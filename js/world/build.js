import * as THREE from 'three';
import { CELL } from './grid.js';
import { glowTexture } from '../engine/view.js';
import { stoneMaps, runeTexture } from './texture.js';

const geoCache = new Map();
const dummy = new THREE.Object3D();

function box(w, h, d) {
  const k = `b${w}_${h}_${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function lathe(profile, seg, key) {
  const k = `l${key}`;
  if (!geoCache.has(k)) {
    geoCache.set(k, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg));
  }
  return geoCache.get(k);
}
function arch(r, tube, seg) {
  const k = `a${r}_${tube}_${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.TorusGeometry(r, tube, 5, seg, Math.PI));
  return geoCache.get(k);
}
function cyl(rt, rb, h, seg = 10) {
  const k = `c${rt}_${rb}_${h}_${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(k);
}
function cone(r, h, seg = 8) {
  const k = `k${r}_${h}_${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.ConeGeometry(r, h, seg));
  return geoCache.get(k);
}
function ico(r, det = 0) {
  const k = `i${r}_${det}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.IcosahedronGeometry(r, det));
  return geoCache.get(k);
}
function torus(r, t, seg = 14) {
  const k = `t${r}_${t}_${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.TorusGeometry(r, t, 6, seg));
  return geoCache.get(k);
}
function plane(w, h) {
  const k = `p${w}_${h}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.PlaneGeometry(w, h));
  return geoCache.get(k);
}
// A stela is a slab with a turned head — an extruded profile, not a box with a
// cylinder glued on, so the bevel runs continuously around the shoulder.
function stela() {
  if (!geoCache.has('stela')) {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(-0.3, 0.52);
    s.absarc(0, 0.52, 0.3, Math.PI, 0, true);
    s.lineTo(0.3, 0);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
    geo.translate(0, 0, -0.08);
    geoCache.set('stela', geo);
  }
  return geoCache.get('stela');
}
function brazierGeo() {
  if (!geoCache.has('brazier')) {
    geoCache.set('brazier', new THREE.LatheGeometry([
      [0.16, 0], [0.34, 0.06], [0.3, 0.16], [0.24, 0.34], [0.3, 0.52], [0.46, 0.72], [0.5, 0.78], [0.42, 0.8],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 12));
  }
  return geoCache.get('brazier');
}

// Instance colours multiply the albedo map, so these stay near-white variation:
// they carry per-block tone, not the surface value.
const TONES = ['#dedcd6', '#d2cec6', '#e6e2da', '#c9c7cc', '#dfd6c6', '#c4c0bb'];

function instanced(geo, mat, items, { cast = true, receive = true, colors = null } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const c = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    dummy.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    if (colors) m.setColorAt(i, c.copy(colors[i % colors.length]));
  }
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.frustumCulled = false;
  return m;
}

function applyShadows(group) {
  group.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; if (!o.material?.transparent) o.castShadow = true; } });
}

function toneList(rng, n, blend, base = null) {
  const out = [];
  // 0.16 keeps the mood as a hue hint; lerping deeper would re-darken the map it multiplies
  for (let i = 0; i < n; i++) out.push(new THREE.Color(base || TONES[Math.floor(rng.next() * TONES.length)]).lerp(blend, 0.16));
  return out;
}

export function buildRoom(room, mood, rng) {
  const g = room.grid, cell = g.cell;
  const group = new THREE.Group();
  const owned = [];
  const tint = new THREE.Color(mood.tint);
  const kind = room.spec.kind || room.spec.type;

  // one flagstone tile per 1.6 m cell face; walls ask for two tiles up a
  // 4.6 m face so the courses stay near cubic rather than smearing tall
  const floorMaps = stoneMaps('floor', 1);
  const wallMaps = stoneMaps('wall', [1, 2]);
  const pillarMaps = stoneMaps('pillar', [1, 3]);
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#f4f2f6', roughness: 0.94, metalness: 0.04, ...floorMaps, normalScale: new THREE.Vector2(0.92, 0.92) });
  const obsidianMat = new THREE.MeshStandardMaterial({ color: '#efedf4', roughness: 0.4, metalness: 0.6, ...stoneMaps('obsidian', 2), normalScale: new THREE.Vector2(0.65, 0.65) });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#f2f0f6', roughness: 0.98, metalness: 0.02, ...wallMaps, normalScale: new THREE.Vector2(1.3, 1.3) });
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#f2f0f6', roughness: 0.92, metalness: 0.03, ...pillarMaps, normalScale: new THREE.Vector2(0.9, 0.9) });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#2a2620', roughness: 0.7, metalness: 0.35, emissive: tint, emissiveIntensity: 0.12 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.35, metalness: 0.9 });
  const boneMat = new THREE.MeshStandardMaterial({ color: '#6b6557', roughness: 0.88, metalness: 0.02 });
  owned.push(stoneMat, obsidianMat, wallMat, pillarMat, trimMat, goldMat, boneMat);

  const floorItems = [], wallItems = [], pillars = [], rubble = [], lowwalls = [];
  const isOpen = (cx, cz) => g.inBounds(cx, cz) && g.type[g.index(cx, cz)] !== CELL.WALL;

  for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
    const i = g.index(cx, cz), t = g.type[i];
    if (t === CELL.WALL) {
      let near = false;
      for (let dz = -2; dz <= 2 && !near; dz++) for (let dx = -2; dx <= 2; dx++) if (isOpen(cx + dx, cz + dz)) { near = true; break; }
      if (!near) continue;
      const sy = rng.range(0.82, 1.12);
      wallItems.push({ x: g.wx(cx), y: 2.3 * sy, z: g.wz(cz), ry: rng.range(-0.05, 0.05), sy });
      continue;
    }
    floorItems.push({ x: g.wx(cx), y: -0.3, z: g.wz(cz), sx: 1.01, sy: 0.6, sz: 1.01 });
    if (t === CELL.PILLAR) pillars.push({ x: g.wx(cx), z: g.wz(cz), h: rng.range(3.5, 4.3), rot: rng.range(0, 1.57) });
    else if (t === CELL.RUBBLE) rubble.push({ x: g.wx(cx) + rng.range(-0.2, 0.2), y: 0.3, z: g.wz(cz) + rng.range(-0.2, 0.2), rx: rng.range(0, 3.14), ry: rng.range(0, 6.28), rz: rng.range(0, 3.14), sx: rng.range(0.8, 1.25), sy: rng.range(0.5, 0.95), sz: rng.range(0.8, 1.25) });
    else if (t === CELL.LOWWALL) lowwalls.push({ x: g.wx(cx), y: 0.52, z: g.wz(cz), ry: rng.range(-0.06, 0.06) });
  }

  group.add(instanced(box(cell, 0.6, cell), kind === 'arena' ? obsidianMat : stoneMat, floorItems, { cast: false, colors: toneList(rng, floorItems.length, kind === 'arena' ? new THREE.Color('#2a2434') : tint) }));
  group.add(instanced(box(cell, 4.6, cell), wallMat, wallItems, { colors: toneList(rng, wallItems.length, new THREE.Color('#2f2d38')) }));

  if (pillars.length) {
    // unit-height turned shaft: base plinth → torus → tapered flute → neck →
    // bell → abacus. Kept 0..1 in Y so the per-instance sy still scales height.
    const shaft = lathe([[0.74, 0], [0.74, 0.05], [0.62, 0.08], [0.68, 0.115], [0.56, 0.15],
      [0.5, 0.2], [0.485, 0.5], [0.47, 0.8], [0.55, 0.855], [0.5, 0.885],
      [0.6, 0.93], [0.72, 0.985], [0.76, 1]], 18, 'column');
    group.add(instanced(shaft, pillarMat, pillars.map((p) => ({ x: p.x, y: 0, z: p.z, ry: p.rot, sy: p.h })), { colors: toneList(rng, pillars.length, new THREE.Color('#4a4752')) }));
    group.add(instanced(box(1.5, 0.26, 1.5), trimMat, pillars.map((p) => ({ x: p.x, y: p.h + 0.13, z: p.z, ry: p.rot }))));
    group.add(instanced(box(1.42, 0.3, 1.42), trimMat, pillars.map((p) => ({ x: p.x, y: 0.16, z: p.z, ry: p.rot })), { cast: false }));
    for (let i = 0; i < pillars.length - 1; i++) {
      const a = pillars[i], b = pillars[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > cell * 4.5 || d < cell * 2.5 || !rng.chance(0.3)) continue;
      // the span is the geometry's local +X, so the yaw must carry +X onto it
      const span = [{ x: (a.x + b.x) / 2, y: Math.min(a.h, b.h), z: (a.z + b.z) / 2, ry: Math.atan2(-dz, dx) }];
      group.add(instanced(arch(d / 2, 0.17, 14), trimMat, span, { cast: false }));
      group.add(instanced(box(d, 0.2, 0.42), trimMat, [{ x: (a.x + b.x) / 2, y: Math.min(a.h, b.h) + 0.34, z: (a.z + b.z) / 2, ry: Math.atan2(-dz, dx) }], { cast: false }));
    }
  }
  if (rubble.length) group.add(instanced(ico(0.58), stoneMat, rubble, { colors: toneList(rng, rubble.length, new THREE.Color('#57545d')) }));
  if (lowwalls.length) group.add(instanced(box(cell, 1.15, cell * 0.62), wallMat, lowwalls, { colors: toneList(rng, lowwalls.length, new THREE.Color('#45424b')) }));

  const bones = [];
  for (let i = 0; i < 46; i++) {
    const p = rng.pick(room.spawnField);
    if (!p) break;
    bones.push({ x: p.x + rng.range(-0.7, 0.7), y: 0.12, z: p.z + rng.range(-0.7, 0.7), ry: rng.range(0, 6.28), sx: rng.range(0.3, 0.7), sy: rng.range(0.4, 1) });
  }
  if (bones.length) group.add(instanced(cone(0.13, 0.5, 5), boneMat, bones, { cast: false }));

  const lamps = [];
  for (let cz = 1; cz < g.h - 1; cz++) for (let cx = 1; cx < g.w - 1; cx++) {
    const i = g.index(cx, cz);
    if (g.type[i] !== CELL.WALL || !rng.chance(0.3)) continue;
    let fx = 0, fz = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (g.inBounds(cx + dx, cz + dz) && g.type[g.index(cx + dx, cz + dz)] === CELL.FLOOR) { fx = dx; fz = dz; break; }
    }
    if (!fx && !fz) continue;
    lamps.push({ x: g.wx(cx) + fx * cell * 0.4, y: 2.6, z: g.wz(cz) + fz * cell * 0.4, intensity: 15, distance: 11.5, color: '#ffab52' });
  }

  const torchMat = new THREE.MeshStandardMaterial({ color: '#2b2119', roughness: 0.8, metalness: 0.3 });
  owned.push(torchMat);
  const torchGroup = new THREE.Group();
  for (const l of lamps) {
    if (!l.color || l.intensity > 20) continue;
    const ry = Math.atan2(-(l.x - 0) , 1) * 0;
    const stick = new THREE.Mesh(cyl(0.06, 0.09, 0.95, 6), torchMat);
    stick.position.set(l.x, 1.95, l.z);
    stick.rotation.y = ry;
    const bowl = new THREE.Mesh(cyl(0.2, 0.09, 0.26, 8), torchMat);
    bowl.position.set(l.x, 2.42, l.z);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('flame', 'rgba(255,236,170,1)', 'rgba(255,120,20,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    flame.scale.set(1.5, 1.9, 1);
    flame.position.set(l.x, 2.58, l.z);
    l.sprite = flame;
    owned.push(flame.material);
    torchGroup.add(stick, bowl, flame);
  }
  group.add(torchGroup);

  // ---------------------------------------------------------------- dressing
  const ironMat = new THREE.MeshStandardMaterial({ color: '#211d1a', roughness: 0.6, metalness: 0.75 });
  const coalMat = new THREE.MeshStandardMaterial({ color: '#3a1405', emissive: '#ff7a2a', emissiveIntensity: 2.6, roughness: 0.9 });
  const runeMat = new THREE.MeshBasicMaterial({ map: runeTexture(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.45 });
  owned.push(ironMat, coalMat, runeMat);

  const runes = [];
  const dress = new THREE.Group();
  const braziers = [];
  for (let i = 0; i < 3; i++) {
    const p = rng.pick(room.spawnField);
    if (!p || braziers.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < cell * 3)) continue;
    braziers.push({ x: p.x, z: p.z });
  }
  for (const b of braziers) {
    const g2 = new THREE.Group();
    g2.add(new THREE.Mesh(brazierGeo(), ironMat));
    const coal = new THREE.Mesh(cyl(0.36, 0.3, 0.1, 10), coalMat);
    coal.position.y = 0.76;
    g2.add(coal);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('flame', 'rgba(255,236,170,1)', 'rgba(255,120,20,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    flame.scale.set(1.1, 1.5, 1);
    flame.position.y = 1.15;
    g2.add(flame);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const leg = new THREE.Mesh(box(0.08, 0.5, 0.08), ironMat);
      leg.position.set(Math.cos(a) * 0.26, 0.25, Math.sin(a) * 0.26);
      leg.rotation.z = Math.cos(a) * 0.16;
      leg.rotation.x = -Math.sin(a) * 0.16;
      g2.add(leg);
    }
    g2.position.set(b.x, 0, b.z);
    g2.rotation.y = rng.range(0, 6.28);
    dress.add(g2);
    owned.push(flame.material);
    lamps.push({ x: b.x, y: 1.05, z: b.z, intensity: 17, distance: 10, color: '#ff9a45', sprite: flame });
  }

  // chains: alternating link planes so the run reads as real interlinks
  const links = [];
  const anchors = pillars.length ? pillars : braziers.map((b) => ({ x: b.x, z: b.z, h: 3.6 }));
  for (let i = 0; i < Math.min(4, anchors.length); i++) {
    const p = anchors[i * Math.max(1, Math.floor(anchors.length / 4))];
    if (!p || !rng.chance(0.55)) continue;
    const n = 5 + rng.int(0, 4);
    for (let k = 0; k < n; k++) links.push({ x: p.x, y: p.h - 0.3 - k * 0.19, z: p.z, rx: k % 2 ? Math.PI / 2 : 0, ry: p.rot || 0, s: 1 });
  }
  if (links.length) dress.add(instanced(torus(0.1, 0.028, 9), ironMat, links, { cast: false }));

  if (kind === 'chapel' || kind === 'court') {
    const stones = [];
    for (let i = 0; i < 7; i++) {
      const p = rng.pick(room.spawnField);
      if (!p || stones.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < cell * 1.6)) continue;
      stones.push({ x: p.x, y: 0, z: p.z, ry: rng.range(0, 6.28), rz: rng.range(-0.09, 0.09), sy: rng.range(0.8, 1.3) });
    }
    if (stones.length) dress.add(instanced(stela(), boneMat, stones, { colors: toneList(rng, stones.length, new THREE.Color('#4d4a48')) }));
  }
  group.add(dress);

  if (kind === 'arena') {
    const big = new THREE.Mesh(plane(13, 13), runeMat);
    big.rotation.x = -Math.PI / 2;
    big.position.set(room.center ? room.center.x : 0, 0.06, room.center ? room.center.z : 0);
    group.add(big);
    runes.push(big);
  }

  if (room.spec.kind === 'chapel') {
    const bannerMat = new THREE.MeshStandardMaterial({ color: mood.banner || '#6d2a2a', roughness: 0.85, side: THREE.DoubleSide, emissive: tint, emissiveIntensity: 0.1 });
    owned.push(bannerMat);
    for (let i = -1; i <= 1; i++) {
      const b = new THREE.Mesh(plane(1.4, 3.4), bannerMat);
      b.position.set(i * cell * 5, 2.3, -cell * 6.2);
      group.add(b);
    }
  }

  if (room.spec.kind === 'arena') {
    const ringMat = new THREE.MeshStandardMaterial({ color: '#241d1a', roughness: 0.5, metalness: 0.6, emissive: tint, emissiveIntensity: 0.45 });
    owned.push(ringMat);
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(torus(6 + r * 4.2, 0.09, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      group.add(ring);
    }
  }

  const portalMat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const rimMat = new THREE.MeshBasicMaterial({ color: '#ffe3a8', transparent: true, opacity: 0.8 });
  owned.push(portalMat, rimMat);
  const portal = new THREE.Group();
  const disc = new THREE.Mesh(plane(cell * 1.9, 3.6), portalMat);
  const rim = new THREE.Mesh(torus(1.5, 0.07, 22), rimMat);
  rim.scale.set(1, 1.6, 1);
  portal.add(disc, rim);
  portal.position.set(room.exit.x - cell * 0.3, 1.9, room.exit.z);
  portal.rotation.y = Math.PI / 2;
  group.add(portal);

  const gateMat = new THREE.MeshBasicMaterial({ color: '#b9c6d8', transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  owned.push(gateMat);
  const gate = new THREE.Mesh(plane(cell * 2.6, 4.4), gateMat);
  gate.position.set(room.gate.x, 2.1, room.gate.z);
  gate.rotation.y = Math.PI / 2;
  gate.visible = !!room.spec.gated;
  // sealed sigil rides the gate mesh so opening the fog takes it with it
  const seal = new THREE.Mesh(plane(2.9, 2.9), runeMat);
  seal.position.z = 0.06;
  gate.add(seal);
  runes.push(seal);
  group.add(gate);

  const graceMat = new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.6, metalness: 0.7 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#cbb27a', roughness: 0.3, metalness: 0.95, emissive: '#ffcf7a', emissiveIntensity: 1.2 });
  owned.push(graceMat, bladeMat);
  const grace = new THREE.Group();
  const pile = new THREE.Mesh(cyl(0.95, 1.25, 0.28, 12), graceMat);
  pile.position.y = 0.14;
  const pile2 = new THREE.Mesh(cyl(0.5, 0.8, 0.24, 10), graceMat);
  pile2.position.y = 0.34;
  const blade = new THREE.Mesh(box(0.12, 1.55, 0.34), bladeMat);
  blade.position.y = 1.1;
  const cross = new THREE.Mesh(box(0.64, 0.12, 0.14), bladeMat);
  cross.position.y = 0.66;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('grace', 'rgba(255,232,170,0.95)', 'rgba(230,160,60,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  halo.scale.set(6, 6, 1);
  halo.position.y = 1.2;
  grace.add(pile, pile2, blade, cross, halo);
  const graceRune = new THREE.Mesh(plane(3.6, 3.6), runeMat);
  graceRune.rotation.x = -Math.PI / 2;
  graceRune.position.y = 0.05;
  grace.add(graceRune);
  runes.push(graceRune);
  const gracePos = room.spec.type === 'chapel' ? { x: g.wx(room.mid.cx), z: g.wz(room.doorRow) } : null;
  if (gracePos) grace.position.set(gracePos.x, 0, gracePos.z);
  else grace.visible = false;
  group.add(grace);
  if (gracePos) lamps.push({ x: gracePos.x, y: 1.15, z: gracePos.z, intensity: 28, distance: 14, color: '#ffd487' });

  applyShadows(group);

  return {
    group, grid: g, room, lamps, portal, gate, grace, gracePos,
    bounds: { w: g.w * g.cell, h: g.h * g.cell },
    update(t) {
      portal.children[0].material.opacity = 0.3 + Math.sin(t * 2.1) * 0.12;
      portal.children[1].rotation.z = t * 0.4;
      if (gate.visible) gate.material.opacity = 0.2 + Math.sin(t * 3.4) * 0.07;
      runeMat.opacity = 0.34 + Math.sin(t * 1.7) * 0.13;
      coalMat.emissiveIntensity = 2.2 + Math.sin(t * 7.3) * 0.55;
      for (const r of runes) r.rotation.z = t * 0.12;
      for (let i = 0; i < lamps.length; i++) {
        const s = lamps[i].sprite;
        if (s) s.scale.set(1.4 + Math.sin(t * 11 + i) * 0.22, 1.9 + Math.cos(t * 9 + i * 2) * 0.3, 1);
      }
    },
    nearestLamps(pos, n) {
      return lamps.map((l) => ({ l, d: Math.hypot(l.x - pos.x, l.z - pos.z) })).sort((a, b) => a.d - b.d).slice(0, n).map((o) => o.l);
    },
    dispose() {
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      for (const m of owned) m.dispose();
    },
  };
}
