import { Emitter } from '../utils/Emitter.js';
import { createControlState, POSE_LABELS } from './ControlState.js';

/**
 * DEMO input: a scripted "ghost hand" that walks through every mode,
 * formation and animation with no camera or mouse. It speaks the same
 * language as the real inputs (ControlState + events), so the rest of the
 * app can't tell the difference.
 */

const LOOP = 52;

// [time, event, payload]
const SCRIPT = [
  [0.1, 'gameMode', { mode: 'solo' }],
  [3.0, 'spin', { dir: 1 }],
  [5.6, 'dash', { dir: { x: 1, y: 0.15 } }],
  [7.8, 'teleport', {}],
  [10.0, 'gameMode', { mode: 'arsenal' }],
  [12.0, 'swipe', { axis: 'right', dir: { x: 1, y: 0 } }],
  [15.5, 'swipe', { axis: 'right', dir: { x: 1, y: 0 } }],
  [19.0, 'spin', { dir: -1 }],
  [22.0, 'swipe', { axis: 'right', dir: { x: 1, y: 0 } }],
  [24.5, 'dash', { dir: { x: -1, y: 0.2 } }],
  [26.0, 'gameMode', { mode: 'master' }],
  [27.2, 'summon', {}],
  [30.5, 'swipe', { axis: 'left', dir: { x: -1, y: 0 } }],
  [33.5, 'spin', { dir: 1 }],
  [36.0, 'cinematic', {}],
  [43.0, 'swipe', { axis: 'right', dir: { x: 1, y: 0 } }],
  [46.0, 'dash', { dir: { x: 0.6, y: 0.4 } }],
  [48.5, 'teleport', {}],
];

// time windows where the ghost hand does something specific
const FIST_WINDOWS = [[8.2, 9.4], [20.4, 21.6], [38.6, 40]];
const PINCH_WINDOWS = [[6.9, 7.8], [47.7, 48.5]];
const TWO_HAND_WINDOWS = [[28.5, 34.5]];

export class DemoDirector extends Emitter {
  constructor() {
    super();
    this.state = createControlState();
    this.state.source = 'demo';
    this.t = 0;
    this.cursor = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    this.t = 0;
    this.cursor = 0;
  }

  stop() {
    this.running = false;
  }

  _in(wins, t) {
    return wins.some(([a, b]) => t >= a && t < b);
  }

  update(dt) {
    if (!this.running) return this.state;
    this.t += dt;
    const t = this.t % LOOP;
    if (this.t >= LOOP) {
      this.t -= LOOP;
      this.cursor = 0;
    }
    while (this.cursor < SCRIPT.length && SCRIPT[this.cursor][0] <= this.t) {
      const [, name, payload] = SCRIPT[this.cursor++];
      this.emit(name, payload);
    }

    const s = this.state;
    const p = s.primary;
    const q = s.secondary;
    const T = this.t;
    p.present = true;
    p.pos.x = Math.sin(T * 0.52) * 0.55 + Math.sin(T * 1.1) * 0.08;
    p.pos.y = Math.sin(T * 0.37 + 1) * 0.28 + 0.05;
    p.depth = 0.5 + 0.22 * Math.sin(T * 0.23);
    p.roll = Math.sin(T * 0.6) * 0.45;
    const fist = this._in(FIST_WINDOWS, T);
    const pinch = this._in(PINCH_WINDOWS, T);
    p.pose = pinch ? 'pinch' : fist ? 'fist' : 'open';
    p.spread = 0.5 + 0.5 * Math.sin(T * 0.45 - 0.6);
    p.pinch = pinch ? 1 : 0;
    p.score = 1;

    const two = this._in(TWO_HAND_WINDOWS, T);
    q.present = two;
    if (two) {
      q.pos.x = -p.pos.x * 0.9 - 0.2;
      q.pos.y = p.pos.y * 0.8 + 0.1;
      q.depth = p.depth;
      q.roll = -p.roll;
      q.spread = 0.5 + 0.5 * Math.sin(T * 0.7);
      q.pose = 'open';
    }
    s.active = true;
    s.twoHands = two;
    s.handsDistance = two ? Math.hypot(p.pos.x - q.pos.x, p.pos.y - q.pos.y) : 0;
    s.handsCenter.x = two ? (p.pos.x + q.pos.x) / 2 : p.pos.x;
    s.handsCenter.y = two ? (p.pos.y + q.pos.y) / 2 : p.pos.y;
    s.label = two ? 'TWO HANDS' : POSE_LABELS[p.pose];
    return s;
  }
}
