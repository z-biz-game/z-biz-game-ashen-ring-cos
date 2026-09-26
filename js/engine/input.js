import { clamp } from './rng.js';

const BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  roll: ['Space'],
  light: ['KeyJ', 'mouse0'],
  heavy: ['KeyK', 'mouse2'],
  block: ['KeyL', 'ShiftLeft'],
  sprint: ['KeyH', 'ShiftRight'],
  parry: ['KeyU'],
  jump: ['KeyC'],
  lock: ['KeyQ', 'Tab'],
  interact: ['KeyF', 'KeyE'],
  estus: ['KeyR'],
  ash: ['KeyG'],
  spell1: ['Digit1'],
  spell2: ['Digit2'],
  spell3: ['Digit3'],
  pause: ['Escape'],
  reroll: ['KeyT'],
  confirm: ['Enter'],
  cancel: ['Backspace', 'Escape'],
};

const PAD_DEFAULT = { move: [0, 1], look: [2, 3], roll: 0, light: 2, heavy: 5, block: 4, parry: 3, jump: 1, lock: 6, interact: 7, estus: 9, ash: 8, spell1: 12, spell2: 13, pause: 10, confirm: 0, cancel: 1, reroll: 15 };
const DEAD = 0.18;

// Standard-gamepad button indices, which is what the Gamepad API reports.
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Guide'];
// Axes are analogue, so only they get the ± treatment in the remap UI.
export const PAD_AXES = ['L-stick X', 'L-stick Y', 'R-stick X', 'R-stick Y', 'L-trigger', 'R-trigger'];
// What the settings screen lets a player rebind: everything that is a discrete press.
// spell3 has no default pad button (the D-pad column is taken), so it is not offered.
export const PAD_ACTIONS = ['roll', 'light', 'heavy', 'block', 'parry', 'jump', 'lock', 'interact', 'estus', 'ash', 'spell1', 'spell2', 'pause', 'reroll'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lockRequested = false;
    this.locked = false;
    this.padConnected = false;
    this.padBinds = { ...PAD_DEFAULT, move: [...PAD_DEFAULT.move], look: [...PAD_DEFAULT.look] };
    this._padPrev = new Set();
    this._padPressed = new Set();
    this._rawPrev = new Set();
    this._capturing = null;
    this.frozen = false;
    this.onLockChange = null;
    this.sensitivity = 0.0026;

    if (typeof window !== 'undefined') this._bind();
  }

  // Persisted overrides only carry the actions a player actually moved.
  applyPadBinds(map) {
    this.padBinds = { ...PAD_DEFAULT, move: [...PAD_DEFAULT.move], look: [...PAD_DEFAULT.look] };
    if (!map) return;
    for (const [act, idx] of Object.entries(map)) {
      if (typeof idx === 'number' && act in PAD_DEFAULT && act !== 'move' && act !== 'look') this.padBinds[act] = idx;
    }
  }

  padLabel(act) {
    const v = this.padBinds[act];
    return typeof v === 'number' ? (PAD_NAMES[v] || String(v)) : '—';
  }

  // Remap flow: the UI names an action, the next physical button press claims it.
  beginPadCapture(action) { this._capturing = action; }
  cancelPadCapture() { this._capturing = null; }
  get capturing() { return this._capturing; }

  _bind() {
    const editable = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    window.addEventListener('keydown', (e) => {
      if (editable(e.target)) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    }, { passive: false });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); });

    this.canvas.addEventListener('mousedown', (e) => {
      const k = 'mouse' + e.button;
      this.down.add(k);
      this.pressed.add(k);
      if (e.button === 2) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.down.delete('mouse' + e.button); });
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.hadLock = true;
      if (was !== this.locked && this.onLockChange) this.onLockChange(this.locked);
    });
    window.addEventListener('gamepadconnected', () => { this.padConnected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; });
  }

  requestLock() {
    if (this.locked) return;
    this.lockRequested = true;
    const p = this.canvas.requestPointerLock?.();
    if (p?.catch) p.catch(() => {});
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  isDown(action) {
    if (this.frozen) return false;
    for (const code of BINDS[action] || []) if (this.down.has(code)) return true;
    for (const b of this._padButtonsDown(action)) if (this.padButtons.has(b)) return true;
    return false;
  }

  justPressed(action) {
    if (this.frozen) return false;
    for (const code of BINDS[action] || []) if (this.pressed.has(code)) return true;
    return this.padPressed.has(action);
  }

  get padButtons() { return this._padDown; }
  get padPressed() { return this._padPressed; }

  _padButtonsDown(action) {
    return typeof this.padBinds[action] === 'number' ? ['pad:' + action] : [];
  }

  rumble(mo = 0.5, hi = 0.5, ms = 140) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      const act = p && p.vibrationActuator;
      if (!act || typeof act.playEffect !== 'function') continue;
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: hi, weakMagnitude: mo }).catch(() => {});
      return;
    }
  }

  _pollPad() {
    this._padDown = this._padDown || new Set();
    this._padPressed.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { this._padDown.clear(); this.padActive = false; return; }
    this.padActive = true;
    const now = new Set();
    for (const [act, idx] of Object.entries(this.padBinds)) {
      if (typeof idx !== 'number') continue;
      const b = gp.buttons[idx];
      if (b && (b.pressed || b.value > 0.5)) now.add('pad:' + act);
    }
    for (const b of now) if (!this._padPrev.has(b)) this._padPressed.add(b.slice(4));
    this._padPrev = now;
    this._padDown = now;
    const raw = new Set();
    gp.buttons.forEach((b, i) => { if (b && (b.pressed || b.value > 0.4)) raw.add(i); });
    if (this._capturing) {
      for (const i of raw) {
        if (this._rawPrev.has(i)) continue;
        const act = this._capturing;
        this._capturing = null;
        this.padBinds[act] = i;
        this.onPadCapture?.(act, i);
        break;
      }
    }
    this._rawPrev = raw;
    const ax = gp.axes || [];
    const mx = ax[this.padBinds.move[0]] || 0, my = ax[this.padBinds.move[1]] || 0;
    const rx = ax[this.padBinds.look[0]] || 0, ry = ax[this.padBinds.look[1]] || 0;
    this._padMove = { x: Math.abs(mx) > DEAD ? mx : 0, y: Math.abs(my) > DEAD ? my : 0 };
    this._padLook = { x: Math.abs(rx) > DEAD ? rx * 340 : 0, y: Math.abs(ry) > DEAD ? ry * 340 : 0 };
    const trig = gp.buttons[7]?.value || 0, brat = gp.buttons[6]?.value || 0;
    this._padTrig = { light: trig > 0.35, heavy: brat > 0.35 };
    if (this._padTrig.light && !this._padTrigPrev?.light) this._padPressed.add('light');
    if (this._padTrig.heavy && !this._padTrigPrev?.heavy) this._padPressed.add('heavy');
    this._padTrigPrev = this._padTrig;
  }

  moveAxis() {
    let x = 0, y = 0;
    if (this.isDown('forward')) y -= 1;
    if (this.isDown('back')) y += 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    const p = this.frozen ? null : this._padMove;
    if (p && (p.x || p.y)) { x += p.x; y += p.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, mag: Math.min(1, Math.hypot(x, y)) };
  }

  look(dt) {
    this._pollPadIfDue();
    const dx = this.mouseDX + (this._padLook?.x || 0) * dt * 60;
    const dy = this.mouseDY + (this._padLook?.y || 0) * dt * 60;
    this.mouseDX = 0; this.mouseDY = 0;
    return { x: dx * this.sensitivity, y: dy * this.sensitivity };
  }

  pollPad() { this._pollPadIfDue(); }

  _pollPadIfDue() {
    const now = performance.now();
    if (this._padAt && now - this._padAt < 12) return;
    this._padAt = now;
    this._pollPad();
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }

  reset() {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
  }

  static keyFor(action) {
    const codes = BINDS[action] || [];
    return codes.map((c) => c.replace('Key', '').replace('Digit', '').replace('Mouse', '鼠标')).join(' / ') || '—';
  }
}

export function keyLabel(action) { return Input.keyFor(action); }
export function mouseInCanvas(el, clientX, clientY) {
  const r = el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}
export const zoomClamp = (v) => clamp(v, 2.0, 9.0);
