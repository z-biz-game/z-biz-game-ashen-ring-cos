import * as THREE from 'three';
import { clamp, damp, angleDamp, distSq } from '../engine/rng.js';
import { makeHumanoid, resetRig, mat } from './parts.js';
import { meleeArc } from '../combat/hit.js';

export const ARCHETYPES = {
  hollow: { cn: '空壳游魂', en: 'Hollow Remnant', hp: 58, dmg: 8.5, def: 0, speed: 2.7, aggro: 11, reach: 2.2, arc: 100, windup: 0.5, recover: 0.5, cooldown: 1.5, runes: [9, 16], poise: 26, style: 'melee', scale: 1, bulk: 0.9, helm: 'hood', armor: '#4a4038', cloth: '#33291f', weapon: 'curved' },
  knight: { cn: '誓灰骑士', en: 'Ashbound Knight', hp: 104, dmg: 12, def: 6, speed: 2.9, aggro: 13, reach: 2.4, arc: 95, windup: 0.42, recover: 0.55, cooldown: 1.8, runes: [18, 30], poise: 48, style: 'shield', scale: 1.05, bulk: 1.15, helm: 'closed', armor: '#545a63', cloth: '#4a2d24', weapon: 'straight', shield: true },
  archer: { cn: '破誓弓手', en: 'Oathbreaker Archer', hp: 52, dmg: 10, def: 1, speed: 3.1, aggro: 17, reach: 15, windup: 0.62, recover: 0.5, cooldown: 2.1, runes: [14, 22], poise: 22, style: 'ranged', scale: 1, bulk: 0.92, helm: 'hood', armor: '#43404b', cloth: '#2f3a30', weapon: 'bow' },
  wraith: { cn: '灰烬怨灵', en: 'Cinder Wraith', hp: 62, dmg: 11, def: 0, speed: 4.4, aggro: 15, reach: 2.6, arc: 130, windup: 0.36, recover: 0.42, cooldown: 1.2, runes: [16, 26], poise: 20, style: 'flurry', scale: 1.08, bulk: 0.85, helm: 'none', armor: '#2f2b3a', cloth: '#1b1826', weapon: 'dagger', hover: true, ethereal: true },
  guard: { cn: '残树守卫', en: 'Siege Tree-Guard', hp: 210, dmg: 21, def: 10, speed: 2.2, aggro: 12, reach: 3.4, arc: 150, windup: 0.8, recover: 0.85, cooldown: 2.6, runes: [40, 62], poise: 100, style: 'large', scale: 1.5, bulk: 1.5, helm: 'horns', armor: '#4b4436', cloth: '#2b2417', weapon: 'hammer', super: true },
  zealot: { cn: '燃血狂信者', en: 'Bloodburn Zealot', hp: 68, dmg: 9, def: 2, speed: 3.0, aggro: 16, reach: 12, windup: 0.5, recover: 0.6, cooldown: 2.4, runes: [22, 34], poise: 28, style: 'healer', scale: 1.02, bulk: 0.95, helm: 'hood', armor: '#6a4f2c', cloth: '#7a2f22', weapon: 'chime' },
};

const ASHES = {
  knight: { cn: '灰烬武具', hp: 90, dmg: 9, speed: 4.1, reach: 2.4, scale: 0.98, armor: '#6d5a3a', cloth: '#3a2a20', weapon: 'curved' },
};

export class Enemy {
  constructor(game, kind, pos, scaleMul = { hp: 1, dmg: 1 }, opts = {}) {
    const cfg = Object.assign({}, ARCHETYPES[kind] || ARCHETYPES.hollow, opts.cfg || {});
    this.kind = kind;
    this.cfg = cfg;
    this.faction = 'foe';
    this.isEnemy = true;
    this.radius = 0.42 * cfg.bulk;
    this.height = 1.75 * cfg.scale;
    this.pos = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, 0, pos.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.state = 'idle';
    this.stT = 0;
    this.stDur = 0;
    this.phase = 0;
    this.hitDone = false;
    this.alive = true;
    this.dead = false;
    this.spawnT = 0;
    this.maxHp = Math.round(cfg.hp * scaleMul.hp);
    this.hp = this.maxHp;
    this.poise = cfg.poise;
    this.poiseMax = cfg.poise;
    this.dmgBase = cfg.dmg * scaleMul.dmg;
    this.s = { armor: cfg.def, attack: 1, lightMul: 1, critChance: 0, critMul: 1, rangeMul: 1, poiseMul: 1 };
    this.runes = opts.runes ?? [cfg.runes[0], cfg.runes[1]];
    this.walkPhase = game.rng.range(0, 6.28);
    this.wanderTarget = null;
    this.stuck = 0;
    this.blocking = false;
    this.attention = 0;
    this.hoverY = cfg.hover ? 0.55 : 0;
    this.build();
    this.pos.y = game.room.grid.support(this.pos.x, this.pos.z, this.radius, 0.2) + this.hoverY;
    this.homeY = this.pos.y;
  }

  build() {
    const c = this.cfg;
    this.rig = makeHumanoid({
      armor: c.armor, cloth: c.cloth, metal: '#7d7a72', skin: '#6b5c4c', glow: '#c05a3a',
      helm: c.helm, weapon: c.weapon, shield: c.shield, cape: c.style === 'large' ? false : true,
      scale: c.scale, bulk: c.bulk, eyeGlow: c.ethereal ? '#8fd0ff' : '#d06a3a',
    });
    this.mesh = this.rig.root;
    if (c.ethereal) {
      this.mesh.traverse((o) => {
        if (o.isMesh && o.material?.isMeshStandardMaterial) {
          o.material.transparent = true;
          o.material.opacity = 0.72;
          o.material.emissive = new THREE.Color('#3a5f8a');
          o.material.emissiveIntensity = 0.5;
          o.castShadow = false;
        }
      });
    }
    resetRig(this.rig);
    this.telegraph = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 22).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ff7a4a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.telegraph.position.y = 0.04;
    this.mesh.add(this.telegraph);
  }

  setState(name, dur) {
    if (this.state === name && dur && this.stDur === dur) { this.stT = 0; return; }
    this.state = name;
    this.stT = 0;
    this.stDur = dur;
  }

  dist(game) { return Math.hypot(game.player.pos.x - this.pos.x, game.player.pos.z - this.pos.z); }
  canSee(game) {
    const p = game.player;
    if (p.dead) return false;
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    return d < this.cfg.aggro * (p.s?.aggroMul ?? 1) && (d < 4 || game.room.grid.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z));
  }

  facePos(x, z, rate, dt) { this.yaw = angleDamp(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z), rate, dt); }

  stepMove(game, dt, dirX, dirZ, speed) {
    const grid = game.room.grid;
    const before = { x: this.pos.x, z: this.pos.z };
    grid.move(this.pos, dirX * speed * dt, dirZ * speed * dt, this.radius, this.pos.y - this.hoverY + 0.05);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if (moved < speed * dt * 0.35) {
      this.stuck += dt;
      this.avoid = this.avoid || 0;
      this.avoid = this.avoid || (game.rng.chance(0.5) ? 1 : -1);
      return false;
    }
    this.stuck = Math.max(0, this.stuck - dt * 2);
    this.avoid = 0;
    return true;
  }

  update(dt, game) {
    if (this.dead) { this.deathAnim(dt, game); return; }
    this.spawnT += dt;
    this.stT += dt;
    if (this.vulnerableUntil && this.vulnerableUntil < game.time) this.vulnerableUntil = 0;
    const p = game.player;
    const d = this.dist(game);
    const grid = game.room.grid;

    if (this.state === 'idle' || this.state === 'patrol') {
      if (this.canSee(game)) this.wake(game);
      else this.patrol(dt, game, d);
    }

    if (this.state === 'alert') {
      this.facePos(p.pos.x, p.pos.z, 8, dt);
      if (this.stT > 0.35) this.setState('combat', 0);
    }

    if (this.state === 'combat') this.brain(dt, game, d);
    else if (this.state === 'windup') {
      this.facePos(p.pos.x, p.pos.z, 5, dt);
      const wu = this.cfg.windup * (this.fastWindup || 1);
      this.telegraph.material.opacity = 0.35 + Math.sin(this.stT * 22) * 0.2;
      if (!this.hitDone && this.stT >= wu * 0.82) { this.hitDone = true; this.strike(game, d); }
      if (this.stT >= wu + (this.cfg.recover || 0.5)) { this.setState('combat', 0); this.cool = (this.cfg.cooldown || 1.6) * game.rng.range(0.85, 1.2); this.telegraph.material.opacity = 0; }
    } else if (this.state === 'recover') {
      if (this.stT > 0.35) this.setState('combat', 0);
    } else if (this.state === 'cast') {
      if (this.stT > 0.7) { this.healPulse(game); this.setState('combat', 0); this.cool = 3.2; }
    } else if (this.state === 'charge') this.doCharge(dt, game);
    else if (this.state === 'stagger') {
      this.vel.x *= 0.85;
      if (this.stT >= this.stDur) this.setState('combat', 0);
    }

    if (this.state === 'charge') { /* handled in doCharge */ }
    else if (this.state !== 'windup' && this.state !== 'stagger' && this.state !== 'idle') {
      this.vel.x = damp(this.vel.x, 0, 8, dt);
    }

    this.physics(dt, game, grid);
    this.animate(dt, game, d);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (this.cool) this.cool = Math.max(0, this.cool - dt);
  }

  wake(game) {
    if (this.woke) return;
    this.woke = true;
    this.cool = game.rng.range(0.25, 0.95);
    game.audio.play('hurt', { vol: 0.3, rate: 0.52 });
    this.setState('alert', 0);
    for (const e of game.enemies) {
      if (e !== this && !e.dead && e.state === 'idle' && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 12) e.setState('alert', 0);
    }
  }

  patrol(dt, game, d) {
    if (!this.wanderTarget || Math.hypot(this.pos.x - this.wanderTarget.x, this.pos.z - this.wanderTarget.z) < 0.6 || this.rngT === undefined) {
      if (!this.wanderCd || this.wanderCd <= 0) {
        const a = game.rng.range(0, Math.PI * 2), r = game.rng.range(1.5, 4);
        const tx = this.pos.x + Math.cos(a) * r, tz = this.pos.z + Math.sin(a) * r;
        if (!game.room.grid.blocked(tx, tz, this.radius, this.pos.y)) this.wanderTarget = { x: tx, z: tz };
        this.wanderCd = game.rng.range(1.4, 3.4);
      }
    }
    this.wanderCd = (this.wanderCd || 0) - dt;
    if (this.wanderTarget) {
      const dx = this.wanderTarget.x - this.pos.x, dz = this.wanderTarget.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      this.facePos(this.wanderTarget.x, this.wanderTarget.z, 4, dt);
      this.stepMove(game, dt, dx / l, dz / l, this.cfg.speed * 0.42);
      this.walkPhase += dt * 4;
    } else this.walkPhase += dt * 0.6;
  }

  approach(game, dt, want, speed) {
    const p = game.player;
    const target = game.taunt && game.taunt.alive && !game.taunt.dead ? game.taunt : p;
    let dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    if (this.stuck > 0.35 && this.avoid) {
      const px = -dz * this.avoid, pz = dx * this.avoid;
      dx = dx * 0.3 + px; dz = dz * 0.3 + pz;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }
    this.facePos(target.pos.x, target.pos.z, 9, dt);
    if (d > want + 0.6) this.stepMove(game, dt, dx, dz, speed);
    else if (d < want - 0.9) this.stepMove(game, dt, -dx, -dz, speed * 0.8);
    else this.stepMove(game, dt, -dz * this.strafe, dx * this.strafe, speed * 0.62);
    this.walkPhase += dt * (3 + speed);
    return d;
  }

  brain(dt, game, d) {
    const c = this.cfg;
    this.strafe = this.strafe || (game.rng.chance(0.5) ? 1 : -1);
    if (!this.strafeT || this.strafeT <= 0) { this.strafeT = game.rng.range(1.2, 2.6); if (game.rng.chance(0.35)) this.strafe *= -1; }
    this.strafeT -= dt;

    if (c.style === 'shield') {
      this.blocking = (game.player.state === 'attack' || game.player.state === 'heavy') && d < 4.2 && !game.player.move?.spin;
    }
    if (c.style === 'healer') {
      const hurt = game.enemies.find((e) => e !== this && e.alive && !e.dead && e.hp < e.maxHp * 0.6 && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 13);
      if (hurt && (!this.cool || this.cool <= 0)) { this.setState('cast', 0); this.healTarget = hurt; return; }
      this.approach(game, dt, 9, c.speed);
      return;
    }
    if (c.style === 'ranged') {
      if (d < 6) { this.approach(game, dt, 11, c.speed); }
      else if (d > 15) this.approach(game, dt, 12, c.speed);
      else { this.facePos(game.player.pos.x, game.player.pos.z, 7, dt); this.stepMove(game, dt, -Math.cos(this.yaw) * this.strafe, Math.sin(this.yaw) * this.strafe, c.speed * 0.6); this.walkPhase += dt * 3; }
      if ((!this.cool || this.cool <= 0) && d < 17 && game.room.grid.los(this.pos.x, this.pos.z, game.player.pos.x, game.player.pos.z)) this.shoot(game);
      return;
    }
    if (c.style === 'large') {
      if (d > 9 && (!this.cool || this.cool <= 0) && game.rng.chance(0.03)) { this.startCharge(game); return; }
      this.approach(game, dt, c.reach * 0.8, c.speed);
      if ((!this.cool || this.cool <= 0) && d < c.reach * 1.25) this.telegraphStrike(game);
      return;
    }
    if (c.style === 'flurry') {
      if (d > 13) this.fade(game);
      this.approach(game, dt, c.reach * 0.7, c.speed);
      if ((!this.cool || this.cool <= 0) && d < c.reach * 1.2) this.telegraphStrike(game, 0.7);
      return;
    }
    this.approach(game, dt, c.reach * 0.75, c.speed);
    if ((!this.cool || this.cool <= 0) && d < c.reach * 1.15) this.telegraphStrike(game);
  }

  telegraphStrike(game, speed = 1, opts = {}) {
    this.hitDone = false;
    this.fastWindup = speed;
    this.nextStrike = opts;
    this.setState('windup', 0);
    game.audio.play('swing', { vol: 0.22, rate: 0.62 });
  }

  strike(game, d) {
    this.telegraph.material.opacity = 0;
    const c = this.cfg;
    const o = this.nextStrike || {};
    game.audio.play('swing', { vol: 0.5, rate: 0.82 });
    if (o.aoe) {
      game.view.shake(1.3);
      game.view.burst(this.pos.x + Math.sin(this.yaw) * 1.8, 0.3, this.pos.z + Math.cos(this.yaw) * 1.8, { count: 30, color: '#8b7a5e', speed: 6, life: 0.6, gravity: -8 });
      game.audio.play('bossStomp', { vol: 0.55 });
    }
    const hits = meleeArc(game, this, { reach: o.reach ?? c.reach, arc: o.arc ?? c.arc, mul: o.mul ?? 1, school: 'light', poise: o.poise ?? (c.style === 'large' ? 40 : 14), heavy: c.style === 'large' });
    if (hits.length) { game.hitStop(0.05); this.setState('recover', 0); return; }
    this.setState('recover', 0);
  }

  shoot(game) {
    this.hitDone = false;
    this.fastWindup = 1;
    this.setState('windup', 0);
    this.nextStrike = { projectile: true };
    const p = game.player;
    this.aim = { x: p.pos.x + p.vel.x * 0.25 - this.pos.x, z: p.pos.z - this.pos.z };
    game.audio.play('doorOpen', { vol: 0.3, rate: 1.6 });
  }

  fireProjectile(game) {
    const l = Math.hypot(this.aim.x, this.aim.z) || 1;
    game.spawnProjectile({
      from: this, faction: 'foe',
      pos: new THREE.Vector3(this.pos.x + (this.aim.x / l) * 0.6, this.pos.y + 1.25, this.pos.z + (this.aim.z / l) * 0.6),
      dir: new THREE.Vector3(this.aim.x / l, 0, this.aim.z / l),
      speed: 17, dmg: this.dmgBase, radius: 0.3, color: '#d8c48a', life: 2.2, kind: 'arrow', gravity: -2,
    });
    game.audio.play('projectile');
  }

  healPulse(game) {
    const t = this.healTarget;
    if (!t || !t.alive) return;
    const amt = Math.round(t.maxHp * 0.24);
    t.hp = Math.min(t.maxHp, t.hp + amt);
    game.view.burst(t.pos.x, t.pos.y + 1.1, t.pos.z, { count: 24, color: '#ff8a5c', speed: 2.4, life: 0.8, up: 2, gravity: 1 });
    game.damageNumber(t.pos, '+' + amt, 'heal');
    game.audio.play('heal', { rate: 0.8 });
    t.speedBuff = 1.25;
    t.speedBuffT = 4;
  }

  startCharge(game) {
    this.setState('charge', 0);
    this.chargeT = 0;
    this.chargeSpeed = 13;
    this.chargeHit = false;
    const p = game.player;
    this.chargeDir = { x: (p.pos.x - this.pos.x), z: (p.pos.z - this.pos.z) };
    const l = Math.hypot(this.chargeDir.x, this.chargeDir.z) || 1;
    this.chargeDir.x /= l; this.chargeDir.z /= l;
    this.yaw = Math.atan2(this.chargeDir.x, this.chargeDir.z);
    game.audio.play('bossRoar', { vol: 0.4, rate: 1.35 });
  }

  doCharge(dt, game) {
    this.chargeT += dt;
    if (this.chargeT < 0.5) { this.facePos(game.player.pos.x, game.player.pos.z, 4, dt); return; }
    const speed = this.chargeSpeed * (1 - clamp((this.chargeT - 0.5) / 1.6, 0, 1) * 0.6);
    const ok = this.stepMove(game, dt, this.chargeDir.x, this.chargeDir.z, speed);
    this.walkPhase += dt * 12;
    if (!this.chargeHit) {
      const p = game.player;
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < this.radius + p.radius + 1.1) {
        this.chargeHit = true;
        p.takeDamage(game, this.dmgBase * 1.35, { dirX: this.chargeDir.x, dirZ: this.chargeDir.z, poise: 40, heavy: true, from: this, school: 'heavy' });
        game.view.shake(1.8);
      }
    }
    if (!ok || this.chargeT > 2.3) {
      this.setState('windup', 0);
      this.hitDone = true;
      this.fastWindup = 0.8;
      this.nextStrike = { aoe: true, reach: 3.6, arc: 200, mul: 1.2, poise: 45 };
      this.stT = 0.32;
    }
  }

  fade(game) {
    game.view.burst(this.pos.x, this.pos.y + 1, this.pos.z, { count: 26, color: '#7fa8d8', speed: 5, life: 0.5 });
    const p = game.player;
    const a = game.rng.range(0, Math.PI * 2);
    const nx = clamp(p.pos.x + Math.cos(a) * 5.5, -game.room.bounds.w / 2 + 2, game.room.bounds.w / 2 - 2);
    const nz = clamp(p.pos.z + Math.sin(a) * 5.5, -game.room.bounds.h / 2 + 2, game.room.bounds.h / 2 - 2);
    if (!game.room.grid.blocked(nx, nz, this.radius, this.pos.y)) { this.pos.x = nx; this.pos.z = nz; }
    game.view.burst(this.pos.x, this.pos.y + 1, this.pos.z, { count: 26, color: '#7fa8d8', speed: 5, life: 0.5 });
    game.audio.play('portal', { vol: 0.4 });
  }

  physics(dt, game, grid) {
    const target = this.hoverY + grid.support(this.pos.x, this.pos.z, this.radius, this.pos.y + 0.05);
    this.pos.y = damp(this.pos.y, target + (this.cfg.hover ? Math.sin(game.time * 2 + this.walkPhase) * 0.12 : 0), 12, dt);
    if (this.speedBuffT > 0) { this.speedBuffT -= dt; if (this.speedBuffT <= 0) this.speedBuff = 1; }
  }

  takeDamage(game, raw, info = {}) {
    if (!this.alive || this.dead) return false;
    if (this.blocking && info.school !== 'spell') {
      const facing = Math.sin(this.yaw) * -info.dirX + Math.cos(this.yaw) * -info.dirZ;
      if (facing > 0.2) {
        game.audio.play('hitShield', { vol: 0.6 });
        game.view.burst(this.pos.x + Math.sin(this.yaw) * 0.6, this.pos.y + 1.15, this.pos.z + Math.cos(this.yaw) * 0.6, { count: 10, color: '#ffe0a0', speed: 4, life: 0.3 });
        this.hp -= Math.max(1, raw * 0.18);
        if (info.from === game.player) game.player.stamina -= 5;
        this.wake(game);
        return true;
      }
    }
    let dmg = raw;
    if (this.state === 'stagger' || this.vulnerableUntil > game.time) dmg *= 1.65;
    dmg = Math.max(1, Math.round(dmg));
    this.hp -= dmg;
    this.recentHit = true;
    this.hitTimer = 0.18;
    if (this.state === 'idle' || this.state === 'patrol') this.wake(game);
    else this.attention = 1;
    game.audio.play(this.cfg.style === 'large' ? 'hitArmor' : 'hitFlesh', { vol: 0.85, rate: game.rng.range(0.94, 1.08) });
    game.damageNumber(this.pos, String(dmg), info.crit ? 'crit' : info.backstab ? 'backstab' : 'foe');
    game.view.burst(this.pos.x + (info.dirX || 0) * 0.4, this.pos.y + 1.1, this.pos.z + (info.dirZ || 0) * 0.4, {
      count: info.backstab ? 34 : 14, color: info.backstab ? '#ffd070' : '#b8402f', speed: info.backstab ? 7 : 4.6, life: 0.42, gravity: -9,
    });
    if (info.backstab) game.hud.toast('背刺', 'BACKSTAB');
    if (!this.cfg.super && info.dirX !== undefined) {
      this.pos.x += (info.dirX || 0) * 0.16;
      this.pos.z += (info.dirZ || 0) * 0.16;
    }
    const thorns = game.player.s?.thorns || 0;
    if (thorns > 0 && info.from === game.player && !info.magic) {
      game.player.takeDamage(game, thorns, { dirX: 0, dirZ: 0, school: 'none', magic: true });
    }
    this.poise -= info.poise || 0;
    if (this.poise <= 0 && !this.cfg.super) {
      this.poise = this.poiseMax;
      this.setState('stagger', 0.9);
      game.audio.play('guardBreak', { vol: 0.6 });
    } else if (this.poise <= 0 && this.cfg.super) {
      this.poise = this.poiseMax * 0.5;
      this.cool = Math.max(this.cool || 0, 0.7);
    }
    if (this.hp <= 0) this.kill(game, info);
    return true;
  }

  kill(game, info = {}) {
    this.dead = true;
    this.alive = false;
    this.deathT = 0;
    this.fadeMat = 1;
    game.onEnemyKilled(this, info);
  }

  deathAnim(dt, game) {
    this.deathT = (this.deathT || 0) + dt;
    const k = clamp(this.deathT / 1.1, 0, 1);
    this.mesh.rotation.x = -k * 1.3;
    this.mesh.position.copy(this.pos);
    this.mesh.position.y -= k * 0.4;
    this.mesh.rotation.y = this.yaw;
    if (this.deathT > 0.25 && !this.ashed) {
      this.ashed = true;
      game.view.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, { count: 44, color: this.cfg.ethereal ? '#8fbfe8' : '#6a5f52', speed: 3.4, life: 1.2, up: 1.6, gravity: -1.4, grow: 1.2 });
      game.audio.play(this.cfg.style === 'large' ? 'largeEnemyDie' : 'enemyDie');
      this.mesh.visible = false;
    }
    this.removeT = (this.removeT || 0) + dt;
    if (this.removeT > 1.3) this.dispose();
  }

  animate(dt, game, d) {
    const r = this.rig;
    resetRig(r);
    const t = game.time;
    if (this.hitTimer > 0) { this.hitTimer -= dt; r.torso.rotation.x = 0.4 * (this.hitTimer / 0.18); r.head.rotation.x = 0.4; }
    if (this.state === 'windup') {
      const wu = this.cfg.windup * (this.fastWindup || 1);
      const k = clamp(this.stT / wu, 0, 1);
      r.armR.shoulder.rotation.x = -2.15 * k;
      r.armR.shoulder.rotation.z = this.cfg.style === 'large' ? -0.5 * k : 0.6 * k;
      r.armL.shoulder.rotation.x = -1.4 * k;
      r.torso.rotation.x = -0.3 * k;
      r.torso.rotation.y = -0.55 * k;
      r.hips.position.y = 0.9 * this.cfg.scale - 0.04 * k;
      if (this.nextStrike?.projectile && !this.hitDone && k > 0.8) { this.hitDone = true; this.fireProjectile(game); this.setState('recover', 0); this.cool = this.cfg.cooldown; }
    } else if (this.state === 'recover') {
      r.armR.shoulder.rotation.x = 0.55;
      r.torso.rotation.y = 0.35;
    } else if (this.state === 'stagger') {
      r.torso.rotation.x = 0.55;
      r.head.rotation.x = 0.5;
      r.armL.shoulder.rotation.x = -0.5;
      r.armR.shoulder.rotation.x = -0.35;
      r.hips.position.y = 0.76 * this.cfg.scale;
    } else if (this.state === 'cast') {
      const k = Math.sin(clamp(this.stT / 0.7, 0, 1) * Math.PI);
      r.armL.shoulder.rotation.x = -2.2 * k;
      r.armR.shoulder.rotation.x = -2.2 * k;
      r.torso.rotation.x = -0.2 * k;
    } else if (this.blocking) {
      r.armL.shoulder.rotation.x = -1.3;
      r.armL.shoulder.rotation.z = 0.4;
      r.armL.elbow.rotation.x = -1.0;
      r.torso.rotation.y = 0.35;
    } else {
      const moving = this.state === 'combat' || this.state === 'patrol' || this.state === 'charge';
      const w = Math.sin(this.walkPhase) * (moving ? 0.72 : 0.05);
      r.legL.hip.rotation.x = w;
      r.legR.hip.rotation.x = -w;
      r.legL.knee.rotation.x = Math.max(0, -w) * 0.5;
      r.legR.knee.rotation.x = Math.max(0, w) * 0.5;
      r.armL.shoulder.rotation.x = -w * 0.35;
      r.armR.shoulder.rotation.x = w * 0.3;
      r.armR.shoulder.rotation.z = -0.18;
      r.hips.position.y = (0.9 + Math.abs(w) * 0.04 + Math.sin(t * 1.6 + this.walkPhase) * 0.012) * this.cfg.scale;
      if (r.cape) r.cape.rotation.x = 0.12 + Math.abs(w) * 0.3;
      this.walkPhase += dt * (moving ? this.cfg.speed * 1.9 : 0.7);
    }
    const tele = this.state === 'windup' ? this.telegraph.material : null;
    if (tele) {
      const s = 1.4 + this.cfg.reach * 0.5;
      this.telegraph.scale.set(s, 1, s);
    }
  }

  dispose() {
    this.disposed = true;
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
  }
}

export class Ash extends Enemy {
  constructor(game, pos, kind = 'knight') {
    const a = ASHES[kind] || ASHES.knight;
    super(game, 'knight', pos, { hp: 1, dmg: 1 }, { cfg: { ...ARCHETYPES.knight, hp: a.hp, dmg: a.dmg, speed: a.speed, armor: a.armor, cloth: a.cloth, aggro: 22, style: 'melee', shield: false } });
    this.faction = 'player';
    this.isAsh = true;
    this.cn = a.cn;
    this.life = 30;
    this.avoidLock = true;
    this.mesh.traverse((o) => {
      if (!o.isMesh || !o.material?.isMeshStandardMaterial) return;
      o.material.transparent = true;
      o.material.opacity = 0.8;
      o.material.emissive = new THREE.Color('#e0a83c');
      o.material.emissiveIntensity = 0.55;
    });
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.kill(game); return; }
    super.update(dt, game);
  }

  brain(dt, game, d) {
    const foe = nearestFoe(game, this);
    if (!foe) { this.walkPhase += dt; return; }
    const dx = foe.pos.x - this.pos.x, dz = foe.pos.z - this.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    this.facePos(foe.pos.x, foe.pos.z, 8, dt);
    if (l > this.cfg.reach * 0.75) this.stepMove(game, dt, dx / l, dz / l, this.cfg.speed);
    else if (!this.cool || this.cool <= 0) this.telegraphStrike(game);
    this.walkPhase += dt * 6;
  }

  taunts(game) { return true; }

  kill(game) {
    if (this.dead) return;
    this.dead = true;
    this.alive = false;
    game.view.burst(this.pos.x, this.pos.y + 1, this.pos.z, { count: 40, color: '#e8b45a', speed: 4, life: 1.1, up: 1.4 });
    this.mesh.visible = false;
    this.removeT = 0;
    game.ashes = game.ashes.filter((a) => a !== this);
  }
}

function nearestFoe(game, self) {
  const list = self.faction === 'player' ? game.enemies : [game.player, ...game.ashes];
  let best = null, bd = 1e9;
  for (const e of list) {
    if (!e || e.dead || !e.alive) continue;
    const d = distSq(self.pos.x, self.pos.z, e.pos.x, e.pos.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

export class Projectile {
  constructor(cfg) {
    this.pos = cfg.pos.clone();
    this.dir = cfg.dir.clone().normalize();
    this.speed = cfg.speed ?? 20;
    this.dmg = cfg.dmg ?? 10;
    this.radius = cfg.radius ?? 0.32;
    this.life = cfg.life ?? 2;
    this.faction = cfg.faction || (cfg.from?.faction === 'player' ? 'player' : 'foe');
    this.from = cfg.from;
    this.color = cfg.color || '#ffb054';
    this.homing = cfg.homing || false;
    this.gravity = cfg.gravity ?? 0;
    this.kind = cfg.kind || 'flame';
    this.thrown = cfg.thrown || false;
    this.alive = true;
    const geo = this.kind === 'arrow'
      ? new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5).rotateX(Math.PI / 2)
      : new THREE.SphereGeometry(this.radius, 10, 8);
    this.mesh = new THREE.Mesh(geo, mat(this.color, { rough: 0.2, metal: 0.1, emissive: this.color, emissiveIntensity: 2.6 }));
    if (this.kind !== 'arrow') this.mesh.scale.set(1, 1, 1.5);
    this.trail = 0;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) return this.destroy(game);
    if (this.homing) {
      const tgt = this.faction === 'player' ? nearestFoe(game, this) : game.player;
      if (tgt) {
        const want = new THREE.Vector3(tgt.pos.x - this.pos.x, tgt.pos.y + 1 - this.pos.y, tgt.pos.z - this.pos.z).normalize();
        this.dir.lerp(want, clamp(dt * 2.6, 0, 1)).normalize();
      }
    }
    this.dir.y += this.gravity * dt / this.speed;
    this.dir.normalize();
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.pos.clone().add(this.dir));
    this.trail -= dt;
    if (this.trail <= 0) {
      this.trail = 0.02;
      game.view.burst(this.pos.x, this.pos.y, this.pos.z, { count: this.kind === 'arrow' ? 1 : 3, color: this.color, speed: 0.5, life: 0.28, gravity: 0, size: 0.32, jitter: 0.1 });
    }
    if (game.room.grid.blocked(this.pos.x, this.pos.z, 0.12, this.pos.y - 0.6)) return this.impact(game, null);
    const list = this.faction === 'player' ? game.enemies : [game.player, ...game.ashes];
    for (const t of list) {
      if (!t || !t.alive || t.dead) continue;
      if (distSq(this.pos.x, this.pos.z, t.pos.x, t.pos.z) < (t.radius + this.radius) ** 2 && Math.abs(this.pos.y - (t.pos.y + 1)) < 1.6 + (t.height || 1.7)) {
        return this.impact(game, t);
      }
    }
  }

  impact(game, target) {
    if (target) {
      const d = Math.hypot(this.dir.x, this.dir.z) || 1;
      target.takeDamage(game, this.dmg, {
        dirX: this.dir.x / d, dirZ: this.dir.z / d, school: this.kind === 'arrow' ? 'light' : 'spell',
        magic: this.kind !== 'arrow', poise: 12, from: this.from, heavy: false,
      });
      game.audio.play(this.kind === 'arrow' ? 'hitFlesh' : 'spellFlame', { vol: 0.6 });
    }
    game.view.burst(this.pos.x, this.pos.y, this.pos.z, { count: 16, color: this.color, speed: 4.2, life: 0.4 });
    this.destroy(game);
  }

  destroy(game) {
    this.alive = false;
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export { ASHES };
