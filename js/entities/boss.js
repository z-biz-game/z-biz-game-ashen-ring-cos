import * as THREE from 'three';
import { clamp } from '../engine/rng.js';
import { Enemy, ARCHETYPES } from './enemy.js';
import { meleeArc, aoe } from '../combat/hit.js';

const MOVES = {
  sweep: { cn: '横祭', windup: 0.58, reach: 4.6, arc: 200, mul: 1.15, poise: 46, cd: 1.9, sfx: 'bossSweep' },
  cleave: { cn: '裂地', windup: 0.78, reach: 3.9, arc: 90, mul: 1.5, poise: 62, cd: 2.6, aoe: 3.1, shake: 1.9 },
  thrust: { cn: '贯誓', windup: 0.42, reach: 6.4, arc: 44, mul: 1.35, poise: 44, cd: 2.2, dash: 9.5 },
  volley: { cn: '灰雨', windup: 0.72, cd: 3.4, shots: 6, spread: 0.55, dmg: 0.85 },
  ring: { cn: '环焰', windup: 0.95, cd: 4.6, ring: 10, dmg: 0.75 },
  roar: { cn: '唤灵', windup: 1.05, cd: 13, summon: 2 },
};

const BOSS_KINDS = [
  {
    key: 'gatekeeper', hp: 620, dmg: 17, def: 8, speed: 3.0, scale: 1.65, bulk: 1.35,
    armor: '#5b5346', cloth: '#3d2a1c', metal: '#b7a582', glow: '#ffb04a', eye: '#ffca6a',
    weapon: 'greatsword', moves: ['sweep', 'cleave', 'thrust', 'roar'], runes: [220, 320],
    title: '灰烬守门人', sub: 'Gatekeeper of Ash',
  },
  {
    key: 'penitent', hp: 840, dmg: 21, def: 12, speed: 3.4, scale: 1.75, bulk: 1.3,
    armor: '#6a3d46', cloth: '#2a1a28', metal: '#cbb2a0', glow: '#e0708a', eye: '#ffd0e0',
    weapon: 'twinblade', moves: ['sweep', 'thrust', 'volley', 'cleave', 'roar'], runes: [340, 460],
    title: '双面忏悔者', sub: 'The Twin-Faced Penitent',
  },
  {
    key: 'nameless', hp: 1250, dmg: 26, def: 16, speed: 3.7, scale: 2.0, bulk: 1.5,
    armor: '#3a2f52', cloth: '#1b1430', metal: '#d8c071', glow: '#ffd479', eye: '#fff0b0',
    weapon: 'greatsword', moves: ['sweep', 'cleave', 'thrust', 'volley', 'ring', 'roar'], runes: [620, 880],
    title: '灰烬王 · 环中无名者', sub: 'Ashen Crown, the Nameless Within',
  },
];

export class Boss extends Enemy {
  constructor(game, depth, pos) {
    const k = BOSS_KINDS[clamp(depth, 0, 2)];
    const mul = game.depthMod?.enemyMul || { hp: 1, dmg: 1 };
    super(game, 'guard', pos, { hp: mul.hp, dmg: mul.dmg }, {
      cfg: {
        ...ARCHETYPES.guard, hp: k.hp, dmg: k.dmg, def: k.def, speed: k.speed, scale: k.scale, bulk: k.bulk,
        armor: k.armor, cloth: k.cloth, metal: k.metal, weapon: k.weapon, helm: 'horns', aggro: 40,
        reach: 4.4, windup: 0.6, recover: 0.6, cooldown: 1.8, poise: 999, super: true, style: 'boss', cape: true,
      },
      runes: k.runes,
    });
    this.kind = 'boss';
    this.boss = true;
    this.def = k;
    this.isEnemy = true;
    this.faction = 'foe';
    this.radius = 0.72;
    this.title = k.title;
    this.sub = k.sub;
    this.phases = 2;
    this.phase = 1;
    this.cool = 1.4;
    this.intro = true;
    this.introT = 0;
    this.revealed = false;
    this.aggro = 40;
    this.avoidLock = false;
    this.blocking = false;
    this.comboLeft = 0;
    this.groundFireT = 6;
    this.speedMul = 1;
    this.name = k.title;
    this.eyes = this.mesh.userData.eyes;
  }

  update(dt, game) {
    if (this.intro) {
      this.introT += dt;
      this.facePos(game.player.pos.x, game.player.pos.z, 2.2, dt);
      this.rig.armR.shoulder.rotation.x = -0.4 - Math.sin(this.introT * 2) * 0.1;
      this.rig.torso.rotation.x = -0.12;
      if (this.introT > 0.4 && !this.revealed) {
        this.revealed = true;
        game.audio.play('bossRoar');
        game.audio.startAmbience(1.6);
        game.view.shake(1.6, 0.7);
        game.hud.showBoss(this.def.title, this.def.sub, this.maxHp);
      }
      this.pos.y = this.homeY;
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
      if (this.introT > 1.5) { this.intro = false; resetPose(this); }
      return;
    }
    if (this.dead) { this.deathAnim(dt, game); return; }
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) this.enterPhase2(game);
    this.stT += dt;
    this.spawnT += dt;
    const p = game.player;
    const d = this.dist(game);

    if (this.state === 'combat' || this.state === 'idle' || this.state === 'alert') {
      this.cool -= dt;
      const inRange = d < 7.4;
      if (this.cool <= 0 && (inRange || this.lastRequestMove === 'roar' || d < 15)) {
        const move = this.pickMove(game, d);
        this.beginMove(game, move);
      } else if (d > 5.5) {
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        this.facePos(p.pos.x, p.pos.z, 5, dt);
        this.stepMove(game, dt, dx / l, dz / l, this.cfg.speed * this.speedMul);
        this.walkPhase += dt * 6;
      } else {
        this.facePos(p.pos.x, p.pos.z, 4, dt);
        this.stepMove(game, dt, -Math.cos(this.yaw) * this.strafe, Math.sin(this.yaw) * this.strafe, this.cfg.speed * 0.4);
        this.walkPhase += dt * 3;
      }
      if (!this.strafeT || this.strafeT <= 0) { this.strafeT = game.rng.range(1, 2.2); this.strafe = game.rng.chance(0.5) ? 1 : -1; }
      this.strafeT -= dt;
    } else if (this.state === 'windup') this.runWindup(dt, game, d);
    else if (this.state === 'dash') this.runDash(dt, game);
    else if (this.state === 'recover') {
      if (this.comboLeft > 0 && this.stT > 0.34) {
        const next = this.comboQueue.shift();
        this.comboLeft--;
        if (next) this.beginMove(game, next, 0.62);
        else { this.setState('combat', 0); this.cool = this.lastCd * game.rng.range(0.85, 1.15); }
      } else if (this.stT > (this.move?.cd ?? 1) * 0.5) {
        this.setState('combat', 0);
        this.cool = (this.lastCd || 1.5) * game.rng.range(0.8, 1.1);
      }
    } else if (this.state === 'stagger') {
      if (this.stT >= this.stDur) this.setState('combat', 0);
    }

    if (this.phase >= 2) {
      this.groundFireT -= dt;
      if (this.groundFireT <= 0) {
        this.groundFireT = 5.5;
        game.spawnGroundFire(this.pos, 3.4, this.dmgBase * 0.42);
      }
    }
    this.physics(dt, game, game.room.grid);
    this.animateBoss(dt, game);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (game.hud) game.hud.setBossHp(this.hp / this.maxHp, this.phase);
    if (this.eyes) this.eyes.material.emissiveIntensity = 2.6 + Math.sin(game.time * 6) * 0.7;
  }

  pickMove(game, d) {
    const list = this.def.moves.filter((m) => (m === 'volley' || m === 'ring' ? d > 4.5 : true));
    const recent = this.recentMoves || [];
    const pool = list.filter((m) => recent[recent.length - 1] !== m);
    const key = game.rng.pick(pool.length ? pool : list);
    recent.push(key);
    this.recentMoves = recent.slice(-3);
    if (key === 'roar' && (game.enemies.filter((e) => e.alive && !e.dead && !e.boss).length > 3)) return MOVES.sweep;
    return MOVES[key];
  }

  beginMove(game, move, speedScale = 1) {
    this.move = move;
    this.moveSpeed = (this.phase >= 2 ? 0.76 : 1) * speedScale;
    this.hitDone = false;
    this.lastCd = move.cd * (this.phase >= 2 ? 0.8 : 1);
    this.setState('windup', 0);
    this.stT = 0;
    game.audio.play('swing', { vol: 0.3, rate: move === MOVES.thrust ? 1.1 : 0.55 });
  }

  runWindup(dt, game, d) {
    const m = this.move;
    const wu = m.windup * this.moveSpeed;
    this.facePos(game.player.pos.x, game.player.pos.z, m === MOVES.thrust ? 3 : 6.5, dt);
    this.telegraph.material.opacity = 0.4 + Math.sin(this.stT * 26) * 0.25;
    const s = (m.reach || 5) * 0.55;
    this.telegraph.scale.set(s, 1, s);
    if (this.stT >= wu) {
      this.telegraph.material.opacity = 0;
      this.execMove(game, m);
    }
  }

  execMove(game, m) {
    if (m === MOVES.roar) {
      game.audio.play('bossRoar', { vol: 0.9 });
      game.view.shake(2.2, 0.6);
      game.view.burst(this.pos.x, this.pos.y + 2, this.pos.z, { count: 90, color: this.def.glow, speed: 9, life: 1, gravity: -3 });
      for (let i = 0; i < m.summon; i++) {
        const a = game.rng.range(0, Math.PI * 2);
        game.spawnMinion('hollow', { x: this.pos.x + Math.cos(a) * 5, z: this.pos.z + Math.sin(a) * 5 });
      }
      game.hud.toast(this.def.title + ' 唤来余烬', 'ASHES ANSWER');
      this.setState('recover', 0);
      return;
    }
    if (m === MOVES.volley || m === MOVES.ring) {
      const base = Math.atan2(game.player.pos.x - this.pos.x, game.player.pos.z - this.pos.z);
      const n = m.shots || m.ring;
      const spread = m.spread || (Math.PI * 2 / n);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * (m.shots ? spread / n : spread);
        game.spawnProjectile({
          from: this, faction: 'foe',
          pos: new THREE.Vector3(this.pos.x, this.pos.y + 1.9, this.pos.z),
          dir: new THREE.Vector3(Math.sin(a), m.ring ? -0.12 : 0.12, Math.cos(a)),
          speed: 15 + i * 0.4, dmg: this.dmgBase * m.dmg, radius: 0.42, color: this.def.glow, life: 2.6, kind: 'flame', gravity: m.ring ? -6 : 0,
        });
      }
      game.audio.play('spellBlades');
      this.setState('recover', 0);
      return;
    }
    if (m === MOVES.thrust) {
      this.setState('dash', 0);
      this.dashT = 0;
      this.dashDir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      this.dashHit = false;
      game.audio.play('bossSweep', { vol: 0.6 });
      return;
    }
    const hits = meleeArc(game, this, { reach: m.reach, arc: m.arc, mul: m.mul, school: 'heavy', poise: m.poise, heavy: true, hitAll: true, maxHits: 4 });
    game.audio.play('bossSweep');
    game.view.shake(m.shake || 1.3);
    game.view.burst(this.pos.x + Math.sin(this.yaw) * 2.2, 0.4, this.pos.z + Math.cos(this.yaw) * 2.2, {
      count: 34, color: this.def.glow, speed: 8, life: 0.5, gravity: -9,
    });
    if (m.aoe) {
      aoe(game, { x: this.pos.x + Math.sin(this.yaw) * 2.4, z: this.pos.z + Math.cos(this.yaw) * 2.4 }, m.aoe, this.dmgBase * 0.7, { faction: 'foe', from: this, school: 'spell', poise: 40, ignorePlayer: false });
      game.view.puff(this.pos.x, 0.4, this.pos.z, { count: 18, color: '#6d6357', speed: 4, alpha: 0.4, grow: 1.6 });
      game.spawnGroundFire({ x: this.pos.x + Math.sin(this.yaw) * 2.4, z: this.pos.z + Math.cos(this.yaw) * 2.4 }, m.aoe * 0.8, this.dmgBase * 0.28, 4);
    }
    if (hits.length) game.hitStop(0.075);
    if (this.comboLeft > 0) { this.setState('recover', 0); return; }
    this.setState('recover', 0);
  }

  runDash(dt, game) {
    this.dashT += dt;
    const dur = 0.5 * this.moveSpeed;
    if (this.dashT < dur) {
      const speed = (this.move.dash || 9) * (1 - this.dashT / dur * 0.35);
      this.stepMove(game, dt, this.dashDir.x, this.dashDir.z, speed);
      this.walkPhase += dt * 10;
      if (!this.dashHit) {
        const p = game.player;
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        if (Math.hypot(dx, dz) < this.radius + p.radius + 1.5) {
          this.dashHit = true;
          p.takeDamage(game, this.dmgBase * this.move.mul, { dirX: this.dashDir.x, dirZ: this.dashDir.z, poise: this.move.poise, heavy: true, from: this, school: 'heavy' });
          game.hitStop(0.09);
          game.view.shake(2.4);
        }
      }
      game.view.burst(this.pos.x, this.pos.y + 0.4, this.pos.z, { count: 3, color: this.def.glow, speed: 1.6, life: 0.35, gravity: -1 });
    } else {
      this.setState('recover', 0);
    }
  }

  enterPhase2(game) {
    this.phase = 2;
    this.speedMul = 1.14;
    this.cool = 1.1;
    this.setState('stagger', 1.2);
    game.audio.play('bossRoar', { vol: 1 });
    game.audio.setAmbienceMood(2);
    game.view.shake(2.6, 0.9);
    game.hitStop(0.22);
    game.view.burst(this.pos.x, this.pos.y + 1.6, this.pos.z, { count: 160, color: this.def.glow, speed: 13, life: 1.3, gravity: -4, jitter: 1.6, grow: 1.4 });
    this.rig.materials.forEach((m) => { if (m.emissive) { m.emissive.set(this.def.glow); m.emissiveIntensity = 0.55; } });
    game.hud.toast('第二形态', 'SECOND PHASE');
    game.hud.phaseFlash();
  }

  takeDamage(game, raw, info = {}) {
    const res = super.takeDamage(game, raw, info);
    if (this.state === 'idle' || this.state === 'alert' || this.intro) { this.intro = false; this.setState('combat', 0); }
    return res;
  }

  animateBoss(dt, game) {
    const r = this.rig;
    const t = game.time;
    const st = this.state;
    const m = this.move;
    if (st === 'windup' && m) {
      const wu = m.windup * this.moveSpeed;
      const k = clamp(this.stT / wu, 0, 1);
      if (m === MOVES.thrust) {
        r.armR.shoulder.rotation.x = -1.5 * k;
        r.torso.rotation.x = 0.45 * k;
        r.hips.position.y = 0.9 * this.cfg.scale - 0.1 * k;
      } else if (m === MOVES.volley || m === MOVES.ring) {
        r.armR.shoulder.rotation.x = -2.6 * k;
        r.armL.shoulder.rotation.x = -2.6 * k;
        r.torso.rotation.x = -0.3 * k;
        r.head.rotation.x = -0.4 * k;
      } else if (m === MOVES.roar) {
        r.armR.shoulder.rotation.x = -2.2 * k;
        r.armL.shoulder.rotation.x = -1.2 * k;
        r.head.rotation.x = -0.6 * k;
        r.torso.rotation.x = -0.25 * k;
      } else {
        const spin = m.arc > 150;
        r.armR.shoulder.rotation.x = spin ? -1.2 * k : -2.3 * k;
        r.armR.shoulder.rotation.z = spin ? 0 : 0.9 * k;
        r.torso.rotation.y = (spin ? -1.2 : -0.6) * k;
        r.hips.rotation.y = (m === MOVES.cleave ? 0 : -0.4) * k;
        r.hips.position.y = (0.9 - 0.12 * k) * this.cfg.scale;
        if (r.cape) r.cape.rotation.x = 0.35 * k;
      }
      return;
    }
    if (st === 'recover' && m) {
      const k = clamp(this.stT / 0.4, 0, 1);
      r.torso.rotation.y = (1 - k) * 0.6;
      r.armR.shoulder.rotation.x = (1 - k) * 0.9;
    }
    if (st === 'stagger') {
      r.torso.rotation.x = 0.55;
      r.head.rotation.x = 0.5;
      r.hips.position.y = (0.86 - Math.sin(t * 12) * 0.02) * this.cfg.scale;
      return;
    }
    const w = Math.sin(this.walkPhase) * (st === 'combat' || st === 'dash' ? 0.55 : 0.06);
    r.legL.hip.rotation.x = w;
    r.legR.hip.rotation.x = -w;
    r.legL.knee.rotation.x = Math.max(0, -w) * 0.45;
    r.legR.knee.rotation.x = Math.max(0, w) * 0.45;
    r.armL.shoulder.rotation.x = -w * 0.3;
    r.armR.shoulder.rotation.x = 0.2 + w * 0.25;
    r.armR.shoulder.rotation.z = -0.28;
    r.hips.position.y = (0.9 + Math.abs(w) * 0.05 + Math.sin(t * 1.3) * 0.015) * this.cfg.scale;
    r.torso.rotation.x = 0.08;
    if (r.cape) r.cape.rotation.x = 0.14 + Math.abs(w) * 0.28 + Math.sin(t * 1.9) * 0.04;
    this.walkPhase += dt * (st === 'combat' || st === 'dash' ? this.cfg.speed * 1.8 : 0.6);
  }

  deathAnim(dt, game) {
    this.deathT = (this.deathT || 0) + dt;
    const k = clamp(this.deathT / 2.2, 0, 1);
    this.mesh.rotation.x = -k * 1.1;
    this.mesh.position.copy(this.pos);
    this.mesh.position.y -= k * 0.5;
    this.mesh.rotation.y = this.yaw;
    if (!this.ashed && this.deathT > 0.6) {
      this.ashed = true;
      game.audio.play('largeEnemyDie', { rate: 0.6 });
      game.view.burst(this.pos.x, this.pos.y + 1.6, this.pos.z, { count: 200, color: this.def.glow, speed: 7, life: 2.2, gravity: -3, jitter: 1.8, grow: 1.6 });
      game.view.shake(2.6, 1.2);
      this.mesh.visible = false;
      game.onBossKilled(this);
    }
    if (this.deathT > 2.4) this.dispose();
  }

  kill(game, info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.alive = false;
    this.deathT = 0;
    game.setLock(null);
  }
}

function resetPose(boss) {
  const r = boss.rig;
  r.hips.rotation.set(0, 0, 0);
  r.torso.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
  r.armL.shoulder.rotation.set(0, 0, 0);
  r.armR.shoulder.rotation.set(0, 0, 0);
}

export { BOSS_KINDS, MOVES as BOSS_MOVES };
