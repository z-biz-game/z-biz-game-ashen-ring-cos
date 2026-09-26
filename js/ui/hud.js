import { clamp } from '../engine/rng.js';
import { RELIC_TAGS } from '../meta/content.js';

const $ = (id) => document.getElementById(id);

export const STAT_CN = {
  maxHp: '生命上限', hpRegen: '生命回复', staminaMax: '体力上限', staminaRegen: '体力回复',
  attack: '攻击', lightMul: '轻击伤害', heavyMul: '重击伤害', spellMul: '法术伤害', backstabMul: '背刺倍率',
  critChance: '暴击率', critMul: '暴击伤害', moveSpeed: '移速', rollCost: '翻滚耗体', lightCost: '轻击耗体',
  heavyCost: '重击耗体', dodgeCost: '疾跑耗体', iframe: '无敌帧', armor: '护甲', rangeMul: '攻击距离',
  attackSpeed: '攻击速度', poiseMul: '削韧', poiseMax: '姿态', fpMax: '专注上限', fpRegen: '专注回复',
  spellPower: '法术强度', estusMax: '元素瓶', estusHeal: '元素瓶回复', runeGain: '灰烬获取', thorns: '荆棘',
  aggroMul: '仇恨范围', jumpForce: '跳跃', guardArmor: '格挡护甲',
};
const FLAG_CN = {
  critOnLock: '锁定弱点', healOnRoll: '翻滚回血', runeOnKill: '猎杀灰烬', staminaOnParry: '弹反回体',
  chainFour: '四段连击', doubleJump: '二段跳', ashTwin: '双灵同召', spellSeek: '法术追踪',
  restExtra: '营火庇护', noEstus: '绝药之誓',
};
const RARITY_CN = { common: '寻常', rare: '珍稀', legendary: '传说', cursed: '诅咒' };
const RARITY_ICON = { common: '◇', rare: '◈', legendary: '✦', cursed: '☠' };

export function formatMods(mods = {}) {
  const out = [];
  for (const [k, v] of Object.entries(mods)) {
    const label = STAT_CN[k] || k;
    if (v.mul !== undefined) {
      const pct = Math.round((v.mul - 1) * 100);
      out.push({ text: `${label} ${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct >= 0 });
    } else if (v.add !== undefined) {
      out.push({ text: `${label} ${v.add >= 0 ? '+' : '−'}${Math.abs(v.add)}`, up: v.add >= 0 });
    }
  }
  return out;
}

export function relicLines(relic) {
  const lines = formatMods(relic.mods);
  for (const [f, n] of Object.entries(relic.flags || {})) lines.push({ text: `◆ ${FLAG_CN[f] || f}`, up: true });
  return lines;
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), hpFill: $('hpFill'), hpGhost: $('hpGhost'), hpText: $('hpText'),
      stFill: $('stFill'), fpFill: $('fpFill'), fpBar: document.querySelector('.bar.fp'),
      estusPips: $('estusPips'), spellPips: $('spellPips'), ashPip: $('ashPip'),
      relics: $('relicList'), runesNow: $('runesNow'), runesLost: $('runesLost'),
      depthLabel: $('depthLabel'), roomLabel: $('roomLabel'),
      bossbar: $('bossbar'), bossName: $('bossName'), bossSub: $('bossSub'),
      bossFill: $('bossFill'), bossGhost: $('bossGhost'), bossPips: $('bossPips'),
      reticle: $('reticle'), crosshair: $('crosshair'), interact: $('interactPrompt'),
      interactText: $('interactText'), interactKey: $('interactKey'),
      centerHint: $('centerHint'), toasts: $('toasts'), dmg: $('dmgNums'),
      flash: $('flash'), stamFlash: $('stamFlash'), banner: $('banner'),
      bannerCn: $('bannerCn'), bannerEn: $('bannerEn'), fade: $('fade'),
      minimap: $('minimapCanvas'), hpBar: document.querySelector('.bar.hp'),
      poiseBar: $('poiseBar'), poiseFill: $('poiseFill'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.pool = [];
    this.poolIdx = 0;
    this.lastRelics = '';
    this.lastEstus = -1;
    for (let i = 0; i < 26; i++) {
      const d = document.createElement('div');
      d.className = 'dn';
      d.style.opacity = '0';
      this.el.dmg.appendChild(d);
      this.pool.push(d);
    }
  }

  screen(name) {
    for (const id of ['title', 'hub', 'draft', 'dead', 'win', 'pause', 'help']) {
      const el = $(id);
      if (!el) continue;
      el.classList.toggle('hidden', id !== name);
    }
    this.screensOpen = name || null;
    this.el.hud.classList.toggle('hidden', !!name);
    this.el.crosshair.classList.toggle('hide', !!name);
  }

  setVitals(p) {
    const hpPct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    this.el.hpFill.style.width = hpPct + '%';
    this.el.hpGhost.style.width = hpPct + '%';
    this.el.hpText.textContent = `${Math.ceil(p.hp)}/${Math.round(p.maxHp)}`;
    this.el.hpBar.classList.toggle('low', hpPct < 30);
    this.el.stFill.style.width = clamp(p.st / p.stMax, 0, 1) * 100 + '%';
    const hasFp = p.fpMax > 0;
    this.el.fpBar.classList.toggle('hidden', !hasFp);
    if (hasFp) this.el.fpFill.style.width = clamp(p.fp / p.fpMax, 0, 1) * 100 + '%';
    if (this.lastEstus !== p.estus + '/' + p.estusMax) {
      this.lastEstus = p.estus + '/' + p.estusMax;
      this.el.estusPips.innerHTML = Array.from({ length: p.estusMax }, (_, i) => `<div class="pip${i < p.estus ? '' : ' empty'}"></div>`).join('');
    }
    this.el.spellPips.innerHTML = p.spells.map((s) => `<div class="pip${s.ready ? '' : ' empty'}" title="${s.cn}"></div>`).join('');
    this.el.ashPip.classList.toggle('hidden', !p.canAsh);
    const poise = clamp(p.poise / p.poiseMax, 0, 1);
    this.el.poiseBar.classList.toggle('hidden', poise > 0.985);
    this.el.poiseFill.style.width = poise * 100 + '%';
  }

  setRunes(n, lost) {
    this.el.runesNow.textContent = n.toLocaleString();
    this.el.runesLost.textContent = lost ? `失落 ${lost.toLocaleString()}` : '';
  }

  setDepth(cn, roomLabel) {
    this.el.depthLabel.textContent = cn;
    this.el.roomLabel.textContent = roomLabel;
  }

  setRelics(list) {
    const key = list.map((r) => r.id).join(',');
    if (key === this.lastRelics) return;
    this.lastRelics = key;
    this.el.relics.innerHTML = list.map((r) => `<div class="relic-chip ${r.rarity}" title="${r.cn} · ${r.name}"><span class="dot"></span>${r.cn}</div>`).join('');
  }

  showBoss(cn, en, phaseCount = 2) {
    this.el.bossbar.classList.remove('hidden');
    this.el.bossName.textContent = cn;
    this.el.bossSub.textContent = en;
    this.el.bossPips.innerHTML = Array.from({ length: phaseCount }, () => '<span class="on"></span>').join('');
  }

  setBossHp(ratio, phase = 1) {
    const pct = clamp(ratio, 0, 1) * 100;
    this.el.bossFill.style.width = pct + '%';
    this.el.bossGhost.style.width = pct + '%';
    [...this.el.bossPips.children].forEach((c, i) => c.classList.toggle('on', i < (3 - phase)));
  }

  hideBoss(fade = true) {
    this.el.bossFill.style.width = '0%';
    setTimeout(() => this.el.bossbar.classList.add('hidden'), fade ? 900 : 0);
  }

  phaseFlash() {
    this.el.bossbar.animate([{ filter: 'brightness(3)' }, { filter: 'brightness(1)' }], { duration: 700 });
  }

  setLock(on, sx, sy, size) {
    this.el.reticle.classList.toggle('hidden', !on);
    if (on) {
      const s = size || 74;
      this.el.reticle.style.transform = `translate(${sx - window.innerWidth / 2}px, ${sy - window.innerHeight / 2}px)`;
      this.el.reticle.style.width = s + 'px';
      this.el.reticle.style.height = s + 'px';
      this.el.reticle.style.margin = `${-s / 2}px 0 0 ${-s / 2}px`;
    }
  }

  setInteract(text, key = 'F') {
    this.el.interact.classList.toggle('hidden', !text);
    if (text) { this.el.interactText.textContent = text; this.el.interactKey.textContent = key; }
  }

  setHint(text, ms = 5200) {
    this.el.centerHint.classList.toggle('hidden', !text);
    if (!text) return;
    this.el.centerHint.innerHTML = text;
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.el.centerHint.classList.add('hidden'), ms);
  }

  toast(cn, en, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.innerHTML = en ? `${cn}<br><span style="font-size:10px;letter-spacing:.3em;opacity:.7">${en}</span>` : cn;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2200);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  banner(cn, en, ms = 3100) {
    this.el.bannerCn.textContent = cn;
    this.el.bannerEn.textContent = en || '';
    this.el.banner.classList.remove('hidden', 'show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => this.el.banner.classList.add('hidden'), ms);
  }

  fade(on) { this.el.fade.classList.toggle('on', on); }

  fadeScreen(on) { this.el.fade.classList.toggle('on', on); }

  showScreenDead(stats, canRevive) {
    const row = (k, v) => `<div>${k} <b>${v}</b></div>`;
    $('deadStats').innerHTML = [
      row('陨落之处', `${stats.depth} · 第 ${stats.room} 进`),
      row('失落灰烬', (stats.runes || 0).toLocaleString()),
      row('击杀', stats.kills),
      row('圣物', stats.relics),
      row('首领', stats.bossKills),
      row('弹反', stats.parries),
      row('背刺', stats.backstabs),
      row('用时', `${Math.floor(stats.time / 60)}′${String(stats.time % 60).padStart(2, '0')}″`),
      row('种子', stats.seed),
    ].join('');
    $('btnRevive').style.display = canRevive ? '' : 'none';
    this.screen('dead');
    this.el.fade.classList.remove('on');
  }

  hitFlash() {
    this.el.flash.classList.add('on');
    setTimeout(() => this.el.flash.classList.remove('on'), 60);
  }

  flashStamina() {
    this.el.stamFlash.classList.add('on');
    setTimeout(() => this.el.stamFlash.classList.remove('on'), 140);
  }

  number(sx, sy, text, kind = 'foe') {
    if (!this.game.settings.dmgNums && kind !== 'rune' && kind !== 'heal') return;
    const d = this.pool[this.poolIdx++ % this.pool.length];
    d.className = 'dn ' + kind;
    d.textContent = text;
    d.style.left = clamp(sx, 8, window.innerWidth - 8) + 'px';
    d.style.top = clamp(sy, 8, window.innerHeight - 8) + 'px';
    d.style.animation = 'none';
    void d.offsetWidth;
    d.style.animation = '';
  }

  drawMap(game) {
    const c = this.ctx, S = 150;
    if (!c || !game.room) return;
    const grid = game.room.room.grid;
    const p = game.player.pos;
    const scale = S / Math.max(grid.w, grid.h) / 1.6;
    c.clearRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-game.player.yaw);
    c.translate(-p.x * scale, -p.z * scale);
    c.fillStyle = 'rgba(201,162,74,0.13)';
    const cell = grid.cell * scale;
    for (let cz = 0; cz < grid.h; cz++) for (let cx = 0; cx < grid.w; cx++) {
      const i = cz * grid.w + cx;
      if (grid.type[i] === 0 || (grid.type[i] > 0 && grid.top[i] < 3)) {
        c.fillRect(grid.wx(cx) * scale - cell / 2, grid.wz(cz) * scale - cell / 2, cell, cell);
      }
    }
    for (const e of game.enemies) {
      if (!e.alive || e.dead) continue;
      c.fillStyle = e.boss ? '#ff6a4a' : '#c9563f';
      c.beginPath();
      c.arc(e.pos.x * scale, e.pos.z * scale, e.boss ? 4.5 : 2.6, 0, 6.283);
      c.fill();
    }
    if (game.room.gracePos) {
      c.fillStyle = '#ffd479';
      c.beginPath();
      c.arc(game.room.gracePos.x * scale, game.room.gracePos.z * scale, 3.4, 0, 6.283);
      c.fill();
    }
    const ex = game.room.room.exit;
    c.fillStyle = 'rgba(160,220,255,0.9)';
    c.fillRect(ex.x * scale - 2, ex.z * scale - 2, 4.5, 4.5);
    c.fillStyle = '#f2dda0';
    c.beginPath();
    c.moveTo(0, -5); c.lineTo(3.4, 4); c.lineTo(0, 2); c.lineTo(-3.4, 4); c.closePath();
    c.save();
    c.translate(p.x * scale, p.z * scale);
    c.rotate(game.player.yaw + Math.PI);
    c.fill();
    c.restore();
    c.restore();
  }

  renderDraft(cards, opts) {
    const wrap = $('draftCards');
    wrap.innerHTML = cards.map((c, i) => cardHTML(c, i)).join('');
    $('draftTitle').textContent = opts.title || '圣物抉择';
    $('draftSub').textContent = opts.sub || '取走其一，其余散为灰烬。';
    $('rerollN').textContent = opts.rerolls;
    $('btnReroll').disabled = opts.rerolls <= 0;
    [...wrap.children].forEach((el, i) => {
      el.onclick = () => opts.onPick(cards[i], i);
      el.onmouseenter = () => window.__ashenAudio?.play?.('uiMove', { vol: 0.4 });
    });
  }

  tagChips(tags = []) {
    return tags.map((t) => {
      const info = RELIC_TAGS[t] || { cn: t, color: '#8d8474' };
      return `<i style="border-color:${info.color}55;color:${info.color}">${info.cn}</i>`;
    }).join('');
  }
}

export function cardHTML(relic, i) {
  const lines = relicLines(relic);
  return `<div class="card ${relic.rarity}">
    <div class="rar">${RARITY_ICON[relic.rarity]} ${RARITY_CN[relic.rarity]}</div>
    <div class="icon">${RARITY_ICON[relic.rarity]}</div>
    <div><h4>${relic.cn}</h4><div class="en">${relic.name.toUpperCase()}</div></div>
    <div class="tags">${(relic.tags || []).map((t) => { const info = RELIC_TAGS[t] || { cn: t, color: '#8d8474' }; return `<i style="border-color:${info.color}55;color:${info.color}">${info.cn}</i>`; }).join('')}</div>
    <div class="desc">${relic.desc}</div>
    <div class="mods">${lines.map((l) => `<span class="${l.up ? 'up' : 'down'}">${l.text}</span>`).join('')}</div>
  </div>`;
}

export { RARITY_CN, RARITY_ICON, FLAG_CN };
