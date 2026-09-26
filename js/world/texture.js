import * as THREE from 'three';

// Procedural PBR map factory.
//
// Every map is periodic by construction (the noise lattice and the block grid
// both wrap at the tile edge), so RepeatWrapping is seamless without the
// mirror-symmetry cheat. Height is generated first, then albedo and roughness
// are derived from it and the normal map comes out of a wrapped Sobel filter —
// one source of truth, so relief and colour can never disagree.

const SIZE = 256;
const cache = new Map();

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x1b873593) ^ Math.imul(seed | 0, 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x2545f491);
  return ((h ^ (h >>> 17)) >>> 0) / 4294967295;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

// value noise sampled on an integer lattice that wraps every `period` cells
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a, b) => hash2(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function fbm(x, y, period, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(x * f, y * f, period * f, seed + o * 977);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

// Thin dark lines wherever a field crosses 0.5 — cracks, veins, mortar seams.
const ridge = (v, w) => 1 - smooth(0, w, Math.abs(v - 0.5));

// Block layout that repeats every `nx` × `ny` cells, with per-block size and
// position jitter so the course work never reads as a perfect grid.
function blockField(u, v, nx, ny, seed, jag) {
  const bx = Math.floor(u * nx), by = Math.floor(v * ny);
  const fx = u * nx - bx, fy = v * ny - by;
  const r = (k) => hash2(((bx % nx) + nx) % nx, ((by % ny) + ny) % ny, seed + k);
  // running bond: alternate rows slide half a block, wrapped so it stays periodic
  const shift = (by % 2) * 0.5;
  const sx = (fx + shift) % 1, sy = fy;
  const hw = 0.5 - jag * 0.16 * r(3), hh = 0.5 - jag * 0.16 * r(5);
  const dx = Math.abs(sx - 0.5 - (r(1) - 0.5) * jag * 0.22) / hw;
  const dy = Math.abs(sy - 0.5 - (r(2) - 0.5) * jag * 0.22) / hh;
  const edge = Math.max(dx, dy);
  return { edge, tone: r(7), chip: r(11) };
}

function makeHeight(kind) {
  const h = new Float32Array(SIZE * SIZE);
  const tone = new Float32Array(SIZE * SIZE);
  const inv = 1 / SIZE;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const u = (px + 0.5) * inv, v = (py + 0.5) * inv;
      let z = 0, tn = 0;
      if (kind === 'floor') {
        const b = blockField(u, v, 3, 3, 7, 1);
        const face = 0.5 + 0.5 * fbm(u * 12, v * 12, 12, 31, 3);
        const crack = ridge(fbm(u * 7, v * 7, 7, 131, 3), 0.05) * 0.35;
        const wear = smooth(0.82, 1.06, b.edge);
        z = (1 - wear) * (0.34 + 0.66 * face - crack) + wear * 0.06;
        tn = b.tone * 0.7 + face * 0.3;
      } else if (kind === 'wall') {
        // 2 × 3 courses per tile, and walls ask for 2 tiles up a 4.6-unit face:
        // that lands each block near 0.8 m, which is what the cell scale reads as
        const b = blockField(u, v, 2, 3, 17, 1);
        const face = 0.5 + 0.5 * fbm(u * 10, v * 10, 10, 53, 3);
        const seam = smooth(0.80, 1.0, b.edge);
        const drip = fbm(u * 5, v * 1.4, 5, 211, 3);
        const crack = ridge(fbm(u * 6, v * 6, 6, 71, 3), 0.045) * 0.3;
        z = (1 - seam) * (0.42 + 0.58 * face - crack) + seam * 0.1;
        z *= 0.86 + 0.14 * drip;
        tn = b.tone * 0.62 + face * 0.24 + drip * 0.14;
      } else if (kind === 'pillar') {
        // fluted drum: a cosine ridge per facet, banded by course height
        const flutes = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 14);
        const b = blockField(u, v, 1, 5, 29, 0.6);
        const face = 0.5 + 0.5 * fbm(u * 9, v * 9, 9, 89, 3);
        const seam = smooth(0.88, 1.0, b.edge);
        z = (1 - seam) * (0.5 + 0.5 * (0.55 * face + 0.45 * flutes)) + seam * 0.12;
        tn = b.tone * 0.5 + face * 0.5;
      } else { // obsidian
        const facet = fbm(u * 6, v * 6, 6, 151, 3);
        const vein = ridge(fbm(u * 4, v * 4, 4, 307, 3), 0.03);
        z = 0.35 + 0.65 * facet - vein * 0.22;
        tn = facet;
      }
      const i = py * SIZE + px;
      h[i] = Math.min(1, Math.max(0, z));
      tone[i] = tn;
    }
  }
  return { h, tone };
}

function normalMap(h, strength) {
  const at = (x, y) => h[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const gx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const gy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(gx, gy, 1), i = (y * SIZE + x) * 4;
    data[i] = ((-gx / l) * 0.5 + 0.5) * 255;
    data[i + 1] = ((gy / l) * 0.5 + 0.5) * 255;
    data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    data[i + 3] = 255;
  }
  return data;
}

const PAL = {
  floor: { base: [0.352, 0.341, 0.376], grime: [0.129, 0.121, 0.113], moss: [0.153, 0.196, 0.137], ash: [0.62, 0.6, 0.57], joint: 0.58, relief: 1.95 },
  wall: { base: [0.235, 0.227, 0.263], grime: [0.086, 0.082, 0.094], moss: [0.121, 0.157, 0.113], ash: [0.5, 0.49, 0.47], joint: 0.85, relief: 2.6 },
  pillar: { base: [0.29, 0.282, 0.322], grime: [0.106, 0.102, 0.117], moss: [0.129, 0.165, 0.117], ash: [0.55, 0.54, 0.52], joint: 0.78, relief: 2.2 },
  obsidian: { base: [0.055, 0.053, 0.07], grime: [0.02, 0.02, 0.028], moss: [0.05, 0.06, 0.05], ash: [0.28, 0.27, 0.3], joint: 0.8, relief: 2.2 },
};

function shade(kind, h, tone, rough) {
  const p = PAL[kind];
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  const rdata = new Uint8ClampedArray(SIZE * SIZE * 4);
  const inv = 1 / SIZE;
  for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
    const i = py * SIZE + px, u = (px + 0.5) * inv, v = (py + 0.5) * inv;
    const zz = h[i], tn = tone[i];
    const recess = smooth(0.42, 0.05, zz);          // dark in the joints
    const dust = smooth(0.5, 0.95, zz) * smooth(0.62, 0.9, fbm(u * 3, v * 3, 3, 401, 3));
    const bio = kind === 'obsidian' ? 0 : smooth(0.72, 0.34, zz) * smooth(0.55, 0.78, fbm(u * 4, v * 4, 4, 503, 3));
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    let c = mix(p.base, p.grime, recess * p.joint);
    c = mix(c, [0, 0, 0], (1 - tn) * 0.16);
    c = mix(c, p.moss, bio * (kind === 'floor' ? 0.5 : 0.34));
    // the map is the sole carrier of value now (material.color and the per-instance
    // tint are multipliers on top of it), so it has to sit bright on its own
    const lit = 0.72 + 0.5 * zz;
    c = [c[0] * lit, c[1] * lit, c[2] * lit];
    c = mix(c, p.ash, dust * 0.3);
    if (kind === 'obsidian') {
      const vein = ridge(fbm(u * 4, v * 4, 4, 307, 3), 0.022);
      c = mix(c, [0.79, 0.64, 0.29], vein * 0.9);
    }
    const o = i * 4;
    data[o] = c[0] * 255; data[o + 1] = c[1] * 255; data[o + 2] = c[2] * 255; data[o + 3] = 255;
    const rv = kind === 'obsidian' ? 0.62 - 0.42 * (1 - zz) : 0.99 - 0.17 * smooth(0.55, 1, zz) + 0.06 * tn;
    rdata[o] = rdata[o + 1] = rdata[o + 2] = Math.min(255, Math.max(0, rv * 255)); rdata[o + 3] = 255;
    rough[i] = rv;
  }
  return { data, rdata };
}

function canvasOf(buf) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  cv.getContext('2d').putImageData(new ImageData(buf, SIZE, SIZE), 0, 0);
  return cv;
}

function tex(cv, srgb, rx, ry) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Map triple for a stone kind. `tiles` is how many repeats fit across one mesh
 * face (a number, or [across, up]), which is what keeps a 1.6 × 4.6 wall face
 * from stretching one square block into a tall smear.
 */
export function stoneMaps(kind, tiles = 1) {
  const [rx, ry] = Array.isArray(tiles) ? tiles : [tiles, tiles];
  const key = kind + '@' + rx + 'x' + ry;
  if (cache.has(key)) return cache.get(key);
  const { h, tone } = makeHeight(kind);
  const rough = new Float32Array(SIZE * SIZE);
  const { data, rdata } = shade(kind, h, tone, rough);
  const set = {
    map: tex(canvasOf(data), true, rx, ry),
    normalMap: tex(canvasOf(normalMap(h, PAL[kind].relief)), false, rx, ry),
    roughnessMap: tex(canvasOf(rdata), false, rx, ry),
  };
  cache.set(key, set);
  return set;
}

// Emissive arcane seal: drawn with vector paths so it stays crisp at any size.
export function runeTexture(seed = 3, spokes = 24) {
  const key = 'rune' + seed + '_' + spokes;
  if (cache.has(key)) return cache.get(key);
  const S2 = 256, c = document.createElement('canvas');
  c.width = c.height = S2;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S2, S2);
  g.translate(S2 / 2, S2 / 2);
  g.strokeStyle = '#ffd489';
  g.shadowColor = '#ffb54a';
  g.shadowBlur = 10;
  const ring = (r, w, dash) => {
    g.beginPath(); g.lineWidth = w; g.setLineDash(dash || []);
    g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  };
  ring(112, 3); ring(104, 1.4); ring(64, 2, [9, 7]); ring(30, 1.4);
  g.lineWidth = 2;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2, long = i % 3 === 0;
    g.beginPath();
    g.moveTo(Math.cos(a) * (long ? 66 : 96), Math.sin(a) * (long ? 66 : 96));
    g.lineTo(Math.cos(a) * 104, Math.sin(a) * 104);
    g.stroke();
  }
  // inscribed polygon + glyph ticks, all derived from the same hash stream
  g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + hash2(i, seed, 5) * 0.2;
    const r = 34 + hash2(i, seed, 9) * 22;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.stroke();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, r0 = 72 + hash2(i, seed, 13) * 18;
    g.beginPath();
    g.arc(Math.cos(a) * r0, Math.sin(a) * r0, 3 + hash2(i, seed, 17) * 3, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
