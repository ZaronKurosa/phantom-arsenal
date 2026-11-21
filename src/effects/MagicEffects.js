import * as THREE from 'three';
import { FLOOR_Y } from '../scene/SceneManager.js';
import { clamp, damp, easeOutCubic, rand } from '../utils/MathUtils.js';

const VIOLET = new THREE.Color(0xa66bff);
const SILVER = new THREE.Color(0xdfe4ff);
const WHITE = new THREE.Color(0xffffff);

function makeSigilTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  g.translate(cx, cx);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.shadowColor = '#ffffff';
  g.shadowBlur = 8;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const circle = (r, w = 3) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  };
  circle(244, 4);
  circle(226, 2);
  circle(188, 2);
  circle(96, 3);
  circle(40, 2);

  // rune ring
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.lineWidth = 3;
  for (let i = 0; i < 36; i++) {
    g.save();
    g.rotate((i / 36) * Math.PI * 2);
    g.translate(0, -207);
    g.beginPath();
    switch (Math.floor(rnd() * 5)) {
      case 0: g.moveTo(0, -10); g.lineTo(0, 10); g.moveTo(-7, -2); g.lineTo(0, 6); g.lineTo(7, -2); break;
      case 1: g.moveTo(-6, -10); g.lineTo(6, 0); g.lineTo(-6, 10); break;
      case 2: g.arc(0, 0, 7, 0, Math.PI * 2); g.moveTo(0, 7); g.lineTo(0, 14); break;
      case 3: g.moveTo(-6, -9); g.lineTo(6, 9); g.moveTo(6, -9); g.lineTo(-6, 9); break;
      default: g.moveTo(0, -10); g.lineTo(-7, 0); g.lineTo(0, 10); g.lineTo(7, 0); g.closePath(); break;
    }
    g.stroke();
    g.restore();
  }

  // hexagram
  const tri = (rot) => {
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = rot + (i / 3) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 170;
      const y = Math.sin(a) * 170;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.lineWidth = 3;
    g.stroke();
  };
  tri(0);
  tri(Math.PI);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.arc(Math.cos(a) * 170, Math.sin(a) * 170, 12, 0, Math.PI * 2);
    g.stroke();
  }
  // spokes
  g.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 96, Math.sin(a) * 96);
    g.lineTo(Math.cos(a) * 188, Math.sin(a) * 188);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeBeamTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  v.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export class MagicEffects {
  constructor(scene, particles, sceneManager) {
    this.scene = scene;
    this.particles = particles;
    this.sm = sceneManager;

    /* shockwave ring pool */
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 72);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: VIOLET,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, max: 3, active: false, floor: false });
    }
    this.ringCursor = 0;

    /* persistent floor sigil */
    this.sigilTex = makeSigilTexture();
    this.sigilMat = new THREE.MeshBasicMaterial({
      map: this.sigilTex,
      color: VIOLET.clone().multiplyScalar(1.5),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sigilMat);
    this.sigil.rotation.x = -Math.PI / 2;
    this.sigil.position.y = FLOOR_Y + 0.3;
    this.sigil.renderOrder = 2;
    this.sigil.visible = false;
    scene.add(this.sigil);
    this.sigilState = { on: false, x: 0, z: 0, radius: 3, alpha: 0, spin: 0, spinSpeed: 0.25, boost: 0, curRadius: 3 };

    /* light beam */
    this.beamTex = makeBeamTexture();
    this.beamMat = new THREE.MeshBasicMaterial({
      map: this.beamTex,
      color: VIOLET.clone().lerp(WHITE, 0.2),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 16, 24, 1, true), this.beamMat);
    this.beam.visible = false;
    scene.add(this.beam);
    this.beamState = { t: 0, dur: 0, active: false, x: 0, z: 0, width: 1 };
  }

  /* ---------------------------- particles ---------------------------- */

  burst(pos, color = VIOLET, count = 36, speed = 3.2, size = 0.14, life = 0.9) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      _d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.35, 1));
      const c = Math.random() < 0.3 ? SILVER : color;
      p.emit(pos.x, pos.y, pos.z, _d.x, _d.y, _d.z, life * rand(0.6, 1.2), size * rand(0.6, 1.3), c.r, c.g, c.b, 2.2, 0.4);
    }
  }

  /** Radial sparks lying in a plane (used by spins and formation transitions). */
  halo(pos, color = VIOLET, count = 28, radius = 0.5, speed = 2.5, size = 0.1) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(0, 0.2);
      p.emit(
        pos.x + Math.cos(a) * radius, pos.y + Math.sin(a) * radius * 0.3, pos.z + Math.sin(a) * radius,
        Math.cos(a) * speed, rand(-0.2, 0.4), Math.sin(a) * speed,
        rand(0.5, 0.9), size, color.r, color.g, color.b, 2.4, 0,
      );
    }
  }

  /** A few drifting embers behind a moving sword. */
  trail(pos, vel, color = VIOLET, amount = 1) {
    const p = this.particles;
    const n = Math.min(4, Math.ceil(amount));
    for (let i = 0; i < n; i++) {
      p.emit(
        pos.x + rand(-0.12, 0.12), pos.y + rand(-0.5, 0.5), pos.z + rand(-0.12, 0.12),
        -vel.x * 0.05 + rand(-0.25, 0.25), -vel.y * 0.05 + rand(-0.1, 0.3), -vel.z * 0.05 + rand(-0.25, 0.25),
        rand(0.35, 0.7), rand(0.06, 0.12), color.r, color.g, color.b, 2.2, 0,
      );
    }
  }

  /** Streak of particles along a segment (dash afterimage). */
  streak(from, to, color = SILVER, count = 26, size = 0.12) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const c = t > 0.5 ? color : VIOLET;
      p.emit(
        from.x + (to.x - from.x) * t + rand(-0.06, 0.06),
        from.y + (to.y - from.y) * t + rand(-0.06, 0.06),
        from.z + (to.z - from.z) * t + rand(-0.06, 0.06),
        rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3),
        0.3 + t * 0.45, size * (0.5 + t * 0.7), c.r, c.g, c.b, 2.6, 0,
      );
    }
  }

  /** Glowing motes rising from a point (summon). */
  rise(pos, color = VIOLET, count = 30, spread = 1.2) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * spread;
      p.emit(
        pos.x + Math.cos(a) * r, pos.y - 0.5 + rand(-0.3, 0.3), pos.z + Math.sin(a) * r,
        rand(-0.2, 0.2), rand(1.2, 3), rand(-0.2, 0.2),
        rand(0.8, 1.6), rand(0.06, 0.14), color.r, color.g, color.b, 0.8, 0,
      );
    }
  }

  /* ------------------------------ rings ------------------------------ */

  shockwave(pos, color = VIOLET, max = 3, dur = 0.7, floor = false) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.max = max;
    r.floor = floor;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    if (floor) {
      r.mesh.position.y = FLOOR_Y + 0.32;
      r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    }
    r.mesh.material.color.copy(color);
    r.mesh.scale.setScalar(0.01);
    r.mesh.material.opacity = 0.9;
  }

  /* ------------------------------ sigil ------------------------------ */

  /** Keep a rotating rune circle on the floor (fades out when `on` is false). */
  setSigil(on, x = 0, z = 0, radius = 3, spinSpeed = 0.25) {
    const s = this.sigilState;
    s.on = on;
    if (on) {
      s.x = x;
      s.z = z;
      s.radius = radius;
      s.spinSpeed = spinSpeed;
    }
  }
  boostSigil(v = 1) {
    this.sigilState.boost = Math.max(this.sigilState.boost, v);
  }

  /* ------------------------------ beam ------------------------------- */

  lightBeam(x, z, dur = 2.2, width = 1.4) {
    const b = this.beamState;
    b.active = true;
    b.t = 0;
    b.dur = dur;
    b.x = x;
    b.z = z;
    b.width = width;
    this.beam.visible = true;
    this.beam.position.set(x, FLOOR_Y + 8, z);
  }

  /* ------------------------------ frame ------------------------------ */

  update(dt) {
    // rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = easeOutCubic(k);
      r.mesh.scale.setScalar(Math.max(0.01, r.max * e));
      r.mesh.material.opacity = (1 - k) * (1 - k) * 0.95;
      if (!r.floor) r.mesh.quaternion.copy(this.sm.camera.quaternion);
    }

    // sigil
    const s = this.sigilState;
    s.boost = damp(s.boost, 0, 2.2, dt);
    s.alpha = damp(s.alpha, s.on ? 0.55 : 0, s.on ? 4 : 2.2, dt);
    s.curRadius = damp(s.curRadius, s.radius, 5, dt);
    s.spin += dt * (s.spinSpeed + s.boost * 2.2);
    const visible = s.alpha > 0.01;
    this.sigil.visible = visible;
    if (visible) {
      this.sigil.position.x = s.x;
      this.sigil.position.z = s.z;
      this.sigil.scale.setScalar(s.curRadius);
      this.sigil.rotation.z = s.spin;
      this.sigilMat.opacity = clamp(s.alpha + s.boost * 0.4, 0, 1);
    }

    // beam
    const b = this.beamState;
    if (b.active) {
      b.t += dt;
      const k = b.t / b.dur;
      if (k >= 1) {
        b.active = false;
        this.beam.visible = false;
      } else {
        const env = Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * (1 - Math.pow(k, 3));
        this.beamMat.opacity = env * 0.75;
        const w = b.width * (0.7 + 0.5 * env);
        this.beam.scale.set(w, 1, w);
      }
    }
  }

  clear() {
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    this.beamState.active = false;
    this.beam.visible = false;
    this.sigilState.on = false;
    this.sigilState.alpha = 0;
    this.sigil.visible = false;
    this.particles.clear();
  }
}
