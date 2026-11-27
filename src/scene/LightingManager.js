import * as THREE from 'three';
import { damp } from '../utils/MathUtils.js';

/**
 * Cinematic lighting rig: cold silver key light from above (the only shadow
 * caster), violet back light, silver rim, and a violet point light that
 * follows the lead sword. Effects can call pulse() to flash the chamber.
 */
export class LightingManager {
  constructor(scene) {
    this.scene = scene;

    this.hemi = new THREE.HemisphereLight(0x3a3050, 0x050408, 0.55);
    scene.add(this.hemi);

    this.key = new THREE.SpotLight(0xdfe4ff, 260, 60, 0.62, 0.85, 1.6);
    this.key.position.set(0, 10, 7);
    this.key.target.position.set(0, -2, -1);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.camera.near = 4;
    this.key.shadow.camera.far = 30;
    scene.add(this.key, this.key.target);

    this.back = new THREE.PointLight(0x7a3cff, 160, 40, 1.6);
    this.back.position.set(0, 3, -10);
    scene.add(this.back);

    this.rim = new THREE.DirectionalLight(0xb8c4ff, 0.9);
    this.rim.position.set(-6, 4, -5);
    scene.add(this.rim);

    this.follow = new THREE.PointLight(0xb98cff, 34, 13, 1.6);
    this.follow.position.set(0, 0, 2);
    scene.add(this.follow);

    this.floorGlow = new THREE.PointLight(0x6a3cd8, 10, 10, 2);
    this.floorGlow.position.set(0, -3.4, 0);
    scene.add(this.floorGlow);

    this._flash = 0;
    this._boost = 0;
    this._boostTarget = 0;
    this._followBase = 34;
    this._keyBase = 260;
  }

  /** Flash the chamber briefly (value ~ 0..1). */
  pulse(amount = 1) {
    this._flash = Math.max(this._flash, amount);
  }

  /** Extra violet energy while a weapon's entry animation plays (0..1). */
  setBoost(v) {
    this._boostTarget = v;
  }

  setShadows(enabled) {
    this.key.castShadow = enabled;
  }

  setFollowColor(color) {
    this.follow.color.lerp(color, 0.15);
  }

  update(dt, mainPos, glow = 0.5) {
    this._flash = damp(this._flash, 0, 4.5, dt);
    this._boost = damp(this._boost, this._boostTarget, 5, dt);
    if (mainPos) {
      this.follow.position.lerp(mainPos, 1 - Math.exp(-10 * dt));
      this.follow.position.z += 0.8;
      this.floorGlow.position.x = mainPos.x;
      this.floorGlow.position.z = mainPos.z;
      this.key.target.position.x += (mainPos.x * 0.4 - this.key.target.position.x) * Math.min(1, dt * 3);
    }
    this.follow.intensity = this._followBase * (0.7 + glow * 0.8) + this._flash * 90 + this._boost * 70;
    this.back.intensity = 160 + this._flash * 220 + this._boost * 140;
    this.key.intensity = this._keyBase * (1 + this._flash * 0.6);
  }
}
