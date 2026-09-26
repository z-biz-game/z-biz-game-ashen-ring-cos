import * as THREE from 'three';
import { clamp, damp, angleDamp, lerp } from '../engine/rng.js';
import { makeHumanoid, resetRig } from './parts.js';
import { meleeArc, aoe } from '../combat/hit.js';
import { resolveStats } from '../meta/stats.js';

const G = 23;
const ROLL_DUR = 0.5;
const MOVE_SPEED = 5.35;

const MOVES = {
  l1: { windup: 0.15, active: 0.12, recover: 0.25, arc: 96, reach: 2.45, mul: 1.0, cost: 'lightCost', poise: 9, fwd: 1.7, side: 1, chain: 'l2' },
  l2: { windup: 0.135, active: 0.12, recover: 0.26, arc: 104, reach: 2.5, mul: 1.08, cost: 'lightCost', poise: 10, fwd: 1.8, side: -1, chain: 'l3' },
  l3: { windup: 0.19, active: 0.15, recover: 0.42, arc: 155, reach: 2.8, mul: 1.5, cost: 'lightCost', poise: 19, fwd: 2.2, side: 1, spin: true },
  l4: { windup: 0.17, active: 0.14, recover: 0.46, arc: 190, reach: 2.9, mul: 1.32, cost: 'lightCost', poise: 16, fwd: 1.2, spin: true },
  heavy: { windup: 0.42, active: 0.17, recover: 0.5, arc: 122, reach: 3.0, mul: 2.5, cost: 'heavyCost', poise: 38, fwd: 1.2, heavy: true },
};

const SPELLS = {
  spell1: { cn: '焰牙', en: 'Ember Fang', fp: 12, dur: 0.5, kind: 'projectile', speed: 27, radius: 0.42, dmg: 1.45, color: '#ff9a3c' },
  spell2: { cn: '魂斩', en: 'Soul Slash', fp: 19, dur: 0.55, kind: 'wave', dmg: 1.75, reach: 5.4, arc: 120, color: '#8fd0ff' },
  spell3: { cn: '刃环', en: 'Ring of Blades', fp: 24, dur: 0.7, kind: 'nova', dmg: 1.5, radius: 5.2, color: '#c9a24a' },
};

const WEAPONS = {
  '直剑': { kind: 'straight', dmg: 13, shield: true },
  '战锤': { kind: 'hammer', dmg: 17.5, shield: false },
  '细剑': { kind: 'rapier', dmg: 11.5, shield: false },
  '双匕首': { kind: 'dagger', dmg: 9.5, shield: false },
  '灰烬法杖': { kind: 'staff', dmg: 10.5, shield: false },
};

export class Player {
  constructor(game, cls) {
    this.faction = 'player';
    this.radius = 0.42;
    this.height = 1.78;
    this.cls = cls;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'idle';
    this.stT = 0;
    this.stDur = 0;
    this.move = null;
    this.moveIdx = 0;
    this.hitDone = false;
    this.buffered = null;
    this.chainT = 0;
    this.comboCount = 0;
    this.grounded = true;
    this.iFrameT = 0;
    this.parryT = 0;
    this.parryCd = 0;
    this.rollCd = 0;
    this.blocking = false;
    this.sprinting = false;
    this.speedNorm = 0;
    this.alive = true;
    this.dead = false;
    this.hp = 100;
    this.stamina = 100;
    this.fp = 0;
    this.poise = 40;
    this.estus = 3;
    this.recentHit = 0;
    this.buffs = [];
    this.tempSeq = 0;
    this.dmgBase = 13;
    this.fastTime = false;
    const w = WEAPONS[cls?.weapon] || WEAPONS['直剑'];
    this.weaponKind = w.kind;
    this.dmgBase = w.dmg;
    this.hasShield = !!w.shield;
    this.shieldMul = w.shield ? 0.34 : 0.6;
    this.build();
    this.applyClass(cls);
  }

  build() {
    const c = this.cls?.colors || {};
    this.rig = makeHumanoid({
      armor: c.metal || '#40454e', cloth: c.cloak || '#5a2f28', metal: c.metal || '#9aa0a8',
      skin: '#8a7666', glow: c.glow || '#e8b45a', helm: c.helm || 'closed',
      weapon: this.weaponKind, shield: this.hasShield, cape: true, bulk: 1, eyeGlow: c.eye || null,
    });
    this.mesh = this.rig.root;
    resetRig(this.rig);
  }

  applyClass(cls) {
    this.classStats = { ...(cls?.stats || {}) };
    this.spells = (cls?.spells || Object.keys(SPELLS));
    if (cls?.dmgBase) this.dmgBase = cls.dmgBase;
    if (cls?.weaponKind) this.weaponKind = cls.weaponKind;
    this.recompute([]);
    this.hp = this.s.maxHp;
    this.stamina = this.s.staminaMax;
    this.fp = this.s.fpMax;
    this.poise = this.s.poiseMax;
    this.estus = Math.round(this.s.estusMax);
  }

  recompute(relicIds, curseIds, upgrades) {
    const res = resolveStats({
      classStats: this.classStats,
      relicIds: relicIds !== undefined ? relicIds : this.relicIds || [],
      curseIds: curseIds !== undefined ? curseIds : this.curseIds || [],
      upgrades: upgrades !== undefined ? upgrades : this.upgrades || {},
    });
    this.statBase = res.s;
    this.flags = res.flags;
    this.rerolls = res.rerolls;
    this.relicIds = relicIds !== undefined ? relicIds : this.relicIds || [];
    this.curseIds = curseIds !== undefined ? curseIds : this.curseIds || [];
    this.upgrades = upgrades !== undefined ? upgrades : this.upgrades || {};
    this._tempIdx = -1;
    this.refreshStats();
    return res;
  }

  refreshStats() {
    const s = { ...this.statBase };
    for (const b of this.buffs) {
      if (b.mul !== undefined) s[b.stat] = (s[b.stat] ?? 0) * b.mul;
      else s[b.stat] = (s[b.stat] ?? 0) + b.add;
    }
    const maxHp = Math.round(s.maxHp);
    if (this.maxHp === undefined) { this.maxHp = maxHp; this.hp = maxHp; }
    else if (maxHp !== this.maxHp) {
      const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
      this.maxHp = maxHp;
      this.hp = clamp(Math.round(ratio * maxHp), 1, maxHp);
    }
    this.hp = Math.min(this.hp, maxHp);
    this.stamina = Math.min(this.stamina, s.staminaMax);
    this.fp = Math.min(this.fp, s.fpMax);
    this.s = s;
  }

  addTemp(spec) {
    this.buffs.push(Object.assign({ id: ++this.tempSeq, until: performance.now() / 1000 + spec.dur }, spec));
    this.refreshStats();
    return this.tempSeq;
  }

  tickBuffs(now) {
    if (!this.buffs.length) return;
    const before = this.buffs.length;
    this.buffs = this.buffs.filter((b) => b.until > now);
    if (this.buffs.length !== before) this.refreshStats();
  }

  spend(stat, amount) {
    if (this.s[stat] === undefined) return true;
    if (stat === 'stamina') { if (this.stamina < amount) return false; this.stamina -= amount; return true; }
    if (stat === 'fp') { if (this.fp < amount) return false; this.fp -= amount; return true; }
    return true;
  }

  get busy() { return this.state === 'attack' || this.state === 'heavy' || this.state === 'cast' || this.state === 'drink' || this.state === 'stagger' || this.state === 'summon' || this.dead; }
  get canAct() { return !this.dead && (this.state === 'idle' || this.state === 'run' || this.state === 'block' || this.state === 'roll' && this.stT > 0.28); }

  setState(name, dur) {
    this.state = name;
    this.stT = 0;
    this.stDur = dur;
  }

  startMove(game, key) {
    const mv = MOVES[key];
    const cost = this.s[mv.cost];
    if (!this.spend('stamina', cost)) {
      game.hud.flashStamina();
      game.audio.play('guardBreak', { vol: 0.35 });
      return false;
    }
    this.move = mv;
    this.moveKey = key;
    this.hitDone = false;
    this.setState(mv.heavy ? 'heavy' : 'attack', mv.windup + mv.active + mv.recover);
    this.attackScale = 1 / Math.max(0.5, this.s.attackSpeed);
    this.stDur *= this.attackScale;
    return true;
  }

  update(dt, game) {
    if (this.dead) { this.animate(dt, game); return; }
    const inp = game.input;
    const grid = game.room.grid;
    const now = game.time;
    this.tickBuffs(now);

    this.stT += dt;
    this.chainT = Math.max(0, this.chainT - dt);
    if (this.chainT === 0 && this.state === 'idle') this.comboCount = 0;
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.parryT = Math.max(0, this.parryT - dt);
    this.parryCd = Math.max(0, this.parryCd - dt);
    this.recentHit = Math.max(0, this.recentHit - dt);
    if (this.iFrameT > 0) this.iFrameT -= dt;

    const locked = game.lockTarget && game.lockTarget.alive && !game.lockTarget.dead ? game.lockTarget : null;
    if (inp.justPressed('lock')) this.toggleLock(game, locked);

    if (inp.justPressed('interact')) this.tryInteract(game);
    if (inp.justPressed('estus') && this.canAct && this.estus > 0 && this.s.estusMax > 0 && this.hp < this.maxHp) {
      this.setState('drink', 0.68);
      this.estusUsed = false;
      game.audio.play('estus');
    }
    if (inp.justPressed('ash') && this.canAct) this.summon(game);
    for (const k of ['spell1', 'spell2', 'spell3']) {
      if (inp.justPressed(k) && this.spells.includes(k)) this.cast(game, k);
    }
    if (inp.justPressed('parry') && this.canAct && this.parryCd <= 0) {
      this.parryT = 0.19;
      this.parryCd = 0.62;
      this.setState('parry', 0.42);
      game.audio.play('lockoff', { vol: 0.4, rate: 1.4 });
    }
    if (inp.justPressed('roll') && this.rollCd <= 0 && !this.dead) this.doRoll(game);
    if (inp.justPressed('jump') && this.grounded) {
      this.vel.y = this.s.jumpForce;
      this.grounded = false;
      game.audio.play('jump');
    } else if (inp.justPressed('jump') && !this.grounded && this.flags.doubleJump && !this.usedDouble) {
      this.usedDouble = true;
      this.vel.y = this.s.jumpForce * 0.86;
      game.view.burst(this.pos.x, this.pos.y + 0.6, this.pos.z, { count: 14, color: '#cfe4ff', speed: 3.4, life: 0.45 });
      game.audio.play('jump', { rate: 1.3 });
    }

    const wantLight = inp.justPressed('light');
    const wantHeavy = inp.justPressed('heavy');
    if (this.state === 'attack' || this.state === 'heavy') {
      const phase = this.stT / Math.max(0.001, this.stDur);
      const wu = this.move.windup * this.attackScale;
      const ac = wu + this.move.active * this.attackScale;
      if (!this.hitDone && this.stT >= ac - this.move.active * this.attackScale * 0.55) {
        this.hitDone = true;
        this.resolveSwing(game);
      }
      if (wantLight && phase > 0.42 && this.stT > wu) this.buffered = this.move.chain || (this.flags.chainFour ? 'l4' : null);
      if (wantHeavy && phase > 0.5 && this.stT > wu) this.buffered = 'heavy';
    } else if (this.state === 'roll') {
      if (wantLight && this.stT > 0.3) this.buffered = MOVES[this.lastChain]?.chain || 'l1';
      if (wantHeavy && this.stT > 0.34) this.buffered = 'heavy';
    } else if (this.canAct) {
      if (wantLight) this.beginLight(game);
      else if (wantHeavy) { if (this.startMove(game, 'heavy')) this.lastChain = 'heavy'; }
    }

    if ((this.state === 'attack' || this.state === 'heavy' || this.state === 'roll') && this.stT >= this.stDur) {
      if (this.buffered && this.buffered !== this.moveKey) {
        const b = this.buffered;
        this.buffered = null;
        if (this.startMove(game, b)) { this.lastChain = b; }
        else this.setState(this.grounded ? 'idle' : 'jump', 0);
      } else {
        this.buffered = null;
        this.setState(this.grounded ? 'idle' : 'jump', 0);
      }
    }
    if (this.state === 'parry' && this.stT >= this.stDur) this.setState('idle', 0);
    if (this.state === 'cast' && this.stT >= this.stDur) this.setState('idle', 0);
    if (this.state === 'summon' && this.stT >= this.stDur) this.setState('idle', 0);
    if (this.state === 'drink') {
      if (!this.estusUsed && this.stT > 0.36) {
        this.estusUsed = true;
        const amt = Math.round(this.s.estusHeal);
        this.heal(game, amt);
        this.estus--;
        game.view.burst(this.pos.x, this.pos.y + 1.1, this.pos.z, { count: 22, color: '#ff7a4a', speed: 2.2, life: 0.7, up: 1.4, gravity: -3 });
      }
      if (this.stT >= this.stDur) this.setState('idle', 0);
    }
    if (this.state === 'stagger' && this.stT >= this.stDur) this.setState('idle', 0);

    this.moveAndCollide(dt, game, locked);
    this.regenerate(dt, game);
    this.animate(dt, game);
    this.syncMesh();
    return this;
  }

  beginLight(game) {
    const next = this.chainT > 0 && MOVES[this.lastChain]?.chain ? MOVES[this.lastChain].chain : 'l1';
    if (this.startMove(game, next)) {
      this.lastChain = next;
      this.chainT = 0.55;
    }
  }

  resolveSwing(game) {
    const mv = this.move;
    const hits = meleeArc(game, this, {
      reach: mv.reach, arc: mv.arc, mul: mv.mul, school: mv.heavy ? 'heavy' : 'light',
      poise: mv.poise, heavy: mv.heavy, hitAll: !!mv.spin, maxHits: 4,
      critBonus: (this.flags.critOnLock && game.lockTarget) ? 0.2 : 0,
    });
    if (hits.length) {
      game.hitStop(mv.heavy ? 0.085 : 0.055);
      game.view.shake(mv.heavy ? 1.5 : 0.85);
      this.comboCount += hits.length;
    } else if (this.stT < 0.02) {
      game.audio.play('swing', { vol: mv.heavy ? 0.8 : 0.55, rate: mv.heavy ? 0.8 : 1 + this.moveIdx * 0.06 });
    } else game.audio.play('swing', { vol: 0.42, rate: 0.95 + Math.random() * 0.18 });
    this.moveIdx++;
  }

  doRoll(game) {
    if (!this.spend('stamina', this.s.rollCost)) { game.hud.flashStamina(); return; }
    const inp = game.input;
    const ax = inp.moveAxis();
    const dir = this.rollDir(game, ax);
    this.setState('roll', ROLL_DUR);
    this.rollCd = ROLL_DUR + 0.06;
    this.rollDirVec = dir;
    this.rollSpeed = 8.4 * clamp(this.s.moveSpeed, 0.8, 1.5);
    this.iFrameT = this.s.iframe;
    game.audio.play('roll');
    game.view.puff(this.pos.x, this.pos.y + 0.1, this.pos.z, { count: 5, color: '#6a625a', speed: 1.4, alpha: 0.28 });
    this.buffered = null;
  }

  rollDir(game, ax) {
    const rig = game.rig;
    if (ax.mag < 0.2) return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const dx = rig.forward.x * -ax.y + rig.right.x * ax.x;
    const dz = rig.forward.y * -ax.y + rig.right.y * ax.x;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  moveAndCollide(dt, game, locked) {
    const grid = game.room.grid;
    const inp = game.input;
    const ax = inp.moveAxis();
    const rig = game.rig;
    const moving = ax.mag > 0.08;

    let speed = MOVE_SPEED * this.s.moveSpeed;
    this.sprinting = inp.isDown('sprint') && moving && this.stamina > 2 && this.state !== 'attack';
    if (this.sprinting) {
      speed *= 1.42;
      this.stamina = Math.max(0, this.stamina - this.s.dodgeCost * dt);
    }
    this.blocking = inp.isDown('block') && this.grounded && (this.state === 'idle' || this.state === 'run' || this.state === 'block') && this.stamina > 3;
    if (this.blocking) { this.setStateIfSoft('block'); speed *= 0.52; }
    else if (this.state === 'block') this.setState('idle', 0);

    let mx = 0, mz = 0;
    if (this.state === 'roll' && this.rollDirVec) {
      const k = 1 - Math.pow(clamp(this.stT / ROLL_DUR, 0, 1), 1.7);
      mx = this.rollDirVec.x * this.rollSpeed * k;
      mz = this.rollDirVec.z * this.rollSpeed * k;
    } else if (moving) {
      mx = (rig.forward.x * -ax.y + rig.right.x * ax.x);
      mz = (rig.forward.y * -ax.y + rig.right.y * ax.x);
      const l = Math.hypot(mx, mz) || 1;
      const scale = this.busy ? speed * 0.14 : speed;
      mx = (mx / l) * scale * Math.min(1, ax.mag * 1.35);
      mz = (mz / l) * scale * Math.min(1, ax.mag * 1.35);
    } else if (this.busy) {
      mx = Math.sin(this.yaw) * 1.4;
      mz = Math.cos(this.yaw) * 1.4;
    }

    if (locked && !(this.state === 'roll')) this.yaw = angleDamp(this.yaw, Math.atan2(locked.pos.x - this.pos.x, locked.pos.z - this.pos.z), 12, dt);
    else if ((mx || mz) && !this.busy) this.yaw = angleDamp(this.yaw, Math.atan2(mx, mz), 15, dt);

    const footY = this.pos.y;
    grid.move(this.pos, mx * dt, mz * dt, this.radius, footY);
    this.vel.x = Math.hypot(mx, mz);
    this.speedNorm = clamp(this.vel.x / (MOVE_SPEED * this.s.moveSpeed), 0, 1.6);

    this.vel.y -= G * dt;
    this.pos.y += this.vel.y * dt;
    const sup = grid.support(this.pos.x, this.pos.z, this.radius, this.pos.y + 0.05);
    if (this.pos.y <= sup + 0.02 && this.vel.y <= 0.01) {
      if (!this.grounded) {
        const fall = this.fallFrom !== undefined ? this.fallFrom - this.pos.y : 0;
        this.onLand(game, fall);
      }
      this.pos.y = sup;
      this.vel.y = 0;
      this.grounded = true;
      this.usedDouble = false;
    } else {
      if (this.grounded && this.pos.y - sup > 0.35) { this.grounded = false; this.fallFrom = this.pos.y; }
      else if (!this.grounded && this.pos.y > sup + 0.35) this.fallFrom = Math.max(this.fallFrom ?? this.pos.y, this.pos.y);
      if (!this.grounded && this.state === 'idle') this.setState('jump', 0);
      if (this.grounded === false && this.state === 'jump' && this.vel.y > 0) this.grounded = false;
    }
    if (this.grounded && (this.state === 'jump')) this.setState('idle', 0);
  }

  setStateIfSoft(name) { if (this.state === 'idle' || this.state === 'run' || this.state === name) this.state = name; }

  onLand(game, fallDist) {
    this.grounded = true;
    if (fallDist > 3.2) {
      const dmg = Math.round((fallDist - 3.2) * 7);
      game.audio.play('land', { vol: clamp(fallDist / 8, 0.4, 1) });
      game.view.shake(clamp(fallDist / 5, 0.3, 1.6));
      game.view.puff(this.pos.x, this.pos.y + 0.1, this.pos.z, { count: 10, color: '#736a5e', speed: 2.4, alpha: 0.4 });
      if (dmg > 0) this.takeDamage(game, dmg, { fall: true, dirX: 0, dirZ: 0 });
    } else if (fallDist > 0.6) game.audio.play('land', { vol: 0.45 });
    this.fallFrom = undefined;
  }

  regenerate(dt, game) {
    const attackLock = this.busy || this.recentHit > 0;
    const rate = this.sprinting ? 0 : this.state === 'block' ? this.s.staminaRegen * 0.28 : (attackLock ? this.s.staminaRegen * 0.46 : this.s.staminaRegen);
    this.stamina = Math.min(this.s.staminaMax, this.stamina + rate * dt);
    this.fp = Math.min(this.s.fpMax, this.fp + this.s.fpRegen * dt);
    this.poise = Math.min(this.s.poiseMax, this.poise + this.s.poiseMax * 0.35 * dt);
    if (this.recentHit <= 0 && this.hp < this.maxHp && this.s.hpRegen > 0) this.hp = Math.min(this.maxHp, this.hp + this.s.hpRegen * dt);
  }

  cast(game, key) {
    const sp = SPELLS[key];
    if (!sp || this.busy || !this.grounded) return false;
    if (this.s.fpMax <= 0) { game.toast('未习得法术', 'No sorceries attuned'); return false; }
    if (this.fp < sp.fp) { game.audio.play('guardBreak', { vol: 0.3 }); game.toast('专注不足', 'Not enough FP'); return false; }
    this.fp -= sp.fp;
    this.setState('cast', sp.dur);
    this.castKind = key;
    this.castDone = false;
    this.castSpec = sp;
    game.audio.play(key === 'spell2' ? 'spellBlades' : key === 'spell3' ? 'spellSoul' : 'spellFlame');
    return true;
  }

  finishCast(game) {
    const sp = this.castSpec;
    if (!sp) return;
    const pow = this.s.spellPower * this.s.attack * this.s.spellMul * this.dmgBase;
    if (sp.kind === 'projectile') {
      const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      game.spawnProjectile({
        from: this, pos: this.pos.clone().add(new THREE.Vector3(0, 1.15, 0)).add(dir.clone().multiplyScalar(0.7)),
        dir, speed: sp.speed * (0.9 + pow * 0.004), dmg: pow * sp.dmg, radius: sp.radius * (0.85 + pow * 0.004),
        color: sp.color, life: 1.6, homing: !!this.flags.spellSeek, kind: 'flame',
      });
      game.view.burst(this.pos.x + dir.x, this.pos.y + 1.2, this.pos.z + dir.z, { count: 16, color: sp.color, speed: 4, life: 0.4 });
    } else if (sp.kind === 'wave') {
      const hits = meleeArc(game, this, { reach: sp.reach, arc: sp.arc, mul: sp.dmg * this.s.spellPower, school: 'spell', poise: 14, hitAll: true, maxHits: 6 });
      game.view.burst(this.pos.x + Math.sin(this.yaw) * 2.2, this.pos.y + 1.1, this.pos.z + Math.cos(this.yaw) * 2.2, { count: 34, color: sp.color, speed: 7, life: 0.55, jitter: 1.4 });
      if (hits.length) game.hitStop(0.06);
    } else {
      const hits = aoe(game, this.pos, sp.radius * this.s.spellPower, this.dmgBase * this.s.attack * this.s.spellMul * sp.dmg, { school: 'spell', from: this, faction: 'foe', ignorePlayer: true, poise: 12 });
      game.view.burst(this.pos.x, this.pos.y + 0.6, this.pos.z, { count: 70, color: sp.color, speed: 11, life: 0.6, jitter: 1.2, gravity: -6 });
      game.view.shake(1.4);
      if (hits.length) game.hitStop(0.07);
    }
  }

  summon(game) {
    if (this.s.fpMax <= 0 && !this.flags.ashTwin) { game.toast('无灰烬可召', 'No ashes to summon'); return; }
    if (this.fp < 18) { game.toast('专注不足', 'Not enough FP'); return; }
    if (game.ashes.length >= (this.flags.ashTwin ? 2 : 1)) { game.toast('已有召唤物', 'Already summoned'); return; }
    this.fp -= 18;
    this.setState('summon', 0.8);
    game.summonAsh(this.cls?.ash || 'knight', this.flags.ashTwin ? 2 : 1);
  }

  toggleLock(game, current) {
    if (current) { game.setLock(null); game.audio.play('lockoff'); return; }
    let best = null, bestScore = -1;
    for (const e of game.enemies) {
      if (!e.alive || e.dead || e.avoidLock) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d > 20) continue;
      if (!game.room.grid.los(this.pos.x, this.pos.z, e.pos.x, e.pos.z)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dot = (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / (d || 1);
      const score = dot * 2 - d * 0.06 + (e.boss ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (best) { game.setLock(best); game.audio.play('lockon'); }
    else game.toast('无可锁定目标', 'Nothing to lock');
  }

  tryInteract(game) {
    if (this.busy) return;
    game.interact();
  }

  heal(game, amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.hp > before) game.damageNumber(this.pos, '+' + Math.round(this.hp - before), 'heal');
    game.audio.play('heal');
  }

  takeDamage(game, raw, info = {}) {
    if (this.dead) return false;
    if (this.iFrameT > 0) {
      if (this.flags.healOnRoll && info.from) { this.heal(game, 6); game.view.burst(this.pos.x, this.pos.y + 1, this.pos.z, { count: 12, color: '#9fe8b0', speed: 3, life: 0.5 }); }
      game.audio.play('roll', { vol: 0.35, rate: 1.4 });
      return false;
    }
    if (this.parryT > 0 && info.from && !info.magic && !info.fall && info.school !== 'spell') {
      this.onParry(game, info.from);
      return false;
    }
    let dmg = raw;
    let guarded = false;
    if (this.blocking && info.dirX !== undefined) {
      const facing = Math.sin(this.yaw) * -info.dirX + Math.cos(this.yaw) * -info.dirZ;
      if (facing > -0.15) {
        guarded = true;
        dmg *= this.shieldMul;
        this.stamina -= raw * 0.55 + 6;
        game.audio.play('hitShield', { vol: 0.8 });
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.setState('stagger', 1.1);
          game.audio.play('guardBreak');
          game.hud.toast('守势崩溃', 'GUARD BREAK');
          game.view.shake(2);
        }
      }
    }
    if (!guarded) {
      dmg *= 1 - Math.min(0.62, (this.s.armor || 0) / ((this.s.armor || 0) + 34));
      this.stamina -= raw * 0.18;
    }
    dmg = Math.max(1, Math.round(dmg));
    this.hp -= dmg;
    this.recentHit = 0.6;
    this.parryT = 0;
    this.iFrameT = Math.max(this.iFrameT, 0.22);
    if (!guarded) {
      game.audio.play('hurt', { vol: 0.9 });
      game.view.shake(info.heavy ? 1.7 : 1.05, 0.26);
      game.hud.hitFlash();
      game.damageNumber(this.pos, String(dmg), 'player');
      if (info.dirX !== undefined) {
        this.pos.x += info.dirX * (guarded ? 0.06 : 0.24);
        this.pos.z += info.dirZ * (guarded ? 0.06 : 0.24);
      }
      game.view.burst(this.pos.x, this.pos.y + 1.1, this.pos.z, { count: guarded ? 6 : 14, color: guarded ? '#ffe0a0' : '#c0392b', speed: 4.4, life: 0.35 });
    }
    this.poise -= info.poise || 0;
    if (this.poise <= 0 && !guarded) {
      this.poise = this.s.poiseMax;
      this.setState('stagger', 0.85);
      game.hud.toast('硬直', 'STAGGERED');
    }
    if (this.state === 'attack' || this.state === 'heavy' || this.state === 'cast') this.buffered = null;
    if (this.hp <= 0) this.die(game, info);
    return true;
  }

  onParry(game, attacker) {
    this.parryT = 0;
    this.comboCount = 0;
    if (game.run) game.run.parries++;
    game.audio.play('parry');
    game.hitStop(0.14);
    game.view.shake(1.7);
    game.view.burst(
      (this.pos.x + attacker.pos.x) / 2, this.pos.y + 1.3, (this.pos.z + attacker.pos.z) / 2,
      { count: 40, color: '#fff2c0', speed: 9, life: 0.42, gravity: -6, size: 0.7 }
    );
    if (attacker.setState && attacker.alive) {
      attacker.state = 'stagger';
      attacker.stDur = 1.25;
      attacker.stT = 0;
      attacker.vulnerableUntil = game.time + 1.3;
    }
    if (this.flags.staminaOnParry) this.stamina = this.s.staminaMax;
    game.hud.toast('完美弹反', 'PARRIED');
  }

  die(game, info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.state = 'dead';
    this.alive = false;
    game.audio.play('death');
    game.view.shake(2.2, 0.5);
    game.view.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, { count: 60, color: '#d94a3a', speed: 5.5, life: 1.1, gravity: -8 });
    game.onPlayerDeath(info);
  }

  animate(dt, game) {
    const r = this.rig;
    resetRig(r);
    const t = game.time;
    const sp = this.speedNorm;

    if (this.state === 'roll') {
      const k = clamp(this.stT / ROLL_DUR, 0, 1);
      r.hips.rotation.x = -Math.PI * 2 * k;
      r.hips.position.y = 0.92 - Math.sin(k * Math.PI) * 0.42;
      r.legL.hip.rotation.x = -0.9 * Math.sin(k * Math.PI);
      r.legR.hip.rotation.x = -0.9 * Math.sin(k * Math.PI);
      r.armL.shoulder.rotation.x = -1.2;
      r.armR.shoulder.rotation.x = -1.2;
      r.weapon.rotation.x = -0.4;
      return;
    }

    if (this.state === 'attack' || this.state === 'heavy') {
      const mv = this.move;
      const scale = this.attackScale;
      const wu = mv.windup * scale, ac = wu + mv.active * scale, total = this.stDur;
      const tt = this.stT;
      let k;
      if (tt < wu) k = -1 + (tt / wu);
      else if (tt < ac) k = (tt - wu) / (ac - wu);
      else k = 1 + (tt - ac) / Math.max(0.001, total - ac);
      const side = mv.side || 1;
      if (mv.spin) {
        r.torso.rotation.y = -1.5 + k * 3.0;
        r.hips.rotation.y = k * Math.PI * 2 * side;
        r.armR.shoulder.rotation.z = -1.5 + clamp(k, -1, 1) * 0.4;
        r.armL.shoulder.rotation.z = 1.5 - clamp(k, -1, 1) * 0.4;
        r.weapon.rotation.x = -1.2;
      } else if (mv.heavy) {
        const up = clamp(-k, 0, 1);
        r.armR.shoulder.rotation.x = -2.55 + clamp(k, 0, 1) * 3.4;
        r.armL.shoulder.rotation.x = -2.4 + clamp(k, 0, 1) * 3.2;
        r.torso.rotation.x = -0.45 * up + 0.5 * clamp(k, 0, 1);
        r.torso.rotation.y = -0.5 * up;
        r.weapon.rotation.x = -0.15;
      } else {
        const up = clamp(-k, 0, 1), dn = clamp(k, 0, 1);
        r.armR.shoulder.rotation.x = -1.9 * up + 1.0 * dn;
        r.armR.shoulder.rotation.z = side * (0.9 * up - 0.75 * dn);
        r.armR.elbow.rotation.x = -0.5 - 0.5 * up;
        r.torso.rotation.y = side * (-0.65 * up + 0.55 * dn);
        r.torso.rotation.x = -0.2 * up + 0.3 * dn;
        r.head.rotation.y = side * (-0.3 * up + 0.35 * dn);
        r.hips.rotation.y = side * (-0.2 * up + 0.25 * dn);
        r.weapon.rotation.x = 0.1 * dn;
      }
      r.hips.position.y = 0.9 + (mv.heavy ? -0.06 + 0.1 * clamp(k, 0, 1) : 0);
      if (r.cape) r.cape.rotation.x = 0.25 * clamp(k, 0, 1) - 0.2 * clamp(-k, 0, 1);
      return;
    }

    if (this.state === 'cast' || this.state === 'summon') {
      const k = clamp(this.stT / this.stDur, 0, 1);
      const up = Math.sin(k * Math.PI);
      r.armR.shoulder.rotation.x = -2.3 * up;
      r.armL.shoulder.rotation.x = this.state === 'summon' ? -2.0 * up : -1.4 * up;
      r.torso.rotation.x = -0.16 * up;
      r.head.rotation.x = -0.25 * up;
      if (this.state === 'cast' && !this.castDone && k > 0.34) { this.castDone = true; this.finishCast(game); }
      return;
    }

    if (this.state === 'drink') {
      const k = Math.sin(clamp(this.stT / this.stDur, 0, 1) * Math.PI);
      r.armR.shoulder.rotation.x = -2.1 * k;
      r.armR.elbow.rotation.x = -1.2 * k;
      r.head.rotation.x = -0.35 * k;
      return;
    }

    if (this.state === 'stagger') {
      const k = clamp(this.stT / this.stDur, 0, 1);
      r.torso.rotation.x = 0.42 - 0.3 * k;
      r.head.rotation.x = 0.5;
      r.armL.shoulder.rotation.x = -0.5;
      r.armR.shoulder.rotation.x = -0.4;
      r.hips.position.y = 0.78;
      return;
    }

    if (this.state === 'parry') {
      const k = clamp(this.stT / this.stDur, 0, 1);
      r.armL.shoulder.rotation.x = -1.7;
      r.armL.shoulder.rotation.z = 0.5 - k * 0.6;
      r.armL.elbow.rotation.x = -1.3;
      r.torso.rotation.y = 0.4 - k * 0.7;
      r.weapon.rotation.y = -0.5;
      return;
    }

    if (this.dead) {
      r.hips.rotation.x = -1.35;
      r.hips.position.y = 0.34;
      r.torso.rotation.x = 0.3;
      r.armL.shoulder.rotation.x = -0.7;
      r.armR.shoulder.rotation.x = -0.5;
      return;
    }

    const walk = Math.sin(t * 9.2) * clamp(sp, 0, 1);
    const idleBreath = Math.sin(t * 1.7) * 0.03;
    r.legL.hip.rotation.x = walk * 0.72;
    r.legR.hip.rotation.x = -walk * 0.72;
    r.legL.knee.rotation.x = Math.max(0, -walk) * 0.55;
    r.legR.knee.rotation.x = Math.max(0, walk) * 0.55;
    r.armL.shoulder.rotation.x = -walk * 0.4;
    r.armR.shoulder.rotation.x = walk * 0.32;
    r.armR.shoulder.rotation.z = -0.16;
    r.armL.shoulder.rotation.z = 0.16;
    r.hips.position.y = 0.9 + Math.abs(walk) * 0.045 + idleBreath;
    r.torso.rotation.x = 0.1 * clamp(sp, 0, 1) + idleBreath * 0.5;
    if (this.blocking) {
      r.armL.shoulder.rotation.x = -1.25;
      r.armL.shoulder.rotation.z = 0.35;
      r.armL.elbow.rotation.x = -0.9;
      r.armR.shoulder.rotation.x = -0.55;
      r.torso.rotation.y = 0.28;
      if (r.shield) r.shield.rotation.z = 0.2;
    } else if (r.shield) r.shield.rotation.z = 0;
    if (r.cape) {
      r.cape.rotation.x = 0.1 + clamp(sp, 0, 1) * 0.34 + Math.sin(t * 2.3) * 0.05;
      r.cape.rotation.z = Math.sin(t * 1.6) * 0.05;
    }
    if (!this.grounded) {
      r.legL.hip.rotation.x = -0.5;
      r.legR.hip.rotation.x = 0.25;
      r.armL.shoulder.rotation.x = -0.9;
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  atGrace(game) {
    this.hp = this.maxHp;
    this.stamina = this.s.staminaMax;
    this.fp = this.s.fpMax;
    this.poise = this.s.poiseMax;
    this.estus = Math.round(this.s.estusMax);
  }
}

export { SPELLS, MOVES };
