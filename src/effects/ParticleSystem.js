import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(0.0, aSize * uScale / max(0.1, -mv.z));
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    if (a * vAlpha < 0.004) discard;
    gl_FragColor = vec4(vColor * (0.6 + a), a * vAlpha);
  }
`;

/**
 * Fully pooled GPU point-sprite particle system.
 * A fixed ring buffer of `capacity` particles is allocated once; emit() recycles
 * the oldest slot, so no objects are created or destroyed at runtime.
 */
export class ParticleSystem {
  constructor(capacity = 2600) {
    this.capacity = capacity;
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); // rendered size
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n); // remaining seconds (<=0 means dead)
    this.maxLife = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.grow = new Float32Array(n); // size over life: <0 shrink, >0 grow
    this.cursor = 0;
    this.alive = 0;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Keep point sizes consistent in world units regardless of resolution. */
  setViewport(heightPx, fovDeg, pixelRatio = 1) {
    const f = (heightPx * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.material.uniforms.uScale.value = f;
  }

  /**
   * @param {number} life seconds
   * @param {number} size world-units diameter
   * @param {number} grow -1 shrinks to nothing, 0 constant, >0 swells
   */
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, drag = 1.2, gravity = 0, grow = -1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    if (this.life[i] <= 0) this.alive++;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
    this.grow[i] = grow;
    this.size[i] = size;
    this.alpha[i] = 1;
  }

  /** Emit using a THREE.Color for convenience. */
  emitC(p, v, life, size, color, drag, gravity, grow) {
    this.emit(p.x, p.y, p.z, v.x, v.y, v.z, life, size, color.r, color.g, color.b, drag, gravity, grow);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const n = this.capacity;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0;
          this.alpha[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.gravity[i] * dt;
      this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i]; // 1 -> 0
      const g = this.grow[i];
      this.size[i] = this.baseSize[i] * (g < 0 ? Math.pow(t, 0.8) : g > 0 ? 1 + (1 - t) * g : 1);
      this.alpha[i] = Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 14 + 0.25);
    }
    this.alive = alive;
    const a = this.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aColor.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
    this.alpha.fill(0);
    this.alive = 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
