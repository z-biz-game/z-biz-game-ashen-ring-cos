import * as THREE from 'three';
import { CELL } from './grid.js';
import { glowTexture } from '../engine/view.js';

const geoCache = new Map();
const dummy = new THREE.Object3D();

function box(w, h, d) {
  const k = `b${w}_${h}_${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
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

const TONES = ['#6b6a6f', '#5e5b58', '#77746f', '#54544f', '#6f6a5f', '#4d4a48'];

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
  for (let i = 0; i < n; i++) out.push(new THREE.Color(base || TONES[Math.floor(rng.next() * TONES.length)]).lerp(blend, 0.35));
  return out;
}

export function buildRoom(room, mood, rng) {
  const g = room.grid, cell = g.cell;
  const group = new THREE.Group();
  const owned = [];
  const tint = new THREE.Color(mood.tint);

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#5a5760', roughness: 0.94, metalness: 0.04 });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#3c3a43', roughness: 0.98, metalness: 0.02 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#2a2620', roughness: 0.7, metalness: 0.35, emissive: tint, emissiveIntensity: 0.12 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.35, metalness: 0.9 });
  const boneMat = new THREE.MeshStandardMaterial({ color: '#8b8676', roughness: 0.8 });
  owned.push(stoneMat, wallMat, trimMat, goldMat, boneMat);

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
    else if (t === CELL.RUBBLE) rubble.push({ x: g.wx(cx), y: 0.28, z: g.wz(cz), ry: rng.range(0, 6.28), sx: rng.range(0.75, 1.2), sz: rng.range(0.75, 1.2) });
    else if (t === CELL.LOWWALL) lowwalls.push({ x: g.wx(cx), y: 0.52, z: g.wz(cz), ry: rng.range(-0.06, 0.06) });
  }

  group.add(instanced(box(cell, 0.6, cell), stoneMat, floorItems, { cast: false, colors: toneList(rng, floorItems.length, tint) }));
  group.add(instanced(box(cell, 4.6, cell), wallMat, wallItems, { colors: toneList(rng, wallItems.length, new THREE.Color('#2f2d38')) }));

  if (pillars.length) {
    group.add(instanced(cyl(0.52, 0.64, 1, 8), wallMat, pillars.map((p) => ({ x: p.x, y: p.h / 2, z: p.z, ry: p.rot, sy: p.h })), { colors: toneList(rng, pillars.length, new THREE.Color('#4a4752')) }));
    group.add(instanced(box(1.5, 0.34, 1.5), trimMat, pillars.map((p) => ({ x: p.x, y: p.h - 0.2, z: p.z, ry: p.rot }))));
    group.add(instanced(box(1.42, 0.3, 1.42), trimMat, pillars.map((p) => ({ x: p.x, y: 0.16, z: p.z, ry: p.rot })), { cast: false }));
    for (let i = 0; i < pillars.length - 1; i++) {
      const a = pillars[i], b = pillars[i + 1];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > cell * 4.5 || d < cell * 2.5 || !rng.chance(0.3)) continue;
      group.add(instanced(box(d, 0.26, 0.5), trimMat, [{ x: (a.x + b.x) / 2, y: 3.95, z: (a.z + b.z) / 2, ry: Math.atan2(b.x - a.x, b.z - a.z) }], { cast: false }));
    }
  }
  if (rubble.length) group.add(instanced(box(cell * 0.85, 0.6, cell * 0.85), stoneMat, rubble, { colors: toneList(rng, rubble.length, new THREE.Color('#57545d')) }));
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
    torchGroup.add(stick, bowl, flame);
  }
  group.add(torchGroup);

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
  gate.position.set(room.entry.x + cell * 0.9, 2.1, room.entry.z);
  gate.rotation.y = Math.PI / 2;
  gate.visible = !!room.spec.gated;
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
