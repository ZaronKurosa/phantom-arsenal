import { clamp } from './MathUtils.js';

/* ------------------------------------------------------------------ */
/* One Euro filter: adaptive low-pass (smooth at rest, quick in motion) */
/* ------------------------------------------------------------------ */

const alphaFor = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

export class OneEuroFilter {
  constructor(minCutoff = 1.5, beta = 10, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xf = new LowPass();
    this.dxf = new LowPass();
    this.prev = null;
  }

  filter(x, dt) {
    dt = Math.max(dt, 1e-3);
    const dx = this.prev === null ? 0 : (x - this.prev) / dt;
    this.prev = x;
    const edx = this.dxf.filter(dx, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xf.filter(x, alphaFor(cutoff, dt));
  }

  reset() {
    this.xf.reset();
    this.dxf.reset();
    this.prev = null;
  }
}

/** Smooths the 21 MediaPipe landmarks of one hand (x, y, z each). */
export class LandmarkSmoother {
  constructor(minCutoff = 1.6, beta = 14) {
    this.filters = Array.from({ length: 21 }, () => [
      new OneEuroFilter(minCutoff, beta),
      new OneEuroFilter(minCutoff, beta),
      new OneEuroFilter(minCutoff, beta),
    ]);
  }

  smooth(landmarks, dt) {
    return landmarks.map((p, i) => ({
      x: this.filters[i][0].filter(p.x, dt),
      y: this.filters[i][1].filter(p.y, dt),
      z: this.filters[i][2].filter(p.z ?? 0, dt),
    }));
  }

  reset() {
    for (const f of this.filters) for (const g of f) g.reset();
  }
}

/* ------------------------------------------------------------------ */
/* Velocity based smoothing (critically damped spring, Unity-style)     */
/* ------------------------------------------------------------------ */

/**
 * Smoothly moves a scalar toward a target with continuous velocity.
 * `state.v` holds the velocity. Returns the new value.
 */
export function smoothDamp(current, target, state, smoothTime, dt, maxSpeed = Infinity) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const originalTo = target;
  const maxChange = maxSpeed * smoothTime;
  change = clamp(change, -maxChange, maxChange);
  target = current - change;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  if (originalTo - current > 0 === out > originalTo) {
    out = originalTo;
    state.v = (out - originalTo) / dt;
  }
  return out;
}

const _sx = { v: 0 };
const _sy = { v: 0 };
const _sz = { v: 0 };

/** smoothDamp for any {x,y,z} position and velocity objects (mutates both). */
export function smoothDampVec3(cur, target, vel, smoothTime, dt, maxSpeed = Infinity) {
  _sx.v = vel.x;
  _sy.v = vel.y;
  _sz.v = vel.z;
  cur.x = smoothDamp(cur.x, target.x, _sx, smoothTime, dt, maxSpeed);
  cur.y = smoothDamp(cur.y, target.y, _sy, smoothTime, dt, maxSpeed);
  cur.z = smoothDamp(cur.z, target.z, _sz, smoothTime, dt, maxSpeed);
  vel.x = _sx.v;
  vel.y = _sy.v;
  vel.z = _sz.v;
  return cur;
}

/** Smooths an angle without wrap-around jumps (value is kept unwrapped). */
export class AngleSmoother {
  constructor(minCutoff = 1.4, beta = 6) {
    this.f = new OneEuroFilter(minCutoff, beta);
    this.last = null;
    this.unwrapped = 0;
  }
  filter(angle, dt) {
    if (this.last === null) {
      this.unwrapped = angle;
    } else {
      let d = angle - this.last;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.unwrapped += d;
    }
    this.last = angle;
    return this.f.filter(this.unwrapped, dt);
  }
  reset() {
    this.f.reset();
    this.last = null;
  }
}
