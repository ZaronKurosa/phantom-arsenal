import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  TAU,
  VIOLET,
  bladeEmissiveTex,
  ellipse,
  glowSprite,
  handleTextures,
  lerp,
  mulberry,
  sheathTextures,
  sstep,
  sweepGeometry,
} from './WeaponKit.js';

/**
 * GOTHIC KATANA: model.
 *
 * Geometry, textures and shader patches are ported from "Purple Awakening":
 * a 5-sided curved blade (arc of curvature KAPPA), tsuba guard with violet
 * gems, diamond-wrapped handle, filigree sheath with a rune-sweep emissive and
 * a noise-driven dissolve, and a tassel. The model is built in the reference's
 * local frame (guard at the origin, handle +Y, blade along -Y) and wrapped in a
 * flip group so that in the app it follows the "tip up" convention.
 *
 * The cinematic that drives it lives in KatanaAwakening.js.
 */

export const KAT = { L: 2.45, KAPPA: 0.12, HANDLE: 0.95, SCALE: 0.82, CENTER: 0.715 };
KAT.RC = 1 / KAT.KAPPA;
export const SH_A = (t) => lerp(0.118, 0.104, t);
export const SH_B = 0.085;

/* ------------------------------------------------------------------ */
/* Shader patch: reveal + sheath dissolve + blade sweep                 */
/* ------------------------------------------------------------------ */

export const NOISE_GLSL = /* glsl */ `
float h31(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.-2.*f);
 return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
`;

function makeUniforms() {
  return {
    uTime: { value: 0 },
    uDis: { value: 0 },
    uRune: { value: 1.2 },
    uRuneI: { value: 1 },
    uSweep: { value: 1.2 },
    uBladeI: { value: 1 },
    uFlash: { value: 0 },
    uReveal: { value: 9 },
    uSheathInv: { value: new THREE.Matrix4() },
    uBodyInv: { value: new THREE.Matrix4() },
  };
}

function patch(mat, kind, U) {
  mat.customProgramCacheKey = () => 'kat2_' + kind;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSP; varying vec3 vBP; varying vec2 vUv0; uniform mat4 uSheathInv; uniform mat4 uBodyInv;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvUv0 = uv; vec4 wp0 = modelMatrix * vec4(transformed,1.0); vSP = (uSheathInv * wp0).xyz; vBP = (uBodyInv * wp0).xyz;',
      );
    let fs = sh.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vSP; varying vec3 vBP; varying vec2 vUv0; uniform float uTime,uDis,uRune,uRuneI,uSweep,uBladeI,uFlash,uReveal;\n' + NOISE_GLSL,
    );
    // common prologue: materialisation front sweeping from the pommel to the tip
    let pro = `#include <clipping_planes_fragment>
      float rField = clamp((-vBP.y + 1.1) / 3.6, 0., 1.) * 0.75 + fbm(vBP * 6.0) * 0.25;
      float rFront = uReveal * 1.25 - 0.2;
      if (rField > rFront) discard;
      float rEdge = (1.0 - smoothstep(0.0, 0.07, rFront - rField)) * step(uReveal, 2.0);`;
    if (kind === 'sheath') {
      pro += `
        float ax = clamp(-vSP.y/2.55, 0., 1.);
        float nz = fbm(vSP*7.0 + vec3(0., uTime*0.05, 0.));
        float field = ax*0.72 + nz*0.28;
        float dd = uDis*1.2 - 0.12;
        if (field < dd) discard;
        float edgeBand = 1.0 - smoothstep(0.0, 0.07, field - dd);
        edgeBand *= step(0.001, uDis);`;
    } else {
      pro += '\n float edgeBand = 0.0;';
    }
    fs = fs.replace('#include <clipping_planes_fragment>', pro);
    let em = '#include <emissivemap_fragment>\n';
    if (kind === 'sheath') {
      em += `
        #ifdef USE_EMISSIVEMAP
          float rv = uRune*1.3;
          float rm = 1.0 - smoothstep(rv-0.18, rv, vUv0.x);
          float pulse = 0.7 + 0.3*sin(vUv0.x*18. - uTime*3.0);
          totalEmissiveRadiance *= rm * pulse * uRuneI;
        #endif`;
    } else if (kind === 'blade') {
      em += `
        float sw = 1.0 - smoothstep(uSweep-0.07, uSweep+0.01, vUv0.x);
        totalEmissiveRadiance *= sw * uBladeI * (0.88 + 0.12*sin(vUv0.x*38. - uTime*2.0));
        float front = exp(-pow((vUv0.x-uSweep)*26., 2.));
        totalEmissiveRadiance += vec3(0.75,0.45,1.0) * front * uFlash;`;
    }
    em += `
      totalEmissiveRadiance += vec3(0.62,0.22,1.0)*edgeBand*3.5 + vec3(1.0,0.8,1.0)*pow(edgeBand,3.)*2.5;
      totalEmissiveRadiance += vec3(0.7,0.4,1.0)*rEdge*3.0;`;
    fs = fs.replace('#include <emissivemap_fragment>', em);
    sh.fragmentShader = fs;
  };
  return mat;
}

/* ------------------------------------------------------------------ */
/* Geometry (built once, shared by every katana)                        */
/* ------------------------------------------------------------------ */

let GEO = null;
const shared = (g) => {
  g.userData.shared = true;
  return g;
};

function geometries() {
  if (GEO) return GEO;
  const { L, KAPPA, HANDLE } = KAT;
  const G = {};

  const bladeSec = (s, t, jt, j) => {
    const u = s / L;
    const k = u > 0.93 ? 1 - (u - 0.93) / 0.07 : 1;
    const w = lerp(0.094, 0.062, u) * Math.pow(Math.max(k, 0), 0.7);
    const th = lerp(0.026, 0.014, u) * Math.pow(Math.max(k, 0), 0.5);
    const pts = [[w, 0], [-0.05 * w, th], [-w, th * 0.8], [-w, -th * 0.8], [-0.05 * w, -th], [w, 0]];
    return pts[j];
  };
  G.blade = shared(sweepGeometry({ s0: 0, s1: L, segs: 110, N: 5, sec: bladeSec, kappa: KAPPA, dir: -1, flat: true }));
  G.habaki = shared(sweepGeometry({ s0: 0, s1: 0.13, segs: 4, N: 20, sec: (s, t, jt) => ellipse(0.076, 0.05)(jt), kappa: KAPPA, dir: -1 }));

  // tsuba
  const sh = new THREE.Shape();
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const r = 0.19 * (1 + 0.065 * Math.cos(8 * a)) * (1 + 0.1 * Math.cos(2 * a));
    const x = Math.cos(a) * r * 1.05;
    const y = Math.sin(a) * r * 0.9;
    if (i) sh.lineTo(x, y);
    else sh.moveTo(x, y);
  }
  const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 24 });
  eg.rotateX(-Math.PI / 2);
  eg.translate(0, -0.02, 0);
  G.tsuba = shared(eg);
  G.seppa = shared(new THREE.CylinderGeometry(0.095, 0.095, 0.014, 32));
  G.ring = shared(new THREE.TorusGeometry(0.135, 0.008, 8, 48));
  G.gemSmall = shared(new THREE.OctahedronGeometry(0.02));

  // handle
  G.handle = shared(new THREE.CylinderGeometry(0.06, 0.054, HANDLE, 32, 1, true));
  G.fuchi = shared(new THREE.CylinderGeometry(0.068, 0.066, 0.1, 32));
  const prof = [[0, 0], [0.07, 0], [0.074, 0.02], [0.072, 0.07], [0.058, 0.1], [0.03, 0.115], [0, 0.12]].map((p) => new THREE.Vector2(p[0], p[1]));
  G.kashira = shared(new THREE.LatheGeometry(prof, 32));
  G.menuki = shared(new THREE.OctahedronGeometry(0.03));

  // sheath
  const s0 = 0.05;
  const s1 = L + 0.06;
  G.sheath = shared(
    sweepGeometry({
      s0, s1, segs: 120, N: 36, kappa: KAPPA, dir: -1,
      sec: (s, t, jt) => {
        const k = 1 - 0.35 * sstep(0.9, 1, t);
        return [SH_A(t) * k * Math.cos(jt * TAU), SH_B * k * Math.sin(jt * TAU)];
      },
    }),
  );
  G.collar = shared(
    sweepGeometry({
      s0: 0.03, s1: 0.2, segs: 6, N: 36, kappa: KAPPA, dir: -1,
      sec: (s, t, jt) => {
        const f = 1 + 0.16 * (1 - t);
        return [(0.124 + 0.004) * f * Math.cos(jt * TAU), (SH_B + 0.012) * f * Math.sin(jt * TAU)];
      },
    }),
  );
  G.sleeve = shared(
    sweepGeometry({
      s0: L - 0.32, s1: L + 0.075, segs: 30, N: 36, kappa: KAPPA, dir: -1,
      sec: (s, t, jt) => {
        const k = t > 0.8 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.8) / 0.2, 2))) : 1;
        return [(0.108 + 0.014) * k * Math.cos(jt * TAU), (SH_B + 0.012) * k * Math.sin(jt * TAU)];
      },
    }),
  );
  G.bands = [1.0, 1.6].map((sb) =>
    shared(
      sweepGeometry({
        s0: sb, s1: sb + 0.07, segs: 3, N: 36, kappa: KAPPA, dir: -1,
        sec: (s, t, jt) => [(SH_A(sb / L) + 0.01) * Math.cos(jt * TAU), (SH_B + 0.01) * Math.sin(jt * TAU)],
      }),
    ),
  );

  // tassel pieces
  G.tRing = shared(new THREE.TorusGeometry(0.03, 0.007, 8, 20));
  G.tCord = shared(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(-0.02, -0.12, 0.01), new THREE.Vector3(-0.025, -0.26, 0.02)]),
      12, 0.008, 6,
    ),
  );
  G.tGem = shared(new THREE.OctahedronGeometry(0.038));
  G.tCap = shared(new THREE.ConeGeometry(0.022, 0.05, 10));
  G.tKnot = shared(new THREE.SphereGeometry(0.02, 10, 8));
  const rng = mulberry(9);
  const strands = [];
  for (let i = 0; i < 36; i++) {
    const len = 0.3 + rng() * 0.07;
    const a = rng() * TAU;
    const r = rng() * 0.012;
    const g = new THREE.CylinderGeometry(0.0035, 0.0025, len, 4);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(-0.025 + Math.cos(a) * r * 1.5, -0.375 - len / 2 + 0.04, 0.02 + Math.sin(a) * r * 1.5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.05, 0, -Math.cos(a) * 0.05)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    strands.push(g);
  }
  G.tStrands = shared(mergeGeometries(strands));
  strands.forEach((g) => g.dispose());

  GEO = G;
  return G;
}

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {{ full?: boolean }} opts  full = sheath, tassel, aura (needed for the awakening).
 *                                   Lite katanas (formation blades) are always unsheathed.
 */
export function buildKatana({ full = true } = {}) {
  const { L, KAPPA, HANDLE, SCALE, CENTER } = KAT;
  const G = geometries();
  const U = makeUniforms();
  const sheathT = sheathTextures();
  const handleT = handleTextures();

  const SIL = { color: 0xb8bbc8, metalness: 1, roughness: 0.28 };
  const M = {
    blade: patch(
      new THREE.MeshStandardMaterial({
        color: 0xc9c8e0, metalness: 0.85, roughness: 0.26,
        emissive: 0xffffff, emissiveMap: bladeEmissiveTex(), emissiveIntensity: 0.9,
      }),
      'blade', U,
    ),
    sheath: patch(
      new THREE.MeshPhysicalMaterial({
        map: sheathT.map, metalnessMap: sheathT.orm, roughnessMap: sheathT.orm, metalness: 1, roughness: 1,
        clearcoat: 0.9, clearcoatRoughness: 0.15,
        emissive: 0xffffff, emissiveMap: sheathT.emissive, emissiveIntensity: 2.2, side: THREE.DoubleSide,
      }),
      'sheath', U,
    ),
    silverSheath: patch(new THREE.MeshStandardMaterial({ ...SIL }), 'sheath', U),
    silver: patch(new THREE.MeshStandardMaterial({ ...SIL }), 'plain', U),
    handle: patch(
      new THREE.MeshStandardMaterial({
        map: handleT.map, roughness: 0.55, metalness: 0.25,
        emissive: 0xffffff, emissiveMap: handleT.emissive, emissiveIntensity: 0.6,
      }),
      'plain', U,
    ),
    cord: patch(new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.8, metalness: 0.1 }), 'sheath', U),
    gem: patch(new THREE.MeshStandardMaterial({ color: 0x6a2cff, emissive: 0x9a5cff, emissiveIntensity: 2.4, roughness: 0.15, metalness: 0.2 }), 'sheath', U),
    gemFixed: patch(new THREE.MeshStandardMaterial({ color: 0x6a2cff, emissive: 0x9a5cff, emissiveIntensity: 1.8, roughness: 0.15, metalness: 0.2 }), 'plain', U),
  };

  const root = new THREE.Group();
  root.name = 'katana';
  const scaleG = new THREE.Group();
  scaleG.scale.setScalar(SCALE);
  const flip = new THREE.Group();
  flip.rotation.z = Math.PI;
  flip.position.y = -CENTER;
  const body = new THREE.Group();
  const sword = new THREE.Group();
  const sheathG = new THREE.Group();
  root.add(scaleG);
  scaleG.add(flip);
  flip.add(body);
  body.add(sword);

  const mesh = (geo, mat) => new THREE.Mesh(geo, mat);

  // blade + habaki
  sword.add(mesh(G.blade, M.blade), mesh(G.habaki, M.silver));

  // tsuba
  const tsuba = mesh(G.tsuba, M.silver);
  tsuba.scale.set(1.3, 1, 1.3);
  sword.add(tsuba);
  for (const y of [0.038, -0.038]) {
    const seppa = mesh(G.seppa, M.silver);
    seppa.position.y = y;
    seppa.scale.z = 0.85;
    sword.add(seppa);
  }
  const ring = mesh(G.ring, M.silver);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  ring.scale.set(1.05, 0.9, 1);
  sword.add(ring);
  for (const [x, z] of [[0.17, 0], [-0.17, 0], [0, 0.14], [0, -0.14]]) {
    const gem = mesh(G.gemSmall, M.gemFixed);
    gem.position.set(x, 0.045, z);
    gem.scale.y = 1.4;
    sword.add(gem);
  }

  // handle
  const h = mesh(G.handle, M.handle);
  h.scale.z = 0.78;
  h.position.y = 0.07 + HANDLE / 2;
  sword.add(h);
  const fuchi = mesh(G.fuchi, M.silver);
  fuchi.scale.z = 0.8;
  fuchi.position.y = 0.1;
  sword.add(fuchi);
  const kashira = mesh(G.kashira, M.silver);
  kashira.scale.z = 0.8;
  kashira.position.y = 0.07 + HANDLE - 0.01;
  sword.add(kashira);
  for (const y of [0.4, 0.75]) {
    const m = mesh(G.menuki, M.silver);
    m.scale.set(1, 1.3, 0.5);
    m.position.set(0, y, 0.05);
    sword.add(m);
  }

  const parts = { root, scaleG, flip, body, sword, sheathG: null, tassel: null, auras: [], flash: null };

  // aura haze along the blade + draw flash at the mouth
  const auras = [];
  for (const s of [0.25, 0.8, 1.4, 2.0, 2.4]) {
    const phi = KAPPA * s;
    const spr = glowSprite(0x8a44ff, 1.3, 0);
    spr.position.set((1 - Math.cos(phi)) / KAPPA + 0.05, -Math.sin(phi) / KAPPA, -0.1);
    sword.add(spr);
    auras.push(spr);
  }
  const flash = glowSprite(0xc8a0ff, 1.2, 0);
  flash.position.set(0.02, -0.05, 0.1);
  sword.add(flash);
  parts.auras = auras;
  parts.flash = flash;

  if (full) {
    body.add(sheathG);
    sheathG.add(mesh(G.sheath, M.sheath), mesh(G.collar, M.silverSheath), mesh(G.sleeve, M.silverSheath));
    for (const b of G.bands) sheathG.add(mesh(b, M.silverSheath));

    const tassel = new THREE.Group();
    const s = 0.62;
    const phi = KAPPA * s;
    const c = new THREE.Vector3((1 - Math.cos(phi)) / KAPPA, -Math.sin(phi) / KAPPA, 0);
    const n = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0);
    tassel.position.copy(c).addScaledVector(n, -0.1).add(new THREE.Vector3(0, 0, 0.03));
    const tr = mesh(G.tRing, M.silverSheath);
    tr.rotation.y = Math.PI / 2;
    const cordM = mesh(G.tCord, M.cord);
    const gem = mesh(G.tGem, M.gem);
    gem.position.set(-0.025, -0.31, 0.02);
    gem.scale.y = 1.7;
    const cap = mesh(G.tCap, M.silverSheath);
    cap.position.set(-0.025, -0.255, 0.02);
    const knot = mesh(G.tKnot, M.cord);
    knot.position.set(-0.025, -0.37, 0.02);
    tassel.add(tr, cordM, gem, cap, knot, mesh(G.tStrands, M.cord));
    sheathG.add(tassel);
    parts.sheathG = sheathG;
    parts.tassel = tassel;
  }

  root.userData = {
    kind: 'katana',
    glow: {},
    length: (L + HANDLE + 0.07) * SCALE,
    tipY: (L - CENTER) * SCALE,
    color: VIOLET,
    parts,
    U,
    materials: M,
    awakening: null, // set by KatanaAwakening
    tick: null,
  };

  // Lite katanas are always fully revealed (uniform defaults) and ignore the sheath inverse.
  return root;
}

/** Remove the per-instance materials of a katana (geometry/textures are shared). */
export function disposeKatana(root) {
  const M = root.userData.materials;
  if (M) for (const m of Object.values(M)) m.dispose();
  root.userData.awakening?.dispose?.();
  root.userData.parts.auras.forEach((s) => s.material.dispose());
  root.userData.parts.flash.material.dispose();
}
