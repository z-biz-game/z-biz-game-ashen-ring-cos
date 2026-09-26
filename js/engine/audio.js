// Procedural WebAudio layer: every sound is synthesised at runtime, zero assets.
import { clamp } from './rng.js';

const jit = (spread = 0.12) => 1 + (Math.random() - 0.5) * spread;
const tanhCurve = (k = 1.6, n = 1024) => Float32Array.from({ length: n }, (_, i) => Math.tanh((i / (n - 1)) * 2 * k - k) / Math.tanh(k));

// convolver-free cathedral reverb: damped feedback delay taps [time, feedback, damping cutoff]
const TAPS = [[0.031, 0.7, 2500], [0.047, 0.66, 2100], [0.067, 0.61, 1700], [0.097, 0.55, 1300]];
// ambience pad voices: [wave, hz, base level, extra level per unit of tension mood]
const PAD = [[55, 'sawtooth', 0.05, 0.012], [55.6, 'sawtooth', 0.044, 0.012], [110.3, 'sine', 0.03, 0.006], [82.4, 'sine', 0.022, 0.005], [77.8, 'sawtooth', 0.003, 0.03]];

// musical stingers: pulse() and the bell SFX share these
const STINGS = {
  grace: (a, t) => [0, 4, 7, 12].forEach((s, i) => a.tone(t + i * 0.16, { type: 'triangle', f: 440 * 2 ** (s / 12), dur: 1.7, vol: 0.11, atk: 0.008, send: 1.2, dest: a.music })),
  bossReveal: (a, t) => { [55, 58.3, 82.4].forEach((f) => a.tone(t, { type: 'sawtooth', f, f1: f * 0.86, dur: 2.4, vol: 0.1, atk: 0.25, send: 1, dest: a.music })); a.noise(t, { dur: 2, vol: 0.07, type: 'lowpass', f: 300, f1: 90, atk: 0.2, send: 1, dest: a.music }); },
  died: (a, t) => [[196, 0], [185, 0.2], [131, 0.45], [123, 1.1]].forEach(([f, d]) => a.tone(t + d, { type: 'sawtooth', f, f1: f * 0.93, dur: 1.9, vol: 0.09, atk: 0.06, send: 1, dest: a.music })),
  victory: (a, t) => [0, 4, 7, 12, 16].forEach((s, i) => a.tone(t + i * 0.12, { type: 'square', f: 330 * 2 ** (s / 12), dur: 0.8, vol: 0.05, atk: 0.01, send: 0.8, dest: a.music })),
  levelUp: (a, t) => [0, 7, 12, 19].forEach((s, i) => a.tone(t + i * 0.07, { type: 'sine', f: 523 * 2 ** (s / 12), dur: 0.6, vol: 0.08, atk: 0.004, send: 0.9, dest: a.music })),
};

// one entry per sound: (audio, startTime, opts) -> voices
const VOICES = {
  swing: (a, t, o) => { a.noise(t, { ...o, dur: 0.2, vol: 0.26 * o.vol, type: 'bandpass', f: 2600, f1: 520, q: 1.6 }); a.noise(t + 0.04, { ...o, dur: 0.1, vol: 0.05 * o.vol, type: 'highpass', f: 3600 }); },
  swingHeavy: (a, t, o) => { a.noise(t, { ...o, dur: 0.36, vol: 0.3 * o.vol, type: 'bandpass', f: 1500, f1: 230, q: 1.2, send: 0.35 }); a.tone(t, { ...o, type: 'sine', f: 150, f1: 62, dur: 0.2, vol: 0.1 * o.vol }); },
  hitFlesh: (a, t, o) => { a.noise(t, { ...o, dur: 0.14, vol: 0.34 * o.vol, type: 'lowpass', f: 520, f1: 170, send: 0.12 }); a.tone(t, { ...o, type: 'sine', f: 118, f1: 46, dur: 0.16, vol: 0.22 * o.vol }); },
  hitArmor: (a, t, o) => { a.noise(t, { ...o, dur: 0.05, vol: 0.2 * o.vol, type: 'highpass', f: 2800 }); [1, 2.42, 3.13, 4.31].forEach((m, i) => a.tone(t, { ...o, type: i ? 'sine' : 'triangle', f: 320 * m, dur: 0.34 - i * 0.06, vol: (0.13 / (i + 1)) * o.vol, detune: o.detune + i * 9 - 12 })); },
  hitShield: (a, t, o) => { a.noise(t, { ...o, dur: 0.07, vol: 0.24 * o.vol, type: 'bandpass', f: 3300, q: 0.8, send: 0.55 }); [1, 1.68, 2.31, 3.14, 4.2].forEach((m, i) => a.tone(t, { ...o, type: 'triangle', f: 610 * m, dur: 0.42 - i * 0.05, vol: (0.09 / (i + 1)) * o.vol, detune: o.detune + i * 7 })); },
  guardBreak: (a, t, o) => { a.noise(t, { ...o, dur: 0.3, vol: 0.26 * o.vol, type: 'bandpass', f: 2400, f1: 400, q: 1.1, send: 0.6 }); a.tone(t, { ...o, type: 'sawtooth', f: 300, f1: 70, dur: 0.5, vol: 0.11 * o.vol, send: 0.5 }); [1, 1.9, 2.83].forEach((m, i) => a.tone(t + 0.02 * i, { ...o, type: 'triangle', f: 480 * m, dur: 0.25, vol: 0.06 * o.vol })); },
  parry: (a, t, o) => { a.noise(t, { ...o, dur: 0.09, vol: 0.32 * o.vol, type: 'highpass', f: 4200, send: 0.8 }); a.tone(t, { ...o, type: 'square', f: 1250, f1: 2650, dur: 0.07, vol: 0.08 * o.vol, atk: 0.001 }); [1, 2.05, 3.31, 5.4].forEach((m, i) => a.tone(t, { ...o, type: 'triangle', f: 1450 * m, dur: 0.55 - i * 0.08, vol: (0.14 / (i + 1)) * o.vol, send: 0.95 })); },
  roll: (a, t, o) => a.noise(t, { ...o, dur: 0.42, vol: 0.12 * o.vol, type: 'bandpass', f: 700, f1: 1900, q: 0.8, send: 0.2 }),
  jump: (a, t, o) => { a.tone(t, { ...o, type: 'sine', f: 200, f1: 430, dur: 0.14, vol: 0.11 * o.vol }); a.noise(t, { ...o, dur: 0.1, vol: 0.09 * o.vol, type: 'bandpass', f: 1100, f1: 2200, q: 1 }); },
  land: (a, t, o) => { a.noise(t, { ...o, dur: 0.16, vol: 0.22 * o.vol, type: 'lowpass', f: 420, f1: 150, send: 0.25 }); a.tone(t, { ...o, type: 'sine', f: 95, f1: 48, dur: 0.18, vol: 0.18 * o.vol }); },
  footstep: (a, t, o) => a.noise(t, { ...o, dur: 0.085, vol: 0.13 * o.vol, type: 'bandpass', f: 380 + Math.random() * 520, q: 1.4, send: 0.22, pan: o.pan || (Math.random() < 0.5 ? -0.15 : 0.15) }),
  hurt: (a, t, o) => { a.tone(t, { ...o, type: 'sawtooth', f: 270, f1: 150, dur: 0.3, vol: 0.12 * o.vol, atk: 0.02, send: 0.3 }); a.noise(t, { ...o, dur: 0.22, vol: 0.11 * o.vol, type: 'bandpass', f: 900, f1: 420, q: 2.5 }); },
  death: (a, t, o) => { a.tone(t, { ...o, type: 'sawtooth', f: 240, f1: 40, dur: 1.7, vol: 0.14 * o.vol, atk: 0.05, send: 1.2 }); a.noise(t, { ...o, dur: 1.2, vol: 0.12 * o.vol, type: 'lowpass', f: 700, f1: 110, send: 0.9 }); },
  enemyDie: (a, t, o) => { a.tone(t, { ...o, type: 'sawtooth', f: 340, f1: 95, dur: 0.55, vol: 0.11 * o.vol, send: 0.45 }); a.noise(t, { ...o, dur: 0.3, vol: 0.15 * o.vol, type: 'lowpass', f: 900, f1: 200 }); },
  largeEnemyDie: (a, t, o) => { a.tone(t, { ...o, type: 'sawtooth', f: 130, f1: 30, dur: 1.5, vol: 0.17 * o.vol, atk: 0.04, send: 1.1 }); a.noise(t, { ...o, dur: 1.1, vol: 0.18 * o.vol, type: 'lowpass', f: 500, f1: 90, send: 0.8 }); },
  heal: (a, t, o) => { [0, 4, 7, 12].forEach((s, i) => a.tone(t + i * 0.06, { ...o, type: 'sine', f: 520 * 2 ** (s / 12), dur: 0.9, vol: 0.07 * o.vol, atk: 0.03, send: 0.9 })); a.noise(t, { ...o, dur: 0.7, vol: 0.05 * o.vol, type: 'bandpass', f: 900, f1: 4400, q: 2, send: 0.6 }); },
  estus: (a, t, o) => { [0, 0.13, 0.26].forEach((d, i) => a.noise(t + d, { ...o, dur: 0.14, vol: 0.11 * o.vol, type: 'bandpass', f: 480 + i * 240, f1: 1500 + i * 400, q: 3.4 })); a.tone(t + 0.34, { ...o, type: 'sine', f: 620, f1: 900, dur: 0.3, vol: 0.05 * o.vol, send: 0.5 }); },
  lockon: (a, t, o) => { a.tone(t, { ...o, type: 'sine', f: 1320, dur: 0.12, vol: 0.09 * o.vol, atk: 0.001 }); a.tone(t + 0.07, { ...o, type: 'sine', f: 1980, dur: 0.28, vol: 0.06 * o.vol, atk: 0.001, send: 0.6 }); },
  lockoff: (a, t, o) => a.tone(t, { ...o, type: 'sine', f: 1180, f1: 700, dur: 0.22, vol: 0.07 * o.vol, atk: 0.002, send: 0.35 }),
  runeGain: (a, t, o) => { [0, 7, 12, 19, 24].forEach((s, i) => a.tone(t + i * 0.05, { ...o, type: 'triangle', f: 660 * 2 ** (s / 12), dur: 0.85, vol: 0.06 * o.vol, atk: 0.004, send: 1.1 })); a.noise(t, { ...o, dur: 1, vol: 0.035 * o.vol, type: 'highpass', f: 5200, send: 0.8 }); },
  grace: (a, t) => STINGS.grace(a, t),
  rest: (a, t, o) => { a.tone(t, { ...o, type: 'sine', f: 110, dur: 2.2, vol: 0.07 * o.vol, atk: 0.4, send: 0.9 }); STINGS.grace(a, t + 0.12); },
  boonPickup: (a, t, o) => [0, 7, 16].forEach((s, i) => a.tone(t + i * 0.07, { ...o, type: 'triangle', f: 700 * 2 ** (s / 12), dur: 0.75, vol: 0.075 * o.vol, atk: 0.004, send: 0.95 })),
  cardSelect: (a, t, o) => { a.noise(t, { ...o, dur: 0.55, vol: 0.11 * o.vol, type: 'bandpass', f: 420, f1: 3400, q: 1.2, send: 0.7 }); [0, 7, 12].forEach((s, i) => a.tone(t + 0.1 + i * 0.09, { ...o, type: 'sine', f: 480 * 2 ** (s / 12), dur: 0.7, vol: 0.055 * o.vol, send: 0.85 })); },
  uiMove: (a, t, o) => a.noise(t, { ...o, dur: 0.045, vol: 0.09 * o.vol, type: 'bandpass', f: 2100, q: 4, send: 0.1 }),
  uiSelect: (a, t, o) => { a.tone(t, { ...o, type: 'sine', f: 720, dur: 0.09, vol: 0.07 * o.vol, atk: 0.002 }); a.tone(t + 0.06, { ...o, type: 'sine', f: 1080, dur: 0.2, vol: 0.055 * o.vol, atk: 0.002, send: 0.4 }); },
  uiBack: (a, t, o) => a.tone(t, { ...o, type: 'triangle', f: 520, f1: 240, dur: 0.16, vol: 0.07 * o.vol, atk: 0.002, send: 0.2 }),
  spellFlame: (a, t, o) => { a.noise(t, { ...o, dur: 0.75, vol: 0.2 * o.vol, type: 'lowpass', f: 300, f1: 2600, send: 0.8 }); a.tone(t, { ...o, type: 'sawtooth', f: 110, f1: 46, dur: 0.65, vol: 0.1 * o.vol, send: 0.7 }); },
  spellBlades: (a, t, o) => { for (let i = 0; i < 5; i++) a.tone(t + i * 0.035, { ...o, type: 'triangle', f: (760 + i * 210) * jit(0.1), dur: 0.3, vol: 0.06 * o.vol, atk: 0.002, pan: clamp(-0.7 + i * 0.35, -1, 1), send: 0.5 }); a.noise(t, { ...o, dur: 0.4, vol: 0.13 * o.vol, type: 'bandpass', f: 2600, f1: 900, q: 1.2 }); },
  spellSoul: (a, t, o) => { [0, 3, 7.2].forEach((s, i) => a.tone(t + i * 0.04, { ...o, type: 'sine', f: 420 * 2 ** (s / 12), f1: 300, dur: 1.2, vol: 0.065 * o.vol, atk: 0.08, send: 1.2 })); a.noise(t, { ...o, dur: 1, vol: 0.05 * o.vol, type: 'bandpass', f: 1800, f1: 600, q: 5, send: 0.9 }); },
  projectile: (a, t, o) => { a.noise(t, { ...o, dur: 0.4, vol: 0.15 * o.vol, type: 'bandpass', f: 1800, f1: 380, q: 1.6, send: 0.45 }); a.tone(t, { ...o, type: 'sine', f: 900, f1: 260, dur: 0.35, vol: 0.06 * o.vol, send: 0.4 }); },
  bossRoar: (a, t, o) => { a.tone(t, { ...o, type: 'sawtooth', f: 92, f1: 36, dur: 1.6, vol: 0.26 * o.vol, atk: 0.08, send: 1.3 }); a.tone(t + 0.05, { ...o, type: 'square', f: 46, f1: 30, dur: 1.4, vol: 0.1 * o.vol, send: 0.9 }); a.noise(t, { ...o, dur: 1.3, vol: 0.19 * o.vol, type: 'lowpass', f: 620, f1: 190, q: 2, send: 1.1 }); },
  bossStomp: (a, t, o) => { a.tone(t, { ...o, type: 'sine', f: 88, f1: 26, dur: 0.6, vol: 0.38 * o.vol, atk: 0.006, send: 0.7 }); a.noise(t, { ...o, dur: 0.35, vol: 0.22 * o.vol, type: 'lowpass', f: 420, f1: 90, send: 0.6 }); },
  bossSweep: (a, t, o) => { a.noise(t, { ...o, dur: 0.7, vol: 0.24 * o.vol, type: 'bandpass', f: 1500, f1: 300, q: 1.1, pan: -0.6, send: 0.6 }); a.noise(t + 0.08, { ...o, dur: 0.6, vol: 0.2 * o.vol, type: 'bandpass', f: 1200, f1: 260, q: 1.1, pan: 0.7, send: 0.6 }); },
  fogGate: (a, t, o) => { a.noise(t, { ...o, dur: 1.8, vol: 0.15 * o.vol, type: 'bandpass', f: 260, f1: 2400, q: 0.8, atk: 0.5, send: 1.3 }); a.tone(t, { ...o, type: 'sine', f: 68, dur: 2, vol: 0.09 * o.vol, atk: 0.4, send: 1 }); },
  portal: (a, t, o) => { a.tone(t, { ...o, type: 'sine', f: 240, f1: 980, dur: 0.9, vol: 0.1 * o.vol, atk: 0.05, send: 1.1 }); a.noise(t, { ...o, dur: 1, vol: 0.09 * o.vol, type: 'bandpass', f: 620, f1: 3800, q: 1.4, atk: 0.2, send: 1 }); },
  chestOpen: (a, t, o) => { a.noise(t, { ...o, dur: 0.5, vol: 0.11 * o.vol, type: 'bandpass', f: 620, f1: 1500, q: 4, atk: 0.02, send: 0.45 }); a.noise(t + 0.48, { ...o, dur: 0.06, vol: 0.13 * o.vol, type: 'highpass', f: 2600 }); [0, 7, 12].forEach((s, i) => a.tone(t + 0.5 + i * 0.05, { ...o, type: 'triangle', f: 520 * 2 ** (s / 12), dur: 0.6, vol: 0.055 * o.vol, atk: 0.003, send: 0.8 })); },
  doorOpen: (a, t, o) => { a.noise(t, { ...o, dur: 1.4, vol: 0.17 * o.vol, type: 'lowpass', f: 240, f1: 700, atk: 0.25, send: 0.9 }); a.tone(t, { ...o, type: 'sawtooth', f: 58, f1: 40, dur: 1.4, vol: 0.09 * o.vol, atk: 0.2, send: 0.8 }); },
  lowHp: (a, t, o) => a._beat(t, 0.2 * o.vol, a.sfx),
};

export class Audio {
  constructor() {
    this.ctx = null; this.enabled = true; this.mood = 0; this.amb = null; this.timer = null;
    this.nextAt = 0; this.nextBeat = 0; this.voices = VOICES; this.vols = { master: 0.85, sfx: 1, music: 0.6 };
  }

  get ready() { const ctx = this.ctx ?? null; return !!ctx && ctx.state !== 'closed'; }

  // must be called from a user gesture; idempotent, safe to call on every click
  unlock() {
    if (this.ctx) { this._resume(); return this; }
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
    if (!Ctor) return this;
    try { this.ctx = new Ctor({ latencyHint: 'interactive' }); } catch (e) { this.ctx = null; return this; }
    const ctx = this.ctx, G = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.master = G(this.enabled ? this.vols.master : 0); this.sfx = G(this.vols.sfx); this.music = G(this.vols.music);
    this.ambGain = G(0.0001); this.revSend = G(1); this.revWet = G(0.55);
    this.sfx.connect(this.master); this.music.connect(this.master); this.ambGain.connect(this.music);
    this.clip = ctx.createWaveShaper(); this.clip.curve = tanhCurve(); this.clip.oversample = '2x';
    this.master.connect(this.clip).connect(ctx.destination); this.masterGain = this.master; this.sfxGain = this.sfx; this.musicGain = this.music;
    this._makeBuffers(); this._makeReverb(); this._resume();
    return this;
  }

  setEnabled(on) {
    const ctx = this.ctx ?? null; this.enabled = !!on;
    if (ctx) this.master.gain.setTargetAtTime(this.enabled ? Math.max(0.0001, this.vols.master) : 0, ctx.currentTime, 0.05);
  }

  setVolume(kind, v) {
    const ctx = this.ctx ?? null;
    if (!kind || !(kind in this.vols)) return;
    this.vols[kind] = clamp(Number(v) || 0, 0, 1);
    const bus = ctx ? { master: this.master, sfx: this.sfx, music: this.music }[kind] : null;
    if (bus) bus.gain.setTargetAtTime(Math.max(0.0001, kind === 'master' && !this.enabled ? 0 : this.vols[kind]), ctx.currentTime, 0.02);
  }

  play(name, opts = {}) {
    const ctx = this.ctx ?? null, build = this.voices[name];
    if (!ctx || !build || !this.enabled) return;
    const o = { vol: 1, rate: 1, pan: 0, detune: 0, send: 0.22, ...opts };
    o.vol = clamp(Number(o.vol) || 0, 0, 4) * jit(); o.rate = (Number(o.rate) || 1) * jit(); o.pan = clamp(Number(o.pan) || 0, -1, 1);
    o.send = clamp(Number(o.send) || 0, 0, 2); o.detune = (Number(o.detune) || 0) + (Math.random() - 0.5) * 12;
    try { build(this, ctx.currentTime + 0.005, o); } catch (e) { /* a bad voice must never break the frame */ }
  }

  pulse(kind) {
    const ctx = this.ctx ?? null, build = STINGS[kind];
    if (!ctx || !build || !this.enabled) return;
    try { build(this, ctx.currentTime + 0.01); } catch (e) { /* ignore */ }
  }

  startAmbience(mood = 0) {
    const ctx = this.ctx ?? null;
    if (!ctx || this.amb) { if (ctx) this.setAmbienceMood(mood); return; }
    const pad = ctx.createGain(); pad.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 3; pad.connect(lp).connect(this.ambGain);
    const oscs = PAD.map(([f, type, lvl, m]) => {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f; osc.detune.value = (Math.random() - 0.5) * 16;
      const gain = ctx.createGain(); gain.gain.value = 0.0001; osc.connect(gain).connect(pad); osc.start();
      return { osc, gain, lvl, m };
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 95; lfo.connect(lfoAmt).connect(lp.frequency); lfo.start();
    const air = ctx.createBufferSource(); air.buffer = this.noiseBuf; air.loop = true; air.playbackRate.value = 0.6;
    const airBp = ctx.createBiquadFilter(); airBp.type = 'bandpass'; airBp.frequency.value = 380; airBp.Q.value = 1.2;
    const airG = ctx.createGain(); airG.gain.value = 0.03; air.connect(airBp).connect(airG).connect(this.ambGain); air.start();
    this.amb = { pad, lp, oscs, lfo, lfoAmt, air, airBp, airG };
    this.nextAt = ctx.currentTime + 0.8; this.nextBeat = ctx.currentTime + 2; this.timer = setInterval(() => this._tick(), 500);
    this.setAmbienceMood(mood);
    pad.gain.setTargetAtTime(0.5, ctx.currentTime, 2.5); this.ambGain.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
  }

  setAmbienceMood(mood = 0) {
    const ctx = this.ctx ?? null; if (!ctx || !this.amb) return;
    this.mood = clamp(Number(mood) || 0, 0, 2);
    const t = ctx.currentTime, m = this.mood;
    this.amb.lp.frequency.setTargetAtTime(170 + m * 210, t, 3);
    this.amb.airG.gain.setTargetAtTime(0.03 + m * 0.028, t, 4);
    for (const o of this.amb.oscs) o.gain.gain.setTargetAtTime(Math.max(0.0001, o.lvl + o.m * m), t, 3);
  }

  stopAmbience() {
    const ctx = this.ctx ?? null; if (!ctx || !this.amb) return;
    const amb = this.amb, t = ctx.currentTime, end = t + 1.8;
    this.amb = null; clearInterval(this.timer); this.timer = null;
    this.ambGain.gain.setTargetAtTime(0.0001, t, 0.4); amb.pad.gain.setTargetAtTime(0.0001, t, 0.4);
    for (const o of amb.oscs) o.osc.stop(end);
    amb.lfo.stop(end); amb.air.stop(end);
    amb.air.onended = () => { for (const n of [amb.pad, amb.lp, amb.airBp, amb.airG, amb.lfoAmt, ...amb.oscs.map((o) => o.gain)]) n.disconnect(); };
  }

  dispose() {
    clearInterval(this.timer); this.timer = null; this.amb = null;
    const ctx = this.ctx ?? null; this.ctx = null;
    if (ctx) { try { ctx.close(); } catch (e) { /* already closed */ } }
  }

  _resume() {
    const ctx = this.ctx ?? null; if (!ctx || ctx.state !== 'suspended') return;
    const p = ctx.resume(); if (p && p.catch) p.catch(() => {});
  }

  // white noise grains + exponentially decaying filtered noise for the cathedral tail (1.4 s, mono)
  _makeBuffers() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const white = ctx.createBuffer(1, Math.floor(sr * 1.2), sr), wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const len = Math.floor(sr * 1.4), tail = ctx.createBuffer(1, len, sr), d = tail.getChannelData(0); let lp = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; lp += (w - lp) * 0.17; d[i] = (lp * 2.3 + w * 0.22) * Math.exp(-3.6 * (i / len)) * Math.min(1, i / (sr * 0.02)); }
    this.noiseBuf = white; this.tailBuf = tail;
  }

  _makeReverb() {
    const ctx = this.ctx, damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 2700; damp.Q.value = 0.3; this.revSend.connect(damp);
    for (const [time, fb, cut] of TAPS) {
      const dl = ctx.createDelay(0.5); dl.delayTime.value = time;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; const g = ctx.createGain(); g.gain.value = fb;
      damp.connect(dl); dl.connect(lp); lp.connect(this.revWet); lp.connect(g); g.connect(dl);
    }
    this.revWet.connect(this.master);
  }

  // fan a voice out to panner / bus / reverb send; returns created nodes so they can be released
  _route(node, t, { pan = 0, send = 0, dest = null } = {}) {
    const ctx = this.ctx, extra = []; let head = node;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); head.connect(p); head = p; extra.push(p); }
    head.connect(dest ?? this.sfx);
    if (!send) return extra;
    const s = ctx.createGain(); s.gain.value = send; head.connect(s); s.connect(this.revSend); extra.push(s);
    this._tail(t, send);
    return extra;
  }

  _tail(t, amt) {
    const ctx = this.ctx, dur = this.tailBuf.duration;
    const src = ctx.createBufferSource(); src.buffer = this.tailBuf; src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170;
    const g = ctx.createGain(); g.gain.setValueAtTime(clamp(amt * 0.16, 0.0002, 0.25), t); g.gain.exponentialRampToValueAtTime(0.0002, t + dur);
    src.connect(hp).connect(g).connect(this.revSend);
    src.start(t, Math.random() * 0.2); src.stop(t + dur); this._end(src, [src, hp, g]);
  }
  _end(src, nodes) { src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already torn down */ } } }; }
  // percussive AD envelope, never touching exactly zero so exponential ramps stay legal
  _env(g, t, vol, atk, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dur);
  }
  tone(t, o = {}) {
    const ctx = this.ctx ?? null; if (!ctx) return null;
    const { type = 'sine', f = 220, f1 = null, dur = 0.2, vol = 0.3, atk = 0.004, pan = 0, send = 0.22, detune = 0, rate = 1, dest = this.sfx } = o;
    const osc = ctx.createOscillator(); osc.type = type; osc.detune.value = detune;
    osc.frequency.setValueAtTime(Math.max(1, f * rate), t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * rate), t + dur);
    const g = ctx.createGain(); this._env(g, t, vol, atk, dur); osc.connect(g);
    const extra = this._route(g, t, { pan, send, dest });
    osc.start(t); osc.stop(t + atk + dur + 0.05); this._end(osc, [osc, g, ...extra]);
    return osc;
  }
  noise(t, o = {}) {
    const ctx = this.ctx ?? null; if (!ctx) return null;
    const { dur = 0.2, vol = 0.3, f = 1200, f1 = null, q = 1, type = 'bandpass', atk = 0.003, pan = 0, send = 0.22, rate = 1, dest = this.sfx } = o;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = clamp(rate * jit(0.24), 0.1, 8);
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(clamp(f * rate, 20, 20000), t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(clamp(f1 * rate, 20, 20000), t + dur);
    const g = ctx.createGain(); this._env(g, t, vol, atk, dur); src.connect(flt); flt.connect(g);
    const extra = this._route(g, t, { pan, send, dest });
    src.start(t, Math.random() * 0.6); src.stop(t + atk + dur + 0.05); this._end(src, [src, flt, g, ...extra]);
    return src;
  }
  // two lowpassed sine thumps: the 'lowHp' warning and the high-tension heartbeat
  _beat(t, vol, dest) { for (let i = 0; i < 2; i++) this.tone(t + i * 0.19, { type: 'sine', f: 58, f1: 33, dur: 0.16, vol: vol * (i ? 0.65 : 1), atk: 0.012, dest, send: 0.1 }); }
  // lookahead scheduler for distant clangs, whispers and the heartbeat
  _tick() {
    const ctx = this.ctx ?? null; if (!ctx || ctx.state !== 'running' || !this.amb) return;
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.2;
    while (this.nextAt < ctx.currentTime + 1.5) {
      const t = this.nextAt, m = this.mood, roll = Math.random();
      this.nextAt += 0.7 + Math.random() * 1.6;
      if (roll < 0.26) this._clang(t);
      else if (roll < 0.58) this.noise(t, { dur: 0.9 + Math.random() * 0.7, vol: 0.02 + m * 0.006, type: 'bandpass', f: 1400 + Math.random() * 1800, f1: 700, q: 3, pan: (Math.random() - 0.5) * 1.6, send: 0.8, atk: 0.25 });
      if (m >= 0.6 && t >= this.nextBeat) { this._beat(t, 0.03 + m * 0.035, this.music); this.nextBeat = t + Math.max(0.6, 1.45 - m * 0.42); }
    }
  }

  _clang(t) {
    const f = 240 + Math.random() * 280;
    [1, 2.4, 3.7].forEach((m, i) => this.tone(t + i * 0.004, { type: 'triangle', f: f * m, dur: 1.9, vol: 0.03 / (i + 1), atk: 0.02, pan: (Math.random() - 0.5) * 1.6, send: 1, dest: this.music }));
  }
}

export default Audio;
