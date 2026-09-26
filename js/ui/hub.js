import { CLASSES, CURSES, HUB_UPGRADES, RELICS, DEPTH_MODIFIERS } from '../meta/content.js';
import { upgradeCost, wipeSave, writeSave, exportCode, importCode } from '../meta/save.js';
import { resolveStats, summarize } from '../meta/stats.js';
import { cardHTML, STAT_CN } from './hud.js';
import { PAD_ACTIONS, PAD_NAMES } from '../engine/input.js';

const $ = (id) => document.getElementById(id);

const KEY_HELP = [
  ['W A S D', '移动'],
  ['鼠标', '转动视角'],
  ['滚轮', '拉近 / 推远'],
  ['左键 或 J', '轻击连段（最多四段）'],
  ['右键 或 K', '重击 · 可背刺'],
  ['Shift 或 L', '格挡（持续耗体）'],
  ['U', '弹反 · 时机极短，成功可打断并削韧'],
  ['空格', '翻滚 · 起手无敌帧'],
  ['C', '跳跃 · 翻越矮墙'],
  ['Q 或 Tab', '锁定 / 解除锁定'],
  ['F 或 E', '休息 · 拾取 · 穿门'],
  ['R', '饮用元素瓶'],
  ['G', '召唤灰烬'],
  ['1 2 3', '法术（消耗专注）'],
  ['H', '疾跑'],
  ['T', '圣物重抽'],
  ['Esc 或 P', '暂停'],
];

const PAD_LABEL = {
  move: '移动', look: '视角', roll: '翻滚', light: '轻击', heavy: '重击', block: '格挡',
  parry: '弹反', jump: '跳跃', lock: '锁定', interact: '休息 · 拾取', estus: '元素瓶',
  ash: '召唤灰烬', spell1: '法术 I', spell2: '法术 II', pause: '暂停', reroll: '圣物重抽',
};

// Rendered from the live bindings, so the help page cannot drift from a remap.
function padHelpRows(input) {
  const rows = [['左摇杆', PAD_LABEL.move], ['右摇杆', PAD_LABEL.look]];
  for (const act of PAD_ACTIONS) rows.push([input.padLabel(act), PAD_LABEL[act]]);
  return rows;
}

const RULES = [
  '三层轮回，每层数间，尽头是雾门之后的首领。',
  '死亡会失落全部灰烬；回到血印处才能取回。',
  '灰烬营火休息：状态回满、敌人重生、写入续档快照。',
  '圣物三选一，重抽次数来自血脉强化。',
  '灰烬印记在圆桌厅兑换永久强化，死亡不会带走。',
  '命运枷锁是主动背负的诅咒，换取更深的收益。',
];

class HubUI {
  constructor(game) {
    this.game = game;
    this.tab = 'expedition';
    this.classId = game.save.lastClass || CLASSES[0].id;
    this.returnScreen = 'title';
    this.lastEarned = null;
    this.btnResume = document.createElement('button');
    this.btnResume.className = 'btn';
    this.btnResume.id = 'btnResumeRun';
    this.btnResume.textContent = '继续未竟的轮回';
    this.btnResume.style.display = 'none';
    $('btnStart')?.before(this.btnResume);
  }

  bind() {
    const g = this.game;

    this.btnResume.onclick = () => {
      const snap = g.resumeSnapshot;
      if (snap) g.startRun('', snap.classId, snap);
    };

    $('btnStart').onclick = () => this.openHub();
    $('btnHelp').onclick = () => { this.renderHelp(); this.returnScreen = 'title'; g.hud.screen('help'); };
    $('btnSettings').onclick = () => this.openHub('bloodline');
    $('btnHelpBack').onclick = () => {
      g.hud.screen(this.returnScreen);
      if (this.returnScreen === 'hub') this.renderHub();
    };

    for (const t of document.querySelectorAll('#hub .tab')) {
      t.onclick = () => { this.tab = t.dataset.tab; this.renderHub(); };
    }
    $('btnHubBack').onclick = () => { g.state = 'title'; g.hud.screen('title'); this.renderTitle(); };
    $('btnRun').onclick = () => {
      const seed = ($('seedInput').value || '').trim();
      g.startRun(seed, this.classId);
    };

    $('btnRevive').onclick = () => g.revive();
    $('btnToHub').onclick = () => g.endRun();
    $('btnWinHub').onclick = () => g.endRun();

    $('btnResume').onclick = () => g.resumeGame();
    $('btnAbandon').onclick = () => g.endRun();

    this.syncSettings();
    $('volRange').oninput = (e) => { g.settings.volume = e.target.value / 100; this.syncSettings(); };
    $('qualitySel').onchange = (e) => { g.settings.quality = Number(e.target.value); g.applySettings(); };
    $('invertChk').onchange = (e) => { g.settings.invert = e.target.checked; writeSave(g.save); };
    $('dmgChk').onchange = (e) => { g.settings.dmgNums = e.target.checked; writeSave(g.save); };
    this.renderPadMap();
    $('btnPadReset').onclick = () => {
      g.settings.pad = {};
      g.input.applyPadBinds(null);
      writeSave(g.save);
      this.renderPadMap();
    };
    g.input.onPadCapture = (act, idx) => {
      g.settings.pad[act] = idx;
      writeSave(g.save);
      g.audio.play?.('lockoff', { vol: 0.4 });
      this.renderPadMap();
    };
    $('btnExport').onclick = () => this.exportSave();
    $('btnImport').onclick = () => this.importSave();
    for (const el of document.querySelectorAll('#screens button, #screens .btn')) {
      el.onmouseenter = () => g.audio.play?.('uiMove', { vol: 0.35 });
    }
  }

  syncSettings() {
    const s = this.game.settings;
    $('volRange').value = Math.round(s.volume * 100);
    $('qualitySel').value = String(s.quality);
    $('invertChk').checked = !!s.invert;
    $('dmgChk').checked = !!s.dmgNums;
    this.game.audio.setVolume('master', s.volume);
    writeSave(this.game.save);
  }

  codeMsg(text, bad) {
    const el = $('codeState');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('warn', !!bad);
    clearTimeout(this._codeT);
    this._codeT = setTimeout(() => { el.textContent = ''; }, 7000);
  }

  exportSave() {
    const g = this.game;
    const code = exportCode(g.save);
    const box = $('saveCode');
    box.value = code;
    box.select();
    // Clipboard write needs a secure context and can still be refused; the textarea
    // is selected either way, so a manual copy keeps working.
    if (!navigator.clipboard) this.codeMsg('已生成，按 Ctrl/⌘+C 复制');
    else navigator.clipboard.writeText(code).then(
      () => this.codeMsg(`已复制 · ${g.save.marks} 灰烬印记`),
      () => this.codeMsg('已生成，按 Ctrl/⌘+C 复制'));
  }

  importSave() {
    const g = this.game;
    const res = importCode($('saveCode').value);
    if (!res.ok) { this.codeMsg(res.reason, true); g.audio.play?.('uiBack', { vol: 0.6 }); return; }
    const before = g.save.marks;
    g.save = res.save;
    g.settings = g.save.settings;
    writeSave(g.save);
    g.applySettings();
    g.input.applyPadBinds(g.settings.pad);
    this.syncSettings();
    this.renderPadMap();
    if (g.state === 'hub') this.renderHub();
    g.audio.play?.('lockon', { vol: 0.6 });
    const mid = ['playing', 'paused', 'grace', 'draft'].includes(g.state);
    this.codeMsg(`已导入：印记 ${before} → ${g.save.marks}${mid ? ' · 血脉与诅咒下一轮生效' : ''}`);
  }

  renderPadMap() {
    const el = $('padMap');
    if (!el) return;
    const g = this.game;
    const cap = g.input.capturing;
    el.innerHTML = PAD_ACTIONS.map((act) => {
      const wait = cap === act;
      return `<button class="padkey${wait ? ' wait' : ''}" data-act="${act}"><b>${PAD_LABEL[act]}</b><kbd>${wait ? '按下按键…' : g.input.padLabel(act)}</kbd></button>`;
    }).join('');
    for (const b of el.querySelectorAll('.padkey')) {
      b.onclick = () => {
        const act = b.dataset.act;
        if (g.input.capturing === act) g.input.cancelPadCapture();
        else {
          g.input.beginPadCapture(act);
          // give up rather than leave a live capture armed for an unseen button press
          clearTimeout(this._capT);
          this._capT = setTimeout(() => { g.input.cancelPadCapture(); this.renderPadMap(); }, 6200);
        }
        this.renderPadMap();
      };
    }
    const state = $('padState');
    if (state) state.textContent = g.input.padActive || g.input.padConnected ? '已连接 · 点按键再按手柄' : '未检测到手柄';
  }

  openHub(tab = 'expedition') {
    this.game.audio.unlock();
    this.game.audio.setVolume('master', this.game.settings.volume);
    this.tab = tab;
    this.game.state = 'hub';
    this.game.hud.screen('hub');
    this.renderHub();
  }

  renderTitle() {
    const c = this.game.save.codex;
    $('titleStats').textContent = `轮回 ${c.runs} · 最深 第${c.deepest || 0}层 · 首领 ${c.bossKills} · 死亡 ${c.deaths}`;
    const snap = this.game.resumeSnapshot;
    this.btnResume.style.display = snap && snap.depth !== undefined ? '' : 'none';
    if (snap) {
      this.btnResume.textContent = `继续未竟的轮回 · 第${(snap.depth || 0) + 1}层 进${(snap.roomIdx || 0) + 1}`;
      this.btnResume.classList.add('primary');
      $('btnStart').classList.remove('primary');
    } else {
      $('btnStart').classList.add('primary');
    }
    $('seedInput').value = '';
  }

  renderHub(earned) {
    for (const t of document.querySelectorAll('#hub .tab')) t.classList.toggle('active', t.dataset.tab === this.tab);
    for (const body of document.querySelectorAll('.tab-body')) body.classList.toggle('hidden', body.id !== 'tab-' + this.tab);
    $('markCount').textContent = this.game.save.marks;
    if (this.tab === 'expedition') this.renderExpedition(earned);
    else if (this.tab === 'bloodline') this.renderBloodline();
    else if (this.tab === 'bindings') this.renderBindings();
    else this.renderCodex();
  }

  // ------------------------------------------------------------------ expedition
  renderExpedition(earned) {
    const g = this.game;
    const body = $('tab-expedition');
    body.innerHTML = `
      <h3 class="mini">残铠 · 起手之躯</h3>
      <div class="class-grid" id="classGrid"></div>
      <h3 class="mini" style="margin-top:20px">命运种子</h3>
      <div class="seed-row" style="justify-content:flex-start;margin-top:0">
        <label for="seedInput2">种子</label>
        <input id="seedInput2" placeholder="留空则随机" maxlength="12" spellcheck="false" />
        <span class="dim">同一种子生成同一段轮回</span>
      </div>
      <div class="legend" style="margin-top:18px">${DEPTH_MODIFIERS.map((d, i) => `<div>第${'一二三'[i]}层 · <b style="color:#c9a24a">${d.cn}</b> — 首领「${d.boss}」，敌人血量 x${d.enemyMul.hp.toFixed(2)}、伤害 x${d.enemyMul.dmg.toFixed(2)}</div>`).join('')}</div>
      ${earned && earned.marks ? `<p class="lore" style="margin-top:16px;font-size:13px">此行带回 <b style="color:#ffd479">+${earned.marks}</b> 灰烬印记。</p>` : ''}`;
    const seed2 = $('seedInput2');
    seed2.value = $('seedInput').value;
    seed2.oninput = () => { $('seedInput').value = seed2.value; };
    $('seedInput').oninput = () => { if ($('seedInput2')) $('seedInput2').value = $('seedInput').value; };

    const grid = $('classGrid');
    grid.innerHTML = CLASSES.map((c) => this.classCardHTML(c)).join('');
    [...grid.children].forEach((el, i) => {
      el.onclick = () => {
        this.classId = CLASSES[i].id;
        g.save.lastClass = this.classId;
        writeSave(g.save);
        this.renderHub();
      };
    });
    $('hubLegend').innerHTML = `<div>选定残铠后，右下「踏入轮回」开始。血印、营火、圣物都会在轮回里教你规矩。</div>`;
    $('btnRun').textContent = `踏入轮回 · ${CLASSES.find((c) => c.id === this.classId)?.cn || ''} ⚔`;
  }

  classCardHTML(c) {
    const sel = c.id === this.classId;
    const { s, flags } = resolveStats({ classStats: c.stats, upgrades: this.game.save.upgrades });
    const preview = summarize(s, flags).split(' · ');
    return `<div class="class-card${sel ? ' sel' : ''}">
      <h4>${c.cn}</h4>
      <div class="en">${c.name.toUpperCase()}</div>
      <div class="wp">⚔ ${c.weapon}</div>
      <p>${c.desc}</p>
      <div class="statline">${preview.map((p) => `<i>${p}</i>`).join('')}</div>
      <div class="lore-line">${c.lore}</div>
    </div>`;
  }

  // ------------------------------------------------------------------- bloodline
  renderBloodline() {
    const g = this.game;
    const body = $('tab-bloodline');
    body.innerHTML = `
      <h3 class="mini">血脉强化 · 以灰烬印记刻进骨血</h3>
      <div class="up-grid" id="upGrid"></div>
      <div class="legend" style="margin-top:16px">强化永久生效，跨轮回保留。死亡带回的印记越多，解锁越快。</div>`;
    const grid = $('upGrid');
    grid.innerHTML = HUB_UPGRADES.map((up) => {
      const lvl = Math.min(up.max, g.save.upgrades[up.id] || 0);
      const maxed = lvl >= up.max;
      const cost = upgradeCost(up, lvl);
      const poor = !maxed && g.save.marks < cost;
      return `<div class="up-card${maxed ? ' max' : poor ? ' poor' : ''}" data-id="${up.id}">
        <div>
          <h5>${up.cn} <span style="font-size:10px;letter-spacing:.2em;color:#6f665a">${up.name.toUpperCase()}</span></h5>
          <p>${up.desc}</p>
          <div class="lvl-dots">${Array.from({ length: up.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <div class="up-cost">${maxed ? '已满' : `${cost} ◈`}<small>LVL ${lvl}/${up.max}</small></div>
      </div>`;
    }).join('');
    [...grid.children].forEach((el) => {
      el.onclick = () => {
        const up = HUB_UPGRADES.find((u) => u.id === el.dataset.id);
        const lvl = Math.min(up.max, g.save.upgrades[up.id] || 0);
        const cost = upgradeCost(up, lvl);
        if (lvl >= up.max) return;
        if (g.save.marks < cost) { g.audio.play?.('uiBack', { vol: 0.4 }); return; }
        g.save.marks -= cost;
        g.save.upgrades[up.id] = lvl + 1;
        writeSave(g.save);
        g.audio.play?.('boonPickup', { vol: 0.6 });
        this.renderHub();
      };
    });
    $('hubLegend').innerHTML = `<div>「${HUB_UPGRADES.map((u) => u.cn).join(' / ')}」— 点击卡片消耗印记升级。</div>`;
  }

  // -------------------------------------------------------------------- bindings
  renderBindings() {
    const g = this.game;
    const body = $('tab-bindings');
    const taken = new Set(g.save.curses || []);
    body.innerHTML = `
      <h3 class="mini">命运枷锁 · 自愿背负的诅咒</h3>
      <p class="legend" style="margin-bottom:12px">诅咒在整段轮回中生效，代价换来的是更凶的收益。随时可解下。</p>
      <div class="cards" id="curseCards"></div>
      <div class="legend" style="margin-top:18px">已背负 ${taken.size} / ${CURSES.length} 条。诅咒不计入圣物数量，但会同样出现在纪功碑里。</div>`;
    const wrap = $('curseCards');
    wrap.innerHTML = CURSES.map((c) => cardHTML(c, 0)).join('');
    [...wrap.children].forEach((el, i) => {
      const c = CURSES[i];
      el.classList.toggle('sel', taken.has(c.id));
      if (taken.has(c.id)) el.style.boxShadow = '0 0 0 1px #c0453a inset, 0 0 26px rgba(190,70,60,.25)';
      el.onclick = () => {
        const list = g.save.curses || (g.save.curses = []);
        const at = list.indexOf(c.id);
        if (at >= 0) list.splice(at, 1); else list.push(c.id);
        writeSave(g.save);
        g.audio.play?.(at >= 0 ? 'uiBack' : 'cardSelect', { vol: 0.5 });
        this.renderHub();
      };
    });
    $('hubLegend').innerHTML = `<div>诅咒越多，轮回越险，灰烬印记结算不变 —— 纯粹给想要自缚的猎人准备。</div>`;
  }

  // ----------------------------------------------------------------------- codex
  renderCodex() {
    const g = this.game;
    const c = g.save.codex;
    const body = $('tab-codex');
    const seen = c.relics || {};
    const discovered = RELICS.filter((r) => seen[r.id]).length;
    const row = (k, v) => `<div>${k} <b>${v}</b></div>`;
    body.innerHTML = `
      <h3 class="mini">纪功碑</h3>
      <div class="dead-stats" style="border:1px solid var(--line)">
        ${row('轮回次数', c.runs)}${row('抵达最深', '第 ' + (c.deepest || 0) + ' 层')}
        ${row('首领击破', c.bossKills)}${row('击杀', c.kills)}
        ${row('死亡', c.deaths)}${row('通关', c.victories || 0)}
        ${row('最多灰烬', (c.bestRunes || 0).toLocaleString())}${row('圣物图鉴', discovered + '/' + RELICS.length)}
      </div>
      <h3 class="mini" style="margin-top:22px">圣物图鉴 · 已见 ${discovered} 件</h3>
      <div class="relic-codex" id="codexList">${RELICS.map((r) => `<span class="relic-chip ${seen[r.id] ? r.rarity : 'unknown'}" title="${seen[r.id] ? r.desc : '尚未在轮回中遇见'}">${seen[r.id] ? r.cn : '？？？'}</span>`).join('')}</div>
      <div class="legend" style="margin-top:22px">
        <div>属性词条对照：${Object.entries(STAT_CN).slice(0, 12).map(([k, v]) => v).join(' · ')} …</div>
        <div style="margin-top:6px"><button class="btn small danger" id="btnWipe">抹去全部进度</button></div>
      </div>`;
    $('btnWipe').onclick = () => {
      if (!confirm('将清空灰烬印记、血脉强化、诅咒与图鉴，且无法复原。确认？')) return;
      wipeSave();
      g.save = { marks: 0, upgrades: {}, curses: [], lastClass: 'ashen_knight', codex: { runs: 0, deaths: 0, victories: 0, bossKills: 0, deepest: 0, kills: 0, bestRunes: 0, parries: 0, backstabs: 0, relics: {} }, settings: g.save.settings };
      g.resumeSnapshot = null;
      this.renderHub();
    };
    $('hubLegend').innerHTML = `<div>图鉴记录你在所有轮回里遇见过的圣物；未遇见的条目只会显示问号。</div>`;
  }

  // ----------------------------------------------------------------------- pause
  renderPause() {
    const s = this.game.settings;
    $('ctrlList').innerHTML = KEY_HELP.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
    $('volRange').value = Math.round(s.volume * 100);
    $('qualitySel').value = String(s.quality);
    $('invertChk').checked = !!s.invert;
    $('dmgChk').checked = !!s.dmgNums;
    this.renderPadMap();
    $('btnRevive') && ($('btnRevive').style.display = '');
  }

  renderHelp() {
    $('helpKeys').innerHTML = KEY_HELP.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
    $('helpPad').innerHTML = padHelpRows(this.game.input).map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
    $('helpRules').innerHTML = RULES.map((r) => `<li>${r}</li>`).join('');
  }
}

export { HubUI };
