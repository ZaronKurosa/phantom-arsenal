import * as THREE from 'three';
import { clamp, wrapAngle } from '../utils/MathUtils.js';
import { FLOOR_Y } from '../scene/SceneManager.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const MIN_SEPARATION = 0.7; // world units: the two daggers never sit on the same spot
const SYNC_SPEED = 1.4; // both daggers must be moving at least this fast to count as "together"

/**
 * TwinDaggerController: two-handed control of the two Void Daggers.
 *
 * The LEFT dagger belongs to the LEFT hand, the RIGHT dagger to the RIGHT hand.
 * Each dagger gets its own target, smoothing, roll and pose-dependent
 * behaviour, computed only from its own hand. One hand moving never moves the
 * other dagger.
 *
 * Camera / demo   hand.side ('Left' | 'Right') says which dagger a hand wields.
 *                 With one hand tracked only that hand's dagger follows; the
 *                 other keeps floating at its resting spot.
 * Mouse           (one pointer, so the buttons choose which dagger it holds)
 *                   no button   both daggers follow as a mirrored pair (synchronised)
 *                   hold LMB    the RIGHT dagger follows, the left stays where it was
 *                   hold RMB    the LEFT dagger follows, the right stays where it was
 *                   both held   both follow (mirrored)
 *                 A / D roll, wheel = depth, tap = that dagger's action (see MouseInput).
 *
 * "Synchronised" animations: when both hands move together (similar velocity,
 * both fast) the daggers link: glow rises and a violet arc is drawn between them.
 */
export class TwinDaggerController {
  constructor(controller) {
    this.c = controller;
    this.sm = controller.sm;
    this.fx = controller.fx;
    this.parked = { Left: new THREE.Vector3(-1.6, 0.4, 0.6), Right: new THREE.Vector3(1.6, 0.4, 0.6) };
    this.drive = { Left: 'idle', Right: 'idle' }; // what moves each dagger this frame (read by tests / HUD)
    this.sync = 0; // 0..1
    this._arc = 0;
    this._pinch = { Left: null, Right: null };
  }

  daggers() {
    return { Right: this.c.main, Left: this.c.partner };
  }

  /** world-space rest positions used before a hand shows up */
  reset() {
    this.parked.Left.set(-1.6, 0.4, 0.6);
    this.parked.Right.set(1.6, 0.4, 0.6);
    this.sync = 0;
  }

  /** Which tracked hand (if any) wields each dagger. */
  _assign(ctl) {
    const out = { Left: null, Right: null };
    if (ctl.source === 'mouse') return out;
    for (const h of [ctl.primary, ctl.secondary]) {
      if (!h.present) continue;
      const side = h.side === 'Left' ? 'Left' : 'Right';
      if (!out[side]) out[side] = h;
    }
    return out;
  }

  update(dt, time, ctl) {
    const d = this.daggers();
    const hands = this._assign(ctl);
    const ctrl = this.c.weapons.control;

    if (ctl.source === 'mouse') this._mouse(ctl, d, time);
    else {
      for (const side of ['Left', 'Right']) {
        const h = hands[side];
        if (ctl.active && h) this._follow(d[side], side, h, dt, time);
        else this._idle(d[side], side, time);
      }
    }

    // keep the pair apart
    const L = d.Left;
    const R = d.Right;
    _a.copy(R.target).sub(L.target);
    _a.z = 0;
    const gap = _a.length();
    if (gap < MIN_SEPARATION) {
      const push = (MIN_SEPARATION - gap) / 2;
      _a.set(gap > 1e-3 ? _a.x / gap : 1, gap > 1e-3 ? _a.y / gap : 0, 0);
      R.target.addScaledVector(_a, push);
      L.target.addScaledVector(_a, -push);
    }
    for (const s of [L, R]) s.target.y = Math.max(s.target.y, FLOOR_Y + 1.5);

    this._sync(L, R, dt, time);
    this.drive.ctrl = ctrl;
  }

  /* ------------------------------ camera ------------------------------ */

  _follow(s, side, h, dt, time) {
    this.sm.worldFromNDC(h.pos.x, h.pos.y, h.depth, _b);
    s.target.copy(_b);
    this.parked[side].copy(_b);
    const fist = h.pose === 'fist';
    const pinch = h.pose === 'pinch';
    s.smoothTime = pinch ? 0.05 : fist ? 0.065 : 0.2;
    s.floatWeight = pinch ? 0.1 : fist ? 0.15 : 1;
    s.glowTarget = pinch ? 1.0 : fist ? 0.95 : 0.55;
    s.idleSpinSpeed = fist ? 0.12 : 0.7;
    this.drive[side] = side === 'Left' ? 'left-hand' : 'right-hand';
    this._orient(s, side, h.roll, true, time);
  }

  _idle(s, side, time) {
    // parked where the hand last was, with a slow drift so it never looks frozen
    const p = this.parked[side];
    s.target.set(p.x + Math.sin(time * 0.5 + (side === 'Left' ? 0 : 2)) * 0.12, p.y + Math.sin(time * 0.7 + (side === 'Left' ? 1 : 3)) * 0.1, p.z);
    s.smoothTime = 0.45;
    s.floatWeight = 1;
    s.glowTarget = 0.5;
    s.idleSpinSpeed = 0.7;
    this.drive[side] = 'idle';
    this._orient(s, side, 0, false, time);
  }

  _orient(s, side, roll, active, time) {
    if (time < (s.orientLockUntil || 0)) return;
    const lean = clamp(s.vel.x * 0.06, -0.7, 0.7);
    const outward = side === 'Left' ? 0.08 : -0.08; // blades splay slightly apart
    s.setUpright((active ? clamp(wrapAngle(roll), -1.5, 1.5) : 0) + lean + outward, 0, -s.pos.x * 0.03);
  }

  /* ------------------------------- mouse ------------------------------- */

  _mouse(ctl, d, time) {
    const h = ctl.primary;
    const b = ctl.buttons || { left: false, right: false };
    const idleHold = !b.left && !b.right;
    const rightOn = idleHold || b.left; // LMB holds the right dagger
    const leftOn = idleHold || b.right; // RMB holds the left dagger
    const both = rightOn && leftOn;
    const cursor = this.sm.worldFromNDC(h.pos.x, h.pos.y, h.depth, new THREE.Vector3());
    const mirrored = this.sm.worldFromNDC(-h.pos.x, h.pos.y, h.depth, new THREE.Vector3());

    const apply = (side, on, pos, roll) => {
      const s = d[side];
      if (ctl.active && on) {
        s.target.copy(pos);
        this.parked[side].copy(pos);
        const held = !idleHold;
        s.smoothTime = h.pose === 'pinch' ? 0.05 : held ? 0.065 : 0.2;
        s.floatWeight = held ? 0.15 : 1;
        s.glowTarget = held ? 0.95 : 0.55;
        s.idleSpinSpeed = held ? 0.12 : 0.7;
        this.drive[side] = both ? 'mouse-pair' : 'mouse';
        this._orient(s, side, roll, true, time);
      } else this._idle(s, side, time);
    };
    apply('Right', rightOn, cursor, h.roll);
    apply('Left', leftOn, both ? mirrored : cursor, both ? -h.roll : h.roll);
  }

  /* ----------------------------- synchronised ----------------------------- */

  _sync(L, R, dt, time) {
    const both = this.drive.Left !== 'idle' && this.drive.Right !== 'idle';
    let target = 0;
    if (both) {
      const sl = L.vel.length();
      const sr = R.vel.length();
      if (sl > SYNC_SPEED && sr > SYNC_SPEED) {
        // same direction in screen space, mirrored counts too (moving apart / together together)
        const dot = (L.vel.x * R.vel.x + L.vel.y * R.vel.y) / (sl * sr);
        const dotMirror = (-L.vel.x * R.vel.x + L.vel.y * R.vel.y) / (sl * sr);
        const ratio = Math.min(sl, sr) / Math.max(sl, sr);
        if ((dot > 0.8 || dotMirror > 0.8) && ratio > 0.5) target = 1;
      }
    }
    this.sync += (target - this.sync) * Math.min(1, dt * (target > this.sync ? 6 : 3));
    this.synced = this.sync > 0.6;
    if (this.sync > 0.15) {
      for (const s of [L, R]) s.glowTarget = Math.max(s.glowTarget, 0.7 + 0.45 * this.sync);
      this._arc -= dt;
      if (this._arc <= 0) {
        this._arc = 0.06;
        this.fx.streak(L.group.position, R.group.position, L.color, 3, 0.07);
      }
    }
  }
}
