import * as THREE from 'three';
import { Sword } from './Sword.js';
import { SwordFormation, FORMATIONS } from './SwordFormation.js';
import { SwordAnimations } from './SwordAnimations.js';
import { VARIANTS } from './SwordGeometry.js';
import { FLOOR_Y } from '../scene/SceneManager.js';
import { Emitter } from '../utils/Emitter.js';
import { TAU, clamp, damp, easeInOutCubic, easeOutCubic, lerp, wrapAngle } from '../utils/MathUtils.js';

export const MODES = {
  solo: { id: 'solo', key: '1', name: 'SOLO', desc: 'One blade follows your hand' },
  arsenal: { id: 'arsenal', key: '2', name: 'ARSENAL', desc: 'A formation of swords floats around you' },
  master: { id: 'master', key: '3', name: 'MASTER', desc: 'Lead blade + formation + every animation' },
};

const FORMATION_COUNT = 8;
const CINEMATIC_DURATION = 5.2;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Owns every sword and turns an input-agnostic ControlState + discrete events
 * into motion. It never knows whether the data came from the camera, the
 * mouse or the demo director.
 */
export class SwordController extends Emitter {
  constructor(sceneManager, effects) {
    super();
    this.sm = sceneManager;
    this.fx = effects;
    this.formation = new SwordFormation();
    this.anim = new SwordAnimations(effects, sceneManager.lighting, sceneManager);

    this.main = new Sword('nightfang', { role: 'main', scale: 1.3 });
    this.swords = [];
    for (let i = 0; i < FORMATION_COUNT; i++) {
      const s = new Sword(VARIANTS[(i + 1) % VARIANTS.length].id, { role: 'formation', scale: 0.9 });
      s.slot = i;
      this.swords.push(s);
    }
    sceneManager.scene.add(this.main.group);
    for (const s of this.swords) sceneManager.scene.add(s.group);

    this.mode = 'solo';
    this.deployed = false;
    this.echoUntil = 0;
    this._wasDeployed = false;
    this.cinematic = null;
    this.stablePose = 'open';
    this.pinchAnchor = null;
    this.pinchRaw = new THREE.Vector3();
    this.openHold = 0;
    this.fistHold = 0;
    this.summonCooldown = 0;
    this.variantChoice = 'mixed';
    this.time = 0;
    this.mainTarget = new THREE.Vector3(0, 0, 0.5);
    this.slotTargets = this.swords.map(() => new THREE.Vector3());
    this.lastDash = 0;

    this.main.target.set(0, 0, 0.5);
    this.main.teleportTo(this.main.target);
    this.main.snapOrientation();
    this.main.show(true);
    this.main.glowTarget = 0.5;
    this.main.idleSpinSpeed = 0.6;
    for (const s of this.swords) s.idleSpinSpeed = 0.35 * (s.slot % 2 ? 1 : -1);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  get activeCount() {
    let n = this.main.appearTarget === 1 ? 1 : 0;
    for (const s of this.swords) if (s.appearTarget === 1) n++;
    return n;
  }

  get formationDeployed() {
    return this._effectiveDeployed();
  }

  setMode(mode, { announce = true } = {}) {
    if (!MODES[mode]) return;
    const changed = mode !== this.mode;
    this.mode = mode;
    if (changed) this.echoUntil = 0; // a SOLO blade-echo never leaks into another mode
    if (mode === 'arsenal') this.deployed = true;
    else if (mode === 'solo') this.deployed = false;
    else if (changed) this.deployed = false;
    if (changed) {
      this.fx.shockwave(this.main.group.position, this.main.color, 3, 0.7);
      this.sm.lighting.pulse(0.5);
      this.anim.flourish(this.main, { strength: 1.2 });
      this.main.show(true);
      if (announce) this.emit('action', { name: `MODE · ${MODES[mode].name}` });
    }
    this.emit('mode', { mode });
  }

  setVariantChoice(choice) {
    const ids = VARIANTS.map((v) => v.id);
    if (choice !== 'mixed' && !ids.includes(choice)) return;
    this.variantChoice = choice;
    if (choice === 'mixed') {
      this.main.setVariant('nightfang');
      this.swords.forEach((s, i) => s.setVariant(VARIANTS[(i + 1) % VARIANTS.length].id));
    } else {
      this.main.setVariant(choice);
      for (const s of this.swords) s.setVariant(choice);
    }
    this.anim.flourish(this.main, { strength: 1.3 });
    this.swords.forEach((s, i) => this.anim.flourish(s, { delay: i * 0.04 }));
    this.fx.shockwave(this.main.group.position, this.main.color, 2.4, 0.6);
    this.sm.lighting.pulse(0.4);
    this.emit('variant', { choice });
  }

  cycleVariant() {
    const order = [...VARIANTS.map((v) => v.id), 'mixed'];
    const next = order[(order.indexOf(this.variantChoice) + 1) % order.length];
    this.setVariantChoice(next);
    return next;
  }

  reset() {
    this.anim.cancelAll();
    this.fx.clear();
    this.cinematic = null;
    this.echoUntil = 0;
    this.formation.reset();
    this.pinchAnchor = null;
    this.openHold = this.fistHold = 0;
    this.deployed = this.mode === 'arsenal';
    this.main.scaleMul = 1;
    this.main.spinAngle = 0;
    this.main.offset.set(0, 0, 0);
    this.main.target.set(0, 0, 0.5);
    this.main.teleportTo(this.main.target);
    this.main.setUpright(0);
    this.main.snapOrientation();
    this.main.appear = 0;
    this.main.show(true);
    this.anim.flourish(this.main);
    for (const s of this.swords) {
      s.scaleMul = 1;
      s.spinAngle = 0;
      s.offset.set(0, 0, 0);
      s.teleportTo(this.main.pos);
      s.appear = 0;
      s.show(false);
    }
    this._wasDeployed = false;
    this.setVariantChoice('mixed');
    this.sm.lighting.pulse(0.7);
    this.emit('action', { name: 'SCENE RESET' });
    this.emit('formation', { name: this.formation.type.name });
  }

  /** Discrete events from any input source. */
  trigger(name, payload = {}) {
    switch (name) {
      case 'dash':
        return this._dash(payload);
      case 'swipe':
        return this._swipe(payload);
      case 'spin':
        return this._spin(payload);
      case 'teleport':
        return this._teleport(payload);
      case 'cinematic':
        return this._startCinematic();
      case 'summon':
        return this._toggleSummon();
      case 'formation':
        return this._cycleFormation(payload.dir || 1);
      case 'spread':
        this.formation.setSpread(this.formation.spreadTarget + (payload.delta || 0));
        this.emit('action', { name: this.formation.spreadTarget > 0.5 ? 'FORMATION · EXPAND' : 'FORMATION · COLLAPSE' });
        return;
      case 'reset':
        return this.reset();
      case 'variant':
        return this.cycleVariant();
      default:
    }
  }

  /* ------------------------------------------------------------------ */
  /* Event handlers                                                       */
  /* ------------------------------------------------------------------ */

  _effectiveDeployed() {
    return this.deployed || this.time < this.echoUntil || !!this.cinematic;
  }

  _dirFrom(payload) {
    if (payload.dir) return _d.set(payload.dir.x, payload.dir.y, payload.dir.z ?? 0).normalize().clone();
    if (payload.toward) {
      // mouse click: lunge from the sword toward the cursor
      const depth = this._ctl?.primary.depth ?? 0.5;
      this.sm.worldFromNDC(payload.toward.x, payload.toward.y, depth, _d).sub(this.main.pos);
      if (_d.lengthSq() > 0.6) return _d.normalize().clone();
    }
    return new THREE.Vector3(0, 0.15, -1).normalize();
  }

  _dash(payload) {
    if (this.cinematic) return;
    const dir = this._dirFrom(payload);
    this.anim.dash(this.main, dir, { dist: 3.6 });
    if (this._effectiveDeployed()) {
      this.swords.forEach((s, i) => this.anim.dash(s, dir, { dist: 2.4 + (i % 3) * 0.4, delay: 0.05 + i * 0.045 }));
    }
    this.emit('action', { name: 'DASH' });
  }

  _swipe(payload) {
    if (this.cinematic) return;
    if (this.mode === 'solo' && !this._effectiveDeployed()) {
      this._dash({ dir: payload.dir });
      this.emit('action', { name: 'SWIPE · DASH' });
      return;
    }
    if (!this._effectiveDeployed()) {
      this.deployed = true;
      this.emit('action', { name: 'SUMMON' });
      return;
    }
    const dir = payload.axis === 'left' || payload.axis === 'down' ? -1 : 1;
    this._cycleFormation(dir, true);
  }

  _cycleFormation(dir = 1, fromSwipe = false) {
    if (this.cinematic) return;
    if (!this._effectiveDeployed()) {
      // Space/summon when nothing is deployed summons first.
      if (this.mode === 'solo') this.echoUntil = this.time + 4.5;
      else this.deployed = true;
      this.emit('action', { name: 'SUMMON' });
      return;
    }
    const type = this.formation.next(dir);
    const c = this._formationCenter(_c);
    this.fx.shockwave(c, this.main.color, 3.6, 0.8);
    this.fx.shockwave(_v.set(c.x, FLOOR_Y, c.z), this.main.color, 4.5, 0.9, true);
    this.fx.boostSigil(1);
    this.sm.lighting.pulse(0.55);
    this.swords.forEach((s, i) => {
      this.anim.schedule(i * this.formation.stagger, () => {
        s.glowTarget = 1.8;
        this.fx.burst(s.group.position, s.color, 10, 1.8, 0.1, 0.5);
        this.anim.schedule(0.4, () => (s.glowTarget = 0.45));
      });
    });
    if (this.mode === 'solo' && this.echoUntil > this.time) this.echoUntil = Math.max(this.echoUntil, this.time + 3);
    this.emit('action', { name: `${fromSwipe ? 'SWIPE · ' : ''}FORMATION · ${type.name.toUpperCase()}` });
    this.emit('formation', { name: type.name });
  }

  _spin(payload) {
    if (this.cinematic) return;
    const dir = payload.dir || 1;
    this.anim.spin(this.main, { dir, turns: 2 });
    if (this.mode === 'arsenal' || (this.mode === 'master' && this._effectiveDeployed())) {
      this.swords.forEach((s, i) => this.anim.spin(s, { dir: i % 2 ? dir : -dir, turns: 2, delay: 0.08 + i * 0.07 }));
    }
    this.emit('action', { name: 'SPIN' });
  }

  _teleport(payload) {
    if (this.cinematic) return;
    this.pinchAnchor = null; // release: follow raw hand position again
    this.main.holdUntil = this.time + 0.24;
    this.anim.teleport(this.main, () => this._mainTargetNow(), { dur: 0.45 });
    if (this._effectiveDeployed()) {
      this.swords.forEach((s, i) =>
        this.anim.teleport(s, () => _p.copy(this._formationSlotWorld(i)), { dur: 0.45, delay: 0.06 + i * 0.05 }),
      );
    }
    this.fx.boostSigil(1);
    this.emit('action', { name: 'TELEPORT' });
  }

  _toggleSummon() {
    if (this.cinematic) return;
    if (this.mode === 'solo') {
      // SOLO wields one blade; summoning conjures a brief echo of the arsenal.
      if (this.time < this.echoUntil) this.echoUntil = 0;
      else this.echoUntil = this.time + 4.5;
      this.emit('action', { name: this.time < this.echoUntil ? 'BLADE ECHO' : 'ECHO FADES' });
      return;
    }
    this.deployed = !this.deployed;
    this.summonCooldown = this.time + 1.5;
    this.emit('action', { name: this.deployed ? 'SUMMON · ARSENAL' : 'RECALL' });
  }

  _startCinematic() {
    if (this.cinematic) return;
    const c = this._formationCenter(new THREE.Vector3());
    c.x = clamp(c.x, -2.4, 2.4);
    c.y = clamp(c.y, -1.0, 1.0);
    c.z = clamp(c.z, -2.5, 1.5);
    this.cinematic = { t: 0, center: c, burst: false, beam: false };
    this.fx.setSigil(true, c.x, c.z, 5.2, 0.5);
    this.fx.boostSigil(1.2);
    this.sm.lighting.pulse(0.9);
    this.sm.shake(0.6);
    this.emit('action', { name: 'CINEMATIC FORMATION' });
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */

  _idleTarget(time, out) {
    return out.set(Math.sin(time * 0.45) * 1.6, 0.4 + Math.sin(time * 0.7) * 0.5, 0.6 + Math.cos(time * 0.3) * 0.8);
  }

  _mainTargetNow() {
    return _w.copy(this.mainTarget);
  }

  _formationCenter(out) {
    if (this.mode === 'master' && this._ctl?.twoHands) {
      return this.sm.worldFromNDC(this._ctl.secondary.pos.x, this._ctl.secondary.pos.y, this._ctl.secondary.depth, out);
    }
    return out.copy(this.main.pos);
  }

  _formationSlotWorld(i) {
    return this.slotTargets[i];
  }

  /* ------------------------------------------------------------------ */
  /* Frame update                                                         */
  /* ------------------------------------------------------------------ */

  update(dt, time, ctl) {
    dt = Math.min(dt, 0.05);
    this.time = time;
    this._ctl = ctl;
    this.formation.update(dt);
    this.anim.update(dt, time);

    this._updateGestureState(dt, ctl);
    this._updateMain(dt, time, ctl);

    const eff = this._effectiveDeployed();
    if (eff !== this._wasDeployed) {
      this._wasDeployed = eff;
      if (eff) this._summonFormation();
      else this._dismissFormation();
    }
    this._updateFormation(dt, time, ctl, eff);
    this._updateCinematic(dt);

    this.main.update(dt, time);
    for (const s of this.swords) s.update(dt, time);
    this._emitTrails();
  }

  _updateGestureState(dt, ctl) {
    const h = ctl.primary;
    if (ctl.active && (h.pose === 'open' || h.pose === 'fist' || h.pose === 'pinch')) this.stablePose = h.pose;

    // Camera-only auto summon / recall by holding a pose (mouse uses dbl-click / Space).
    if (ctl.source === 'camera' && ctl.active && this.mode === 'master' && !this.cinematic) {
      if (h.pose === 'open') {
        this.openHold += dt;
        this.fistHold = 0;
      } else if (h.pose === 'fist') {
        this.fistHold += dt;
        this.openHold = 0;
      } else {
        this.openHold = this.fistHold = 0;
      }
      if (!this.deployed && this.openHold > 0.9 && this.time > this.summonCooldown) {
        this.deployed = true;
        this.summonCooldown = this.time + 1.5;
        this.openHold = 0;
        this.emit('action', { name: 'SUMMON · OPEN PALM' });
      } else if (this.deployed && this.fistHold > 1.4 && this.time > this.summonCooldown) {
        this.deployed = false;
        this.summonCooldown = this.time + 1.5;
        this.fistHold = 0;
        this.emit('action', { name: 'RECALL · FIST' });
      }
    } else {
      this.openHold = this.fistHold = 0;
    }

    // Formation spread / rotation
    if (this.mode !== 'solo' || this._effectiveDeployed()) {
      const hh = this.mode === 'master' && ctl.twoHands ? ctl.secondary : ctl.primary;
      if (ctl.active && hh.present) {
        if (hh.pose === 'fist') this.formation.setSpread(0.02);
        else if (hh.pose === 'open') this.formation.setSpread(hh.spread);
        this.formation.spinTarget = clamp(wrapAngle(hh.roll), -1.4, 1.4) * 0.85;
      } else {
        this.formation.spinTarget = 0;
      }
    }
  }

  _updateMain(dt, time, ctl) {
    const m = this.main;
    const h = ctl.primary;
    const lockedOrient = time < (m.orientLockUntil || 0);

    if (this.cinematic) return; // cinematic drives the main sword

    if (ctl.active && h.present) {
      this.sm.worldFromNDC(h.pos.x, h.pos.y, h.depth, this.mainTarget);

      if (h.pose === 'pinch') {
        if (!this.pinchAnchor) {
          this.pinchAnchor = this.main.target.clone();
          this.pinchRaw.copy(this.mainTarget);
        }
        // precision positioning: heavily damped relative motion
        _v.copy(this.mainTarget).sub(this.pinchRaw).multiplyScalar(0.28);
        m.target.copy(this.pinchAnchor).add(_v);
        m.smoothTime = 0.05;
        m.floatWeight = 0.1;
        m.glowTarget = 1.0;
        this.sm.setParallax(0, 0);
      } else {
        // If the pinch ended without a teleport event, resume following smoothly.
        this.pinchAnchor = null;
        m.target.copy(this.mainTarget);
        const follow = this.stablePose === 'fist';
        m.smoothTime = follow ? 0.065 : 0.2;
        m.floatWeight = follow ? 0.15 : 1;
        m.glowTarget = follow ? 0.95 : 0.55;
        m.idleSpinSpeed = follow ? 0.12 : 0.7;
      }
      this.sm.setParallax(h.pos.x * 0.6, h.pos.y * 0.5);
    } else {
      this._idleTarget(time, this.mainTarget);
      m.target.copy(this.mainTarget);
      m.smoothTime = 0.45;
      m.floatWeight = 1;
      m.glowTarget = 0.5;
      m.idleSpinSpeed = 0.7;
      this.sm.setParallax(0, 0);
    }

    // While teleporting, hold the sword in place until it jumps.
    if (time < (m.holdUntil || 0)) m.target.copy(m.pos);

    if (!lockedOrient) {
      const lean = clamp(m.vel.x * (this.stablePose === 'fist' ? 0.09 : 0.05), -0.7, 0.7);
      const roll = ctl.active ? clamp(wrapAngle(h.roll), -1.5, 1.5) : 0;
      m.setUpright(roll + lean, 0, -m.pos.x * 0.03);
    }
    m.target.y = Math.max(m.target.y, FLOOR_Y + 1.5);
  }

  _summonFormation() {
    const c = this._formationCenter(_c);
    this.fx.shockwave(_v.set(c.x, FLOOR_Y, c.z), this.main.color, 5, 1.0, true);
    this.fx.shockwave(c, this.main.color, 3.2, 0.8);
    this.fx.rise(_v.set(c.x, FLOOR_Y + 1.2, c.z), this.main.color, 40, 2.2);
    this.fx.boostSigil(1);
    this.sm.lighting.pulse(0.6);
    this.swords.forEach((s, i) => {
      s.teleportTo(this.main.pos);
      s.appear = 0;
      this.anim.schedule(i * 0.07, () => {
        s.show(true);
        s.glowTarget = 1.6;
        this.anim.flourish(s, { strength: 1.1 });
      });
    });
  }

  _dismissFormation() {
    this.fx.setSigil(false);
    this.swords.forEach((s, i) => {
      this.anim.schedule(i * 0.05, () => {
        s.show(false);
        this.fx.burst(s.group.position, s.color, 14, 2.4, 0.1, 0.6);
      });
    });
    this.fx.shockwave(this.main.group.position, this.main.color, 2.6, 0.7);
  }

  _updateFormation(dt, time, ctl, deployed) {
    const n = this.swords.length;
    if (this.cinematic) return;

    if (!deployed) {
      for (const s of this.swords) {
        if (s.appear < 0.01 && s.appearTarget === 0) {
          s.target.copy(this.main.pos);
          s.pos.copy(this.main.pos);
        } else {
          s.target.copy(this.main.pos);
        }
      }
      return;
    }

    // Build groups: one by default, two when both hands are tracked in ARSENAL.
    const groups = [];
    const idx = this.swords.map((_, i) => i);
    if (this.mode === 'arsenal' && ctl.twoHands) {
      groups.push({ center: this.sm.worldFromNDC(ctl.primary.pos.x, ctl.primary.pos.y, ctl.primary.depth, new THREE.Vector3()), indices: idx.filter((i) => i % 2 === 0), scale: 0.72 });
      groups.push({ center: this.sm.worldFromNDC(ctl.secondary.pos.x, ctl.secondary.pos.y, ctl.secondary.depth, new THREE.Vector3()), indices: idx.filter((i) => i % 2 === 1), scale: 0.72 });
    } else {
      const c = this._formationCenter(new THREE.Vector3());
      groups.push({ center: c, indices: idx, scale: this.mode === 'solo' ? 0.8 : this.mode === 'master' ? 1.05 : 1 });
    }

    for (const g of groups) {
      const R = this.formation.radius(g.scale);
      const m = g.indices.length;
      g.indices.forEach((si, k) => {
        const s = this.swords[si];
        this.formation.slot(k, m, R, time, _p, _d);
        const t = this.slotTargets[si].copy(g.center).add(_p);
        t.y = Math.max(t.y, FLOOR_Y + 1.4);
        s.target.copy(t);
        s.smoothTime = 0.14 + k * 0.012;
        s.floatWeight = 0.8;
        if (time >= (s.orientLockUntil || 0)) {
          _w.copy(_d);
          s.pointAlong(_w);
        }
        s.glowTarget = this.anim.isBusy(s) ? s.glowTarget : Math.max(0.35, 0.35 + this.formation.spread * 0.35);
      });
    }

    // floor sigil follows the first group
    const g0 = groups[0];
    this.fx.setSigil(true, g0.center.x, g0.center.z, 2.2 + this.formation.spread * 2.2, 0.22);
  }

  /* --------------------------- cinematic ---------------------------- */

  _updateCinematic(dt) {
    const cin = this.cinematic;
    if (!cin) return;
    cin.t += dt;
    const t = cin.t;
    const C = cin.center;
    const n = this.swords.length;
    const A = 1.2;
    const B = 3.4;
    const Cend = 4.2;

    // main sword: rises above the centre, spins, blazes
    const m = this.main;
    const rise = t < A ? easeOutCubic(t / A) : 1;
    m.target.set(C.x, C.y + 0.5 * rise + Math.sin(t * 2) * 0.08, C.z + 0.3);
    m.smoothTime = 0.18;
    m.setUpright(0);
    m.rotLambda = 8;
    m.idleSpinSpeed = lerp(0.7, 7, easeInOutCubic(clamp(t / B, 0, 1)));
    m.glowTarget = 1.8;
    m.floatWeight = 0.3;

    if (!cin.beam && t > 0.8) {
      cin.beam = true;
      this.fx.lightBeam(C.x, C.z, 3.2, 1.5);
    }

    for (let i = 0; i < n; i++) {
      const s = this.swords[i];
      s.show(true);
      s.glowTarget = 1.5;
      s.smoothTime = 0.1;
      s.rotLambda = 10;
      let px;
      let py;
      let pz;
      let dx;
      let dy;
      let dz;
      if (t < A) {
        // curtain of blades rising in a row
        const k = easeInOutCubic(t / A);
        px = (i - (n - 1) / 2) * 0.55;
        py = lerp(-1.4, 0.3, k) + Math.sin(i + t * 3) * 0.05;
        pz = -0.3;
        dx = 0;
        dy = 1;
        dz = 0;
      } else {
        // crown ring, tips pointing inwards, accelerating rotation
        const tt = t - A;
        const ang = (i / n) * TAU + tt * tt * 0.9 + tt * 0.8;
        let r = 2.5 + Math.sin(tt * 2.4) * 0.18;
        if (t > B) {
          const u = (t - B) / (Cend - B);
          r = lerp(2.5, 7.5, easeOutCubic(clamp(u * 1.4, 0, 1)));
          if (t > Cend) r = lerp(7.5, 2.0, easeInOutCubic(clamp((t - Cend) / (CINEMATIC_DURATION - Cend), 0, 1)));
        }
        px = Math.cos(ang) * r;
        py = Math.sin(ang) * r * 0.9 + 0.3;
        pz = Math.sin(ang * 2) * 0.2;
        // tips point inwards while gathering and returning, outwards during the burst
        const sgn = t > B && t < Cend ? 1 : -1;
        dx = Math.cos(ang) * sgn;
        dy = Math.sin(ang) * sgn;
        dz = 0;
      }
      s.target.set(C.x + px, Math.max(C.y + py, FLOOR_Y + 1.4), C.z + pz);
      _d.set(dx, dy, dz);
      s.pointAlong(_d);
      this.slotTargets[i].copy(s.target);
    }

    if (!cin.burst && t > B) {
      cin.burst = true;
      this.fx.shockwave(_v.set(C.x, C.y, C.z), this.main.color, 7, 1.0);
      this.fx.shockwave(_v.set(C.x, FLOOR_Y, C.z), this.main.color, 9, 1.4, true);
      this.fx.burst(_v.set(C.x, C.y, C.z), this.main.color, 90, 6.5, 0.2, 1.4);
      this.fx.halo(_v.set(C.x, C.y, C.z), this.main.color, 60, 1.2, 6, 0.16);
      this.sm.lighting.pulse(1);
      this.sm.shake(1.4);
    }

    if (t >= CINEMATIC_DURATION) {
      this.cinematic = null;
      m.rotLambda = 9;
      m.idleSpinSpeed = 0.7;
      for (const s of this.swords) s.rotLambda = 9;
      if (!this.deployed && this.time >= this.echoUntil) this.fx.setSigil(false);
    }
  }

  _emitTrails() {
    const m = this.main;
    if (m.speed > 2.2 && m.appear > 0.5) this.fx.trail(m.group.position, m.vel, m.color, m.speed * 0.25);
    for (const s of this.swords) {
      if (s.speed > 3 && s.appear > 0.5 && Math.random() < 0.5) this.fx.trail(s.group.position, s.vel, s.color, 1);
    }
  }
}

export { FORMATIONS };
