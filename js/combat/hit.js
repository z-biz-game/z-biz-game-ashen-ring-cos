import { clamp, distSq } from '../engine/rng.js';

export function armorFactor(armor) {
  const a = Math.max(0, armor || 0);
  return 1 - a / (a + 34);
}

export function inArc(attacker, target, reach, arcRad) {
  const dx = target.pos.x - attacker.pos.x, dz = target.pos.z - attacker.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > reach + (target.radius || 0.4)) return -1;
  if (d < 1e-3) return 0;
  const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
  const dot = (fx * dx + fz * dz) / d;
  const ang = Math.acos(clamp(dot, -1, 1));
  if (ang > arcRad) return -1;
  return d;
}

export function rollDamage(game, attacker, target, opts = {}) {
  const as = attacker.s || {};
  const school = opts.school || 'light';
  let dmg = (attacker.dmgBase || 10) * (as.attack ?? 1) * (as[school + 'Mul'] ?? 1) * (opts.mul ?? 1);
  dmg *= game.rng.range(0.94, 1.06);
  let crit = false;
  const critChance = (as.critChance ?? 0) + (opts.critBonus || 0);
  if (game.rng.chance(clamp(critChance, 0, 0.85))) { dmg *= (as.critMul ?? 1.7); crit = true; }
  let backstab = false;
  if (school !== 'none' && target.s && opts.allowBackstab !== false) {
    const dx = target.pos.x - attacker.pos.x, dz = target.pos.z - attacker.pos.z;
    const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    const behind = Math.sin(target.yaw) * dx + Math.cos(target.yaw) * dz;
    const dot = (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1);
    const unaware = target.state !== 'combat' && target.state !== 'alert' && !target.recentHit;
    // 弹反给的惩罚窗口就是一次"强制背刺"的窗口。旧代码里这个窗口只有 enemy.js
    // 读它（算 1.65 倍的硬直加伤），rollDamage 从来不看：于是 README 写的
    // 「弹反成功 ⇒ 敌人硬直并可背刺」根本不会发生，能不能吃到 ×2 背刺取决于
    // 敌人此前有没有挨过打（recentHit）—— 那是玩家看不见、也管不了的状态。
    // vulnerableUntil 只由 Player.onParry 设置，所以它就是"刚刚被弹反过"。
    const parried = (target.vulnerableUntil || 0) > (game.time || 0);
    if (dot > 0.86 && behind > 0 && (unaware || parried || opts.forcedBackstab)) { dmg *= (as.backstabMul ?? 2); backstab = true; }
  }
  const armor = (target.s?.armor ?? 0) + (target.blocking ? (target.s?.guardArmor ?? 0) : 0);
  dmg *= armorFactor(armor);
  if (target.blocking) dmg *= (target.shieldMul ?? 0.35);
  if (target.iFrameT > 0) dmg = 0;
  return { dmg: Math.max(0, dmg), crit, backstab };
}

export function meleeArc(game, attacker, opts = {}) {
  const reach = (opts.reach ?? 2.4) * (attacker.s?.rangeMul ?? 1);
  const arcRad = ((opts.arc ?? 100) * Math.PI) / 180;
  const targets = attacker.faction === 'player' ? game.enemies : [game.player, ...game.ashes].filter(Boolean);
  const hits = [];
  for (const t of targets) {
    if (!t || !t.alive || t.dead) continue;
    if (t.faction === attacker.faction) continue;
    const d = inArc(attacker, t, reach, arcRad);
    if (d < 0) continue;
    if (!game.room.grid.los(attacker.pos.x, attacker.pos.z, t.pos.x, t.pos.z)) continue;
    const res = rollDamage(game, attacker, t, opts);
    const dirX = d < 0.01 ? Math.sin(attacker.yaw) : (t.pos.x - attacker.pos.x) / d;
    const dirZ = d < 0.01 ? Math.cos(attacker.yaw) : (t.pos.z - attacker.pos.z) / d;
    if (t.takeDamage(game, res.dmg, {
      dirX, dirZ, crit: res.crit, backstab: res.backstab, school: opts.school || 'light',
      poise: (opts.poise ?? 10) * (attacker.s?.poiseMul ?? 1), heavy: !!opts.heavy,
      from: attacker, thorns: true,
    })) hits.push(t);
    if (!opts.hitAll && hits.length >= (opts.maxHits ?? 1)) break;
  }
  return hits;
}

// 死因（设计标准 §6 / §10.3）：失败态必须回答"为什么输了"，而答案只能由规则层
// 算出来 —— 谁打死的、怎么打死的，都已经在 takeDamage 的 info 里（from=攻击者，
// heavy/magic/school=招式类型，fall=坠落），这里把它落成一句人话，视图只负责显示。
// 注意这不是"把一句概括换个名字塞进引擎"：换掉任何一个攻击者/招式/落差，
// 这句话都会跟着变（谁打的、用的哪一招、摔了多高都是当帧的真实状态）。
export function describeDeath(info = {}) {
  if (info.fall) {
    const d = Number(info.fallDist);
    return `死于坠落${Number.isFinite(d) ? `（落差 ${d.toFixed(1)} m）` : ''}`;
  }
  const from = info.from;
  if (from) {
    const who = from.title || from.cn || from.cfg?.cn || '不明之物';
    const move = from.move?.cn;                     // 首领：当前正在出的那一招
    const kind = info.heavy ? '重击'
      : (info.magic || info.school === 'spell') ? '法术'
      : from.cfg?.style === 'ranged' ? '远程箭' : '近战';
    return `死于${who}的${move ? `「${move}」` : kind}`;
  }
  return '死于不明伤害';
}

export function aoe(game, origin, radius, dmgMul, opts = {}) {
  const list = opts.faction === 'foe' ? game.enemies : game.enemies.concat([game.player]);
  const out = [];
  for (const t of list) {
    if (!t || !t.alive || t.dead) continue;
    if (opts.ignorePlayer && t === game.player) continue;
    const d2 = distSq(origin.x, origin.z, t.pos.x, t.pos.z);
    if (d2 > radius * radius) continue;
    const fall = 1 - Math.sqrt(d2) / radius * 0.45;
    const d = Math.sqrt(d2) || 1;
    if (t.takeDamage(game, dmgMul * fall, {
      dirX: (t.pos.x - origin.x) / d, dirZ: (t.pos.z - origin.z) / d,
      school: opts.school || 'spell', poise: (opts.poise ?? 8) * fall, from: opts.from, magic: true,
    })) out.push(t);
  }
  return out;
}
