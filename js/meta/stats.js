import { RELICS, CURSES, HUB_UPGRADES } from './content.js';

export const BASE_STATS = {
  maxHp: 100, hpRegen: 0, staminaMax: 100, staminaRegen: 44,
  attack: 1, lightMul: 1, heavyMul: 1, spellMul: 1, backstabMul: 2.0,
  critChance: 0.05, critMul: 1.7, moveSpeed: 1,
  rollCost: 20, lightCost: 16, heavyCost: 30, dodgeCost: 8,
  iframe: 0.3, armor: 0, rangeMul: 1, attackSpeed: 1,
  poiseMul: 1, poiseMax: 40, fpMax: 0, fpRegen: 4, spellPower: 1,
  estusMax: 3, estusHeal: 38, runeGain: 1, thorns: 0, aggroMul: 1,
  jumpForce: 6.4, guardArmor: 12,
};

export const STAT_KEYS = Object.keys(BASE_STATS);
export const ALL_FLAGS = ['critOnLock', 'healOnRoll', 'runeOnKill', 'staminaOnParry', 'chainFour', 'doubleJump', 'ashTwin', 'spellSeek', 'restExtra', 'noEstus'];

const relicIndex = new Map();
for (const r of [...RELICS, ...CURSES]) relicIndex.set(r.id, r);

export function relicById(id) { return relicIndex.get(id); }

export function resolveStats({ classStats = {}, relicIds = [], curseIds = [], upgrades = {}, depthBonus = 0 } = {}) {
  const adds = {}, muls = {};
  const flags = {};
  const collect = (relic) => {
    if (!relic) return;
    for (const [k, v] of Object.entries(relic.mods || {})) {
      if (!STAT_KEYS.includes(k)) continue;
      if (v.add) (adds[k] ||= 0, adds[k] += v.add);
      if (v.mul) (muls[k] ||= 1, muls[k] *= v.mul);
    }
    for (const f of Object.keys(relic.flags || {})) if (ALL_FLAGS.includes(f)) flags[f] = (flags[f] || 0) + 1;
  };
  for (const id of relicIds) collect(relicById(id));
  for (const id of curseIds) collect(relicById(id));

  const s = {};
  for (const k of STAT_KEYS) {
    const base = classStats[k] !== undefined ? classStats[k] : BASE_STATS[k];
    s[k] = (base + (adds[k] || 0)) * (muls[k] || 1);
  }
  let rerolls = 0;
  for (const up of HUB_UPGRADES) {
    const lvl = Math.min(up.max, upgrades[up.id] || 0);
    if (!lvl) continue;
    if (up.statKey === 'rerolls') { rerolls += lvl * up.per; continue; }
    if (!STAT_KEYS.includes(up.statKey)) continue;
    if (up.kind === 'mul') s[up.statKey] *= Math.pow(1 + up.per, lvl);
    else s[up.statKey] += up.per * lvl;
  }
  s.maxHp *= 1 + depthBonus * 0.06;
  s.attack *= 1 + depthBonus * 0.04;
  s.estusMax = Math.max(0, Math.round(s.estusMax));
  if (flags.noEstus) s.estusMax = 0;
  s.iframe = Math.min(0.62, s.iframe);
  s.critChance = Math.min(0.9, s.critChance);
  return { s, flags, rerolls };
}

export function summarize(s, flags) {
  const out = [];
  out.push(`生命 ${Math.round(s.maxHp)}`, `体力 ${Math.round(s.staminaMax)}`, `攻击 x${s.attack.toFixed(2)}`);
  if (s.fpMax > 0) out.push(`专注 ${Math.round(s.fpMax)}`);
  if (s.estusMax > 0) out.push(`元素瓶 x${Math.round(s.estusMax)}`);
  const f = Object.keys(flags);
  if (f.length) out.push('特性 ' + f.join('/'));
  return out.join(' · ');
}

export function enemyScale(depth) {
  const mul = [1, 1.35, 1.78][Math.min(2, depth)] || 1;
  return { hp: mul, dmg: 1 + depth * 0.28, count: depth };
}
