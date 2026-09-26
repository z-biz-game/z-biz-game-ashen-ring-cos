export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function strFromSeed(seed) {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '', n = seed >>> 0;
  for (let i = 0; i < 6; i++) { s += alpha[n % alpha.length]; n = Math.floor(n / alpha.length) + i * 977; n >>>= 0; }
  return s;
}

export class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }

  next() {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  weighted(items, weightOf = (x) => x.weight ?? 1) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weightOf(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  sample(items, n, weightOf = (x) => x.weight ?? 1) {
    const pool = items.slice(), out = [];
    for (let k = 0; k < n && pool.length; k++) {
      const it = this.weighted(pool, weightOf);
      out.push(it);
      pool.splice(pool.indexOf(it), 1);
    }
    return out;
  }
  fork() { return new RNG(Math.floor(this.next() * 4294967295) ^ 0x9e3779b9); }
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
export function smoothstep(t) { return t * t * (3 - 2 * t); }
export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeInCubic(t) { return t * t * t; }
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDamp(a, b, lambda, dt) { return angleLerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function distSq(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

export function valueNoise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 1440662683)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const u = smoothstep(clamp(xf, 0, 1)), v = smoothstep(clamp(yf, 0, 1));
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}

export function fbm2(x, y, octaves = 3, seed = 1) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += amp * valueNoise2(x * freq, y * freq, seed + i * 101); norm += amp; amp *= 0.5; freq *= 2; }
  return sum / norm;
}
