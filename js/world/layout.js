import { Grid, CELL } from './grid.js';
import { clamp, RNG } from '../engine/rng.js';

const CARVE = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
];

function carveRect(g, x0, z0, x1, z1) {
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) g.set(cx, cz, CELL.FLOOR);
}

function carveDisc(g, cx, cz, r) {
  for (let dz = -r - 1; dz <= r + 1; dz++) for (let dx = -r - 1; dx <= r + 1; dx++) {
    if (Math.hypot(dx, dz) <= r + (Math.hypot(dx, dz) % 1) * 0.4) g.set(cx + dx, cz + dz, CELL.FLOOR);
  }
}

function scatter(g, rng, count, pick, type) {
  for (let i = 0; i < count; i++) {
    const cell = pick();
    if (cell) g.set(cell[0], cell[1], type);
  }
}

function floors(g) {
  const out = [];
  for (let cz = 1; cz < g.h - 1; cz++) for (let cx = 1; cx < g.w - 1; cx++) if (g.type[g.index(cx, cz)] === CELL.FLOOR) out.push([cx, cz]);
  return out;
}

export const DEPTH_MOODS = [
  { cn: '灰烬墓地', name: 'Ashen Necropolis', tint: '#c8a24a', top: '#0a0c15', bot: '#3b2d23', glow: '#caa253', fogColor: '#181720', fogDensity: 0.026, sunColor: '#ffd9a0', sunInt: 2.1, hemiInt: 0.95, star: 0.4 },
  { cn: '沉沦回廊', name: 'Sunken Cloister', tint: '#7fb0c8', top: '#080b12', bot: '#1f2a33', glow: '#5f93b3', fogColor: '#131a21', fogDensity: 0.033, sunColor: '#bcd8ff', sunInt: 1.5, hemiInt: 0.88, star: 0.9 },
  { cn: '王冠熔炉', name: 'Crown Forge', tint: '#e0743a', top: '#120708', bot: '#4a1e12', glow: '#ff8a3c', fogColor: '#20110c', fogDensity: 0.038, sunColor: '#ffb070', sunInt: 2.5, hemiInt: 0.8, star: 0.15 },
];

export function planDepth(rng, depthIndex) {
  const mood = DEPTH_MOODS[clamp(depthIndex, 0, 2)];
  const count = 5 + depthIndex;
  const rooms = [{ type: 'chapel', kind: 'chapel', w: 24, h: 20 }];
  const pool = ['combat', 'combat', 'court', 'combat', 'cache', 'shrine', 'cross'];
  const used = [];
  for (let i = 1; i < count; i++) {
    let type = rng.pick(pool);
    if (used[i - 2] === type && rng.chance(0.6)) type = rng.pick(pool);
    if (i === count - 2 && !used.includes('shrine')) type = 'shrine';
    used.push(type);
    const kind = type === 'court' ? 'court' : type === 'cross' ? 'cross' : type === 'cache' ? 'hall' : 'hall';
    const w = type === 'cache' ? rng.int(20, 24) : rng.int(26, 32);
    rooms.push({ type, kind, w, h: kind === 'court' ? w - 4 : rng.int(18, 24) });
  }
  rooms.push({ type: 'boss', kind: 'arena', w: 34, h: 32, gated: true });
  return { index: depthIndex, ...mood, rooms, seedNote: rng.int(1000, 9999) };
}

export function buildRoomGrid(rng, spec, opts = {}) {
  const w = spec.w | 0, h = spec.h | 0;
  const g = new Grid(w, h, 1.6);
  const mid = { cx: w >> 1, cz: h >> 1 };
  const doorRow = mid.cz;

  if (spec.kind === 'court' || spec.kind === 'arena') {
    carveDisc(g, mid.cx, mid.cz, Math.min(w, h) / 2 - 2);
    const r = Math.min(w, h) / 2 - 2;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
      if (!rng.chance(spec.kind === 'arena' ? 0.35 : 0.6)) continue;
      const cx = Math.round(mid.cx + Math.cos(a) * (r - 2)), cz = Math.round(mid.cz + Math.sin(a) * (r - 2));
      g.set(cx, cz, CELL.PILLAR);
    }
  } else if (spec.kind === 'cross') {
    carveRect(g, 2, doorRow - 3, w - 3, doorRow + 3);
    carveRect(g, mid.cx - 3, 2, mid.cx + 3, h - 3);
    carveRect(g, mid.cx - 6, doorRow - 6, mid.cx + 6, doorRow + 6);
  } else {
    carveRect(g, 2, 2, w - 3, h - 3);
  }

  const row = doorRow;
  const inW = g.cx(-g.w * g.cell / 2 + 1), inZ = row;
  carveRect(g, 0, row - 1, 2, row + 1);
  carveRect(g, w - 3, row - 1, w + 1, row + 1);

  if (spec.kind === 'chapel') {
    carveRect(g, mid.cx - 4, 1, mid.cx + 4, 4);
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      g.set(mid.cx + side * 5, 3 + (i >> 1) * 2, CELL.LOWWALL);
    }
    for (let cz = 6; cz < h - 6; cz += 5) {
      g.set(mid.cx - 6, cz, CELL.PILLAR);
      g.set(mid.cx + 6, cz, CELL.PILLAR);
    }
  } else {
    const lattice = spec.kind === 'arena' ? 7 : 6;
    for (let cz = 4; cz < h - 4; cz += lattice) {
      for (let cx = 4; cx < w - 4; cx += lattice) {
        if (g.type[g.index(cx, cz)] !== CELL.FLOOR) continue;
        if (Math.abs(cx - mid.cx) < 3 && Math.abs(cz - doorRow) < 3) continue;
        if (rng.chance(spec.kind === 'arena' ? 0.55 : 0.72)) {
          g.set(cx, cz, CELL.PILLAR);
          if (rng.chance(0.3) && g.type[g.index(cx + 1, cz)] === CELL.FLOOR) g.set(cx + 1, cz, CELL.PILLAR);
        }
      }
    }
    const nRubble = spec.type === 'cache' ? 26 : spec.kind === 'arena' ? 10 : 40;
    const fl = floors(g);
    scatter(g, rng, nRubble, () => {
      const c = rng.pick(fl);
      const [cx, cz] = c;
      if (Math.abs(cx - mid.cx) < 2 && Math.abs(cz - doorRow) < 2) return null;
      if ((cx < 4 || cx > w - 5) && Math.abs(cz - doorRow) < 3) return null;
      return g.type[g.index(cx, cz)] === CELL.FLOOR ? c : null;
    }, CELL.RUBBLE);
    if (spec.kind !== 'arena') {
      for (let i = 0; i < 3; i++) {
        const cz = rng.int(4, h - 5);
        const cx = rng.int(4, w - 8);
        if (Math.abs(cz - doorRow) < 3) continue;
        for (let k = 0; k < rng.int(3, 6); k++) if (g.type[g.index(cx + k, cz)] === CELL.FLOOR) g.set(cx + k, cz, CELL.LOWWALL);
      }
    }
  }

  // repeated full-grid passes, not a per-neighbour offset: dx/dz are unused
  for (let pass = 0; pass < CARVE.length; pass++) {
    for (let cz = 1; cz < h - 1; cz++) for (let cx = 1; cx < w - 1; cx++) {
      if (g.type[g.index(cx, cz)] !== CELL.FLOOR) continue;
      if ((cx < 4 || cx > w - 5) && Math.abs(cz - doorRow) < 3) continue;
      if (g.openCount(cx, cz) === 4 && rng.chance(0.15)) g.set(cx, cz, CELL.RUBBLE);
    }
  }

  // facing is (sin yaw, cos yaw); the door row runs west → east, so both face +X
  const entry = { x: g.wx(0) + 0.4, z: g.wz(row), yaw: Math.PI / 2 };
  const exit = { x: g.wx(w - 1) - 0.4, z: g.wz(row), yaw: Math.PI / 2 };
  // inset so the player gets a stretch of approach in front of the gate and the
  // third-person camera has room to sit behind them at the doorway
  const gate = { x: entry.x + g.cell * 2.7, z: entry.z };
  const usable = floors(g).filter(([cx, cz]) => g.type[g.index(cx, cz)] === CELL.FLOOR && g.openCount(cx, cz) >= 2 && Math.abs(cx - mid.cx) > 3);
  const spawnField = usable.map(([cx, cz]) => ({ x: g.wx(cx), z: g.wz(cz) }));
  const center = { x: 0, z: 0 };
  return { grid: g, spec, entry, exit, gate, spawnField, center, cellSize: g.cell, mid, doorRow };
}

export function spawnPoints(room, rng, count, minFromEntry = 7) {
  const list = room.spawnField.filter((p) => Math.hypot(p.x - room.entry.x, p.z - room.entry.z) > minFromEntry * room.cellSize);
  const out = [];
  if (!list.length) return out;
  for (let i = 0; i < count && out.length < 40; i++) {
    const p = rng.pick(list);
    if (out.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > 2.6)) out.push({ x: p.x, z: p.z });
  }
  while (out.length < count) out.push({ ...rng.pick(room.spawnField) });
  return out;
}

export function graceSpot(room) {
  const g = room.grid;
  let best = null;
  for (const p of room.spawnField) {
    const d = Math.hypot(p.x - room.entry.x, p.z - room.entry.z);
    if (p.x > 2 && (!best || d > best.d)) best = { x: p.x, z: p.z, d };
  }
  if (!best) return { x: room.grid.wx(room.mid.cx + 4), z: room.grid.wz(room.doorRow) };
  const cx = g.cx(best.x), cz = g.cz(best.z);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) g.set(cx + dx, cz + dz, CELL.FLOOR);
  return best;
}

export { RNG };
