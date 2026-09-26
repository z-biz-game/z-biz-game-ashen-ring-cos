const SAVE_KEY = 'ashen_ring_save_v1';
const RUN_KEY = 'ashen_ring_run_v1';

export const DEFAULT_SAVE = {
  marks: 0,
  upgrades: {},
  curses: [],
  lastClass: 'ashen_knight',
  codex: { runs: 0, deaths: 0, victories: 0, bossKills: 0, deepest: 0, kills: 0, bestRunes: 0, parries: 0, backstabs: 0, relics: {} },
  settings: { volume: 0.7, quality: 1, invert: false, dmgNums: true, pad: {} },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function merge(base, got) {
  const out = clone(base);
  if (!got || typeof got !== 'object') return out;
  for (const k of Object.keys(base)) {
    if (got[k] === undefined) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = { ...base[k], ...got[k] };
    else out[k] = got[k];
  }
  out.codex = { ...DEFAULT_SAVE.codex, ...(got.codex || {}) };
  out.settings = { ...DEFAULT_SAVE.settings, ...(got.settings || {}) };
  return out;
}

export function loadSave() {
  try { return merge(DEFAULT_SAVE, JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); }
  catch { return clone(DEFAULT_SAVE); }
}

export function writeSave(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(RUN_KEY); } catch { /* ignore */ }
}

export function upgradeCost(up, level) {
  return Math.round(up.cost * Math.pow(up.growth, level));
}

export function saveRun(snapshot) {
  try { localStorage.setItem(RUN_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.seed ? s : null;
  } catch { return null; }
}

export function clearRun() {
  try { localStorage.removeItem(RUN_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- save codes
// localStorage is partitioned by origin, so the Pages deployment and a local run
// are two unrelated accounts. The code is the whole meta save, base64url'd with a
// checksum so a truncated paste fails loudly instead of half-loading.
const CODE_PREFIX = 'ASHEN1';
const CODE_VERSION = 1;
const CODEX_INTS = ['runs', 'deaths', 'victories', 'bossKills', 'deepest', 'kills', 'bestRunes', 'parries', 'backstabs'];

const clampNum = (v, lo, hi, dflt = 0) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

// Keys are user data from another machine: bound their length and drop anything
// that is not a non-negative count, so a hand-edited code cannot poison a lookup.
function idMap(o, hi) {
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of Object.keys(o)) {
      const v = Math.round(clampNum(o[k], 0, hi));
      if (v > 0 && /^[\w-]{1,40}$/.test(k)) out[k] = v;
    }
  }
  return out;
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0').slice(-7);
}

function b64url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function sanitizeSave(save) {
  const s = merge(DEFAULT_SAVE, save);
  s.marks = Math.round(clampNum(s.marks, 0, 1e9));
  s.lastClass = typeof s.lastClass === 'string' ? s.lastClass.slice(0, 40) : DEFAULT_SAVE.lastClass;
  s.curses = Array.isArray(s.curses) ? s.curses.filter((c) => typeof c === 'string').slice(0, 64) : [];
  s.upgrades = idMap(s.upgrades, 99);
  for (const k of CODEX_INTS) s.codex[k] = Math.round(clampNum(s.codex[k], 0, 1e9));
  s.codex.relics = idMap(s.codex.relics, 9999);
  const st = s.settings;
  st.volume = clampNum(st.volume, 0, 1, DEFAULT_SAVE.settings.volume);
  st.quality = [0, 1, 2].includes(st.quality) ? st.quality : DEFAULT_SAVE.settings.quality;
  st.invert = !!st.invert;
  st.dmgNums = !!st.dmgNums;
  const pad = {};
  if (st.pad && typeof st.pad === 'object') {
    for (const k of Object.keys(st.pad)) {
      const v = st.pad[k];
      if (/^[\w-]{1,24}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 31) pad[k] = v;
    }
  }
  st.pad = pad;
  return s;
}

export function exportCode(save) {
  const body = b64url(JSON.stringify({ v: CODE_VERSION, ...sanitizeSave(save) }));
  return `${CODE_PREFIX}-${body}.${fnv(body)}`;
}

export function importCode(code) {
  const m = /^ASHEN1-([A-Za-z0-9_-]+)\.([a-z0-9]{7})$/.exec(String(code || '').trim());
  if (!m) return { ok: false, reason: '格式不对：存档码应以 ASHEN1- 开头' };
  if (fnv(m[1]) !== m[2]) return { ok: false, reason: '校验不符：存档码被截断或改过' };
  let payload;
  try { payload = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: '存档码无法解码' }; }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: '存档码内容为空' };
  if (payload.v !== CODE_VERSION) return { ok: false, reason: `不支持的存档码版本 ${payload.v}` };
  return { ok: true, save: sanitizeSave(payload) };
}
