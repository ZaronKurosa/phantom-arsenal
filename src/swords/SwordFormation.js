import * as THREE from 'three';
import { TAU, clamp, damp, easeInOutCubic, lerp } from '../utils/MathUtils.js';

export const FORMATIONS = [
  { id: 'halo', name: 'Halo', speed: 0.28 },
  { id: 'fan', name: 'Crescent Fan', speed: 0 },
  { id: 'orbit', name: 'Orbit', speed: 0.6 },
  { id: 'wings', name: 'Wings', speed: 0 },
  { id: 'helix', name: 'Helix', speed: 0.55 },
];

const _pa = new THREE.Vector3();
const _da = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _db = new THREE.Vector3();

/**
 * Computes slot position + blade direction for sword i of n in a formation.
 * Positions are relative to the formation centre, radius R in world units.
 */
function slotInto(typeIdx, i, n, R, time, phase, spin, p, d) {
  const id = FORMATIONS[typeIdx].id;
  const a = (i / Math.max(1, n)) * TAU + phase;
  const t = n > 1 ? i / (n - 1) : 0.5;
  const zSep = (i - (n - 1) / 2) * 0.06; // avoids z-fighting when collapsed
  switch (id) {
    case 'halo':
      p.set(Math.cos(a) * R, Math.sin(a) * R, zSep);
      d.set(Math.cos(a), Math.sin(a), 0);
      break;
    case 'fan': {
      const ang = lerp(-1.12, 1.12, t) + Math.sin(time * 0.8 + i) * 0.03;
      p.set(Math.sin(ang) * R, Math.cos(ang) * R * 0.45 - R * 0.28, zSep);
      d.set(Math.sin(ang) * 0.9, Math.cos(ang), 0);
      break;
    }
    case 'orbit': {
      const x = Math.cos(a) * R * 1.15;
      const z = Math.sin(a) * R * 1.15;
      p.set(x, z * 0.28 + Math.sin(time * 1.3 + i) * 0.06, z);
      d.set(-Math.sin(a), 0.25, Math.cos(a));
      break;
    }
    case 'wings': {
      const k = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      p.set(side * (0.45 + k * 0.72) * R * 0.55, 0.12 * R + k * 0.19 * R, -0.25 - k * 0.1 + zSep * 0.2);
      d.set(side * (0.16 + 0.13 * k), 1, 0);
      break;
    }
    default: {
      // helix
      const ang = i * 0.85 + phase * 1.5;
      const r = 0.3 + R * 0.28;
      p.set(Math.cos(ang) * r, (t - 0.5) * R * 2.0, Math.sin(ang) * r);
      d.set(Math.cos(ang) * 0.25, 1, Math.sin(ang) * 0.25);
    }
  }
  d.normalize();
  if (spin !== 0) {
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    let x = p.x;
    p.x = x * c - p.y * s;
    p.y = x * s + p.y * c;
    x = d.x;
    d.x = x * c - d.y * s;
    d.y = x * s + d.y * c;
  }
}

/**
 * Formation state: which layout, how expanded, how far it is rotated, and the
 * staggered blend between the previous and the current layout.
 */
export class SwordFormation {
  constructor() {
    this.index = 0;
    this.prevIndex = 0;
    this.spread = 0.55;
    this.spreadTarget = 0.55;
    this.phase = 0;
    this.spin = 0; // wrist-roll driven rotation of the whole formation
    this.spinTarget = 0;
    this.transitionT = 99;
    this.stagger = 0.075;
    this.transitionDur = 0.85;
    this.minRadius = 0.5;
    this.maxRadius = 3.0;
  }

  get type() {
    return FORMATIONS[this.index];
  }

  get transitioning() {
    return this.transitionT < this.transitionDur + this.stagger * 10;
  }

  set(index, instant = false) {
    index = ((index % FORMATIONS.length) + FORMATIONS.length) % FORMATIONS.length;
    if (index === this.index) return this.type;
    this.prevIndex = this.index;
    this.index = index;
    this.transitionT = instant ? 99 : 0;
    return this.type;
  }

  next(dir = 1) {
    return this.set(this.index + dir);
  }

  setSpread(v) {
    this.spreadTarget = clamp(v, 0, 1);
  }

  reset() {
    this.index = 0;
    this.prevIndex = 0;
    this.spread = 0.55;
    this.spreadTarget = 0.55;
    this.phase = 0;
    this.spin = 0;
    this.spinTarget = 0;
    this.transitionT = 99;
  }

  update(dt) {
    this.spread = damp(this.spread, this.spreadTarget, 6, dt);
    this.spin = damp(this.spin, this.spinTarget, 7, dt);
    this.phase += dt * this.type.speed;
    this.transitionT += dt;
  }

  radius(scale = 1) {
    return lerp(this.minRadius, this.maxRadius, this.spread) * scale;
  }

  /** Blended slot (handles the staggered wave between layouts). */
  slot(i, n, R, time, outP, outD) {
    slotInto(this.index, i, n, R, time, this.phase, this.spin, outP, outD);
    if (this.transitionT < this.transitionDur + this.stagger * i) {
      slotInto(this.prevIndex, i, n, R, time, this.phase, this.spin, _pb, _db);
      const w = easeInOutCubic((this.transitionT - i * this.stagger) / this.transitionDur);
      outP.lerpVectors(_pb, outP, w);
      outD.lerpVectors(_db, outD, w).normalize();
    }
  }

  /** Progress (0..1) of sword i within the current transition, or 1 when idle. */
  progress(i) {
    return clamp((this.transitionT - i * this.stagger) / this.transitionDur, 0, 1);
  }
}

export const _tmp = { _pa, _da };
