import * as THREE from 'three';
import { KAT, NOISE_GLSL, SH_A, SH_B } from './Katana.js';
import { PX, TAU, clamp01, easeIO, mulberry, sstep } from './WeaponKit.js';

/**
 * THE PURPLE AWAKENING: the katana's entry animation.
 *
 * This is the reference's timeline ported into the weapon's own local space:
 * every visual (reveal, rune sweep, sheath slide + dissolve, blade sweep,
 * flash, aura, GPU particles) is a pure function of the animation clock, so
 * it can be started, finished or cancelled at any instant and never replays
 * on tracking updates.
 *
 *   Phase 1  SUMMONING        dim violet motes, the light shaft opens, the katana materialises
 *   Phase 2  RUNE AWAKENING   runes ignite along the sheath, glow intensifies, particles gather on it
 *   Phase 3  UNSHEATHING      blade slides out (curved reveal), violet flash rides the edge
 *   Phase 4  SHEATH DISSOLVE  sheath slides off and dissolves into ~7000 particles that spiral round the blade
 *   Phase 5  PRESENTATION     particles disperse, embers + aura remain, a slow roll, hand control fades in
 *
 * The reference runs 36 s; the app plays it at SPEED x so the whole sequence
 * lasts ~13 s while keeping every easing and ratio.
 */

export const AWAKEN = {
  SPEED: 2.6,
  // reference-clock keyframes (seconds on the Purple Awakening timeline)
  TL: {
    reveal: [0.8, 4.2],
    runes: [3.4, 9.5],
    gather: [1.0, 13.2],
    draw: [12.8, 18.6],
    dis: [13.4, 19.4],
    disperse: 25.0,
    roll: [27.0, 33.5],
    handoff: [20.5, 29.5],
  },
};
AWAKEN.DURATION = AWAKEN.TL.roll[1] / AWAKEN.SPEED; // real seconds until fully ready
const { TL } = AWAKEN;
const Z = (T, a) => clamp01((T - a[0]) / (a[1] - a[0]));

export function awakeningState(T) {
  const { L } = KAT;
  const dr = Z(T, TL.draw);
  const hold = clamp01((dr - 0.06) / 0.94);
  const d = (L + 0.12) * easeIO(hold);
  const energy = sstep(TL.gather[0] + 2, TL.gather[1], T);
  return {
    d,
    dr,
    reveal: Z(T, TL.reveal),
    rollP: easeIO(Z(T, TL.roll)),
    energy,
    awake: sstep(TL.draw[0], TL.draw[1], T),
    rune: Z(T, TL.runes),
    runeI: sstep(TL.runes[0], TL.runes[0] + 1.5, T),
    dis: Z(T, TL.dis),
    aura: sstep(TL.disperse - 3, TL.disperse + 3, T),
    sweep: clamp01(d / L * 1.02 + 0.02) * 1.2 * (dr > 0 ? 1 : 0),
    flash: Math.sin(Math.PI * clamp01(dr)) * (dr > 0 && dr < 1 ? 1 : 0),
    handoff: sstep(TL.handoff[0], TL.handoff[1], T),
  };
}

const YAW0 = -0.12;
const YAW_END = 0.33;
const bodyYaw = (st, T) => YAW0 + (YAW_END - YAW0 + TAU) * st.rollP + (T > TL.roll[1] ? 0.04 * Math.sin(T * 0.7) : 0);

/** sheath pose in body space for a given sheath travel d */
function sheathPose(d) {
  const a = KAT.KAPPA * d;
  return { a, x: KAT.RC - KAT.RC * Math.cos(a), y: -KAT.RC * Math.sin(a) };
}

/* ------------------------------------------------------------------ */
/* GPU particle shaders (positions derive purely from uT)               */
/* ------------------------------------------------------------------ */

const COMMON = /* glsl */ `
#define K 0.12
uniform float uYaw; uniform float uK;
vec3 bl(float s,float th,float r){ float ph=K*s; vec3 c=vec3((1.-cos(ph))/K,-sin(ph)/K,0.); vec3 n=vec3(cos(ph),sin(ph),0.); return c + r*(cos(th)*n+sin(th)*vec3(0.,0.,1.)); }
// body frame (blade along -Y, yaw about the blade axis) -> weapon frame (tip up)
vec3 toR(vec3 b){ float c=cos(uYaw), s=sin(uYaw); vec3 y=vec3(c*b.x+s*b.z, b.y, -s*b.x+c*b.z); return vec3(-y.x, -y.y - ${KAT.CENTER.toFixed(4)}, y.z); }
`;

const DIS_VS = /* glsl */ `
attribute vec3 aP; attribute vec3 aV; attribute vec4 aR; attribute float aTe;
uniform float uT,uTd,uPx; varying float vA; varying vec3 vC;
${COMMON}
vec3 posA(float t){ float age=max(t-aTe,0.); return aP + aV*(age-0.12*age*age) + 0.05*vec3(sin(age*2.1+aR.x*6.28),cos(age*1.7+aR.y*6.28),sin(age*1.3+aR.z*6.28)); }
void main(){
  float T=uT, te=aTe, ts=te+0.7+aR.x*0.9, td=uTd+aR.y*1.8, life=2.6+aR.z*1.8;
  float age=T-te, vis=step(0.,age)*step(T,td+life);
  float tt=max(T-ts,0.), disp=max(T-td,0.);
  vec3 pa=posA(min(T,ts));
  float sT=mix(-0.85,2.3,fract(aR.w*7.31+aR.x*3.7));
  float s=sT+0.32*sin(0.8*tt+aR.w*6.283)+disp*0.25*(aR.w-0.5);
  float sg=aR.z>0.5?1.:-1.;
  float th=aR.z*37.+sg*(2.0+1.6*aR.x)*tt + disp*0.6*sg;
  float r=0.2+0.42*aR.y+0.05*sin(tt*1.7+aR.x*9.)+disp*(0.45+0.9*aR.x);
  vec3 ps=toR(bl(s,th,r)) + aV*disp*0.35 + vec3(0.,disp*0.28*(0.4+aR.y),0.);
  vec3 pos=mix(pa,ps,smoothstep(0.,1.1,tt));
  float fi=smoothstep(0.,0.18,age), fo=1.-smoothstep(0.55,1.,disp/life);
  vA=0.45*fi*fo*(0.75+0.25*sin(T*9.+aR.w*50.))*vis;
  float k=smoothstep(0.,1.4,age);
  vC=mix(vec3(0.95,0.75,1.0),vec3(0.55,0.2,1.0),k)*(0.6+1.0*aR.w);
  float sz=mix(0.012,0.038,aR.w*aR.w)*(1.+1.6*exp(-age*5.))*fo;
  vec4 mv=modelViewMatrix*vec4(pos,1.);
  gl_PointSize=uPx*sz*uK/-mv.z;
  gl_Position=vis>0.5?projectionMatrix*mv:vec4(2.,2.,2.,1.);
}`;

const GATH_VS = /* glsl */ `
attribute vec4 aR; attribute vec4 aR2; uniform float uT,uG0,uG1,uPx; varying float vA; varying vec3 vC;
${COMMON}
void main(){
  float dur=2.4+aR.y*1.6, tg=uG0+aR.x*(uG1-uG0-dur-0.5), k=(uT-tg)/dur;
  float vis=step(0.,k)*step(k,1.);
  float kk=pow(clamp(k,0.,1.),1.6);
  float r=mix(aR2.x*1.7+0.6,0.12,kk);
  float th=aR2.y*6.283+(2.2+aR.z*2.)*(clamp(k,0.,1.)*2.5)*(aR.w>0.5?1.:-1.);
  float s=mix(aR2.z*3.0-0.5,aR2.w*2.2+0.1,kk);
  vec3 pos=toR(bl(s,th,r));
  vA=0.7*smoothstep(0.,0.15,k)*(1.-smoothstep(0.82,1.,k))*vis;
  vC=mix(vec3(0.5,0.18,1.0),vec3(0.95,0.7,1.0),kk)*(0.7+1.0*aR.w);
  vec4 mv=modelViewMatrix*vec4(pos,1.);
  gl_PointSize=uPx*(0.014+0.03*aR.z*aR.z)*uK/-mv.z;
  gl_Position=vis>0.5?projectionMatrix*mv:vec4(2.,2.,2.,1.);
}`;

const AURA_VS = /* glsl */ `
attribute vec4 aR; uniform float uT,uPx,uAura; varying float vA; varying vec3 vC;
${COMMON}
void main(){
  float life=3.+aR.x*3.5, p=fract(uT/life+aR.y);
  float s=mix(2.4,-1.0,p), th=aR.z*6.283+(0.8+aR.w)*uT*(aR.x>0.5?1.:-1.);
  float r=0.14+0.32*aR.w+0.05*sin(uT+aR.y*20.);
  vec3 pos=toR(bl(s,th,r));
  vA=sin(3.14159*p)*uAura*(0.6+0.4*sin(uT*3.+aR.z*40.));
  vC=mix(vec3(0.5,0.2,1.0),vec3(0.9,0.7,1.0),aR.w)*(1.2+1.5*aR.z);
  vec4 mv=modelViewMatrix*vec4(pos,1.);
  gl_PointSize=uPx*(0.012+0.026*aR.w)*uK/-mv.z;
  gl_Position=projectionMatrix*mv;
}`;

const PFS = /* glsl */ `varying float vA; varying vec3 vC; void main(){ vec2 c=gl_PointCoord-.5; float d=length(c)*2.; if(d>1.) discard; float a=pow(1.-d,1.25); gl_FragColor=vec4(vC*a, a*vA); }`;

const SHAFT_VS = /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP;
void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=-mv.xyz; vY=position.y/8.+0.5; vP=position; gl_Position=projectionMatrix*mv; }`;
const SHAFT_FS = /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP; uniform float uInt,uT;
${NOISE_GLSL}
void main(){ float f=pow(abs(dot(normalize(vN),normalize(vV))),1.4); float g=smoothstep(0.0,0.75,1.0-vY);
  float ray=0.6+0.8*fbm(vec3(atan(vP.x,vP.z)*3.0, vY*1.5, uT*0.05));
  float a=f*g*ray*uInt; gl_FragColor=vec4(vec3(0.55,0.4,1.0)*a, a); }`;

const attr = (g, name, arr, n) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(arr), n));

/* ------------------------------------------------------------------ */
/* Controller                                                           */
/* ------------------------------------------------------------------ */

export class KatanaAwakening {
  /** @param {THREE.Group} model  the katana root from buildKatana({ full: true }) */
  constructor(model) {
    this.model = model;
    this.parts = model.userData.parts;
    this.U = model.userData.U;
    this.t = 0;
    this.state = 'idle'; // 'idle' | 'running' | 'done'
    this.phase = 'none';
    this.handoff = 1;
    this.onPhase = null; // (name) => void
    this._fired = new Set();
    this.last = awakeningState(1e3);

    this.PU = {
      uT: { value: 0 },
      uPx: PX,
      uTd: { value: TL.disperse },
      uG0: { value: TL.gather[0] },
      uG1: { value: TL.gather[1] },
      uAura: { value: 0 },
      uK: { value: 0.9 },
      uYaw: { value: 0 },
    };
    this._build();
    this._setVisible(false);
  }

  /* ------------------------- construction -------------------------- */

  _pmat(vs) {
    return new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: PFS,
      uniforms: this.PU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  _points(geo, mat, order = 6) {
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    p.renderOrder = order;
    this.parts.scaleG.add(p);
    return p;
  }

  _build() {
    const { L, KAPPA } = KAT;
    this.geos = [];
    this.mats = [];

    // 1) sheath dissolve: baked from the sheath's pose at the instant each particle is released
    {
      const N = 7000;
      const g = new THREE.BufferGeometry();
      const rng = mulberry(101);
      const P = [];
      const V = [];
      const R = [];
      const Te = [];
      const local = new THREE.Vector3();
      const v = new THREE.Vector3();
      const m = new THREE.Matrix4();
      const qz = new THREE.Quaternion();
      const qy = new THREE.Quaternion();
      const axisZ = new THREE.Vector3(0, 0, 1);
      const axisY = new THREE.Vector3(0, 1, 0);
      const poseAt = (T) => {
        const st = awakeningState(T);
        const sp = sheathPose(st.d);
        qz.setFromAxisAngle(axisZ, sp.a);
        m.compose(new THREE.Vector3(sp.x, sp.y, 0), qz, new THREE.Vector3(1, 1, 1));
        qy.setFromAxisAngle(axisY, bodyYaw(st, T));
        return new THREE.Matrix4().makeRotationFromQuaternion(qy).multiply(m);
      };
      for (let i = 0; i < N; i++) {
        let s;
        if (i < N - 300) {
          s = 0.05 + rng() * L;
          const jt = rng() * TAU;
          const A = SH_A(s / L);
          const phi = KAPPA * s;
          local.set((1 - Math.cos(phi)) / KAPPA + Math.cos(phi) * A * Math.cos(jt), -Math.sin(phi) / KAPPA + Math.sin(phi) * A * Math.cos(jt), SH_B * Math.sin(jt));
        } else {
          s = 0.62 + (rng() - 0.5) * 0.1;
          const phi = KAPPA * s;
          local.set(
            (1 - Math.cos(phi)) / KAPPA - 0.1 * Math.cos(phi) - 0.03,
            -Math.sin(phi) / KAPPA - 0.1 * Math.sin(phi) - 0.05 - rng() * 0.36,
            0.03 + (rng() - 0.5) * 0.04,
          );
        }
        const u = clamp01(-local.y / 2.55);
        const field = u * 0.72 + 0.28 * (0.3 + 0.35 * (rng() + rng()));
        const te = TL.dis[0] + ((field + 0.12) / 1.2) * (TL.dis[1] - TL.dis[0]);
        v.copy(local).applyMatrix4(poseAt(te)); // body frame
        P.push(-v.x, -v.y - KAT.CENTER, v.z); // -> weapon frame (same as toR with yaw already applied)
        V.push((rng() - 0.5) * 0.5, 0.15 + rng() * 0.45, (rng() - 0.5) * 0.5);
        R.push(rng(), rng(), rng(), rng());
        Te.push(te);
      }
      attr(g, 'position', new Array(N * 3).fill(0), 3);
      attr(g, 'aP', P, 3);
      attr(g, 'aV', V, 3);
      attr(g, 'aR', R, 4);
      attr(g, 'aTe', Te, 1);
      const mat = this._pmat(DIS_VS);
      this.dis = this._points(g, mat);
      this.geos.push(g);
      this.mats.push(mat);
    }

    // 2) gathering energy
    {
      const N = 2600;
      const g = new THREE.BufferGeometry();
      const rng = mulberry(202);
      const R = [];
      const R2 = [];
      for (let i = 0; i < N; i++) {
        R.push(rng(), rng(), rng(), rng());
        R2.push(rng(), rng(), rng(), rng());
      }
      attr(g, 'position', new Array(N * 3).fill(0), 3);
      attr(g, 'aR', R, 4);
      attr(g, 'aR2', R2, 4);
      const mat = this._pmat(GATH_VS);
      this.gather = this._points(g, mat);
      this.geos.push(g);
      this.mats.push(mat);
    }

    // 3) aura embers
    {
      const N = 900;
      const g = new THREE.BufferGeometry();
      const rng = mulberry(303);
      const R = [];
      for (let i = 0; i < N; i++) R.push(rng(), rng(), rng(), rng());
      attr(g, 'position', new Array(N * 3).fill(0), 3);
      attr(g, 'aR', R, 4);
      const mat = this._pmat(AURA_VS);
      this.aura = this._points(g, mat);
      this.geos.push(g);
      this.mats.push(mat);
    }

    // light shaft
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uInt: { value: 0 }, uT: { value: 0 } },
      vertexShader: SHAFT_VS,
      fragmentShader: SHAFT_FS,
    });
    this.shaft = new THREE.Mesh(new THREE.ConeGeometry(1.7, 8, 36, 1, true), this.shaftMat);
    this.shaft.position.set(0.3, 3.4, -0.5);
    this.shaft.rotation.z = 0.1;
    this.shaft.renderOrder = 3;
    this.shaft.frustumCulled = false;
    this.parts.scaleG.add(this.shaft);
  }

  _setVisible(v, { aura = v } = {}) {
    this.dis.visible = v;
    this.gather.visible = v;
    this.shaft.visible = v;
    this.aura.visible = aura;
  }

  /* --------------------------- control ----------------------------- */

  /** Begin the sequence from the top. No-op while already running (never replays by itself). */
  start() {
    if (this.state === 'running') return;
    this.t = 0;
    this.state = 'running';
    this.phase = 'none';
    this.handoff = 0;
    this._fired.clear();
    this._setVisible(true);
    this._apply(0, 0);
    this._emit('summon');
  }

  /** Jump to the finished ("alive") pose: blade out, sheath gone, embers drifting. */
  finish() {
    this._apply(TL.roll[1] + 1, 0);
    this.t = AWAKEN.DURATION + 0.01;
    this.state = 'done';
    this.handoff = 1;
    this._setVisible(false, { aura: true });
    this.U.uReveal.value = 9;
  }

  /** Abort a running sequence and rest in the finished pose (used when switching weapons or on skip). */
  cancel() {
    this.finish();
  }

  get running() {
    return this.state === 'running';
  }
  get elapsed() {
    return this.t;
  }

  _emit(name) {
    if (this._fired.has(name)) return;
    this._fired.add(name);
    this.phase = name;
    this.onPhase?.(name);
  }

  /* ----------------------------- frame ----------------------------- */

  /** called every frame by the weapon's tick hook */
  update(dt, time, sword) {
    if (this.state !== 'running') return;
    this._tick(Math.min(dt, 0.05), time, sword);
  }

  _tick(dt, time, sword) {
    this.t += dt;
    const T = this.t * AWAKEN.SPEED;
    if (T >= TL.reveal[0]) this._emit('materialise');
    if (T >= TL.runes[0]) this._emit('runes');
    if (T >= TL.draw[0]) this._emit('unsheathe');
    if (T >= (TL.draw[0] + TL.draw[1]) / 2) this._emit('flash');
    if (T >= TL.dis[0]) this._emit('dissolve');
    if (T >= TL.disperse) this._emit('present');
    const st = this._apply(T, time, sword);
    if (T >= TL.roll[1]) {
      this.state = 'done';
      this.handoff = 1;
      // only the long-lived embers remain after the show
      this._setVisible(false, { aura: true });
      this.U.uReveal.value = 9;
      this._emit('ready');
    }
    return st;
  }

  _apply(T, time, sword) {
    const st = awakeningState(T);
    this.last = st;
    this.handoff = st.handoff;
    const { U, parts, PU } = this;

    // sheath slide + body roll
    const sp = sheathPose(st.d);
    if (parts.sheathG) {
      parts.sheathG.rotation.set(0, 0, sp.a);
      parts.sheathG.position.set(sp.x, sp.y, 0);
      parts.sheathG.visible = st.dis < 1;
    }
    const yaw = bodyYaw(st, T);
    parts.body.rotation.y = yaw;
    parts.body.updateWorldMatrix(true, true);
    U.uBodyInv.value.copy(parts.body.matrixWorld).invert();
    if (parts.sheathG) U.uSheathInv.value.copy(parts.sheathG.matrixWorld).invert();

    U.uTime.value = T;
    U.uReveal.value = st.reveal >= 1 ? 9 : st.reveal * 1.1;
    U.uDis.value = st.dis;
    U.uRune.value = st.rune;
    U.uRuneI.value = st.runeI * (0.8 + 0.5 * st.energy);
    U.uSweep.value = st.sweep;
    U.uBladeI.value = st.awake;
    U.uFlash.value = st.flash * 2.5;
    const M = this.model.userData.materials;
    M.sheath.emissiveIntensity = 2.2 + 1.8 * st.energy * (1 - st.dis);

    if (parts.tassel) {
      parts.tassel.rotation.z = 0.06 * Math.sin(T * 1.3) + 0.03 * Math.sin(T * 2.3 + 1);
      parts.tassel.rotation.x = 0.04 * Math.sin(T * 1.1 + 2);
    }
    const pulse = 0.85 + 0.15 * Math.sin(T * 2.4);
    const bladeGlow = st.awake * (0.7 + 0.3 * pulse);
    parts.auras.forEach((s, i) => {
      s.material.opacity = (0.04 + 0.07 * st.aura) * bladeGlow * (0.8 + 0.2 * Math.sin(T * 1.6 + i)) * Math.min(1, st.sweep);
      s.scale.setScalar(1.1 + 0.5 * st.aura + 0.1 * Math.sin(T + i));
    });
    parts.flash.material.opacity = st.flash * 0.45;
    parts.flash.scale.setScalar(0.35 + st.flash * 0.6);

    PU.uT.value = T;
    PU.uAura.value = st.aura;
    PU.uYaw.value = yaw;
    const wk = sword ? sword.group.scale.x * parts.scaleG.scale.x : 0.9;
    PU.uK.value = wk; // particle sizes are authored in weapon-frame units; world size = size x world scale
    this.shaftMat.uniforms.uT.value = T;
    this.shaftMat.uniforms.uInt.value = (0.04 + 0.05 * st.energy + 0.03 * st.awake) * sstep(0, 1.5, T) * (1 - 0.6 * st.aura);
    return st;
  }

  /** Called every frame once the show is over: keeps the embers alive. */
  idle(time, sword) {
    this.PU.uT.value = 40 + time * AWAKEN.SPEED * 0.6;
    this.PU.uAura.value = 1;
    this.PU.uYaw.value = this.parts.body.rotation.y;
    if (sword) this.PU.uK.value = sword.group.scale.x * this.parts.scaleG.scale.x;
  }

  /** Energy level 0..1 that the lighting rig should add while the awakening plays. */
  get lightBoost() {
    if (this.state !== 'running') return 0;
    const s = this.last;
    return 0.25 * s.energy + 0.5 * s.flash + 0.15 * s.awake * (1 - s.aura);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.shaft.geometry.dispose();
    this.shaftMat.dispose();
    this.dis.removeFromParent();
    this.gather.removeFromParent();
    this.aura.removeFromParent();
    this.shaft.removeFromParent();
  }
}

/**
 * Per-frame glow + ember behaviour once the katana is "alive" (and for lite
 * katanas): the blade glow follows the Sword's glow level, dash/spin flashes
 * ride the edge.
 */
export function katanaIdleTick(model, dt, time, sword) {
  const { U, parts, materials } = model.userData;
  const g = Math.max(0, Math.min(2, sword.glow));
  U.uTime.value = time;
  model.userData.awakening?.idle(time, sword);
  U.uBladeI.value = 0.75 + 0.3 * g;
  U.uFlash.value = 0;
  U.uSweep.value = 1.2;
  materials.blade.emissiveIntensity = 0.45 + 0.35 * g;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + sword.phase);
  parts.auras.forEach((s, i) => {
    s.material.opacity = (0.05 + 0.05 * g) * (0.8 + 0.2 * Math.sin(time * 1.6 + i)) * (0.8 + 0.4 * pulse);
    s.scale.setScalar(1.3 + 0.35 * g);
  });
  parts.flash.material.opacity = Math.max(0, g - 1) * 0.5;
  parts.flash.scale.setScalar(0.5 + Math.max(0, g - 1));
}

