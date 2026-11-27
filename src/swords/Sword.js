import * as THREE from 'three';
import { createWeaponModel, disposeWeaponModel, weaponMeta } from '../weapons/WeaponRegistry.js';
import { setWeaponViewport } from '../weapons/WeaponKit.js';
import { smoothDampVec3 } from '../utils/Smoothing.js';
import { TAU, clamp, damp, easeOutBack, rand } from '../utils/MathUtils.js';

/* ------------------------------------------------------------------ */
/* Orbiting motes: one shared geometry, GPU-animated (zero CPU cost)    */
/* ------------------------------------------------------------------ */

const MOTE_COUNT = 22;
const MOTE_TIME = { value: 0 };
const MOTE_SCALE = { value: 600 };

let MOTE_GEO = null;
function moteGeometry() {
  if (MOTE_GEO) return MOTE_GEO;
  const seeds = new Float32Array(MOTE_COUNT * 4);
  const pos = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    seeds[i * 4] = rand(0, Math.PI * 2); // phase
    seeds[i * 4 + 1] = rand(0.28, 0.62); // radius
    seeds[i * 4 + 2] = rand(0.35, 1.1) * (Math.random() < 0.5 ? -1 : 1); // angular speed
    seeds[i * 4 + 3] = rand(-1.35, 1.35); // height
  }
  MOTE_GEO = new THREE.BufferGeometry();
  MOTE_GEO.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  MOTE_GEO.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  MOTE_GEO.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return MOTE_GEO;
}

const MOTE_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vTw;
  void main() {
    float a = aSeed.x + uTime * aSeed.z;
    float h = aSeed.w + sin(uTime * 0.7 + aSeed.x * 3.0) * 0.12;
    vec3 p = vec3(cos(a) * aSeed.y, h, sin(a) * aSeed.y * 0.7);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.03 + 0.025 * fract(aSeed.x * 7.3)) * uScale / max(0.1, -mv.z);
    vTw = 0.5 + 0.5 * sin(uTime * 2.2 + aSeed.x * 10.0);
  }
`;
const MOTE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * uAlpha * (0.35 + 0.65 * vTw));
  }
`;

const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

let UID = 0;

export class Sword {
  /**
   * @param {string} weaponId  key of WEAPONS (katana, greatsword, dagger-left, dagger-right)
   * @param {{ role?: 'main'|'partner'|'formation', scale?: number }} opts
   *   main / partner carry the full model (katana with sheath + awakening); formation blades are lite.
   */
  constructor(weaponId = 'katana', { role = 'formation', scale = 1 } = {}) {
    this.id = ++UID;
    this.role = role;
    this.weaponId = weaponId;
    this.group = new THREE.Group();
    this.group.name = 'sword-' + this.id;

    // kinematics
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.offset = new THREE.Vector3(); // transient animation offset (dash, recoil...)
    this.smoothTime = 0.14;
    this.maxSpeed = 60;
    this.quat = new THREE.Quaternion();
    this.targetQuat = new THREE.Quaternion();
    this.rotLambda = 9;
    this.spinAngle = 0; // extra rotation around the blade axis
    this.idleSpin = 0;
    this.idleSpinSpeed = 0; // |speed| > 1.5 = continuous spin (cinematic); below that the blade only sways
    this.swayAmp = 0.5; // yaw sway (rad) that keeps the broad face toward the viewer
    this.orientLockUntil = 0;
    this.holdUntil = 0;

    // look
    this.baseScale = scale;
    this.scaleMul = 1; // animated multiplier
    this.appear = 0;
    this.appearTarget = 0;
    this.glow = 0.4;
    this.glowTarget = 0.4;
    this.floatAmp = 0.12;
    this.floatSpeed = rand(0.9, 1.4);
    this.floatWeight = 1;
    this.phase = rand(0, Math.PI * 2);

    // book-keeping used by animations / formations
    this.busy = 0; // >0 while an animation owns the transform
    this.speed = 0;
    this.slot = 0;

    this.model = null;
    this.glowParts = null;
    this.motes = null;
    this.moteMat = null;
    this._buildModel(weaponId);
    this.group.visible = false;
    this.group.scale.setScalar(1e-4);
  }

  static setViewport(heightPx, fovDeg, pixelRatio = 1) {
    MOTE_SCALE.value = (heightPx * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    setWeaponViewport(heightPx, fovDeg, pixelRatio);
  }
  static tick(time) {
    MOTE_TIME.value = time;
  }

  _buildModel(id) {
    if (this.model) {
      this.group.remove(this.model);
      disposeWeaponModel(this.model);
    }
    this.weaponId = id;
    const meta = weaponMeta(id);
    this.model = createWeaponModel(id, { lite: this.role === 'formation' });
    this.glowParts = this.model.userData.glow;
    this.group.add(this.model);
    this.baseScale = this.role === 'formation' ? 0.9 * meta.formationScale : meta.leadScale;
    this.color = new THREE.Color(this.model.userData.color ?? meta.color);
    if (this.glowParts.core) this.glowParts.core.material.emissive.copy(this.color);
    if (this.glowParts.halo) this.glowParts.halo.material.color.copy(this.color);
    if (this.glowParts.rune) this.glowParts.rune.material.color.copy(this.color).lerp(new THREE.Color(0xffffff), 0.35);

    if (!this.motes) {
      this.moteMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: MOTE_TIME,
          uScale: MOTE_SCALE,
          uColor: { value: this.color.clone() },
          uAlpha: { value: 0.8 },
        },
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.motes = new THREE.Points(moteGeometry(), this.moteMat);
      this.motes.frustumCulled = false;
      this.motes.renderOrder = 5;
      this.group.add(this.motes);
    } else {
      this.moteMat.uniforms.uColor.value.copy(this.color);
    }
    this.length = this.model.userData.length;
    this.tipY = this.model.userData.tipY;
  }

  /** Swap the weapon model (the caller makes sure the sword is hidden while it happens). */
  setWeapon(id) {
    if (id === this.weaponId) return;
    this._buildModel(id);
    this.snapOrientation();
  }

  /* ---------------- orientation helpers ---------------- */

  /** Tip up, tilted by `roll` radians around the view axis plus optional pitch/yaw. */
  setUpright(roll = 0, pitch = 0, yaw = 0) {
    _e.set(pitch, yaw, -roll, 'YXZ');
    this.targetQuat.setFromEuler(_e);
  }

  /** Point the blade tip along a direction. */
  pointAlong(dir) {
    _v.copy(dir).normalize();
    this.targetQuat.setFromUnitVectors(_up, _v);
  }

  /** Snap orientation immediately (used when summoning). */
  snapOrientation() {
    this.quat.copy(this.targetQuat);
    this.group.quaternion.copy(this.quat);
  }

  teleportTo(p) {
    this.pos.copy(p);
    this.target.copy(p);
    this.vel.set(0, 0, 0);
    this.offset.set(0, 0, 0);
    this.group.position.copy(p);
  }

  show(v = true) {
    this.appearTarget = v ? 1 : 0;
  }
  get visibleAmount() {
    return this.appear;
  }

  tipWorld(out) {
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out.set(0, this.tipY, 0));
  }

  /* ---------------- per-frame ---------------- */

  update(dt, time) {
    dt = Math.min(dt, 0.05);
    this.phase += 0;
    smoothDampVec3(this.pos, this.target, this.vel, this.smoothTime, dt, this.maxSpeed);
    this.speed = this.vel.length();

    const bob = Math.sin(time * this.floatSpeed + this.phase) * this.floatAmp * this.floatWeight;
    const sway = Math.sin(time * this.floatSpeed * 0.7 + this.phase * 1.7) * 0.03 * this.floatWeight;
    this.group.position.set(this.pos.x + this.offset.x, this.pos.y + this.offset.y + bob, this.pos.z + this.offset.z);

    this.quat.slerp(this.targetQuat, 1 - Math.exp(-this.rotLambda * dt));
    this.group.quaternion.copy(this.quat);
    _q.setFromAxisAngle(_v.set(0, 0, 1), sway);
    this.group.quaternion.multiply(_q);

    if (Math.abs(this.idleSpinSpeed) > 1.5) {
      this.idleSpin += this.idleSpinSpeed * dt;
    } else {
      // settle back to the nearest upright orientation, then just sway gently
      this.idleSpin = damp(this.idleSpin, Math.round(this.idleSpin / TAU) * TAU, 2.5, dt);
    }
    const yawSway = Math.sin(time * 0.65 + this.phase * 1.3) * this.swayAmp * this.floatWeightClamped();
    this.model.rotation.y = this.spinAngle + this.idleSpin + yawSway;

    this.appear = damp(this.appear, this.appearTarget, 7, dt);
    if (Math.abs(this.appear - this.appearTarget) < 0.003) this.appear = this.appearTarget;
    const vis = this.appear > 0.01;
    this.group.visible = vis;
    if (vis) {
      const s = this.baseScale * this.scaleMul * Math.max(1e-4, easeOutBack(this.appear));
      this.group.scale.setScalar(s);
    }

    this.glow = damp(this.glow, this.glowTarget, 5, dt);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + this.phase);
    const g = clamp(this.glow, 0, 2);
    const gp = this.glowParts;
    if (gp.core) gp.core.material.emissiveIntensity = Math.min(3.4, 1.3 + 1.1 * g + 0.4 * pulse);
    if (gp.rune) gp.rune.material.opacity = clamp(0.5 + 0.3 * g + 0.15 * pulse, 0, 1);
    // (the model's big halo sprite is intentionally not drawn: under bloom it washed the blade out)
    if (gp.halo) gp.halo.visible = false;
    this.moteMat.uniforms.uAlpha.value = 0.55 + 0.35 * clamp(g, 0, 1);

    // weapon-specific per-frame behaviour (katana awakening, energy scroll, reveal uniforms)
    this.model.userData.tick?.(dt, time, this);
  }

  floatWeightClamped() {
    return 0.35 + 0.65 * clamp(this.floatWeight, 0, 1);
  }

  dispose() {
    this.group.removeFromParent();
    disposeWeaponModel(this.model);
    this.moteMat?.dispose();
  }
}
