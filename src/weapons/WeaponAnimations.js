import * as THREE from 'three';
import { TAU, clamp, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, smoothstep } from '../utils/MathUtils.js';
import { setReveal } from './WeaponReveal.js';

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * Entry and dismissal animations for every weapon.
 *
 *   katana      THE PURPLE AWAKENING: drives KatanaAwakening (summon, runes, unsheathe, sheath dissolve, presentation)
 *   greatsword  a column of light, the crystal ignites first, the blade forges outward from the guard,
 *               the horns unfold and the whole sword slams into place with a shockwave
 *   dagger      the dagger whirls in from its own side as scattered shards converge; the blade is drawn
 *               from pommel to tip and ends in a flare. LEFT arrives from the left, RIGHT from the right.
 *
 * Every animation is a one-shot object: it is created by WeaponSwitcher when a
 * weapon is selected, advances on the frame clock and ends by itself. Nothing
 * here reads tracking data, so tracking updates can never replay it.
 */

const DURATIONS = { greatsword: 2.9, dagger: 1.6, dismiss: 0.55, dismissQuick: 0.3 };

export class WeaponAnimations {
  constructor(effects, lighting, sceneManager) {
    this.fx = effects;
    this.lighting = lighting;
    this.sm = sceneManager;
    this.anims = [];
    this.time = 0;
    this.onPhase = null; // (sword, phaseName) => void, used by the UI / tests
  }

  isEntering(sword) {
    return this.anims.some((a) => a.sword === sword && a.kind === 'enter');
  }
  isDismissing(sword) {
    return this.anims.some((a) => a.sword === sword && a.kind === 'dismiss');
  }
  isAnyDismissing() {
    return this.anims.some((a) => a.kind === 'dismiss');
  }
  get busy() {
    return this.anims.length > 0;
  }

  /** Finish whatever is running on this sword instantly (resting pose). */
  settle(sword) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      if (a.sword !== sword) continue;
      a.cleanup?.(a);
      this.anims.splice(i, 1);
    }
  }

  clear() {
    for (const a of this.anims) a.cleanup?.(a);
    this.anims.length = 0;
    this.lighting.setBoost?.(0);
  }

  /* ------------------------------ enter ------------------------------ */

  /**
   * Play the dedicated entry animation of the weapon on `sword`.
   * @returns {object} handle with { done, onDone, skip() }
   */
  enter(sword, { delay = 0, onDone } = {}) {
    this.settle(sword);
    const kind = sword.model.userData.kind;
    const a = { kind: 'enter', sword, t: -delay, dur: 1, done: false, onDone, weapon: kind };
    a.skip = () => {
      if (a.done) return;
      a.t = a.dur + 1;
    };
    sword.appear = 1;
    sword.appearTarget = 1;
    sword.scaleMul = 1;
    sword.spinAngle = 0;
    sword.offset.set(0, 0, 0);
    if (kind === 'katana') this._setupKatana(a);
    else if (kind === 'greatsword') this._setupGreatsword(a);
    else this._setupDagger(a);
    this.anims.push(a);
    return a;
  }

  _phase(sword, name) {
    this.onPhase?.(sword, name);
  }

  /* ---- katana: Purple Awakening ---- */

  _setupKatana(a) {
    const sword = a.sword;
    const fx = this.fx;
    const aw = a.sword.model.userData.awakening;
    a.dur = Infinity;
    sword.glowTarget = 0.5;
    let sigil = false;
    aw.onPhase = (name) => {
      this._phase(sword, `katana:${name}`);
      switch (name) {
        case 'summon':
          this.lighting.pulse(0.25);
          fx.rise(sword.group.position, sword.color, 16, 1.2);
          break;
        case 'materialise':
          fx.setSigil(true, sword.group.position.x, sword.group.position.z, 3.6, 0.35);
          sigil = true;
          fx.boostSigil(0.6);
          break;
        case 'runes':
          fx.boostSigil(1);
          break;
        case 'unsheathe':
          this.lighting.pulse(0.5);
          this.sm.shake(0.25);
          break;
        case 'flash':
          this.lighting.pulse(0.9);
          fx.shockwave(sword.group.position, sword.color, 4.2, 0.9);
          fx.halo(sword.group.position, sword.color, 40, 0.8, 4, 0.12);
          break;
        case 'dissolve':
          fx.boostSigil(1.4);
          break;
        case 'present':
          this.lighting.pulse(0.45);
          fx.shockwave(sword.group.position, sword.color, 3, 0.8);
          break;
        case 'ready':
          this._phase(sword, 'katana:handoff-complete');
          break;
        default:
      }
    };
    a.update = (self) => {
      this.lighting.setBoost?.(aw.lightBoost);
      sword.glowTarget = 0.5 + 0.9 * aw.last.flash;
      if (aw.state === 'done') self.t = Infinity;
    };
    a.cleanup = (self) => {
      aw.onPhase = null;
      if (aw.running) aw.cancel();
      this.lighting.setBoost?.(0);
      sword.glowTarget = 0.5;
      if (sigil) fx.setSigil(false);
    };
    // the first update after the delay starts the clock
    a.started = false;
    const origUpdate = a.update;
    a.update = (self, dt, time) => {
      if (self.t < 0) return;
      if (!self.started) {
        self.started = true;
        aw.start();
      }
      origUpdate(self, dt, time);
    };
    a.handoff = () => aw.handoff;
    a.awakening = aw;
  }

  /* ---- greatsword ---- */

  _setupGreatsword(a) {
    const sword = a.sword;
    const fx = this.fx;
    const ud = sword.model.userData;
    const { RV, axis, parts } = ud;
    a.dur = DURATIONS.greatsword;
    RV.uMode.value = 1;
    RV.uC.value = axis.guardY;
    RV.uS.value = 1 / (Math.max(axis.top - axis.guardY, axis.guardY - axis.bottom) * 1.02);
    setReveal(RV, 0);
    parts.guardG.scale.x = 0.15;
    sword.glowTarget = 1.2;
    sword.offset.y = -1.6;
    let impact = false;
    let started = false;
    a.update = (self) => {
      const t = self.t;
      if (t < 0) return;
      if (!started) {
        started = true;
        this._phase(sword, 'greatsword:summon');
        fx.setSigil(true, sword.group.position.x, sword.group.position.z, 4, 0.3);
        fx.boostSigil(1);
        fx.lightBeam(sword.group.position.x, sword.group.position.z, 2.4, 1.2);
        fx.rise(sword.group.position, sword.color, 34, 1.4);
        this.lighting.pulse(0.35);
      }
      // 1. crystal ignites, the blade is forged outward from the guard
      const k = easeOutCubic(clamp((t - 0.1) / 1.6, 0, 1));
      setReveal(RV, k);
      // 2. horns unfold
      parts.guardG.scale.x = 0.15 + 0.85 * easeOutBack(clamp((t - 0.3) / 0.9, 0, 1));
      // 3. rises out of the floor light
      const rise = easeOutCubic(clamp(t / 1.6, 0, 1));
      sword.offset.y = -1.6 * (1 - rise);
      sword.glowTarget = 1.8 - 1.3 * smoothstep(0.6, 2.4, t) + 0.6 * Math.sin(Math.PI * clamp((t - 1.4) / 0.6, 0, 1));
      if (t > 0.2 && t < 1.7 && Math.random() < 0.5) fx.trail(_p.copy(sword.group.position).add(_v.set((Math.random() - 0.5) * 0.4, -0.8, 0)), _v.set(0, 1.4, 0), sword.color, 1);
      // 4. impact
      if (!impact && t > 1.55) {
        impact = true;
        this._phase(sword, 'greatsword:impact');
        fx.shockwave(sword.group.position, sword.color, 5.5, 0.9);
        fx.shockwave(_p.set(sword.group.position.x, -4.3, sword.group.position.z), sword.color, 7, 1.1, true);
        fx.burst(sword.group.position, sword.color, 60, 5, 0.16, 1.1);
        this.sm.shake(0.7);
        this.lighting.pulse(0.8);
      }
    };
    a.cleanup = () => {
      setReveal(RV, 1);
      RV.uMode.value = 0;
      parts.guardG.scale.x = 1;
      sword.offset.set(0, 0, 0);
      sword.glowTarget = 0.5;
    };
  }

  /* ---- void dagger ---- */

  _setupDagger(a) {
    const sword = a.sword;
    const fx = this.fx;
    const ud = sword.model.userData;
    const { RV, axis } = ud;
    const dir = ud.side === 'left' ? -1 : 1;
    a.dur = DURATIONS.dagger;
    RV.uMode.value = 0;
    RV.uC.value = axis.bottom;
    RV.uS.value = 1 / (axis.top - axis.bottom);
    RV.uO.value = 0;
    setReveal(RV, 0);
    sword.glowTarget = 1.6;
    sword.offset.set(dir * 3.6, -1.4, -0.3);
    let started = false;
    let landed = false;
    a.update = (self) => {
      const t = self.t;
      if (t < 0) return;
      if (!started) {
        started = true;
        this._phase(sword, `dagger:${ud.side}:summon`);
        fx.rise(sword.group.position, sword.color, 22, 1.0);
        this.lighting.pulse(0.25);
      }
      // 1. shards converge: the blade is drawn pommel -> tip
      setReveal(RV, easeInOutCubic(clamp((t - 0.05) / 0.85, 0, 1)));
      // 2. whirls in from its own side on an arc, spinning around the blade axis
      const k = easeOutCubic(clamp(t / 1.15, 0, 1));
      sword.offset.set(dir * 3.6 * (1 - k), -1.4 * (1 - k) * (1 - 0.35 * Math.sin(Math.PI * k)), -0.3 * (1 - k));
      sword.spinAngle = -dir * TAU * 3 * (1 - easeOutCubic(clamp(t / 1.3, 0, 1)));
      sword.glowTarget = 1.6 - 1.1 * smoothstep(0.8, 1.6, t);
      if (t < 1.15 && Math.random() < 0.8) fx.trail(sword.group.position, _v.set(-dir * 2, 0.5, 0), sword.color, 1);
      // 3. lands with a flare
      if (!landed && t > 1.1) {
        landed = true;
        this._phase(sword, `dagger:${ud.side}:land`);
        fx.shockwave(sword.group.position, sword.color, 2.2, 0.6);
        fx.halo(sword.group.position, sword.color, 26, 0.5, 3, 0.1);
        fx.burst(sword.group.position, sword.color, 24, 3, 0.12, 0.7);
        this.lighting.pulse(0.4);
      }
    };
    a.cleanup = () => {
      setReveal(RV, 1);
      sword.offset.set(0, 0, 0);
      sword.spinAngle = 0;
      sword.glowTarget = 0.5;
    };
  }

  /* ----------------------------- dismiss ----------------------------- */

  /** Dissolve the weapon away smoothly; `onDone` fires once it is fully hidden. */
  dismiss(sword, { quick = false, onDone } = {}) {
    this.settle(sword);
    if (sword.appear < 0.02 && sword.appearTarget === 0) {
      onDone?.();
      return null;
    }
    const dur = quick ? DURATIONS.dismissQuick : DURATIONS.dismiss;
    const a = { kind: 'dismiss', sword, t: 0, dur, onDone, started: false };
    a.update = (self) => {
      const k = clamp(self.t / self.dur, 0, 1);
      if (!self.started) {
        self.started = true;
        this.fx.burst(sword.group.position, sword.color, quick ? 16 : 34, 3, 0.12, 0.7);
        this.fx.shockwave(sword.group.position, sword.color, 2.2, 0.5);
        this.lighting.pulse(0.2);
      }
      sword.scaleMul = 1 - 0.97 * easeInCubic(k);
      sword.glowTarget = 0.5 + 1.8 * Math.sin(Math.PI * Math.min(1, k * 1.4));
      sword.offset.y = 0.6 * easeInCubic(k);
      sword.spinAngle += 0.4 * k;
      if (Math.random() < 0.6) this.fx.trail(sword.group.position, _v.set(0, 2, 0), sword.color, 1);
    };
    a.cleanup = (self) => {
      sword.scaleMul = 1;
      sword.offset.set(0, 0, 0);
      sword.spinAngle = 0;
      sword.glowTarget = 0.5;
      sword.appear = 0;
      sword.appearTarget = 0;
      sword.group.visible = false;
      this.fx.burst(sword.group.position, sword.color, quick ? 10 : 22, 2.4, 0.1, 0.6);
    };
    this.anims.push(a);
    return a;
  }

  /* ------------------------------- tick ------------------------------- */

  update(dt, time) {
    this.time = time;
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      a.update?.(a, dt, time);
      if (a.t >= a.dur) {
        a.cleanup?.(a);
        a.done = true;
        this.anims.splice(i, 1);
        a.onDone?.(a);
      }
    }
  }
}
