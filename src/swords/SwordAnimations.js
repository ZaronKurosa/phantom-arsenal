import * as THREE from 'three';
import { TAU, clamp, easeInCubic, easeInOutCubic, easeOutCubic } from '../utils/MathUtils.js';

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Small timeline engine for gesture-triggered sword animations.
 * Each animation owns only the "extra" channels of a sword (spinAngle, offset,
 * scaleMul, glow boost), so it composes cleanly with the follow/formation
 * motion that drives the base position.
 *
 * Animations: spin, dash, teleport, flourish (summon pop). A generic
 * schedule() runs delayed callbacks for staggered formation effects.
 */
export class SwordAnimations {
  constructor(effects, lighting, sceneManager) {
    this.fx = effects;
    this.lighting = lighting;
    this.sm = sceneManager;
    this.anims = [];
    this.timers = [];
    this.time = 0;
  }

  /* --------------------------- scheduling --------------------------- */

  schedule(delay, fn) {
    if (delay <= 0) {
      fn();
      return;
    }
    this.timers.push({ at: this.time + delay, fn });
  }

  isBusy(sword) {
    return this.anims.some((a) => a.sword === sword && a.exclusive);
  }

  cancelAll() {
    for (const a of this.anims) a.cleanup?.();
    this.anims.length = 0;
    this.timers.length = 0;
  }

  /* ----------------------------- spin ------------------------------ */

  spin(sword, { dir = 1, turns = 2, dur = 0.95, delay = 0 } = {}) {
    this.schedule(delay, () => {
      // finish any previous spin so angles stay consistent
      this.anims = this.anims.filter((a) => {
        if (a.sword === sword && a.kind === 'spin') {
          sword.spinAngle = a.end;
          return false;
        }
        return true;
      });
      const start = sword.spinAngle;
      this.anims.push({
        kind: 'spin',
        sword,
        t: 0,
        dur,
        start,
        end: start + dir * turns * TAU,
        flashed: false,
        update: (a, dt) => {
          const k = clamp(a.t / a.dur, 0, 1);
          sword.spinAngle = a.start + (a.end - a.start) * easeInOutCubic(k);
          sword.glowTarget = 1.5 * Math.sin(k * Math.PI) + 0.45;
          sword.model.position.y = 0;
          if (!a.flashed && k > 0.18) {
            a.flashed = true;
            sword.tipWorld(_tip);
            this.fx.halo(sword.group.position, sword.color, 30, 0.45, 2.8, 0.1);
            this.fx.shockwave(sword.group.position, sword.color, 1.6, 0.55);
          }
          if (Math.random() < 0.7) this.fx.trail(sword.group.position, _dir.set(0, 0, 0), sword.color, 1);
        },
        cleanup: () => {
          sword.spinAngle = sword.spinAngle % TAU;
          sword.glowTarget = 0.45;
        },
      });
    });
  }

  /* ----------------------------- dash ------------------------------ */

  /**
   * Fast lunge along `dir` (world-space unit vector). The sword blurs forward
   * leaving a streak, then eases back to its follow position.
   */
  dash(sword, dir, { dist = 3.4, dur = 0.55, delay = 0, onStart } = {}) {
    this.schedule(delay, () => {
      this.anims = this.anims.filter((a) => !(a.sword === sword && a.kind === 'dash'));
      const d = new THREE.Vector3().copy(dir).normalize();
      this.anims.push({
        kind: 'dash',
        sword,
        exclusive: true,
        t: 0,
        dur,
        dir: d,
        dist,
        started: false,
        update: (a, dt, time) => {
          const k = clamp(a.t / a.dur, 0, 1);
          let travel;
          if (k < 0.3) travel = easeOutCubic(k / 0.3);
          else travel = 1 - easeInOutCubic((k - 0.3) / 0.7);
          const prev = _from.copy(sword.offset);
          sword.offset.copy(a.dir).multiplyScalar(a.dist * travel);
          sword.pointAlong(a.dir);
          sword.rotLambda = 22;
          sword.orientLockUntil = time + 0.12;
          sword.glowTarget = 1.8 * (1 - k) + 0.45;
          if (!a.started) {
            a.started = true;
            sword.tipWorld(_tip);
            this.fx.burst(sword.group.position, sword.color, 22, 2.4, 0.12, 0.5);
            this.fx.shockwave(sword.group.position, sword.color, 1.9, 0.45);
            this.lighting.pulse(0.35);
            onStart?.();
          }
          if (k < 0.5) {
            _to.copy(sword.group.position);
            this.fx.streak(prev.add(sword.pos), _to, sword.color, 6, 0.1);
          }
          if (k > 0.28 && !a.hit) {
            a.hit = true;
            this.fx.burst(_to.copy(sword.group.position), sword.color, 16, 3, 0.1, 0.5);
          }
        },
        cleanup: () => {
          sword.offset.set(0, 0, 0);
          sword.rotLambda = 9;
          sword.glowTarget = 0.45;
        },
      });
    });
  }

  /* --------------------------- teleport ---------------------------- */

  /** Dissolve, jump to `getTarget()` and re-materialise with a ring burst. */
  teleport(sword, getTarget, { dur = 0.42, delay = 0 } = {}) {
    this.schedule(delay, () => {
      this.anims = this.anims.filter((a) => !(a.sword === sword && a.kind === 'teleport'));
      this.anims.push({
        kind: 'teleport',
        sword,
        exclusive: false,
        t: 0,
        dur,
        jumped: false,
        update: (a) => {
          const k = clamp(a.t / a.dur, 0, 1);
          if (k < 0.5) {
            const e = easeInCubic(k / 0.5);
            sword.scaleMul = 1 - e * 0.98;
            sword.glowTarget = 0.5 + 2 * e;
            if (!a.fired) {
              a.fired = true;
              this.fx.burst(sword.group.position, sword.color, 34, 3.2, 0.14, 0.7);
              this.fx.shockwave(sword.group.position, sword.color, 2.2, 0.5);
            }
          } else {
            if (!a.jumped) {
              a.jumped = true;
              sword.teleportTo(getTarget());
              this.fx.burst(sword.group.position, sword.color, 40, 3.8, 0.15, 0.8);
              this.fx.shockwave(sword.group.position, sword.color, 2.8, 0.6);
              this.fx.halo(sword.group.position, sword.color, 26, 0.3, 3.2, 0.1);
              this.lighting.pulse(0.5);
            }
            const e = easeOutCubic((k - 0.5) / 0.5);
            sword.scaleMul = 0.02 + e * 0.98;
            sword.glowTarget = 2.2 * (1 - e) + 0.45;
          }
        },
        cleanup: () => {
          sword.scaleMul = 1;
          sword.glowTarget = 0.45;
        },
      });
    });
  }

  /* --------------------------- flourish ---------------------------- */

  /** Short glow + sparkle pop used when a sword is summoned or swapped. */
  flourish(sword, { delay = 0, strength = 1 } = {}) {
    this.schedule(delay, () => {
      this.anims.push({
        kind: 'flourish',
        sword,
        t: 0,
        dur: 0.8,
        update: (a) => {
          const k = clamp(a.t / a.dur, 0, 1);
          sword.glowTarget = 0.45 + 1.8 * strength * (1 - k);
          if (!a.fired) {
            a.fired = true;
            this.fx.rise(sword.group.position, sword.color, 18, 0.5);
            this.fx.burst(sword.group.position, sword.color, 14, 2.2, 0.1, 0.6);
          }
        },
        cleanup: () => {
          sword.glowTarget = 0.45;
        },
      });
    });
  }

  /* ------------------------------ tick ------------------------------ */

  update(dt, time) {
    this.time = time;
    if (this.timers.length) {
      const due = [];
      this.timers = this.timers.filter((t) => {
        if (time >= t.at) {
          due.push(t);
          return false;
        }
        return true;
      });
      for (const t of due) t.fn();
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      a.update(a, dt, time);
      if (a.t >= a.dur) {
        a.cleanup?.();
        this.anims.splice(i, 1);
      }
    }
  }
}
