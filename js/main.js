import * as THREE from 'three';
import { View } from './engine/view.js';
import { CameraRig } from './engine/camera.js';
import { Input } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { RNG, hashSeed, strFromSeed, clamp, damp, lerp } from './engine/rng.js';
import { planDepth, buildRoomGrid } from './world/layout.js';
import { buildRoom } from './world/build.js';
import { CELL } from './world/grid.js';
import { Player } from './entities/player.js';
import { Enemy, Ash, Projectile, ARCHETYPES } from './entities/enemy.js';
import { Boss } from './entities/boss.js';
import { HUD } from './ui/hud.js';
import { HubUI } from './ui/hub.js';
import { CLASSES, RELICS, DEPTH_MODIFIERS } from './meta/content.js';
import { loadSave, writeSave, saveRun, loadRun, clearRun } from './meta/save.js';

const HINTS = {
  move: 'WASD 移动 · 鼠标转视角 · <kbd>空格</kbd>翻滚（有无敌帧）',
  combat: '左键连击 · 右键重击 · <kbd>L</kbd> 格挡 · <kbd>U</kbd> 弹反（时机极短）',
  lock: '<kbd>Q</kbd> 锁定目标：视角绕敌、攻击自动转向，Boss 战必备',
  grace: '走近灰烬营火，按 <kbd>F</kbd> 休息：回满状态、怪物重生、本轮存档',
  rune: '击杀掉落灰烬（货币）。死亡会全部失落——捡回血印才能取回',
  gate: '雾门之前，先备好药与圣物。按 <kbd>F</kbd> 入雾',
  backstab: '敌人未察觉时从背后重击 = 背刺，伤害翻倍',
};

const ROOM_MOBS = {  1: [['hollow', 5], ['knight', 2], ['archer', 2], ['wraith', 1]],
  2: [['hollow', 4], ['knight', 3], ['archer', 3], ['wraith', 2], ['zealot', 2], ['guard', 1]],
  3: [['knight', 3], ['wraith', 3], ['archer', 2], ['zealot', 2], ['guard', 2], ['hollow', 2]],
};

// A room gets one anchor. Two siege guards in the same pack is not a harder
// encounter, it is an unanswered one: the balance rig measured full-bar attrition
// (1.00, i.e. death) for every room that drew two of them at any skill level.
const HEAVY_MOBS = ['guard'];

function pickMobKind(rng, table, depth, taken) {
  const options = table.map(([k, w]) => ({ k, weight: w }))
    .filter((e) => depth >= 1 || e.k !== 'guard')
    .filter((e) => !HEAVY_MOBS.includes(e.k) || !taken.includes(e.k));
  const k = rng.weighted(options, (x) => x.weight).k;
  taken.push(k);
  return k;
}

// How many mobs a room rolls. The balance rig had to be pointed at this number
// directly: with a base of 3 the third floor generated 5-6 mobs, and even behind the
// engagement queue every such room ended with the player dead at full attrition. A
// souls room is a short queue of duels, so the base is 2 and depth only adds one.
function roomMobCount(mod, rng, base = 2) {
  return Math.max(1, base + (mod?.count || 0) + rng.int(0, 1));
}

function disposeMesh(obj) {
  obj.parent?.remove(obj);
  obj.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    o.geometry?.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x?.dispose());
    else m?.dispose();
  });
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.view = new View(canvas);
    this.rig = new CameraRig(this.view.camera);
    this.input = new Input(canvas);
    this.audio = new Audio();
    window.__ashenAudio = this.audio;
    this.save = loadSave();
    this.settings = this.save.settings;
    this.input.applyPadBinds(this.settings.pad);
    this.hud = new HUD(this);
    this.state = 'boot';
    this.time = 0;
    this.hitStopT = 0;
    this.slowT = 0;
    this.cine = null;
    this.enemies = [];
    this.projectiles = [];
    this.ashes = [];
    this.pickups = [];
    this.hazards = [];
    this.lockTarget = null;
    this.taunt = null;
    this.rng = new RNG(12345);
    this.menuAngle = 0;
    this._lampT = 0;
    this._fps = { t: 0, n: 0, v: 60 };
    this.resumeSnapshot = loadRun();
    this.hub = new HubUI(this);
    this.bindEvents();
    this.enterMenu();
    this._last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  bindEvents() {
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pauseGame();
    };
    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.setEnabled(this.settings.volume > 0);
      this.audio.setVolume('master', this.settings.volume);
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && (this.state === 'playing' || this.state === 'paused')) this.togglePause();
    });
    window.addEventListener('beforeunload', () => writeSave(this.save));
  }

  applySettings() {
    this.view.setQuality(this.settings.quality);
    this.audio.setVolume('master', this.settings.volume);
    this.input.sensitivity = 0.0026;
    writeSave(this.save);
  }

  // ---------------------------------------------------------------- menu scene
  enterMenu() {
    this.state = 'title';
    this.clearActors();
    const rng = new RNG(4242);
    const spec = { type: 'chapel', kind: 'chapel', w: 26, h: 22, gated: false };
    this.loadRoom(buildRoomGrid(rng, spec), DEPTH_MODIFIERS[0], rng, { menu: true });
    this.view.setMood({ top: '#080a12', bot: '#2c231c', glow: '#c0913c', fogColor: '#12121a', fogDensity: 0.03, sunColor: '#ffd9a0', sunInt: 1.5, star: 0.6 });
    this.hud.screen('title');
    this.hub.renderTitle();
  }

  loadRoom(layoutRoom, mod, rng, opts = {}) {
    if (this.room) {
      this.view.scene.remove(this.room.group);
      this.room.dispose();
    }
    const built = buildRoom(layoutRoom, mod, rng);
    this.view.scene.add(built.group);
    this.room = built;
    this.roomSpec = layoutRoom.spec;
    this.roomCleared = !!opts.menu;
    this.view.setWorldCenter(built.group.position.x, built.group.position.z);
    if (layoutRoom.spec.gated) this.setGateCells(layoutRoom, true);
    return built;
  }

  setGateCells(layoutRoom, solid) {
    const g = layoutRoom.grid;
    const cx = g.cx(layoutRoom.gate.x);
    for (let dz = -2; dz <= 2; dz++) {
      g.set(cx, g.cz(layoutRoom.gate.z) + dz, solid ? CELL.PILLAR : CELL.FLOOR);
    }
  }

  clearActors() {
    for (const e of this.enemies) e.dispose?.();
    for (const a of this.ashes) a.dispose?.();
    for (const p of this.projectiles) p.destroy?.(this);
    for (const o of this.pickups) disposeMesh(o.mesh);
    for (const h of this.hazards) disposeMesh(h.mesh);
    this.enemies = []; this.ashes = []; this.projectiles = []; this.pickups = []; this.hazards = [];
    this.lockTarget = null;
    this.view.clearParticles();
    if (this.player?.mesh) this.player.mesh.parent?.remove(this.player.mesh);
  }

  // ------------------------------------------------------------------ run flow
  startRun(seedStr, classId, snapshot = null) {
    this.audio.unlock();
    this.audio.setVolume('master', this.settings.volume);
    const seed = snapshot?.seed || hashSeed(seedStr || String(Math.floor(Math.random() * 1e9)));
    this.run = {
      seed, seedStr: strFromSeed(seed),
      classId: snapshot?.classId || classId,
      depth: snapshot?.depth || 0,
      roomIdx: 0,
      runes: snapshot?.runes || 0,
      lostRunes: 0,
      relics: snapshot?.relics || [],
      curses: snapshot?.curses || [...(this.save.curses || [])],
      revives: snapshot?.revives ?? 1,
      kills: 0, parries: 0, backstabs: 0, roomsCleared: 0,
      bossKills: 0, depthCleared: 0,
      graceAt: null,
      startedAt: performance.now(),
      rerolls: 0,
      bloodstain: null,
    };
    const master = new RNG(seed);
    this.plans = [0, 1, 2].map((d) => planDepth(master.fork(), d));
    const cls = CLASSES.find((c) => c.id === this.run.classId) || CLASSES[0];
    this.clearActors();
    this.player = new Player(this, cls);
    this.view.scene.add(this.player.mesh);
    this.run.rerolls = this.player.recompute(this.run.relics, this.run.curses, this.save.upgrades).rerolls;
    if (snapshot?.hpFrac) this.player.hp = Math.max(1, Math.round(this.player.maxHp * snapshot.hpFrac));
    this.enterRoom(this.run.depth, snapshot?.roomIdx ?? (this.run.graceAt?.roomIdx ?? 0));
    this.state = 'playing';
    this.hud.screen(null);
    this.hud.banner(DEPTH_MODIFIERS[this.run.depth].cn, DEPTH_MODIFIERS[this.run.depth].name);
    this.audio.startAmbience(0.4);
    this.save.codex.runs++;
    writeSave(this.save);
    this.input.requestLock();
    this.hint(HINTS.move, 7000);
  }

  enterRoom(depthIdx, roomIdx) {
    this.cine = null;
    this.input.frozen = false;
    this.run.depth = depthIdx;
    this.run.roomIdx = roomIdx;
    const plan = this.plans[depthIdx];
    const spec = plan.rooms[Math.min(roomIdx, plan.rooms.length - 1)];
    this.depthMod = DEPTH_MODIFIERS[depthIdx];
    const rng = new RNG(hashSeed(this.run.seed + ':' + depthIdx + ':' + roomIdx));
    const layoutRoom = buildRoomGrid(rng, spec, { depth: depthIdx });
    this.loadRoom(layoutRoom, this.depthMod, rng);
    this.view.setMood(plan);
    this.clearActors();
    const entry = layoutRoom.entry;
    if (this.player) {
      const g = layoutRoom.grid;
      let ex = entry.x, ez = entry.z;
      // the doorway cell is flush against the boundary wall, which left the
      // third-person camera no standoff; step inward until the wall is behind us
      for (let i = 0; i < 8 && ex - entry.x < 2.4; i++) {
        if (g.blocked(ex + 0.4, ez, this.player.radius, 0.1)) break;
        ex += 0.4;
      }
      this.player.pos.set(ex, 0.1, ez);
      this.player.vel.set(0, 0, 0);
      this.player.yaw = entry.yaw;
      this.player.state = 'idle';
      this.player.dead = false;
      this.player.alive = true;
      this.player.mesh.visible = true;
      this.player.mesh.rotation.set(0, this.player.yaw, 0);
      this.view.scene.add(this.player.mesh);
      this.rig.yaw = entry.yaw + Math.PI;
      this.rig.pitch = -0.2;
      this.rig.dist = this.rig.wantDist;
      this.rig.focus.copy(this.player.pos).setY(1.3);
    }
    this.populate(rng, spec, layoutRoom);
    this.snapshotRun();
    if (spec.type === 'boss') this.hint(HINTS.gate, 6000);
  }

  populate(rng, spec, layoutRoom) {
    const depth = this.run.depth;
    const mod = this.depthMod.enemyMul;
    this.boss = null;
    this.bossSpawn = null;
    if (this.run.bloodstain && this.run.bloodstain.depth === depth && this.run.bloodstain.roomIdx === this.run.roomIdx) {
      this.spawnPickup(this.run.bloodstain, 'blood');
      this.hint('血印仍在灰烬里发光 —— 走近取回失落的灰烬', 6000);
    }
    if (spec.type === 'chapel') {
      this.roomCleared = true;
      this.run.graceAt = { depth, roomIdx: this.run.roomIdx };
      this.hint(HINTS.grace, 6000);
      return;
    }
    if (spec.type === 'boss') {
      this.roomCleared = true;
      this.bossSpawn = { x: layoutRoom.grid.wx(layoutRoom.mid.cx + 4), z: layoutRoom.grid.wz(layoutRoom.doorRow) };
      this.bossDone = this.run.bossKills > depth;
      if (this.bossDone) this.bossSpawn = null;
      return;
    }
    let count = spec.type === 'cache' ? 2 : roomMobCount(mod, rng);
    if (spec.type === 'shrine') count = Math.max(2, count - 2);
    const table = ROOM_MOBS[clamp(depth + 1, 1, 3)];
    const points = spreadPoints(layoutRoom, count, rng);
    const taken = [];
    for (let i = 0; i < count; i++) {
      const kind = pickMobKind(rng, table, depth, taken);
      const p = points[i] || { x: 0, z: 0 };
      const e = new Enemy(this, kind, new THREE.Vector3(p.x, 0, p.z), { hp: mod.hp, dmg: mod.dmg });
      this.enemies.push(e);
      this.view.scene.add(e.mesh);
    }
    if (spec.type === 'shrine') this.spawnPickup({ x: layoutRoom.grid.wx(layoutRoom.mid.cx), z: layoutRoom.grid.wz(layoutRoom.doorRow - 3) }, 'shrine');
    if (spec.type === 'cache') {
      this.spawnPickup({ x: layoutRoom.grid.wx(layoutRoom.mid.cx + 2), z: layoutRoom.grid.wz(layoutRoom.doorRow - 2) }, 'chest');
      this.runesBurst(60 + depth * 40, { x: layoutRoom.grid.wx(layoutRoom.mid.cx), z: layoutRoom.grid.wz(layoutRoom.doorRow) }, rng);
    }
    if (!this.enemies.length) this.roomCleared = true;
  }

  nextRoom() {
    const plan = this.plans[this.run.depth];
    if (this.run.roomIdx + 1 >= plan.rooms.length) { this.descend(); return; }
    this.enterRoom(this.run.depth, this.run.roomIdx + 1);
    this.hud.banner(`第 ${this.run.roomIdx + 1} 进`, `CHAMBER ${this.run.roomIdx + 1}`);
  }

  descend() {
    if (this.run.depth >= 2) { this.victory(); return; }
    this.run.depth++;
    this.run.roomIdx = 0;
    this.run.depthCleared = Math.max(this.run.depthCleared, this.run.depth);
    this.save.codex.deepest = Math.max(this.save.codex.deepest, this.run.depth + 1);
    this.enterRoom(this.run.depth, 0);
    this.hud.banner(DEPTH_MODIFIERS[this.run.depth].cn, DEPTH_MODIFIERS[this.run.depth].name);
    this.view.flash?.();
  }

  snapshotRun() {
    if (!this.run || this.state !== 'playing') return;
    saveRun({
      seed: this.run.seed, classId: this.run.classId, depth: this.run.depth, roomIdx: this.run.roomIdx,
      runes: this.run.runes, relics: this.run.relics, curses: this.run.curses, revives: this.run.revives,
      hpFrac: this.player ? this.player.hp / this.player.maxHp : 1, at: Date.now(),
    });
    this.resumeSnapshot = loadRun();
  }

  // ----------------------------------------------------------------- spawning
  spawnProjectile(cfg) {
    const pr = new Projectile(cfg);
    this.projectiles.push(pr);
    this.view.scene.add(pr.mesh);
    return pr;
  }

  spawnMinion(kind, pos) {
    const mod = this.depthMod.enemyMul;
    const e = new Enemy(this, kind, new THREE.Vector3(pos.x, 0, pos.z), { hp: mod.hp * 0.8, dmg: mod.dmg });
    e.setState('combat', 0);
    e.woke = true;
    this.enemies.push(e);
    this.view.scene.add(e.mesh);
    this.view.burst(pos.x, 0.6, pos.z, { count: 26, color: '#c9a24a', speed: 4, life: 0.8, up: 2.2 });
    return e;
  }

  summonAsh(kind, n = 1) {
    for (let i = 0; i < n; i++) {
      const a = new Ash(this, { x: this.player.pos.x + (i - (n - 1) / 2) * 1.4, z: this.player.pos.z + 1.6 }, kind);
      this.ashes.push(a);
      this.view.scene.add(a.mesh);
      this.view.burst(a.pos.x, 1, a.pos.z, { count: 40, color: '#e8b45a', speed: 4.5, life: 1, up: 1.8 });
    }
    this.audio.play('grace', { vol: 0.7 });
  }

  spawnGroundFire(pos, radius, dmg, life = 3.2) {
    const geo = new THREE.CircleGeometry(radius, 22).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ff7a2a', transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.set(pos.x, 0.06, pos.z);
    this.view.scene.add(mesh);
    this.hazards.push({ pos: { x: pos.x, z: pos.z }, radius, dmg, life, tick: 0.4, mesh });
  }

  spawnPickup(pos, kind) {
    let mesh;
    if (kind === 'blood') {
      mesh = new THREE.Group();
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#8e1c14', transparent: true, opacity: 0.72 }));
      pool.position.y = 0.04;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: '#5a1010', emissive: '#ff4a2a', emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6 }));
      shard.position.y = 0.62;
      mesh.add(pool, shard);
    } else {
      const geo = kind === 'shrine' ? new THREE.OctahedronGeometry(0.34, 0) : new THREE.BoxGeometry(0.5, 0.62, 0.36);
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: kind === 'shrine' ? '#f2dda0' : '#b98b3a', emissive: '#ffcf7a', emissiveIntensity: kind === 'shrine' ? 1.6 : 0.7,
        roughness: 0.35, metalness: 0.8,
      }));
    }
    mesh.position.set(pos.x, kind === 'shrine' ? 1.25 : kind === 'blood' ? 0.7 : 0.55, pos.z);
    this.view.scene.add(mesh);
    this.pickups.push({ pos: { x: pos.x, z: pos.z }, kind, mesh, taken: false, value: kind === 'blood' ? this.run.bloodstain?.amount : 0 });
  }

  runesBurst(amount, pos, rng = this.rng) {
    const n = clamp(Math.round(amount / 22), 1, 9);
    for (let i = 0; i < n; i++) {
      const v = Math.round(amount / n * rng.range(0.8, 1.2));
      this.spawnOrb(pos, v);
    }
  }

  spawnOrb(pos, value) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), new THREE.MeshBasicMaterial({ color: '#ffd071' }));
    mesh.position.set(pos.x + (Math.random() - 0.5) * 1.6, 0.7 + Math.random() * 0.8, pos.z + (Math.random() - 0.5) * 1.6);
    this.view.scene.add(mesh);
    this.pickups.push({ pos: { x: mesh.position.x, z: mesh.position.z }, kind: 'rune', value, mesh, orb: true, vy: 1.6 + Math.random() * 2, life: 90 });
  }

  // -------------------------------------------------------------------- combat
  hitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); }
  slowMo(t) { this.slowT = Math.max(this.slowT, t); }

  damageNumber(worldPos, text, kind = 'foe') {
    if (kind === 'backstab' && this.run) this.run.backstabs++;
    const v = new THREE.Vector3(worldPos.x, worldPos.y + 1.4, worldPos.z).project(this.view.camera);
    if (v.z > 1) return;
    this.hud.number((v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, text, kind);
  }

  setLock(t) {
    this.lockTarget = t && t.alive && !t.dead ? t : null;
  }

  addRunes(n) {
    const gain = Math.round(n * (this.player?.s?.runeGain || 1));
    this.run.runes += gain;
    return gain;
  }

  onEnemyKilled(e, info = {}) {
    this.run.kills++;
    this.save.codex.kills++;
    const [a, b] = e.runes;
    const value = Math.round((a + Math.random() * (b - a)) * (this.depthMod.enemyMul.hp * 0.6 + 0.4) * (this.player.flags.runeOnKill ? 1.35 : 1));
    this.runesBurst(value, e.pos);
    if (this.player.flags.runeOnKill) this.player.stamina = Math.min(this.player.s.staminaMax, this.player.stamina + 12);
    if (e.kind === 'zealot') this.spawnPickup({ x: e.pos.x, z: e.pos.z }, 'chest');
    this.view.burst(e.pos.x, e.pos.y + 1.2, e.pos.z, { count: 20, color: '#ffd071', speed: 3.5, life: 1.2, up: 2.4, gravity: -1 });
    this.checkCleared();
  }

  onBossKilled(b) {
    this.run.bossKills++;
    this.save.codex.bossKills++;
    this.bossDone = true;
    this.runesBurst(b.runes[0] + Math.floor(Math.random() * (b.runes[1] - b.runes[0])), b.pos);
    this.hud.hideBoss();
    this.hud.banner('守望者已熄', 'THE KEEPER FALLS');
    this.audio.pulse('victory');
    this.slowMo(1.4);
    this.input.rumble(0.7, 1, 520);
    this.offerDraft({
      title: '王冠碎片',
      sub: '从首领的灰烬里取出三枚残片。',
      pool: RELICS.filter((r) => r.rarity === 'legendary' || (r.rarity === 'rare' && r.minDepth <= this.run.depth + 1)),
      count: 3,
      onPick: () => { this.runesBurst(180, b.pos); },
    });
    const plan = this.plans[this.run.depth];
    if (this.run.roomIdx === plan.rooms.length - 1 && this.run.depth < 2) this.descendPending = true;
  }

  checkCleared() {
    const live = this.enemies.filter((e) => e.alive && !e.dead);
    if (live.length) return;
    if (this.roomCleared) return;
    this.roomCleared = true;
    this.run.roomsCleared++;
    this.audio.play('fogGate');
    this.hud.toast('房间已肃清', 'FOE SLAIN · PATH OPEN');
    if (this.rng.chance(0.34) && this.roomSpec.type === 'combat') {
      this.spawnPickup({ x: this.room.room.grid.wx(this.room.room.mid.cx), z: this.room.room.grid.wz(this.room.room.doorRow) }, 'shrine');
    }
  }

  get portalOpen() {
    return this.roomCleared && (!this.bossSpawn || this.bossDone);
  }

  // ------------------------------------------------------------------ drafts
  offerDraft(opts) {
    const depth = this.run.depth + 1;
    const count = opts.count || 3;
    const owned = new Set([...this.run.relics, ...this.run.curses]);
    let pool = (opts.pool || RELICS).filter((r) => !owned.has(r.id) && r.minDepth <= depth);
    if (pool.length < count) pool = RELICS.filter((r) => !owned.has(r.id));
    const picked = this.rng.sample(pool, count);
    this.draft = { picked, pool, count, rerolls: this.run.rerolls, title: opts.title, sub: opts.sub, onAfter: opts.onPick };
    this.state = 'draft';
    this.input.exitLock();
    this.renderDraft();
  }

  renderDraft() {
    const d = this.draft;
    if (!d) return;
    this.hud.renderDraft(d.picked, {
      title: d.title || '圣物抉择',
      sub: d.sub || '取走其一，其余散为灰烬。',
      rerolls: d.rerolls,
      onPick: (relic) => this.pickDraft(relic),
    });
    this.hud.screen('draft');
    document.getElementById('btnReroll').onclick = () => this.rerollDraft();
  }

  rerollDraft() {
    const d = this.draft;
    if (!d || d.rerolls <= 0) return;
    d.rerolls--;
    d.picked = this.rng.sample(d.pool, d.count);
    this.audio.play('cardSelect');
    this.renderDraft();
  }

  pickDraft(relic) {
    const d = this.draft;
    if (!d || this.state !== 'draft') return;
    this.run.relics.push(relic.id);
    this.save.codex.relics[relic.id] = (this.save.codex.relics[relic.id] || 0) + 1;
    this.run.rerolls = d.rerolls;
    writeSave(this.save);
    this.player.relicIds = this.run.relics;
    this.player.recompute(this.run.relics, this.run.curses, this.save.upgrades);
    this.audio.play('boonPickup');
    this.hud.toast(relic.cn, relic.name.toUpperCase(), 'crit');
    this.view.burst(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z, { count: 70, color: '#ffd071', speed: 5, life: 1.4, up: 2.6, gravity: -1.2, jitter: 1.2 });
    this.draft = null;
    this.hud.screen(null);
    this.state = 'playing';
    this.snapshotRun();
    this.input.requestLock();
    d.onAfter?.(relic);
  }

  // ---------------------------------------------------------------- rest/die
  rest() {
    this.player.atGrace(this);
    this.audio.play('rest');
    this.hud.banner('余烬重燃', 'GRACE RESTORED');
    this.view.burst(this.room.gracePos.x, 1, this.room.gracePos.z, { count: 90, color: '#ffd487', speed: 4, life: 2, up: 2.4, gravity: -0.6, jitter: 1.5 });
    this.run.graceAt = { depth: this.run.depth, roomIdx: this.run.roomIdx };
    const depth = this.run.depth;
    const rng = new RNG(hashSeed(this.run.seed + ':' + depth + ':' + this.run.roomIdx));
    const spec = this.plans[depth].rooms[this.run.roomIdx];
    const mod = this.depthMod.enemyMul;
    const layoutRoom = this.room.room;
    this.enemies.filter((e) => e.alive).forEach((e) => { e.dispose(); });
    this.enemies = [];
    if (spec.type !== 'chapel' && spec.type !== 'boss') {
      const points = spreadPoints(layoutRoom, roomMobCount(mod, rng), rng);
      const taken = [];
      for (let i = 0; i < points.length; i++) {
        const e = new Enemy(this, this.mobPick(rng, taken), points[i], { hp: mod.hp, dmg: mod.dmg });
        this.enemies.push(e);
        this.view.scene.add(e.mesh);
      }
    }
    if (this.player.flags.restExtra) this.player.addTemp({ stat: 'attack', mul: 1.2, dur: 90 });
    this.pickups = this.pickups.filter((p) => { if (p.orb) { p.mesh.parent?.remove(p.mesh); return false; } return true; });
    this.snapshotRun();
    writeSave(this.save);
  }

  mobPick(rng, taken = []) {
    const table = ROOM_MOBS[clamp(this.run.depth + 1, 1, 3)];
    return pickMobKind(rng, table, this.run.depth, taken);
  }

  onPlayerDeath(info = {}) {
    this.state = 'dying';
    this.run.lostRunes = this.run.runes;
    this.run.runes = 0;
    this.run.bloodstain = { depth: this.run.depth, roomIdx: this.run.roomIdx, x: this.player.pos.x, z: this.player.pos.z, amount: this.run.lostRunes };
    this.save.codex.deaths++;
    this.save.codex.parries = (this.save.codex.parries || 0) + this.run.parries;
    this.save.codex.backstabs = (this.save.codex.backstabs || 0) + this.run.backstabs;
    writeSave(this.save);
    clearRun();
    this.audio.stopAmbience();
    this.audio.play('death');
    this.audio.pulse('died');
    this.slowMo(1.6);
    this.view.shake(1.6);
    this.hud.fadeScreen(true);
    setTimeout(() => {
      if (this.state !== 'dying') { this.hud.fadeScreen(false); return; }
      this.state = 'dead';
      this.input.exitLock();
      this.hud.fadeScreen(false);
      this.hud.showScreenDead(this.deathStats(), this.run.revives > 0);
    }, 1700);
  }

  deathStats() {
    return {
      depth: DEPTH_MODIFIERS[this.run.depth].cn, room: this.run.roomIdx + 1,
      runes: this.run.lostRunes, kills: this.run.kills, relics: this.run.relics.length,
      bossKills: this.run.bossKills, time: Math.round((performance.now() - this.run.startedAt) / 1000),
      seed: this.run.seedStr, parries: this.run.parries, backstabs: this.run.backstabs,
    };
  }

  revive() {
    if (this.run.revives <= 0) return;
    this.run.revives--;
    this.state = 'playing';
    const g = this.run.graceAt || { depth: this.run.depth, roomIdx: 0 };
    this.hud.screen(null);
    this.enterRoom(g.depth, g.roomIdx);
    this.player.dead = false;
    this.player.alive = true;
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.s.staminaMax;
    this.player.fp = this.player.s.fpMax;
    this.player.state = 'idle';
    this.player.mesh.visible = true;
    this.audio.startAmbience(0.5);
    this.hud.toast('复归灰烬', 'RETURNED TO ASH');
    this.input.requestLock();
  }

  endRun() {
    const earned = this.marksEarned();
    this.save.marks += earned.marks;
    this.save.codex.bestRunes = Math.max(this.save.codex.bestRunes, this.run.lostRunes + this.run.runes);
    writeSave(this.save);
    clearRun();
    this.resumeSnapshot = null;
    this.run = null;
    this.audio.stopAmbience();
    this.enterMenu();
    this.state = 'hub';
    this.hud.screen('hub');
    this.hub.renderHub(earned);
  }

  victory() {
    const earned = this.marksEarned(true);
    this.save.marks += earned.marks;
    this.save.codex.victories++;
    writeSave(this.save);
    clearRun();
    this.resumeSnapshot = null;
    this.state = 'win';
    this.input.exitLock();
    this.audio.pulse('victory');
    this.hud.screen('win');
    document.getElementById('winStats').innerHTML = statBlock({ ...this.deathStats(), marks: earned.marks });
  }

  marksEarned(won = false) {
    const cleared = this.run.bossKills;
    return { marks: cleared * 4 + (won ? 14 : 0) + Math.floor(this.run.roomsCleared / 3) + this.run.depth * 2, cleared, rooms: this.run.roomsCleared };
  }

  // ------------------------------------------------------------------ interact
  nearestInteract() {
    if (!this.player || this.player.busy) return null;
    const p = this.player.pos;
    const room = this.room;
    const out = [];
    if (room.gracePos) out.push({ kind: 'grace', pos: room.gracePos, text: this.run.graceAt ? '休息（重生敌人）' : '休息', key: 'F', d: Math.hypot(p.x - room.gracePos.x, p.z - room.gracePos.z) });
    if (room.gate.visible) {
      const gp = room.room.gate;
      out.push({ kind: 'gate', pos: gp, text: '进入雾门', key: 'F', d: Math.hypot(p.x - gp.x, p.z - gp.z) });
    }
    for (const pk of this.pickups) if (!pk.taken && !pk.orb) out.push({ kind: pk.kind, src: pk, pos: pk.pos, mesh: pk.mesh, text: pk.kind === 'shrine' ? '取走圣物' : pk.kind === 'blood' ? '取回失落的灰烬' : '开启匣子', key: 'F', d: Math.hypot(p.x - pk.pos.x, p.z - pk.pos.z) });
    const ex = room.room.exit;
    out.push({ kind: 'portal', pos: ex, text: this.portalOpen ? (this.roomSpec.type === 'boss' ? '下潜一层' : '进入下一间') : '被阻挡 · 需肃清此间', key: 'F', blocked: !this.portalOpen, d: Math.hypot(p.x - ex.x, p.z - ex.z) });
    out.sort((a, b) => a.d - b.d);
    return out[0] && out[0].d < 2.9 ? out[0] : null;
  }

  interact() {
    const t = this.nearestInteract();
    if (!t) return;
    if (t.kind === 'grace' && t.d < 2.9) return this.rest();
    if (t.kind === 'gate') {
      this.room.gate.visible = false;
      this.setGateCells(this.room.room, false);
      this.audio.play('fogGate');
      this.hud.banner('雾门已开', 'THE FOG PARTS');
      this.view.burst(t.pos.x, 1.6, t.pos.z, { count: 60, color: '#cfe0f0', speed: 4, life: 1.4, up: 1.4, gravity: 0.4 });
      return;
    }
    if (t.kind === 'blood') {
      t.src.taken = true;
      disposeMesh(t.mesh);
      this.recoverBloodstain();
      return;
    }
    if (t.kind === 'shrine') {
      t.src.taken = true;
      disposeMesh(t.mesh);
      return this.offerDraft({ title: '圣物圣坛', sub: '坛上余温尚存。' });
    }
    if (t.kind === 'chest') {
      t.src.taken = true;
      disposeMesh(t.mesh);
      this.audio.play('chestOpen');
      this.runesBurst(80 + this.run.depth * 60, t.pos);
      if (this.rng.chance(0.4)) this.offerDraft({ title: '匣中之赐', sub: '匣底还压着一件圣物。', count: 3 });
      return;
    }
    if (t.kind === 'portal') {
      if (t.blocked) { this.audio.play('guardBreak', { vol: 0.4 }); this.hud.toast('前路封锁', 'SLAIN FOES REQUIRED', 'bad'); return; }
      this.audio.play('portal');
      this.view.burst(t.pos.x, 1.4, t.pos.z, { count: 40, color: '#ffe3a8', speed: 5, life: 0.8 });
      if (this.roomSpec.type === 'boss') { if (this.descendPending) { this.descendPending = false; this.descend(); } else this.nextRoom(); }
      else this.nextRoom();
      return;
    }
  }

  hint(text, ms) { this.hud.setHint(text, ms); }
  toast(cn, en, kind) { this.hud.toast(cn, en, kind); }

  togglePause() {
    if (this.state === 'playing') this.pauseGame();
    else if (this.state === 'paused') this.resumeGame();
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.hud.screen('pause');
    this.hub.renderPause();
  }

  resumeGame() {
    this.state = 'playing';
    this.hud.screen(null);
    this.input.requestLock();
  }

  // -------------------------------------------------------------------- update
  step(dt) {
    if (this.cine) {
      const c = this.cine;
      c.t += dt;
      const k = clamp(c.t / c.dur, 0, 1);
      this.input.frozen = c.t < c.lock;
      const ease = k < 0.3 ? 0 : (k - 0.3) / 0.7;
      this.rig.wantDist = lerp(2.9, c.dist0, ease * ease);
      if (k >= 1) { this.cine = null; this.input.frozen = false; this.rig.wantDist = c.dist0; }
    } else if (this.input.frozen) this.input.frozen = false;
    const look = this.input.look(dt);
    if (!this.cine) {
      this.rig.orbit(dt, look.x, look.y, this.settings.invert);
      this.rig.zoom(this.input.wheel);
    }
    this.player.update(dt, this);
    for (const e of this.enemies) if (!e.disposed) e.update(dt, this);
    this.enemies = this.enemies.filter((e) => !e.disposed);
    for (const a of this.ashes) if (!a.disposed) a.update(dt, this);
    for (const pr of this.projectiles) if (pr.alive) pr.update(dt, this);
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.updatePickups(dt);
    this.updateHazards(dt);
    this.maybeBoss();
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.dead)) this.setLock(null);
    const target = this.player;
    this.rig.update(dt, target, this.room.grid, this.lockTarget);
    this.view.followTorch(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    this.room.update(this.time);
    this._lampT -= dt;
    if (this._lampT <= 0) {
      this._lampT = 0.25;
      this.view.setLamps(this.room.nearestLamps(this.player.pos, this.view.preset.lamps));
    }
    this.view.followSun(this.view.camera.position.x, this.view.camera.position.y, this.view.camera.position.z);
    this.view.update(dt, this.view.camera.position);
  }

  maybeBoss() {
    if (!this.bossSpawn || this.boss || this.bossDone) return;
    const p = this.player.pos;
    if (Math.hypot(p.x - this.bossSpawn.x, p.z - this.bossSpawn.z) < 9.5) {
      this.boss = new Boss(this, this.run.depth, new THREE.Vector3(this.bossSpawn.x, 0, this.bossSpawn.z));
      this.enemies.push(this.boss);
      this.view.scene.add(this.boss.mesh);
      this.setLock(this.boss);
      this.slowMo(0.9);
      this.view.shake(1.2);
      // the boss holds its intro pose for 1.5 s — spend it on a camera move instead of
      // leaving the rig wherever combat left it
      this.cine = { t: 0, dur: 1.5, lock: 0.9, dist0: this.rig.wantDist };
      this.rig.wantDist = 2.9;
      this.rig.pitch = clamp(this.rig.pitch + 0.16, -1.05, 0.78);
      this.rig.punch(1.0);
    }
  }

  updatePickups(dt) {
    const p = this.player.pos;
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      if (!pk.orb) {
        pk.mesh.rotation.y += dt * 0.9;
        pk.mesh.position.y = (pk.kind === 'shrine' ? 1.25 : pk.kind === 'blood' ? 0.7 : 0.55) + Math.sin(this.time * 1.6) * 0.08;
        if (pk.kind === 'blood' && Math.hypot(p.x - pk.pos.x, p.z - pk.pos.z) < 0.75) {
          pk.taken = true;
          disposeMesh(pk.mesh);
          this.recoverBloodstain();
        }
        continue;
      }
      pk.life -= dt;
      pk.vy -= 9 * dt;
      pk.mesh.position.y += pk.vy * dt;
      if (pk.mesh.position.y < 0.32) { pk.mesh.position.y = 0.32; pk.vy *= -0.34; }
      const d = Math.hypot(p.x - pk.mesh.position.x, p.z - pk.mesh.position.z);
      if (d < 5.5 && Math.abs(p.y - pk.mesh.position.y) < 3) {
        const pull = clamp(1 - d / 5.5, 0, 1) * dt * 14;
        pk.mesh.position.x += (p.x - pk.mesh.position.x) * pull;
        pk.mesh.position.z += (p.z - pk.mesh.position.z) * pull;
        pk.mesh.position.y += ((p.y + 0.9) - pk.mesh.position.y) * pull * 0.7;
      }
      pk.mesh.rotation.y += dt * 2.4;
      if (d < 1 && Math.abs(p.y - pk.mesh.position.y) < 2) {
        pk.taken = true;
        const gain = this.addRunes(pk.value);
        this.audio.play('runeGain', { vol: 0.5, rate: 0.9 + Math.random() * 0.3 });
        this.damageNumber(this.player.pos, '+' + gain, 'rune');
        disposeMesh(pk.mesh);
      } else if (pk.life <= 0) {
        pk.taken = true;
        disposeMesh(pk.mesh);
      }
    }
    this.pickups = this.pickups.filter((pk) => !pk.taken);
  }

  recoverBloodstain() {
    const b = this.run.bloodstain;
    if (!b) return;
    this.run.runes += b.amount;
    this.run.bloodstain = null;
    this.hud.toast('取回灰烬', 'RUNES RECLAIMED', 'crit');
    this.audio.play('boonPickup');
    this.snapshotRun();
  }

  updateHazards(dt) {
    const p = this.player;
    for (const h of this.hazards) {
      h.life -= dt;
      h.tick -= dt;
      h.mesh.material.opacity = h.life < 0.8 ? clamp(h.life / 0.8, 0, 0.4) : 0.2 + Math.sin(this.time * 8) * 0.12;
      h.mesh.scale.setScalar(clamp(1 + (1 - h.life) * 0.1, 1, 1.2));
      if (Math.random() < dt * 14) this.view.burst(h.pos.x + (Math.random() - 0.5) * h.radius * 1.6, 0.2, h.pos.z + (Math.random() - 0.5) * h.radius * 1.6, { count: 2, color: '#ff8a3c', speed: 1.2, life: 0.7, up: 2.4, gravity: -1 });
      if (h.tick <= 0 && p && !p.dead) {
        h.tick = 0.55;
        if (Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z) < h.radius && p.pos.y < 0.4) {
          p.takeDamage(this, h.dmg, { school: 'spell', magic: true, dirX: 0, dirZ: 0 });
        }
      }
    }
    const dying = this.hazards.filter((h) => h.life <= 0);
    for (const h of dying) {
      h.mesh.parent?.remove(h.mesh);
      h.mesh.geometry.dispose();
      h.mesh.material.dispose();
    }
    this.hazards = this.hazards.filter((h) => h.life > 0);
  }

  updateHud() {
    const p = this.player;
    this.hud.setVitals({
      hp: p.hp, maxHp: p.maxHp, st: p.stamina, stMax: p.s.staminaMax, fp: p.fp, fpMax: p.s.fpMax,
      estus: p.estus, estusMax: Math.round(p.s.estusMax), canAsh: p.s.fpMax > 18 && this.ashes.length < (p.flags.ashTwin ? 2 : 1),
      spells: [
        { cn: '焰牙', ready: p.fp >= 12 }, { cn: '魂斩', ready: p.fp >= 19 }, { cn: '刃环', ready: p.fp >= 24 },
      ].slice(0, p.s.fpMax > 0 ? 3 : 0),
      poise: Math.max(0, p.poise), poiseMax: p.s.poiseMax,
    });
    this.hud.setRunes(this.run.runes, this.run.bloodstain ? this.run.bloodstain.amount : 0);
    this.hud.setDepth(`第 ${'一二三'[this.run.depth]} 层 · ${DEPTH_MODIFIERS[this.run.depth].cn}`, `进 ${this.run.roomIdx + 1}/${this.plans[this.run.depth].rooms.length} · 复活 ${this.run.revives}`);
    this.hud.setRelics(this.run.relics.map((id) => RELICS.find((r) => r.id === id)).filter(Boolean));
    const t = this.nearestInteract();
    this.hud.setInteract(t ? t.text : null, 'F');
    if (this.lockTarget) {
      const v = new THREE.Vector3(this.lockTarget.pos.x, this.lockTarget.pos.y + 1.2, this.lockTarget.pos.z).project(this.view.camera);
      const d = this.player.pos.distanceTo(this.lockTarget.pos);
      this.hud.setLock(true, (v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, clamp(220 / d, 30, 150));
    } else this.hud.setLock(false);
    this.hud.drawMap(this);
  }

  menuStep(dt) {
    this.menuAngle += dt * 0.075;
    if (!this.room) return;
    const g = this.room.gracePos || { x: 0, z: 0 };
    const r = 9.5;
    this.view.camera.position.set(g.x + Math.cos(this.menuAngle) * r, 3.2 + Math.sin(this.menuAngle * 0.7) * 0.8, g.z + Math.sin(this.menuAngle) * r);
    this.view.camera.lookAt(g.x, 1.35, g.z);
    if (Math.random() < dt * 12) this.view.burst(g.x + (Math.random() - 0.5) * 1.2, 0.4, g.z + (Math.random() - 0.5) * 1.2, { count: 1, color: '#ffd487', speed: 0.6, life: 2.2, up: 1.5, gravity: 0.2 });
    this.view.setLamps(this.room.nearestLamps(this.view.camera.position, Math.min(5, this.view.preset.lamps)));
    this.room.update(this.time);
    this.view.followSun(this.view.camera.position.x, 0, this.view.camera.position.z);
    this.view.update(dt, this.view.camera.position);
  }

  loop(ts) {
    requestAnimationFrame(this.loop);
    // damp() diverges on a negative delta, and out-of-order timestamps do happen
    // when a frame is driven manually from the test harness
    const d = (ts - this._last) / 1000;
    const raw = Math.min(0.048, d > 0 ? d : 0.016);
    this._last = ts;
    // nothing is watching, so nothing should be rasterised: rAF keeps firing in
    // headless and occluded contexts, and a souls-like sim has no meaning there
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.state === 'playing' || this.state === 'dying') {
      let dt = raw;
      if (this.hitStopT > 0) { this.hitStopT -= raw; dt = raw * 0.09; }
      else if (this.slowT > 0) { this.slowT -= raw; dt = raw * 0.4; }
      this.time += dt;
      if (this.state === 'playing') this.step(dt);
      else {
        this.player.update(dt, this);
        for (const e of this.enemies) if (!e.disposed) e.update(dt, this);
        this.rig.update(dt, this.player, this.room.grid, null);
        this.room.update(this.time);
        this.view.update(dt, this.view.camera.position);
      }
      this.updateHud();
      this.checkBuffs(dt);
    } else {
      this.time += raw;
      // menus never call step(), so without this the pad stops polling and the
      // remap screen could not see a button press
      this.input.pollPad();
      if (!this.player || this.state === 'title' || this.state === 'hub') this.menuStep(raw);
      else { this.room?.update(this.time); this.view.update(raw, this.view.camera.position); }
    }
    if (this.state === 'playing' && this.input.justPressed('pause')) this.pauseGame();
    else if (this.state === 'paused' && this.input.justPressed('pause')) this.resumeGame();
    if (this.state === 'draft' && this.draft) {
      for (let i = 0; i < this.draft.picked.length; i++) {
        if (this.input.justPressed('spell' + (i + 1))) this.pickDraft(this.draft.picked[i]);
      }
      if (this.input.justPressed('reroll')) this.rerollDraft();
    }
    this.input.endFrame();
    this.view.render();
    this._fps.n++;
    this._fps.t += raw;
    if (this._fps.t > 1) { this._fps.v = Math.round(this._fps.n / this._fps.t); this._fps.t = 0; this._fps.n = 0; }
  }

  checkBuffs(dt) {
    this.ashes = this.ashes.filter((a) => !a.disposed);
    this.taunt = this.ashes.find((a) => a.alive && !a.dead) || null;
    const engaged = this.enemies.some((e) => e.alive && !e.dead && (e.state === 'combat' || e.state === 'windup'));
    this.audio.setAmbienceMood(engaged ? 1 : 0);
    const p = this.player;
    if (p && !p.dead && p.hp < p.maxHp * 0.3) {
      this._lowT = (this._lowT || 0) - dt;
      if (this._lowT <= 0) { this._lowT = 1.2; this.audio.play('lowHp', { vol: 0.85 }); }
    } else this._lowT = 0;
  }
}

function spreadPoints(room, count, rng) {
  const pts = room.spawnField.filter((p) => Math.hypot(p.x - room.entry.x, p.z - room.entry.z) > 6.5);
  const out = [];
  if (!pts.length) return out;
  for (let i = 0; i < count * 6 && out.length < count; i++) {
    const p = rng.pick(pts);
    if (out.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > 3)) out.push(p);
  }
  while (out.length < count) out.push(rng.pick(pts));
  return out;
}

function statBlock(s) {
  const row = (k, v) => `<div>${k} <b>${v}</b></div>`;
  return [
    row('抵达', s.depth), row('房间', s.room), row('灰烬', (s.runes || 0).toLocaleString()),
    row('击杀', s.kills), row('圣物', s.relics), row('首领', s.bossKills),
    row('弹反', s.parries), row('背刺', s.backstabs), row('用时', `${Math.floor(s.time / 60)}′${String(s.time % 60).padStart(2, '0')}″`),
    row('种子', s.seed), s.marks !== undefined ? row('灰烬印记', '+' + s.marks) : '',
  ].join('');
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game(document.getElementById('gl'));
  window.ashen = game;
  game.hub.bind();
});

export { Game, statBlock, ROOM_MOBS, pickMobKind, roomMobCount };
