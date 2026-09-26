const SAVE_KEY = 'ashen_ring_save_v1';
const RUN_KEY = 'ashen_ring_run_v1';

export const DEFAULT_SAVE = {
  marks: 0,
  upgrades: {},
  curses: [],
  lastClass: 'ashen_knight',
  codex: { runs: 0, deaths: 0, victories: 0, bossKills: 0, deepest: 0, kills: 0, bestRunes: 0, parries: 0, backstabs: 0, relics: {} },
  settings: { volume: 0.7, quality: 1, invert: false, dmgNums: true },
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
