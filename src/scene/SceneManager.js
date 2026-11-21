import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LightingManager } from './LightingManager.js';
import { lerp, damp, clamp } from '../utils/MathUtils.js';

const _ray = new THREE.Vector3();

const FOV = 48;
const CAM_Z = 10;
export const FLOOR_Y = -4.3;
const Z_FAR_STAGE = -4.2; // depth 0
const Z_NEAR_STAGE = 3.4; // depth 1

const DUST_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vA;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * (0.08 + aSeed.x * 0.12) + 5.0, 14.0) - 5.5;
    p.x += sin(uTime * 0.2 + aSeed.y * 6.28) * 0.6;
    p.z += cos(uTime * 0.17 + aSeed.z * 6.28) * 0.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.025 + aSeed.w * 0.04) * uScale / max(0.1, -mv.z);
    vA = 0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * 0.9 + aSeed.y * 20.0));
  }
`;
const DUST_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.62, 0.55, 0.85), a * a * vA * 0.55);
  }
`;

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050409);
    this.scene.fog = new THREE.FogExp2(0x07050d, 0.034);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 90);
    this.camera.position.set(0, 0.2, CAM_Z);
    this.baseCamPos = new THREE.Vector3().copy(this.camera.position);
    this.lookAt = new THREE.Vector3(0, -0.2, 0);
    this.camera.lookAt(this.lookAt);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'stage-canvas';
    container.appendChild(this.renderer.domElement);

    this.quality = 2;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    this.shakeAmount = 0;
    this.time = 0;
    this.dustMat = null;
    this.rose = null;

    this._buildEnvironmentMap();
    this.lighting = new LightingManager(this.scene);
    this._buildChamber();
    this._buildDust();

    this.composer = null;
    this.bloom = null;
    this._buildComposer();

    this._onResize = this.resize.bind(this);
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(container);
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  /* ------------------------- environment map ------------------------- */

  _buildEnvironmentMap() {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: 0x0b0912, side: THREE.BackSide })));
    const panel = (w, h, color, mult, pos, look) => {
      const c = new THREE.Color(color).multiplyScalar(mult);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(...look);
      env.add(m);
    };
    panel(16, 2.4, 0xe4e8ff, 7, [0, 12, 2], [0, 0, 0]);
    panel(2.4, 14, 0x9a5cff, 4, [-12, 2, 0], [0, 0, 0]);
    panel(2.2, 12, 0xcfd6ff, 5, [12, 3, 4], [0, 0, 0]);
    panel(10, 3, 0x6a3cd8, 3.5, [0, -3, -12], [0, 0, 0]);
    panel(8, 1.6, 0xffffff, 3, [0, 4, 13], [0, 0, 0]);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(env, 0.03).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
    env.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }

  /* ------------------------------ chamber ----------------------------- */

  _buildChamber() {
    const chamber = new THREE.Group();
    chamber.name = 'chamber';
    this.scene.add(chamber);

    // floor with tiled stone texture
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#14121a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 16 + Math.random() * 14;
      g.fillStyle = `rgb(${v},${v - 1},${v + 6})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 2 + Math.random() * 6);
    }
    g.strokeStyle = '#05040a';
    g.lineWidth = 5;
    g.strokeRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(150,110,255,0.10)';
    g.lineWidth = 1;
    g.strokeRect(6, 6, 244, 244);
    const floorTex = new THREE.CanvasTexture(c);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(14, 14);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.anisotropy = 8;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.55, envMapIntensity: 0.6 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, -14);
    floor.receiveShadow = true;
    chamber.add(floor);
    this.floor = floor;

    // back wall
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), new THREE.MeshStandardMaterial({ color: 0x0a0910, roughness: 0.95, metalness: 0.1 }));
    wall.position.set(0, 6, -26);
    chamber.add(wall);

    // gothic lancet windows with soft light shafts
    const arch = new THREE.Shape();
    const w = 1.1;
    const h = 6.4;
    arch.moveTo(-w, 0);
    arch.lineTo(-w, h);
    arch.quadraticCurveTo(-w, h + 1.6, 0, h + 2.6);
    arch.quadraticCurveTo(w, h + 1.6, w, h);
    arch.lineTo(w, 0);
    arch.closePath();
    const archGeo = new THREE.ShapeGeometry(arch, 12);
    const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5b2fb8).multiplyScalar(1.6), toneMapped: false, fog: true });
    const shaftTex = this._shaftTexture();
    const shaftMat = new THREE.MeshBasicMaterial({
      map: shaftTex,
      color: 0x8c5cff,
      transparent: true,
      opacity: 0.17,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const winX = [-14, -8, 8, 14];
    for (const x of winX) {
      const win = new THREE.Mesh(archGeo, winMat);
      win.position.set(x, -3.2, -25.5);
      chamber.add(win);
      // mullion
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, h + 2, 0.1), new THREE.MeshBasicMaterial({ color: 0x07060b }));
      bar.position.set(x, -3.2 + (h + 2) / 2, -25.4);
      chamber.add(bar);
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 20), shaftMat);
      shaft.position.set(x * 0.8, 3, -17);
      shaft.rotation.z = -Math.sign(x) * 0.1;
      shaft.rotation.y = Math.sign(x) * 0.25;
      chamber.add(shaft);
    }

    // rose window
    const rose = new THREE.Group();
    const roseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a52ff).multiplyScalar(2.1), toneMapped: false });
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x08060d });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a1f78).multiplyScalar(1.1), toneMapped: false }));
    rose.add(disc);
    for (let i = 0; i < 12; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.1, 8.4, 0.05), darkMat);
      spoke.rotation.z = (i / 12) * Math.PI;
      spoke.position.z = 0.02;
      rose.add(spoke);
    }
    for (const r of [4.2, 2.8, 1.4]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r === 4.2 ? 0.2 : 0.09, 6, 64), r === 4.2 ? darkMat : roseMat);
      ring.position.z = 0.03;
      rose.add(ring);
    }
    const petals = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.55, 5), roseMat);
      p.position.set(Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0.04);
      p.rotation.z = a;
      petals.add(p);
    }
    rose.add(petals);
    rose.position.set(0, 5.4, -25.2);
    chamber.add(rose);
    this.rose = rose;
    this.rosePetals = petals;

    // pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0f0d15, roughness: 0.7, metalness: 0.35 });
    const shaftGeo = new THREE.CylinderGeometry(0.62, 0.7, 34, 14, 1);
    const baseGeo = new THREE.CylinderGeometry(0.95, 1.1, 0.9, 14);
    const capGeo = new THREE.CylinderGeometry(1.05, 0.7, 0.9, 14);
    const pz = [-2, -8, -14, -20];
    for (const side of [-1, 1]) {
      for (const z of pz) {
        const x = side * (9.2 + (z < -10 ? 2 : 0));
        const col = new THREE.Mesh(shaftGeo, pillarMat);
        col.position.set(x, FLOOR_Y + 17, z);
        const base = new THREE.Mesh(baseGeo, pillarMat);
        base.position.set(x, FLOOR_Y + 0.45, z);
        const cap = new THREE.Mesh(capGeo, pillarMat);
        cap.position.set(x, FLOOR_Y + 7.5, z);
        chamber.add(col, base, cap);
      }
    }

    // low steps / dais ring under the play area
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.6, 0.25, 48),
      new THREE.MeshStandardMaterial({ color: 0x100e17, roughness: 0.4, metalness: 0.7 }),
    );
    dais.position.set(0, FLOOR_Y + 0.12, -1);
    dais.receiveShadow = true;
    chamber.add(dais);
    const daisRing = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 0.03, 6, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa879ff).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.55 }),
    );
    daisRing.rotation.x = Math.PI / 2;
    daisRing.position.set(0, FLOOR_Y + 0.26, -1);
    chamber.add(daisRing);
  }

  _shaftTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0.0)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 256);
    const grad2 = g.createLinearGradient(0, 0, 64, 0);
    grad2.addColorStop(0, 'rgba(0,0,0,1)');
    grad2.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad2.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grad2;
    g.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _buildDust() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 1] = Math.random() * 14 - 5;
      pos[i * 3 + 2] = Math.random() * 20 - 15;
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, this.dustMat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  _buildComposer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * 0.5, size.y * 0.5), 0.7, 0.65, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /* ----------------------------- quality ----------------------------- */

  /** 2 = full (bloom + shadows), 1 = bloom only, 0 = lightweight. */
  setQuality(level) {
    this.quality = level;
    this.lighting.setShadows(level >= 2);
    this.renderer.shadowMap.enabled = level >= 2;
    this.maxPixelRatio = level >= 2 ? Math.min(window.devicePixelRatio || 1, 1.75) : level === 1 ? 1.25 : 1;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = this.maxPixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * 0.5, h * 0.5);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? FOV + 14 : FOV; // taller view on portrait screens
    this.camera.updateProjectionMatrix();
    this.dustMat.uniforms.uScale.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.viewport = { w, h, pr };
    this.onViewport?.(h, this.camera.fov, pr);
  }

  /* ----------------------------- mapping ----------------------------- */

  /**
   * Map NDC (-1..1) and depth (0..1) to a world position that appears under
   * the cursor/hand on screen at any depth.
   */
  worldFromNDC(nx, ny, depth, out = new THREE.Vector3()) {
    // Cast a ray through the screen point and intersect the stage plane at this
    // depth, so the sword always lands exactly under the cursor / hand marker.
    const z = lerp(Z_FAR_STAGE, Z_NEAR_STAGE, depth);
    _ray.set(clamp(nx, -0.96, 0.96), clamp(ny, -0.92, 0.92), 0.5).unproject(this.camera);
    _ray.sub(this.camera.position).normalize();
    const t = (z - this.camera.position.z) / _ray.z;
    out.copy(this.camera.position).addScaledVector(_ray, t);
    out.y = Math.max(FLOOR_Y + 1.1, out.y);
    return out;
  }

  /** World-space half extents of the stage at a depth (used by formations). */
  stageExtents(depth = 0.5) {
    const z = lerp(Z_FAR_STAGE, Z_NEAR_STAGE, depth);
    const dist = CAM_Z - z;
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * dist;
    return { halfW: halfH * this.camera.aspect * 0.8, halfH: halfH * 0.78, z };
  }

  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  setParallax(x, y) {
    this.parallax.tx = x;
    this.parallax.ty = y;
  }

  /* ------------------------------ frame ------------------------------ */

  update(dt, mainPos, glow) {
    this.time += dt;
    this.dustMat.uniforms.uTime.value = this.time;
    this.parallax.x = damp(this.parallax.x, this.parallax.tx, 3, dt);
    this.parallax.y = damp(this.parallax.y, this.parallax.ty, 3, dt);
    this.shakeAmount = damp(this.shakeAmount, 0, 6, dt);
    const s = this.shakeAmount;
    this.camera.position.set(
      this.baseCamPos.x + this.parallax.x * 0.55 + (Math.random() - 0.5) * s * 0.25,
      this.baseCamPos.y + this.parallax.y * 0.35 + (Math.random() - 0.5) * s * 0.25,
      this.baseCamPos.z,
    );
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
    if (this.rose) {
      this.rosePetals.rotation.z += dt * 0.05;
    }
    this.lighting.update(dt, mainPos, glow);
  }

  render() {
    if (this.quality >= 1) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._ro.disconnect();
    window.removeEventListener('resize', this._onResize);
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
