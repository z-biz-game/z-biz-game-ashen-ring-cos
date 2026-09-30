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
    // 触摸分区：左侧这条带是移动摇杆，其余是转视角/点按。
    this.stickZone = 0.42;
    this.tapSlop = 14;      // CSS px；小于这段位移的点按算"出招"，不算转视角
    this.tapMs = 320;
    this.touchLookScale = 1.8;
    // 指针事件优先：一套代码同时覆盖鼠标、触摸、触控笔，且 pointerId 能把多指分清楚
    // （左手摇杆 + 右手转视角必须并行）。状态放构造函数：无 window 的 headless 也要能查询。
    this._tp = new Map();               // pointerId -> {mode, ...}
    this._stick = { x: 0, y: 0 };
    this._stickTouch = null;
    this._touchDown = new Set();
    this._touchPressed = new Set();
    this.isTouch = false;

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

    // 指针事件优先：一套代码同时覆盖鼠标、触摸、触控笔，且 pointerId 能把多指分清楚
    // （左手摇杆 + 右手转视角必须并行）。老 Safari 没有 PointerEvent，那里走下面的回落。
    this.isTouch = (navigator.maxTouchPoints || 0) > 0;
    const hasPointer = typeof window.PointerEvent === 'function' || ('onpointerdown' in window);

    if (hasPointer) {
      this.canvas.addEventListener('pointerdown', (e) => this._pointerDown(e));
      window.addEventListener('pointermove', (e) => this._pointerMove(e));
      window.addEventListener('pointerup', (e) => this._pointerEnd(e));
      window.addEventListener('pointercancel', (e) => this._pointerEnd(e));
    } else {
      // 回落路径。两条都要：mousedown 保住老桌面浏览器，touchstart 保住老 iOS/Android。
      this.canvas.addEventListener('mousedown', (e) => this._mouseDown(e));
      this.canvas.addEventListener('touchstart', (e) => {
        for (const t of e.changedTouches || []) {
          this._pointerDown({ pointerId: t.identifier, pointerType: 'touch', clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
        }
      }, { passive: false });
      this.canvas.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches || []) {
          this._pointerMove({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
        }
      }, { passive: false });
      const end = (e) => {
        for (const t of e.changedTouches || []) this._pointerEnd({ pointerId: t.identifier });
      };
      this.canvas.addEventListener('touchend', end);
      this.canvas.addEventListener('touchcancel', end);
      window.addEventListener('mouseup', (e) => { this.down.delete('mouse' + e.button); });
    }
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

  // 画布是被 CSS 缩放渲染的（手机上有 transform: scale 与 dpr≠1），所以命中一律用
  // getBoundingClientRect 换算：clientX 减左边再除以 rect 宽度，才是画布的归一化坐标。
  canvasPoint(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { nx: (clientX - r.left) / r.width, ny: (clientY - r.top) / r.height, rect: r };
  }

  _mouseDown(e) { this._pointerDown({ pointerId: 'mouse', pointerType: 'mouse', button: e.button, clientX: e.clientX, clientY: e.clientY, preventDefault: () => e.preventDefault() }); }

  _pointerDown(e) {
    const id = e.pointerId ?? 'mouse';
    const type = e.pointerType || 'mouse';
    const key = 'mouse' + (e.button || 0);
    if (type === 'mouse') { this.down.add(key); this.pressed.add(key); if (e.button === 2) e.preventDefault?.(); }
    // 指针锁在桌面模式下已经占走了鼠标移动，分区只在解锁时（触摸/调试）生效。
    if (this.locked || type === 'mouse') return;
    const p = this.canvasPoint(e.clientX, e.clientY);
    if (!p || p.nx < 0 || p.nx > 1 || p.ny < 0 || p.ny > 1) return;   // 点在 HUD 上，交给 HUD
    e.preventDefault?.();
    const mode = p.nx < this.stickZone ? 'stick' : 'look';
    if (mode === 'stick') {
      if (this._stickTouch != null) this._tp.delete(this._stickTouch);   // 摇杆只认一根手指
      this._stickTouch = id;
      this._stick.x = this._stick.y = 0;
    }
    this._tp.set(id, {
      mode, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY,
      moved: 0, t0: performance.now(), r: Math.max(48, Math.min(p.rect.width, p.rect.height) * 0.18),
    });
  }

  _pointerMove(e) {
    const s = this._tp.get(e.pointerId ?? 'mouse');
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    s.x = e.clientX; s.y = e.clientY;
    s.moved += Math.hypot(dx, dy);
    if (e.pointerType === 'touch') e.preventDefault?.();
    if (s.mode === 'stick') {
      const vx = s.x - s.ox, vy = s.y - s.oy;
      const len = Math.hypot(vx, vy);
      if (len < 1) { this._stick.x = this._stick.y = 0; return; }
      const k = Math.min(1, len / s.r) / len;
      this._stick.x = vx * k; this._stick.y = vy * k;
    } else {
      this.mouseDX += dx * this.touchLookScale;
      this.mouseDY += dy * this.touchLookScale;
    }
  }

  _pointerEnd(e) {
    const id = e.pointerId ?? 'mouse';
    if (e.pointerType === 'mouse') this.down.delete('mouse' + (e.button || 0));
    const s = this._tp.get(id);
    if (!s) return;
    this._tp.delete(id);
    if (s.mode === 'stick') {
      if (this._stickTouch === id) this._stickTouch = null;
      this._stick.x = this._stick.y = 0;
    } else if (s.moved < this.tapSlop && performance.now() - s.t0 < this.tapMs) {
      this.pressed.add('mouse0');      // 短促轻点 = 轻攻击，手机上不用找按钮
    }
  }

  // HUD 触摸按钮走的通道见 touchPress/touchRelease（与 isDown 同一套 action 名）。

  requestLock() {
    if (this.locked) return;
    this.lockRequested = true;
    const p = this.canvas.requestPointerLock?.();
    if (p?.catch) p.catch(() => {});
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  isDown(action) {
    if (this.frozen) return false;
    if (this._touchDown.has(action)) return true;
    for (const code of BINDS[action] || []) if (this.down.has(code)) return true;
    for (const b of this._padButtonsDown(action)) if (this.padButtons.has(b)) return true;
    return false;
  }

  justPressed(action) {
    if (this.frozen) return false;
    for (const code of BINDS[action] || []) if (this.pressed.has(code)) return true;
    if (this._touchPressed.has(action)) return true;
    return this.padPressed.has(action);
  }

  // 一次点按只该出一招：按下时记账，由 endFrame 统一清。
  touchPress(action) { if (action) { this._touchDown.add(action); this._touchPressed.add(action); } }
  touchRelease(action) { if (action) this._touchDown.delete(action); }
  clearTouch() { this._touchDown.clear(); this._touchPressed.clear(); this._tp.clear(); this._stick.x = this._stick.y = 0; this._stickTouch = null; }

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
    const t = this.frozen ? null : this._stick;
    if (t && (t.x || t.y)) { x += t.x; y += t.y; }
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
    this._touchPressed.clear();
    this.wheel = 0;
  }

  reset() {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.clearTouch();
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
