/**
 * Ashen Ring / 灰烬王冠 — content tables (pure data, no logic, no side effects).
 *
 * The engine reads these tables at runtime:
 *   RELICS          relic drafts offered during a run
 *   CURSES          fate bindings (命运枷锁) taken voluntarily at the hub
 *   CLASSES         starting classes
 *   HUB_UPGRADES    permanent meta upgrades bought with Ashen Marks / 灰烬印记
 *   RELIC_TAGS      UI chip metadata for the tag vocabulary
 *   DEPTH_MODIFIERS per-depth run conditions
 *
 * Stat model: every numeric mod key is resolved as
 *   final = (base + sum(add)) * product(mul)
 * Valid mod keys and their bases are documented in the project spec; nothing in
 * this file invents a new key. Valid flags are boolean presences only.
 */

export const RELICS = [
  /* ---------------------------------------------------------------- commons (14) */
  {
    id: 'ember_oath',
    name: 'Ember Oath',
    cn: '余烬誓约',
    desc: '攻击+18%，生命上限-12%',
    rarity: 'common',
    weight: 10,
    tags: ['aggression'],
    mods: { attack: { mul: 1.18 }, maxHp: { mul: 0.88 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'hollow_ward',
    name: 'Hollow Ward',
    cn: '虚刻护壁',
    desc: '护甲+6，生命+14，移速-5%',
    rarity: 'common',
    weight: 10,
    tags: ['defense'],
    mods: { armor: { add: 6 }, maxHp: { add: 14 }, moveSpeed: { mul: 0.95 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'cinder_step',
    name: 'Cinder Step',
    cn: '燔灰步',
    desc: '翻滚耗体-15%，无敌帧+0.02秒',
    rarity: 'common',
    weight: 10,
    tags: ['mobility'],
    mods: { rollCost: { mul: 0.85 }, lightCost: { mul: 0.92 }, iframe: { add: 0.02 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'pilgrims_coin',
    name: "Pilgrim's Coin",
    cn: '香客钱币',
    desc: '灰烬获取+18%，攻击-6%',
    rarity: 'common',
    weight: 10,
    tags: ['greed'],
    mods: { runeGain: { mul: 1.18 }, attack: { mul: 0.94 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'penitent_ember',
    name: 'Penitent Ember',
    cn: '悔者微温',
    desc: '脱战回血+1.6/秒，生命+10',
    rarity: 'common',
    weight: 10,
    tags: ['faith'],
    mods: { hpRegen: { add: 1.6 }, maxHp: { add: 10 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'soul_sliver',
    name: 'Soul Sliver',
    cn: '魂屑',
    desc: '专注上限+28，法术伤害+8%',
    rarity: 'common',
    weight: 10,
    tags: ['soul'],
    mods: { fpMax: { add: 28 }, spellMul: { mul: 1.08 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'lean_cadence',
    name: 'Lean Cadence',
    cn: '紧律',
    desc: '攻速+12%，重击伤害-6%',
    rarity: 'common',
    weight: 10,
    tags: ['mobility', 'aggression'],
    mods: { attackSpeed: { mul: 1.12 }, heavyMul: { mul: 0.94 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'buried_conviction',
    name: 'Buried Conviction',
    cn: '埋骨之信',
    desc: '姿态+10，破防伤害+14%',
    rarity: 'common',
    weight: 10,
    tags: ['faith', 'defense'],
    mods: { poiseMax: { add: 10 }, poiseMul: { mul: 1.14 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'whispering_coal',
    name: 'Whispering Coal',
    cn: '低语冷炭',
    desc: '仇恨范围-18%，背刺+12%',
    rarity: 'common',
    weight: 10,
    tags: ['stealth'],
    mods: { aggroMul: { mul: 0.82 }, backstabMul: { mul: 1.12 }, attack: { mul: 0.96 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'cracked_ruby',
    name: 'Cracked Ruby',
    cn: '裂瓣赤玉',
    desc: '暴击率+6%，暴击伤害+10%',
    rarity: 'common',
    weight: 10,
    tags: ['aggression'],
    mods: { critChance: { add: 0.06 }, critMul: { add: 0.1 }, moveSpeed: { mul: 0.96 } },
    flags: {},
    minDepth: 2
  },
  {
    id: 'thirsting_edge',
    name: 'Thirsting Edge',
    cn: '渴刃',
    desc: '轻击+16%，背刺+15%，生命-5%',
    rarity: 'common',
    weight: 10,
    tags: ['aggression', 'stealth'],
    mods: { lightMul: { mul: 1.16 }, backstabMul: { mul: 1.15 }, maxHp: { mul: 0.95 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'ashen_resilience',
    name: 'Ashen Resilience',
    cn: '灰烬韧性',
    desc: '体力上限+14%，护甲+3，移速-3%',
    rarity: 'common',
    weight: 10,
    tags: ['defense'],
    mods: { staminaMax: { mul: 1.14 }, armor: { add: 3 }, moveSpeed: { mul: 0.97 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'quiet_lungs',
    name: 'Quiet Lungs',
    cn: '静息之肺',
    desc: '轻击耗体-12%，冲刺耗体-10%',
    rarity: 'common',
    weight: 10,
    tags: ['mobility'],
    mods: { lightCost: { mul: 0.88 }, dodgeCost: { mul: 0.9 }, staminaRegen: { mul: 0.95 } },
    flags: {},
    minDepth: 2
  },
  {
    id: 'buried_thorn',
    name: 'Buried Thorn',
    cn: '倒刺残钉',
    desc: '荆棘反伤+5，护甲+4，仇恨+8%',
    rarity: 'common',
    weight: 10,
    tags: ['defense', 'faith'],
    mods: { thorns: { add: 5 }, armor: { add: 4 }, aggroMul: { mul: 1.08 } },
    flags: {},
    minDepth: 1
  },

  /* ----------------------------------------------------------------- rares (12) */
  {
    id: 'cinder_ring',
    name: 'Ring of Cinders',
    cn: '燔戒',
    desc: '法术+22%且追踪，生命-12%',
    rarity: 'rare',
    weight: 5,
    tags: ['soul'],
    mods: { spellMul: { mul: 1.22 }, spellPower: { mul: 1.1 }, fpMax: { add: 35 }, maxHp: { mul: 0.88 } },
    flags: { spellSeek: true },
    minDepth: 1
  },
  {
    id: 'ashfoot_relic',
    name: 'Ashfoot Relic',
    cn: '踏灰者遗印',
    desc: '无敌帧挡伤回血，移速+10%',
    rarity: 'rare',
    weight: 5,
    tags: ['mobility', 'stealth'],
    mods: { moveSpeed: { mul: 1.1 }, aggroMul: { mul: 0.9 }, maxHp: { mul: 0.94 } },
    flags: { healOnRoll: true },
    minDepth: 2
  },
  {
    id: 'oathbound_brand',
    name: 'Oathbound Brand',
    cn: '誓火烙印',
    desc: '药瓶回复+14，护甲+7，移速-5%',
    rarity: 'rare',
    weight: 5,
    tags: ['faith', 'defense'],
    mods: { estusHeal: { add: 14 }, armor: { add: 7 }, hpRegen: { add: 1 }, moveSpeed: { mul: 0.95 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'fourth_toll',
    name: 'Fourth Toll',
    cn: '第四响',
    desc: '轻击连段增至四段，重击-12%',
    rarity: 'rare',
    weight: 5,
    tags: ['aggression'],
    mods: { lightMul: { mul: 1.15 }, heavyMul: { mul: 0.88 } },
    flags: { chainFour: true },
    minDepth: 1
  },
  {
    id: 'executioners_sigil',
    name: "Executioner's Sigil",
    cn: '处刑印',
    desc: '锁定目标可暴击，暴击+12%',
    rarity: 'rare',
    weight: 5,
    tags: ['aggression', 'stealth'],
    mods: { critChance: { add: 0.12 }, critMul: { add: 0.2 }, maxHp: { mul: 0.9 } },
    flags: { critOnLock: true },
    minDepth: 2
  },
  {
    id: 'plague_cinder',
    name: 'Plague Cinder',
    cn: '疫火炭',
    desc: '荆棘+9，攻击+15%，生命-10%',
    rarity: 'rare',
    weight: 5,
    tags: ['defense', 'aggression'],
    mods: { thorns: { add: 9 }, attack: { mul: 1.15 }, maxHp: { mul: 0.9 } },
    flags: {},
    minDepth: 2
  },
  {
    id: 'graven_bulwark',
    name: 'Graven Bulwark',
    cn: '石刻壁垒',
    desc: '护甲+12，姿态+12，移速-10%',
    rarity: 'rare',
    weight: 5,
    tags: ['defense'],
    mods: { armor: { add: 12 }, poiseMax: { add: 12 }, moveSpeed: { mul: 0.9 }, staminaRegen: { mul: 0.95 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'emberfont',
    name: 'Emberfont',
    cn: '烬泉',
    desc: '专注+55，法术强度+12%，药瓶-1',
    rarity: 'rare',
    weight: 5,
    tags: ['soul', 'faith'],
    mods: { fpMax: { add: 55 }, fpRegen: { add: 1.5 }, spellPower: { mul: 1.12 }, estusMax: { add: -1 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'hungering_gild',
    name: 'Hungering Gild',
    cn: '贪金灼痕',
    desc: '灰烬+30%，击杀额外灰烬',
    rarity: 'rare',
    weight: 5,
    tags: ['greed'],
    mods: { runeGain: { mul: 1.3 }, attack: { mul: 0.92 } },
    flags: { runeOnKill: true },
    minDepth: 1
  },
  {
    id: 'pilgrimage_bell',
    name: 'Pilgrimage Bell',
    cn: '朝圣铃',
    desc: '休息获增益，完美格挡回体力',
    rarity: 'rare',
    weight: 5,
    tags: ['faith'],
    mods: { poiseMul: { mul: 1.25 }, armor: { add: 4 }, attack: { mul: 0.92 } },
    flags: { restExtra: true, staminaOnParry: true },
    minDepth: 2
  },
  {
    id: 'cinder_waltz',
    name: 'Cinder Waltz',
    cn: '燔灰圆舞',
    desc: '攻速+20%，命中范围+8%，翻滚耗体+12%',
    rarity: 'rare',
    weight: 5,
    tags: ['mobility', 'aggression'],
    mods: { attackSpeed: { mul: 1.2 }, rangeMul: { mul: 1.08 }, iframe: { add: 0.05 }, rollCost: { mul: 1.12 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'marrow_lantern',
    name: 'Marrow Lantern',
    cn: '髓灯',
    desc: '回血+2.2，体力回复+25%，生命-7%',
    rarity: 'rare',
    weight: 5,
    tags: ['faith', 'defense'],
    mods: { hpRegen: { add: 2.2 }, staminaRegen: { mul: 1.25 }, maxHp: { mul: 0.93 } },
    flags: {},
    minDepth: 2
  },

  /* ----------------------------------------------------------- legendaries (5) */
  {
    id: 'crown_of_cinders',
    name: 'Crown of Cinders',
    cn: '灰烬王冠',
    desc: '攻击+45%，生命上限-22%，移速-6%',
    rarity: 'legendary',
    weight: 2,
    tags: ['aggression', 'faith'],
    mods: {
      attack: { mul: 1.45 },
      lightMul: { mul: 1.18 },
      heavyMul: { mul: 1.2 },
      maxHp: { mul: 0.78 },
      moveSpeed: { mul: 0.94 }
    },
    flags: {},
    minDepth: 2
  },
  {
    id: 'moonlit_blade',
    name: 'Moonlit Blade',
    cn: '月光刃',
    desc: '法术+50%，轻击四段，生命-15%',
    rarity: 'legendary',
    weight: 2,
    tags: ['soul', 'aggression'],
    mods: {
      spellMul: { mul: 1.5 },
      spellPower: { mul: 1.25 },
      attack: { mul: 1.2 },
      fpMax: { add: 65 },
      maxHp: { mul: 0.85 }
    },
    flags: { spellSeek: true, chainFour: true },
    minDepth: 2
  },
  {
    id: 'skybreaker_waltz',
    name: 'Skybreaker Waltz',
    cn: '断空之舞',
    desc: '二段跳，移速+20%，重击-10%',
    rarity: 'legendary',
    weight: 2,
    tags: ['mobility'],
    mods: {
      moveSpeed: { mul: 1.2 },
      iframe: { add: 0.12 },
      rollCost: { mul: 0.8 },
      heavyMul: { mul: 0.9 },
      maxHp: { mul: 0.85 }
    },
    flags: { doubleJump: true },
    minDepth: 2
  },
  {
    id: 'twinned_effigy',
    name: 'Twinned Effigy',
    cn: '双生偶',
    desc: '灰偶双召，法术+35%，移速-5%',
    rarity: 'legendary',
    weight: 2,
    tags: ['soul', 'rune'],
    mods: {
      spellMul: { mul: 1.35 },
      spellPower: { mul: 1.3 },
      fpMax: { add: 50 },
      maxHp: { mul: 0.86 },
      moveSpeed: { mul: 0.95 }
    },
    flags: { ashTwin: true },
    minDepth: 3
  },
  {
    id: 'hoard_of_the_drowned_king',
    name: 'Hoard of the Drowned King',
    cn: '溺王藏金',
    desc: '灰烬+65%，生命-20%，攻击-10%',
    rarity: 'legendary',
    weight: 2,
    tags: ['greed', 'rune'],
    mods: { runeGain: { mul: 1.65 }, maxHp: { mul: 0.8 }, attack: { mul: 0.9 } },
    flags: { runeOnKill: true },
    minDepth: 3
  },

  /* -------------------------------------------------------------- cursed (3) */
  {
    id: 'pact_of_thirst',
    name: 'Pact of Thirst',
    cn: '枯渴契约',
    desc: '禁用药瓶，攻击+40%，生命-15%',
    rarity: 'cursed',
    weight: 3,
    tags: ['aggression', 'faith'],
    mods: {
      attack: { mul: 1.4 },
      lightMul: { mul: 1.15 },
      heavyMul: { mul: 1.15 },
      maxHp: { mul: 0.85 }
    },
    flags: { noEstus: true },
    minDepth: 2
  },
  {
    id: 'crown_of_hollow_greed',
    name: 'Crown of Hollow Greed',
    cn: '空贪之冠',
    desc: '灰烬+60%，生命上限-35%',
    rarity: 'cursed',
    weight: 3,
    tags: ['greed', 'rune'],
    mods: { runeGain: { mul: 1.6 }, maxHp: { mul: 0.65 }, armor: { add: -4 } },
    flags: { runeOnKill: true },
    minDepth: 2
  },
  {
    id: 'bound_tongue',
    name: 'Bound Tongue',
    cn: '缄口烙印',
    desc: '法术+70%，翻滚耗体+30%，攻击-15%',
    rarity: 'cursed',
    weight: 3,
    tags: ['soul'],
    mods: {
      spellMul: { mul: 1.7 },
      fpRegen: { mul: 1.4 },
      attack: { mul: 0.85 },
      rollCost: { mul: 1.3 },
      maxHp: { mul: 0.75 }
    },
    flags: {},
    minDepth: 3
  }
];

/* -----------------------------------------------------------------------------
 * CURSES — 命运枷锁. Voluntarily accepted at the hub for bonus Ashen Marks.
 * Separate pool from RELICS; ids never overlap.
 * -------------------------------------------------------------------------- */
export const CURSES = [
  {
    id: 'curse_frail_vessel',
    name: 'Frail Vessel',
    cn: '脆器',
    desc: '生命上限-30%，攻击+35%',
    rarity: 'cursed',
    weight: 3,
    tags: ['aggression'],
    mods: { maxHp: { mul: 0.7 }, attack: { mul: 1.35 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'curse_blind_greed',
    name: 'Blind Greed',
    cn: '盲贪',
    desc: '灰烬+50%，仇恨+35%，生命-10%',
    rarity: 'cursed',
    weight: 3,
    tags: ['greed', 'rune'],
    mods: { runeGain: { mul: 1.5 }, aggroMul: { mul: 1.35 }, maxHp: { mul: 0.9 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'curse_brittle_frame',
    name: 'Brittle Frame',
    cn: '脆骨',
    desc: '重击+50%，体力-22%，翻滚更耗体',
    rarity: 'cursed',
    weight: 3,
    tags: ['aggression'],
    mods: { staminaMax: { mul: 0.78 }, rollCost: { mul: 1.2 }, heavyMul: { mul: 1.5 }, poiseMul: { mul: 1.2 } },
    flags: {},
    minDepth: 1
  },
  {
    id: 'curse_hollow_sight',
    name: 'Hollow Sight',
    cn: '空心之眼',
    desc: '暴击+22%，暴伤+25%，无敌帧-25%',
    rarity: 'cursed',
    weight: 3,
    tags: ['aggression', 'stealth'],
    mods: { critChance: { add: 0.22 }, critMul: { add: 0.25 }, iframe: { mul: 0.75 }, moveSpeed: { mul: 0.9 } },
    flags: {},
    minDepth: 2
  },
  {
    id: 'curse_bell_of_the_fallen',
    name: 'Bell of the Fallen',
    cn: '堕者钟',
    desc: '攻击+28%，破防+45%，姿态上限-45%',
    rarity: 'cursed',
    weight: 3,
    tags: ['faith', 'aggression'],
    mods: { poiseMax: { mul: 0.55 }, poiseMul: { mul: 1.45 }, attack: { mul: 1.28 }, maxHp: { mul: 0.9 } },
    flags: {},
    minDepth: 2
  }
];

/* -----------------------------------------------------------------------------
 * CLASSES — starting builds. `stats` are absolute starting values; anything
 * omitted falls back to the engine base (hp 100, stamina 100, attack 1,
 * muls 1, documented costs, estus 3 / 38, iframe 0.30, fp 0 for melee).
 * -------------------------------------------------------------------------- */
export const CLASSES = [
  {
    id: 'ashen_knight',
    name: 'Ashen Knight',
    cn: '灰烬骑士',
    weapon: '直剑',
    desc: '均衡的近战开局，容错最高',
    lore: '守誓者的残铠仍在燃烧，剑刃替他说出未尽的誓词。',
    stats: {
      maxHp: 120,
      staminaMax: 105,
      attack: 1.02,
      armor: 4,
      poiseMax: 46,
      moveSpeed: 1,
      lightCost: 16,
      heavyCost: 30,
      rollCost: 20,
      estusMax: 3,
      estusHeal: 38,
      fpMax: 0
    },
    startRelic: 'ashen_resilience',
    colors: { cloak: '#3a2f2a', metal: '#8a8f96', glow: '#e8b45a' }
  },
  {
    id: 'ember_cleric',
    name: 'Ember Cleric',
    cn: '燔火主教',
    weapon: '战锤',
    desc: '厚甲高血的信仰坦克，靠回复取胜',
    lore: '他仍在为无人认领的亡者诵经，钟声比火焰更久。',
    stats: {
      maxHp: 138,
      staminaMax: 95,
      attack: 0.92,
      armor: 9,
      poiseMax: 54,
      hpRegen: 2,
      estusHeal: 46,
      moveSpeed: 0.93,
      lightCost: 18,
      heavyCost: 32,
      rollCost: 23,
      iframe: 0.28,
      attackSpeed: 0.94,
      fpMax: 0
    },
    startRelic: 'penitent_ember',
    colors: { cloak: '#6b5a3a', metal: '#c9b58a', glow: '#f0d089' }
  },
  {
    id: 'veil_duelist',
    name: 'Veil Duelist',
    cn: '帷影剑客',
    weapon: '细剑',
    desc: '高速轻击流，体力深、翻滚便宜',
    lore: '她的剑快得留下残影，残影里藏着三场未败的决斗。',
    stats: {
      maxHp: 96,
      staminaMax: 118,
      attack: 1,
      lightMul: 1.1,
      heavyMul: 0.9,
      armor: 2,
      poiseMax: 36,
      moveSpeed: 1.1,
      lightCost: 14,
      heavyCost: 28,
      rollCost: 17,
      dodgeCost: 7,
      iframe: 0.34,
      attackSpeed: 1.12,
      fpMax: 0
    },
    startRelic: 'cinder_step',
    colors: { cloak: '#2d2740', metal: '#b9c2cc', glow: '#9fd0d8' }
  },
  {
    id: 'hollow_blade',
    name: 'Hollow Blade',
    cn: '空刃',
    weapon: '双匕首',
    desc: '玻璃炮刺客：背刺与暴击，血极薄',
    lore: '没有人记得他的脸，只记得背上传来的凉意。',
    stats: {
      maxHp: 80,
      staminaMax: 100,
      attack: 1.16,
      backstabMul: 1.45,
      critChance: 0.1,
      critMul: 1.75,
      lightCost: 14,
      heavyCost: 34,
      rollCost: 16,
      dodgeCost: 7,
      iframe: 0.36,
      armor: 0,
      poiseMax: 32,
      moveSpeed: 1.08,
      attackSpeed: 1.15,
      aggroMul: 0.88,
      estusMax: 2,
      fpMax: 0
    },
    startRelic: 'whispering_coal',
    colors: { cloak: '#191a1f', metal: '#6d7a80', glow: '#c25a5a' }
  },
  {
    id: 'ember_seer',
    name: 'Ember Seer',
    cn: '烬中先知',
    weapon: '灰烬法杖',
    desc: '法术开局：专注深厚，近战孱弱',
    lore: '她在余烬里看见王冠的七个断面，每一个都在流血。',
    stats: {
      maxHp: 86,
      staminaMax: 92,
      attack: 0.82,
      spellMul: 1.18,
      spellPower: 1.12,
      fpMax: 95,
      fpRegen: 2.2,
      armor: 1,
      poiseMax: 30,
      moveSpeed: 0.98,
      lightCost: 17,
      heavyCost: 32,
      rollCost: 21,
      estusMax: 3,
      estusHeal: 34,
      rangeMul: 0.92
    },
    startRelic: 'soul_sliver',
    colors: { cloak: '#241d33', metal: '#8a7fb8', glow: '#b98cf0' }
  }
];

/* -----------------------------------------------------------------------------
 * HUB_UPGRADES — 永久强化, bought with 灰烬印记 (Ashen Marks).
 * kind 'add' => per is a flat addition per level; kind 'mul' => per is a
 * multiplier delta per level (0.05 => x1.05 cumulative).
 * -------------------------------------------------------------------------- */
export const HUB_UPGRADES = [
  {
    id: 'hub_forged_bones',
    name: 'Forged Bones',
    cn: '锻骨',
    desc: '每级生命上限+12',
    cost: 3,
    growth: 1.6,
    max: 4,
    statKey: 'maxHp',
    per: 12,
    kind: 'add'
  },
  {
    id: 'hub_deep_lungs',
    name: 'Deep Lungs',
    cn: '深息',
    desc: '每级体力上限+10',
    cost: 3,
    growth: 1.5,
    max: 4,
    statKey: 'staminaMax',
    per: 10,
    kind: 'add'
  },
  {
    id: 'hub_estus_vessel',
    name: 'Estus Vessel',
    cn: '药瓶扩腔',
    desc: '每级药瓶次数+1',
    cost: 4,
    growth: 1.8,
    max: 3,
    statKey: 'estusMax',
    per: 1,
    kind: 'add'
  },
  {
    id: 'hub_focus_well',
    name: 'Focus Well',
    cn: '专注之井',
    desc: '每级专注上限+15',
    cost: 3,
    growth: 1.55,
    max: 4,
    statKey: 'fpMax',
    per: 15,
    kind: 'add'
  },
  {
    id: 'hub_whetted_oath',
    name: 'Whetted Oath',
    cn: '誓刃磨石',
    desc: '每级攻击+5%',
    cost: 5,
    growth: 1.7,
    max: 4,
    statKey: 'attack',
    per: 0.05,
    kind: 'mul'
  },
  {
    id: 'hub_light_step',
    name: 'Light Step',
    cn: '轻步',
    desc: '每级翻滚耗体-6%',
    cost: 4,
    growth: 1.65,
    max: 4,
    statKey: 'rollCost',
    per: -0.06,
    kind: 'mul'
  },
  {
    id: 'hub_ghost_frames',
    name: 'Ghost Frames',
    cn: '残影',
    desc: '每级翻滚无敌帧+10%',
    cost: 5,
    growth: 1.75,
    max: 3,
    statKey: 'iframe',
    per: 0.1,
    kind: 'mul'
  },
  {
    id: 'hub_tempered_hide',
    name: 'Tempered Hide',
    cn: '韧皮',
    desc: '每级护甲+3',
    cost: 3,
    growth: 1.5,
    max: 4,
    statKey: 'armor',
    per: 3,
    kind: 'add'
  },
  {
    id: 'hub_tithe_of_ashes',
    name: 'Tithe of Ashes',
    cn: '灰烬什一税',
    desc: '每级灰烬获取+6%',
    cost: 4,
    growth: 1.6,
    max: 4,
    statKey: 'runeGain',
    per: 0.06,
    kind: 'mul'
  },
  {
    id: 'hub_loom_of_fate',
    name: 'Loom of Fate',
    cn: '命运织机',
    desc: '每级开局多一次圣物重抽',
    cost: 6,
    growth: 1.85,
    max: 2,
    statKey: 'rerolls',
    per: 1,
    kind: 'add'
  }
];

/* -----------------------------------------------------------------------------
 * RELIC_TAGS — UI chip labels + colours for the tag vocabulary.
 * -------------------------------------------------------------------------- */
export const RELIC_TAGS = {
  aggression: { cn: '狂怒', color: '#a1382c' },
  defense: { cn: '坚壁', color: '#5f6b74' },
  mobility: { cn: '游影', color: '#c7b299' },
  soul: { cn: '魂焰', color: '#8f6ad0' },
  rune: { cn: '符纹', color: '#5c8fa8' },
  faith: { cn: '残信仰', color: '#e0c069' },
  greed: { cn: '贪灼', color: '#b4712f' },
  stealth: { cn: '暗行', color: '#4b4260' }
};

/* -----------------------------------------------------------------------------
 * DEPTH_MODIFIERS — per-depth run conditions. `count` is a bonus enemy count
 * applied per room.
 * -------------------------------------------------------------------------- */
export const DEPTH_MODIFIERS = [
  {
    depth: 1,
    cn: '余烬回廊',
    name: 'Ember Cloister',
    enemyMul: { hp: 1, dmg: 1, count: 0 },
    tint: '#7a5a33',
    boss: '灰烬守门人'
  },
  {
    depth: 2,
    cn: '溃信圣所',
    name: 'Fallen Reliquary',
    enemyMul: { hp: 1.3, dmg: 1.26, count: 1 },
    tint: '#57343f',
    boss: '双面忏悔者'
  },
  {
    depth: 3,
    cn: '王冠之心',
    name: 'Heart of the Ring',
    enemyMul: { hp: 1.65, dmg: 1.55, count: 2 },
    tint: '#2f2450',
    boss: '灰烬王 · 环中无名者'
  }
];
