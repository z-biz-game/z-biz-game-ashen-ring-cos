import * as THREE from 'three';

const geo = new Map();
function box(w, h, d) { const k = `b${w}_${h}_${d}`; if (!geo.has(k)) geo.set(k, new THREE.BoxGeometry(w, h, d)); return geo.get(k); }
function cap(r, len, seg = 8) { const k = `cp${r}_${len}_${seg}`; if (!geo.has(k)) geo.set(k, new THREE.CapsuleGeometry(r, len, 2, seg)); return geo.get(k); }
function cyl(rt, rb, h, seg = 8) { const k = `cy${rt}_${rb}_${h}_${seg}`; if (!geo.has(k)) geo.set(k, new THREE.CylinderGeometry(rt, rb, h, seg)); return geo.get(k); }
function sph(r, seg = 8) { const k = `s${r}_${seg}`; if (!geo.has(k)) geo.set(k, new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2))); return geo.get(k); }
function cone(r, h, seg = 6) { const k = `co${r}_${h}_${seg}`; if (!geo.has(k)) geo.set(k, new THREE.ConeGeometry(r, h, seg)); return geo.get(k); }
function torusGeo(r, t, seg = 12) { const k = `to${r}_${t}_${seg}`; if (!geo.has(k)) geo.set(k, new THREE.TorusGeometry(r, t, 5, seg, Math.PI)); return geo.get(k); }
export const G = { box, cap, cyl, sph, cone };

export function mat(color, { rough = 0.82, metal = 0.12, emissive = null, emissiveIntensity = 0.9, transparent = false, opacity = 1, side = THREE.FrontSide } = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
    emissive: emissive || '#000000', emissiveIntensity: emissive ? emissiveIntensity : 0,
    transparent, opacity, side,
  });
}

function part(parent, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

export function makeWeapon(kind = 'straight', scale = 1) {
  const g = new THREE.Group();
  const steel = mat('#a9b0ba', { rough: 0.32, metal: 0.92 });
  const dark = mat('#2a2622', { rough: 0.7, metal: 0.4 });
  const gold = mat('#b8912f', { rough: 0.35, metal: 0.9 });
  g.userData.materials = [steel, dark, gold];
  switch (kind) {
    case 'curved': {
      const b = part(g, box(0.09, 1.25, 0.2), steel, 0, 0.72, 0);
      b.rotation.z = 0.12;
      part(g, box(0.3, 0.06, 0.06), gold, 0, 0.1, 0);
      part(g, cyl(0.045, 0.05, 0.28, 6), dark, 0, -0.06, 0);
      break;
    }
    case 'hammer': {
      part(g, cyl(0.05, 0.05, 1.1, 6), dark, 0, 0.5, 0);
      part(g, box(0.42, 0.42, 0.42), mat('#7c7d84', { rough: 0.5, metal: 0.85 }), 0, 1.16, 0);
      break;
    }
    case 'spear': {
      part(g, cyl(0.04, 0.045, 2.2, 6), dark, 0, 1.05, 0);
      part(g, cone(0.1, 0.55, 5), steel, 0, 2.4, 0);
      break;
    }
    case 'greatsword': {
      part(g, box(0.2, 1.95, 0.06), steel, 0, 1.15, 0);
      part(g, box(0.62, 0.1, 0.14), gold, 0, 0.16, 0);
      part(g, cyl(0.06, 0.065, 0.5, 6), dark, 0, -0.14, 0);
      part(g, sph(0.09), gold, 0, -0.4, 0);
      break;
    }
    case 'staff': {
      part(g, cyl(0.045, 0.055, 2.0, 6), mat('#4a3524', { rough: 0.8 }), 0, 1.0, 0);
      const orb = part(g, sph(0.17, 10), mat('#8fd4ff', { rough: 0.1, metal: 0.1, emissive: '#6fbfff', emissiveIntensity: 2.4 }), 0, 2.1, 0);
      g.userData.orb = orb;
      break;
    }
    case 'rapier': {
      const b = part(g, box(0.055, 1.6, 0.1), steel, 0, 0.9, 0);
      part(g, box(0.26, 0.05, 0.05), gold, 0, 0.1, 0);
      part(g, cyl(0.035, 0.04, 0.3, 6), dark, 0, -0.08, 0);
      part(g, sph(0.055, 6), gold, 0, -0.24, 0);
      b.rotation.z = 0.02;
      break;
    }
    case 'dagger': {
      part(g, box(0.07, 0.62, 0.15), steel, 0, 0.38, 0);
      part(g, box(0.22, 0.05, 0.05), gold, 0, 0.06, 0);
      part(g, cyl(0.035, 0.04, 0.2, 6), dark, 0, -0.05, 0);
      const off = part(g, box(0.06, 0.5, 0.13), steel, 0.16, 0.3, -0.1);
      off.rotation.z = -0.25;
      break;
    }
    case 'bow': {
      const limb = part(g, torusGeo(0.55, 0.035, 16), mat('#4a3524', { rough: 0.8 }), 0, 0.55, 0);
      limb.rotation.y = Math.PI / 2;
      limb.scale.set(1, 1.35, 1);
      part(g, box(0.05, 0.12, 0.05), dark, 0, 0.55, 0);
      g.scale.setScalar(0.9);
      break;
    }
    case 'tower': {
      part(g, box(0.9, 1.5, 0.13), mat('#59554c', { rough: 0.75, metal: 0.5 }), 0, 0.78, 0);
      part(g, box(0.98, 0.14, 0.2), gold, 0, 1.55, 0);
      part(g, box(0.2, 0.3, 0.16), dark, 0, 0.5, -0.14);
      break;
    }
    case 'chime': {
      part(g, cyl(0.05, 0.05, 0.9, 6), dark, 0, 0.42, 0);
      part(g, box(0.3, 0.42, 0.05), mat('#c9b487', { rough: 0.5, metal: 0.6 }), 0, 1.05, 0);
      part(g, sph(0.1), gold, 0, 1.32, 0);
      break;
    }
    default: {
      part(g, box(0.1, 1.15, 0.22), steel, 0, 0.68, 0);
      part(g, box(0.34, 0.07, 0.07), gold, 0, 0.1, 0);
      part(g, cyl(0.045, 0.05, 0.26, 6), dark, 0, -0.06, 0);
    }
  }
  g.scale.setScalar(scale);
  return g;
}

export function makeShield(cfg = {}) {
  const g = new THREE.Group();
  const face = mat(cfg.face || '#4e4a44', { rough: 0.72, metal: 0.45 });
  const rim = mat(cfg.rim || '#8b8577', { rough: 0.5, metal: 0.7 });
  g.userData.materials = [face, rim];
  part(g, cyl(0.42, 0.42, 0.09, 10), face, 0, 0, 0).rotation.x = Math.PI / 2;
  const r = part(g, torusRing(0.42, 0.05), rim, 0, 0, 0);
  r.rotation.x = Math.PI / 2;
  return g;
}

function torusRing(r, t) {
  const k = `tr${r}_${t}`;
  if (!geo.has(k)) geo.set(k, new THREE.TorusGeometry(r, t, 5, 12));
  return geo.get(k);
}

export function makeHumanoid(cfg = {}) {
  const c = Object.assign({
    scale: 1, bulk: 1, armor: '#3b3f47', armorRough: 0.72, armorMetal: 0.42,
    cloth: '#4a2d24', skin: '#8a7666', metal: '#9aa0a8', glow: '#e8b45a',
    weapon: 'straight', shield: null, helm: 'closed', cape: true, eyeGlow: null,
  }, cfg);

  const root = new THREE.Group();
  const mats = [];
  const M = (color, o) => { const m = mat(color, o); mats.push(m); return m; };
  const armorM = M(c.armor, { rough: c.armorRough, metal: c.armorMetal });
  const clothM = M(c.cloth, { rough: 0.92, metal: 0.02, side: THREE.DoubleSide });
  const skinM = M(c.skin, { rough: 0.85 });
  const metalM = M(c.metal, { rough: 0.36, metal: 0.9 });
  const glowM = M(c.glow, { rough: 0.4, metal: 0.3, emissive: c.glow, emissiveIntensity: 1.5 });

  const hips = new THREE.Group();
  hips.position.y = 0.92 * c.scale;
  root.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);
  part(torso, cap(0.24 * c.bulk, 0.42, 8), armorM, 0, 0.3 * c.scale, 0).scale.set(1.25, 1, 0.85);
  part(torso, box(0.5 * c.bulk, 0.22, 0.36), armorM, 0, 0.56 * c.scale, 0.02);
  part(torso, box(0.44 * c.bulk, 0.16, 0.3), clothM, 0, 0.06, 0);
  const pauldronL = part(torso, sph(0.19 * c.bulk, 8), armorM, -0.34 * c.bulk, 0.5, 0);
  const pauldronR = part(torso, sph(0.19 * c.bulk, 8), armorM, 0.34 * c.bulk, 0.5, 0);
  pauldronL.scale.set(1.1, 0.8, 1.1);
  pauldronR.scale.set(1.1, 0.8, 1.1);

  const head = new THREE.Group();
  head.position.y = 0.78 * c.scale;
  torso.add(head);
  part(head, sph(0.15, 8), skinM, 0, 0.02, 0);
  if (c.helm === 'closed') {
    part(head, cap(0.165, 0.1, 8), armorM, 0, 0.03, 0).scale.set(1.05, 1, 1.05);
    part(head, box(0.3, 0.055, 0.06), M('#12100f', { rough: 0.5 }), 0, 0.04, 0.15);
    part(head, cone(0.14, 0.2, 6), metalM, 0, 0.22, 0);
  } else if (c.helm === 'hood') {
    const hood = part(head, cone(0.24, 0.42, 7), clothM, 0, 0.1, -0.02);
    hood.rotation.x = -0.15;
  } else if (c.helm === 'horns') {
    part(head, cap(0.16, 0.08, 8), armorM, 0, 0.03, 0);
    const hl = part(head, cone(0.05, 0.42, 5), metalM, -0.14, 0.2, 0);
    hl.rotation.z = 0.75;
    const hr = part(head, cone(0.05, 0.42, 5), metalM, 0.14, 0.2, 0);
    hr.rotation.z = -0.75;
  }
  if (c.eyeGlow) {
    const e = part(head, box(0.2, 0.03, 0.02), M(c.eyeGlow, { rough: 0.2, metal: 0, emissive: c.eyeGlow, emissiveIntensity: 3.4 }), 0, 0.04, 0.16);
    root.userData.eyes = e;
  }

  function arm(side) {
    const sh = new THREE.Group();
    sh.position.set(0.32 * c.bulk * side, 0.46 * c.scale, 0);
    torso.add(sh);
    part(sh, cap(0.085, 0.26, 6), armorM, 0, -0.2, 0);
    const el = new THREE.Group();
    el.position.y = -0.4;
    sh.add(el);
    part(el, cap(0.075, 0.24, 6), armorM, 0, -0.16, 0);
    const hand = new THREE.Group();
    hand.position.y = -0.36;
    el.add(hand);
    part(hand, sph(0.07, 6), skinM);
    return { shoulder: sh, elbow: el, hand };
  }
  const armR = arm(1);
  const armL = arm(-1);

  function leg(side) {
    const hip = new THREE.Group();
    hip.position.set(0.14 * side, -0.04, 0);
    hips.add(hip);
    part(hip, cap(0.1, 0.32, 6), armorM, 0, -0.24, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    part(knee, cap(0.085, 0.3, 6), armorM, 0, -0.2, 0);
    part(knee, box(0.14, 0.08, 0.26), M('#241f1b', { rough: 0.8 }), 0, -0.4, 0.05);
    return { hip, knee };
  }
  const legR = leg(1);
  const legL = leg(-1);

  let cape = null;
  if (c.cape) {
    cape = new THREE.Group();
    cape.position.set(0, 0.5, -0.16);
    torso.add(cape);
    const cloth = part(cape, box(0.52 * c.bulk, 0.95, 0.03), clothM, 0, -0.46, 0);
    cloth.receiveShadow = true;
    part(cape, box(0.5 * c.bulk, 0.9, 0.025), clothM, 0, -1.35, 0.02);
    root.userData.capeMesh = cloth;
  }

  const weapon = makeWeapon(c.weapon, c.weaponScale || 1);
  armR.hand.add(weapon);
  weapon.rotation.x = -Math.PI / 2 + 0.25;
  weapon.position.set(0, -0.05, 0.1);

  let shieldMesh = null;
  if (c.shield) {
    shieldMesh = makeShield({ face: c.armor, rim: c.metal });
    shieldMesh.scale.setScalar(0.85 * c.scale);
    shieldMesh.rotation.y = Math.PI / 2;
    armL.hand.add(shieldMesh);
    shieldMesh.position.set(0, -0.05, 0.05);
  }

  root.scale.setScalar(c.scale);
  root.userData.materials = mats;
  root.userData.trim = glowM;
  return {
    root, hips, torso, head, armL, armR, legL, legR, weapon, shield: shieldMesh, cape,
    materials: mats, glowMat: glowM, armorMat: armorM, pauldronL, pauldronR, cfg: c,
  };
}

export function resetRig(r) {
  r.hips.rotation.set(0, 0, 0);
  r.hips.position.y = 0.92 * r.cfg.scale;
  r.torso.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
  for (const a of [r.armL, r.armR]) { a.shoulder.rotation.set(0, 0, 0); a.elbow.rotation.set(0, 0, 0); }
  for (const l of [r.legL, r.legR]) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); }
  if (r.cape) r.cape.rotation.set(0, 0, 0);
}

export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      if (o.material && o.material.dispose && !o.userData.sharedMat) o.material.dispose();
    }
  });
}
