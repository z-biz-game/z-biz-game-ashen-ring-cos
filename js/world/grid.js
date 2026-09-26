import { clamp } from '../engine/rng.js';

export const CELL = { FLOOR: 0, WALL: 1, PILLAR: 2, RUBBLE: 3, LOWWALL: 4 };
const TOP = [0, 4.6, 4.1, 0.5, 1.15];
const SOLID = [false, true, true, true, true];
export const STEP = 0.6;

export class Grid {
  constructor(w, h, cell = 1.6) {
    this.w = w; this.h = h; this.cell = cell;
    this.type = new Uint8Array(w * h);
    this.top = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { this.type[i] = CELL.WALL; this.top[i] = TOP[CELL.WALL]; }
  }

  cx(x) { return Math.floor(x / this.cell + this.w / 2); }
  cz(z) { return Math.floor(z / this.cell + this.h / 2); }
  wx(cx) { return (cx - this.w / 2 + 0.5) * this.cell; }
  wz(cz) { return (cz - this.h / 2 + 0.5) * this.cell; }
  index(cx, cz) { return cz * this.w + cx; }

  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }

  set(cx, cz, t) {
    if (!this.inBounds(cx, cz)) return;
    this.type[this.index(cx, cz)] = t;
    this.top[this.index(cx, cz)] = TOP[t];
  }

  setWorld(x, z, t) { this.set(this.cx(x), this.cz(z), t); }
  typeAtWorld(x, z) { const cx = this.cx(x), cz = this.cz(z); return this.inBounds(cx, cz) ? this.type[this.index(cx, cz)] : CELL.WALL; }
  heightAtWorld(x, z) { const cx = this.cx(x), cz = this.cz(z); return this.inBounds(cx, cz) ? this.top[this.index(cx, cz)] : TOP[CELL.WALL]; }

  cellSolid(cx, cz, footY) {
    if (!this.inBounds(cx, cz)) return true;
    const i = this.index(cx, cz);
    return SOLID[this.type[i]] && this.top[i] - footY > STEP;
  }

  blocked(x, z, r, footY) {
    const c0 = this.cx(x - r), c1 = this.cx(x + r), r0 = this.cz(z - r), r1 = this.cz(z + r);
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      if (!this.inBounds(cx, cz)) return true;
      const i = this.index(cx, cz);
      if (!SOLID[this.type[i]]) continue;
      if (this.top[i] - footY > STEP) {
        const nx = clamp(x, this.wx(cx) - this.cell / 2, this.wx(cx) + this.cell / 2);
        const nz = clamp(z, this.wz(cz) - this.cell / 2, this.wz(cz) + this.cell / 2);
        const dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  solidAtWorld(x, z, y) { return this.blocked(x, z, 0.12, y - 0.4); }

  support(x, z, r, footY) {
    const c0 = this.cx(x - r), c1 = this.cx(x + r), r0 = this.cz(z - r), r1 = this.cz(z + r);
    let best = 0;
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      if (!this.inBounds(cx, cz)) continue;
      const i = this.index(cx, cz);
      if (!SOLID[this.type[i]]) continue;
      const nx = clamp(x, this.wx(cx) - this.cell / 2, this.wx(cx) + this.cell / 2);
      const nz = clamp(z, this.wz(cz) - this.cell / 2, this.wz(cz) + this.cell / 2);
      const dx = x - nx, dz = z - nz;
      if (dx * dx + dz * dz > (r + 0.18) * (r + 0.18)) continue;
      if (this.top[i] <= footY + STEP && this.top[i] > best) best = this.top[i];
    }
    return best;
  }

  move(pos, dx, dz, r, footY) {
    let hitX = false, hitZ = false;
    if (dx) { if (this.blocked(pos.x + dx, pos.z, r, footY)) hitX = true; else pos.x += dx; }
    if (dz) { if (this.blocked(pos.x, pos.z + dz, r, footY)) hitZ = true; else pos.z += dz; }
    return { hitX, hitZ };
  }

  los(ax, az, bx, bz) { return this.cast(ax, az, bx, bz) >= Math.hypot(bx - ax, bz - az) - 0.05; }

  cast(ax, az, bx, bz, step = 0.35) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return d;
    const ux = dx / d, uz = dz / d;
    for (let t = 0.3; t < d; t += step) {
      const cx = this.cx(ax + ux * t), cz = this.cz(az + uz * t);
      if (!this.inBounds(cx, cz)) return t;
      const i = this.index(cx, cz);
      if (SOLID[this.type[i]] && TOP[this.type[i]] > 1.5) return t;
    }
    return d;
  }

  floorCells(rng, accept) {
    const out = [];
    for (let cz = 1; cz < this.h - 1; cz++) for (let cx = 1; cx < this.w - 1; cx++) {
      const i = cz * this.w + cx;
      if (this.type[i] === CELL.FLOOR && (!accept || accept(cx, cz, i))) out.push([cx, cz]);
    }
    if (rng && out.length) return out;
    return out;
  }

  openCount(cx, cz) {
    let n = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.inBounds(cx + dx, cz + dz) && this.type[this.index(cx + dx, cz + dz)] === CELL.FLOOR) n++;
    }
    return n;
  }
}
