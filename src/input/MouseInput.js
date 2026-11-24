import { Emitter } from '../utils/Emitter.js';
import { clamp, damp } from '../utils/MathUtils.js';
import { createControlState, POSE_LABELS } from './ControlState.js';

/**
 * Mouse source. Produces the same ControlState as the camera.
 *
 *   move            sword follows the cursor
 *   wheel           depth   (Alt + wheel = formation spread)
 *   hold left       follow mode (fist)
 *   tap left        dash toward the cursor (second tap within 320 ms = summon)
 *   hold Shift      precision mode (pinch); release Shift = teleport
 *   right click     spin
 *   middle click    cinematic formation
 *   A / D           rotate wrist,  Q / E collapse / expand,  T twin hands
 *
 * Listeners are attached only while the mouse is the active input so the
 * camera and the mouse can never fight over the sword.
 */
export class MouseInput extends Emitter {
  constructor(target) {
    super();
    this.target = target;
    this.state = createControlState();
    this.state.source = 'mouse';
    this.attached = false;

    this.ndc = { x: 0, y: 0 };
    this.depth = 0.5;
    this.depthTarget = 0.5;
    this.spread = 0.55;
    this.roll = 0;
    this.keys = new Set();
    this.leftDown = false;
    this.downAt = 0;
    this.downPos = { x: 0, y: 0 };
    this.lastTapAt = -1e9;
    this.shift = false;
    this.shiftSince = 0;
    this.twin = false;
    this.hasMoved = false;

    this._h = {
      move: (e) => this._onMove(e),
      down: (e) => this._onDown(e),
      up: (e) => this._onUp(e),
      wheel: (e) => this._onWheel(e),
      ctx: (e) => e.preventDefault(),
      keydown: (e) => this._onKey(e, true),
      keyup: (e) => this._onKey(e, false),
      blur: () => this._releaseAll(),
    };
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    const t = this.target;
    window.addEventListener('pointermove', this._h.move);
    t.addEventListener('pointerdown', this._h.down);
    window.addEventListener('pointerup', this._h.up);
    t.addEventListener('wheel', this._h.wheel, { passive: false });
    t.addEventListener('contextmenu', this._h.ctx);
    window.addEventListener('keydown', this._h.keydown);
    window.addEventListener('keyup', this._h.keyup);
    window.addEventListener('blur', this._h.blur);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    const t = this.target;
    window.removeEventListener('pointermove', this._h.move);
    t.removeEventListener('pointerdown', this._h.down);
    window.removeEventListener('pointerup', this._h.up);
    t.removeEventListener('wheel', this._h.wheel);
    t.removeEventListener('contextmenu', this._h.ctx);
    window.removeEventListener('keydown', this._h.keydown);
    window.removeEventListener('keyup', this._h.keyup);
    window.removeEventListener('blur', this._h.blur);
    this._releaseAll();
  }

  _releaseAll() {
    this.keys.clear();
    this.leftDown = false;
    if (this.shift) this._endShift();
  }

  _ndcFrom(e) {
    const r = this.target.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.1, 1.1),
      y: clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1.1, 1.1),
    };
  }

  _onMove(e) {
    const p = this._ndcFrom(e);
    this.ndc.x = p.x;
    this.ndc.y = p.y;
    this.hasMoved = true;
    if (e.shiftKey && !this.shift) this._startShift();
  }

  _onDown(e) {
    const p = this._ndcFrom(e);
    this.ndc.x = p.x;
    this.ndc.y = p.y;
    this.hasMoved = true;
    const now = performance.now();
    if (e.button === 0) {
      this.leftDown = true;
      this.downAt = now;
      this.downPos = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2) {
      e.preventDefault();
      this.emit('spin', { dir: Math.random() < 0.5 ? 1 : -1 });
    } else if (e.button === 1) {
      e.preventDefault();
      this.emit('cinematic', {});
    }
  }

  _onUp(e) {
    if (e.button !== 0 || !this.leftDown) return;
    this.leftDown = false;
    const now = performance.now();
    const held = now - this.downAt;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    if (held < 260 && moved < 14) {
      if (now - this.lastTapAt < 320) {
        // double click -> summon / recall (replaces the second dash)
        this.lastTapAt = -1e9;
        this.emit('summon', {});
      } else {
        this.lastTapAt = now;
        this.emit('dash', { toward: { x: this.ndc.x, y: this.ndc.y } });
      }
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = clamp(e.deltaY, -120, 120);
    if (e.altKey) {
      this.spread = clamp(this.spread - delta * 0.0025, 0, 1);
      this.emit('spreadSet', { value: this.spread });
    } else {
      this.depthTarget = clamp(this.depthTarget - delta * 0.0014, 0, 1);
    }
  }

  _startShift() {
    this.shift = true;
    this.shiftSince = performance.now();
  }

  _endShift() {
    const held = performance.now() - this.shiftSince;
    this.shift = false;
    if (held > 120) this.emit('teleport', { pos: { x: this.ndc.x, y: this.ndc.y } });
  }

  _onKey(e, down) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (down && (tag === 'input' || tag === 'textarea' || tag === 'select')) return; // typing in the Gesture Lab
    if (e.key === 'Shift') {
      if (down && !this.shift) this._startShift();
      else if (!down && this.shift) this._endShift();
      return;
    }
    const k = e.key.toLowerCase();
    if (down) {
      this.keys.add(k);
      if (k === 'q' && !e.repeat) {
        this.spread = clamp(this.spread - 0.15, 0, 1);
        this.emit('spreadSet', { value: this.spread });
      }
      if (k === 'e' && !e.repeat) {
        this.spread = clamp(this.spread + 0.15, 0, 1);
        this.emit('spreadSet', { value: this.spread });
      }
      if (k === 't' && !e.repeat) {
        this.twin = !this.twin;
        this.emit('twin', { on: this.twin });
      }
    } else {
      this.keys.delete(k);
    }
  }

  update(dt) {
    const s = this.state;
    // held keys: continuous spread / roll
    if (this.keys.has('q') || this.keys.has('e')) {
      const dir = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
      this.spread = clamp(this.spread + dir * dt * 0.5, 0, 1);
    }
    const rollIn = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    if (rollIn) this.roll = clamp(this.roll + rollIn * dt * 2.2, -1.5, 1.5);
    else this.roll = damp(this.roll, 0, 3, dt);

    this.depth = damp(this.depth, this.depthTarget, 9, dt);

    const p = s.primary;
    p.present = this.hasMoved;
    p.pos.x = this.ndc.x;
    p.pos.y = this.ndc.y;
    p.depth = this.depth;
    p.roll = this.roll;
    p.spread = this.spread;
    p.pose = this.shift ? 'pinch' : this.leftDown ? 'fist' : 'open';
    p.pinch = this.shift ? 1 : 0;
    p.score = 1;

    const q = s.secondary;
    q.present = this.twin && this.hasMoved;
    if (q.present) {
      q.pos.x = -this.ndc.x;
      q.pos.y = this.ndc.y;
      q.depth = this.depth;
      q.roll = -this.roll;
      q.spread = this.spread;
      q.pose = p.pose === 'pinch' ? 'open' : p.pose;
    }

    s.active = p.present;
    s.twoHands = p.present && q.present;
    s.handsDistance = s.twoHands ? Math.hypot(p.pos.x - q.pos.x, p.pos.y - q.pos.y) : 0;
    s.handsCenter.x = s.twoHands ? (p.pos.x + q.pos.x) / 2 : p.pos.x;
    s.handsCenter.y = s.twoHands ? (p.pos.y + q.pos.y) / 2 : p.pos.y;
    const MOUSE_LABELS = { open: 'HOVER', fist: 'FOLLOW', pinch: 'PRECISION' };
    s.label = s.twoHands ? 'TWIN HANDS' : s.active ? MOUSE_LABELS[p.pose] || POSE_LABELS[p.pose] : 'MOVE THE MOUSE';
    return s;
  }
}
