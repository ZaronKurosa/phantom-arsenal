import { Emitter } from '../utils/Emitter.js';
import { clamp, remap } from '../utils/MathUtils.js';
import { createControlState, resetHandState, POSE_LABELS } from '../input/ControlState.js';

/**
 * Turns raw smoothed landmarks into:
 *   1. a ControlState (position, depth, roll, pose, spread, pinch, two-hand data)
 *   2. discrete gesture events with cooldowns:
 *        'swipe' {dir, axis}      fast move with an open palm
 *        'dash'  {dir, axis}      fast move with any other pose
 *        'spin'  {dir}            fast wrist rotation
 *        'pinchStart' / 'teleport' {pos}   pinch and release
 *        'cinematic'              both open palms held together
 *        'pose' {hand, pose, prev}
 *
 * False-trigger protection: poses must be stable for several frames, pinch
 * uses hysteresis, every event has its own cooldown, and events are suppressed
 * while the hand has been tracked for less than a short warm-up period.
 */

const FINGERS = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
]; // [MCP, TIP]

const CFG = {
  poseStableFrames: 3,
  warmupMs: 350,
  lostGraceMs: 260,
  pinchEnter: 0.4,
  pinchExit: 0.58,
  pinchMinHoldMs: 120,
  swipeWindowMs: 260,
  swipeMinDist: 0.5,
  swipeMinSpeed: 2.4,
  swipeCooldownMs: 850,
  dashCooldownMs: 650,
  spinWindowMs: 480,
  spinMinAngle: 1.75,
  spinCooldownMs: 1300,
  teleportCooldownMs: 600,
  cinematicHoldMs: 500,
  cinematicCooldownMs: 4200,
  reach: 1.3, // amplify palm travel so the whole stage is reachable
  depthMin: 0.09, // apparent hand size => far
  depthMax: 0.32, // apparent hand size => near
};

class HandAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.pose = 'none';
    this.candidate = 'none';
    this.candidateFrames = 0;
    this.pinchActive = false;
    this.pinchSince = 0;
    this.firstSeen = 0;
    this.lastSeen = 0;
    this.history = []; // {t, x, y}
    this.rollHistory = []; // {t, a}
    this.rollUnwrapped = 0;
    this.lastRoll = null;
    this.spread = 0.5;
    this.prev = null;
    this.vx = 0;
    this.vy = 0;
    this.present = false;
  }
}

const d2 = (lm, a, b, aspect) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);

export class GestureRecognizer extends Emitter {
  constructor() {
    super();
    this.state = createControlState();
    this.state.source = 'camera';
    this.analyzers = { Left: new HandAnalyzer(), Right: new HandAnalyzer() };
    this.cooldowns = { swipe: 0, dash: 0, spin: 0, teleport: 0, cinematic: 0 };
    this.twoOpenSince = 0;
    this.twoOpenFired = false;
    this.twoOpenLost = 0;
  }

  reset() {
    for (const a of Object.values(this.analyzers)) a.reset();
    resetHandState(this.state.primary);
    resetHandState(this.state.secondary);
    this.state.active = false;
    this.state.twoHands = false;
    this.state.label = POSE_LABELS.none;
    this.twoOpenSince = 0;
    this.twoOpenFired = false;
  }

  /**
   * @param {Array} hands output of HandTracker 'hands'
   * @param {number} now performance.now() in ms
   * @param {number} aspect video width/height
   */
  update(hands, now, aspect = 16 / 9) {
    const seenSides = new Set();
    const features = {};

    for (const hand of hands) {
      const an = this.analyzers[hand.side];
      if (!an) continue;
      seenSides.add(hand.side);
      features[hand.side] = this._analyze(an, hand, now, aspect);
    }

    // Hands that disappeared: keep them for a short grace period.
    for (const side of ['Left', 'Right']) {
      const an = this.analyzers[side];
      if (!seenSides.has(side) && an.present && now - an.lastSeen > CFG.lostGraceMs) {
        const prev = an.pose;
        an.reset();
        if (prev !== 'none') this.emit('pose', { hand: side, pose: 'none', prev });
      }
    }

    const left = this.analyzers.Left.present ? this.analyzers.Left : null;
    const right = this.analyzers.Right.present ? this.analyzers.Right : null;

    // Right hand drives the main sword; left hand drives the formation.
    const primaryAn = right || left;
    const secondaryAn = right && left ? left : null;
    const primarySide = right ? 'Right' : 'Left';
    const secondarySide = 'Left';

    const st = this.state;
    this._write(st.primary, primaryAn, features[primarySide] || this._lastFeatures?.[primarySide]);
    this._write(st.secondary, secondaryAn, features[secondarySide] || this._lastFeatures?.[secondarySide]);
    this._lastFeatures = { ...(this._lastFeatures || {}), ...features };

    st.active = st.primary.present;
    st.twoHands = st.primary.present && st.secondary.present;
    if (st.twoHands) {
      st.handsDistance = Math.hypot(st.primary.pos.x - st.secondary.pos.x, st.primary.pos.y - st.secondary.pos.y);
      st.handsCenter.x = (st.primary.pos.x + st.secondary.pos.x) / 2;
      st.handsCenter.y = (st.primary.pos.y + st.secondary.pos.y) / 2;
    } else {
      st.handsDistance = 0;
      st.handsCenter.x = st.primary.pos.x;
      st.handsCenter.y = st.primary.pos.y;
    }
    st.label = st.twoHands ? 'TWO HANDS' : POSE_LABELS[st.primary.pose] || POSE_LABELS.none;

    this._updateCinematic(now);
    return st;
  }

  _analyze(an, hand, now, aspect) {
    const lm = hand.landmarks;
    const wasPresent = an.present;
    if (!wasPresent) {
      an.firstSeen = now;
      an.history.length = 0;
      an.rollHistory.length = 0;
      an.lastRoll = null;
      an.prev = null;
    }
    an.present = true;
    an.lastSeen = now;

    /* ---------- finger extension ---------- */
    const wristToMcp = (i) => d2(lm, 0, i, aspect) || 1e-4;
    const ext = FINGERS.map(([mcp, tip]) => {
      const r = d2(lm, 0, tip, aspect) / wristToMcp(mcp);
      return clamp(remap(r, 1.15, 1.8, 0, 1), 0, 1);
    });
    const extCount = ext.filter((e) => e > 0.5).length;
    const palmWidth = d2(lm, 5, 17, aspect) || 1e-4;

    /* ---------- pinch with hysteresis ---------- */
    const pinchRatio = d2(lm, 4, 8, aspect) / palmWidth;
    const indexUsable = ext[0] > 0.2; // a tight fist curls the index fully
    let pinching = an.pinchActive;
    if (!an.pinchActive && pinchRatio < CFG.pinchEnter && indexUsable) pinching = true;
    else if (an.pinchActive && (pinchRatio > CFG.pinchExit || ext[0] < 0.08)) pinching = false;
    const pinchAmount = clamp(remap(pinchRatio, CFG.pinchExit, 0.15, 0, 1), 0, 1);

    /* ---------- raw pose ---------- */
    let raw;
    if (pinching) raw = 'pinch';
    else if (extCount >= 3) raw = 'open';
    else if (extCount === 0) raw = 'fist';
    else if (extCount === 1 && ext[0] > 0.5) raw = 'point';
    else if (extCount === 1) raw = 'fist';
    else raw = 'neutral';

    if (raw === an.candidate) an.candidateFrames++;
    else {
      an.candidate = raw;
      an.candidateFrames = 1;
    }
    if (an.candidate !== an.pose && an.candidateFrames >= CFG.poseStableFrames) {
      const prev = an.pose;
      // pinch transitions use the immediate detector for crisp pinch/release timing
      an.pose = an.candidate;
      this._onPoseChange(an, hand.side, prev, now);
    }
    an.pinchActive = pinching;

    /* ---------- spread (only updated while the palm is open) ---------- */
    if (an.pose === 'open') {
      const s = (d2(lm, 8, 12, aspect) + d2(lm, 12, 16, aspect) + d2(lm, 16, 20, aspect)) / 3 / palmWidth;
      const target = clamp(remap(s, 0.3, 0.95, 0, 1), 0, 1);
      an.spread += (target - an.spread) * 0.35;
    }

    /* ---------- palm position / depth / roll ---------- */
    let px = 0;
    let py = 0;
    for (const i of [0, 5, 9, 13, 17]) {
      px += lm[i].x;
      py += lm[i].y;
    }
    px /= 5;
    py /= 5;
    const x = clamp((px - 0.5) * 2 * CFG.reach, -1.15, 1.15);
    const y = clamp(-(py - 0.5) * 2 * CFG.reach, -1.15, 1.15);
    const depth = clamp(remap(hand.handSize, CFG.depthMin, CFG.depthMax, 0, 1), 0, 1);

    // Roll: angle of wrist -> middle-MCP vector relative to vertical.
    const rdx = (lm[9].x - lm[0].x) * aspect;
    const rdy = lm[9].y - lm[0].y;
    const roll = Math.atan2(rdx, -rdy);
    if (an.lastRoll === null) an.rollUnwrapped = roll;
    else {
      let dr = roll - an.lastRoll;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      an.rollUnwrapped += dr;
    }
    an.lastRoll = roll;

    /* ---------- velocity ---------- */
    if (an.prev) {
      const dt = Math.max(0.008, (now - an.prev.t) / 1000);
      const vx = (x - an.prev.x) / dt;
      const vy = (y - an.prev.y) / dt;
      an.vx += (vx - an.vx) * 0.4;
      an.vy += (vy - an.vy) * 0.4;
    }
    an.prev = { t: now, x, y };

    /* ---------- motion events ---------- */
    const warmed = now - an.firstSeen > CFG.warmupMs;
    an.history.push({ t: now, x, y });
    while (an.history.length && now - an.history[0].t > CFG.swipeWindowMs) an.history.shift();
    an.rollHistory.push({ t: now, a: an.rollUnwrapped });
    while (an.rollHistory.length && now - an.rollHistory[0].t > CFG.spinWindowMs) an.rollHistory.shift();

    if (warmed && hand.side === (this.analyzers.Right.present ? 'Right' : 'Left')) {
      this._detectSwipe(an, now);
      this._detectSpin(an, now);
    }

    return { x, y, depth, roll: an.rollUnwrapped, pinch: pinchAmount, score: hand.score };
  }

  _onPoseChange(an, side, prev, now) {
    const primarySide = this.analyzers.Right.present ? 'Right' : 'Left';
    if (side === primarySide) {
      if (an.pose === 'pinch') {
        an.pinchSince = now;
        this.emit('pinchStart', { pos: an.prev ? { x: an.prev.x, y: an.prev.y } : { x: 0, y: 0 } });
      } else if (prev === 'pinch') {
        const held = now - an.pinchSince;
        if (held >= CFG.pinchMinHoldMs && now > this.cooldowns.teleport && now - an.firstSeen > CFG.warmupMs) {
          this.cooldowns.teleport = now + CFG.teleportCooldownMs;
          this.emit('teleport', { pos: an.prev ? { x: an.prev.x, y: an.prev.y } : { x: 0, y: 0 } });
        } else {
          this.emit('pinchCancel', {});
        }
      }
    }
    this.emit('pose', { hand: side, pose: an.pose, prev });
  }

  _detectSwipe(an, now) {
    if (an.pose === 'pinch' || an.history.length < 4) return;
    const first = an.history[0];
    const last = an.history[an.history.length - 1];
    const dtw = (last.t - first.t) / 1000;
    if (dtw < 0.07) return;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dist = Math.hypot(dx, dy);
    const speed = dist / dtw;
    if (dist < CFG.swipeMinDist || speed < CFG.swipeMinSpeed) return;

    const isSwipe = an.pose === 'open';
    const key = isSwipe ? 'swipe' : 'dash';
    if (now < this.cooldowns[key]) return;
    this.cooldowns[key] = now + (isSwipe ? CFG.swipeCooldownMs : CFG.dashCooldownMs);
    // Don't double-fire swipe + dash for the same motion.
    this.cooldowns[isSwipe ? 'dash' : 'swipe'] = Math.max(this.cooldowns[isSwipe ? 'dash' : 'swipe'], now + 400);

    const axis = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'up' : 'down';
    this.emit(key, { dir: { x: dx / dist, y: dy / dist }, axis, speed });
    an.history.length = 0;
  }

  _detectSpin(an, now) {
    if (an.pose === 'pinch' || an.rollHistory.length < 4 || now < this.cooldowns.spin) return;
    const delta = an.rollHistory[an.rollHistory.length - 1].a - an.rollHistory[0].a;
    if (Math.abs(delta) < CFG.spinMinAngle) return;
    this.cooldowns.spin = now + CFG.spinCooldownMs;
    this.emit('spin', { dir: Math.sign(delta) });
    an.rollHistory.length = 0;
  }

  _updateCinematic(now) {
    const l = this.analyzers.Left;
    const r = this.analyzers.Right;
    const bothOpen = l.present && r.present && l.pose === 'open' && r.pose === 'open';
    if (bothOpen) {
      this.twoOpenLost = 0;
      if (!this.twoOpenSince) this.twoOpenSince = now;
      if (!this.twoOpenFired && now - this.twoOpenSince > CFG.cinematicHoldMs && now > this.cooldowns.cinematic) {
        this.twoOpenFired = true;
        this.cooldowns.cinematic = now + CFG.cinematicCooldownMs;
        this.emit('cinematic', {});
      }
    } else {
      // Require the two-open state to be lost for a moment before re-arming.
      if (!this.twoOpenLost) this.twoOpenLost = now;
      if (now - this.twoOpenLost > 400) {
        this.twoOpenSince = 0;
        this.twoOpenFired = false;
      }
    }
  }

  _write(out, an, f) {
    if (!an || !f) {
      if (out.present) resetHandState(out);
      return;
    }
    out.present = true;
    out.pos.x = f.x;
    out.pos.y = f.y;
    out.vel.x = an.vx;
    out.vel.y = an.vy;
    out.speed = Math.hypot(an.vx, an.vy);
    out.depth = f.depth;
    out.roll = f.roll;
    out.pose = an.pose;
    out.spread = an.spread;
    out.pinch = f.pinch;
    out.score = f.score;
  }
}
