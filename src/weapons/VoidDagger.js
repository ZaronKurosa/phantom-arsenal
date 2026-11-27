import * as THREE from 'three';
import { VIOLET, extrude, glowSprite, mirroredShape, outline, sweepGeometry } from './WeaponKit.js';
import { makeRevealUniforms, makeWeaponMaterials } from './WeaponReveal.js';

/**
 * VOID DAGGERS: models.
 *
 * LEFT and RIGHT are two completely separate weapons: each call to
 * buildVoidDagger() makes its own root group, meshes, materials, crystal and
 * reveal uniforms. They share only cached geometry (read-only) and textures.
 * Nothing links the two models: no common parent, no shared transform.
 *
 * Design (from the reference): a gothic hooked guard around a violet crystal,
 * diamond-wrap grip, spiked diamond pommel and a short blade that curves
 * outward with serrated barbs on its concave edge, wrapped in a thin shell of
 * violet energy. The left dagger curves to the left, the right to the right.
 */

const SCALE = 0.8;
const BODY_OFFSET = 0.15;
const GUARD_Y = -0.35;
const BLADE_BASE = -0.3;
const BLADE_LEN = 1.4;
const KAPPA = 0.3;

let GEO = null;
const shared = (g) => {
  g.userData.shared = true;
  return g;
};

function geometries() {
  if (GEO) return GEO;
  const G = {};
  const bladeSec = (s, t, jt, j) => {
    const u = s / BLADE_LEN;
    const k = u > 0.9 ? 1 - (u - 0.9) / 0.1 : 1;
    const base = (u < 0.14 ? 0.8 + u * 1.4 : 1) * 0.16 * Math.pow(1 - u * 0.98, 0.62) * Math.pow(Math.max(k, 0), 0.5);
    const saw = u > 0.12 && u < 0.88 ? ((u * 8) % 1) : 0;
    const wIn = base * (1 + 0.28 * saw); // serrated concave edge
    const wOut = base;
    const th = 0.03 * (1 - 0.4 * u) * Math.pow(Math.max(k, 0), 0.4);
    return [[wIn, 0], [-0.05 * wOut, th], [-wOut, th * 0.8], [-wOut, -th * 0.8], [-0.05 * wOut, -th], [wIn, 0]][j];
  };
  G.blade = shared(sweepGeometry({ s0: 0, s1: BLADE_LEN, segs: 96, N: 5, sec: bladeSec, kappa: KAPPA, dir: 1, flat: true }));
  G.shell = shared(sweepGeometry({ s0: 0.05, s1: BLADE_LEN * 0.97, segs: 48, N: 5, sec: (s, t, jt, j) => {
    const u = s / BLADE_LEN;
    const b = 0.16 * Math.pow(1 - u * 0.98, 0.62) * 1.25 + 0.015;
    const th = 0.05 * (1 - 0.4 * u);
    return [[b, 0], [0, th], [-b, th * 0.6], [-b, -th * 0.6], [0, -th], [b, 0]][j];
  }, kappa: KAPPA, dir: 1 }));

  const guardHalf = outline([
    ['M', 0, 0.12],
    ['L', 0.14, 0.1],
    ['Q', 0.36, 0.08, 0.46, 0.32],
    ['Q', 0.4, 0.16, 0.3, 0.05],
    ['L', 0.5, -0.02],
    ['Q', 0.36, -0.06, 0.26, -0.1],
    ['L', 0.12, -0.15],
    ['Q', 0.05, -0.17, 0, -0.22],
  ]);
  G.guard = shared(extrude(mirroredShape(guardHalf), 0.07, 0.01));
  G.mount = shared(
    extrude(new THREE.Shape([new THREE.Vector2(0, 0.28), new THREE.Vector2(0.09, 0.04), new THREE.Vector2(0, -0.26), new THREE.Vector2(-0.09, 0.04)]), 0.1, 0.01),
  );
  G.octa = shared(new THREE.OctahedronGeometry(1));
  G.grip = shared(new THREE.CylinderGeometry(0.046, 0.042, 0.58, 14, 1, true));
  G.ring = shared(new THREE.TorusGeometry(0.052, 0.012, 8, 16));
  GEO = G;
  return G;
}

/** @param {'left'|'right'} side */
export function buildVoidDagger(side) {
  const G = geometries();
  const RV = makeRevealUniforms();
  const M = makeWeaponMaterials(RV);
  const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
  const mirror = side === 'left' ? -1 : 1; // the left dagger curves to the left

  const root = new THREE.Group();
  root.name = `void-dagger-${side}`;
  const scaleG = new THREE.Group();
  scaleG.scale.set(SCALE * mirror, SCALE, SCALE);
  const body = new THREE.Group();
  body.position.y = BODY_OFFSET;
  root.add(scaleG);
  scaleG.add(body);

  const blade = mesh(G.blade, M.blade);
  blade.position.y = BLADE_BASE;
  body.add(blade);

  // violet energy shell hugging the blade (the "energy trail")
  const shell = mesh(G.shell, M.energy);
  shell.position.y = BLADE_BASE;
  shell.renderOrder = 4;
  M.energy.map.rotation = Math.PI / 2;
  M.energy.map.center.set(0.5, 0.5);
  M.energy.map.repeat.set(1.5, 1);
  body.add(shell);

  const guardG = new THREE.Group();
  guardG.position.y = GUARD_Y;
  guardG.add(mesh(G.guard, M.silverFlat));
  const mount = mesh(G.mount, M.black);
  guardG.add(mount);
  const spire = mesh(G.octa, M.silver);
  spire.position.y = 0.32;
  spire.scale.set(0.05, 0.16, 0.04);
  guardG.add(spire);
  const crystal = mesh(G.octa, M.crystal);
  crystal.position.set(0, 0.0, 0.06);
  crystal.scale.set(0.07, 0.14, 0.06);
  guardG.add(crystal);
  body.add(guardG);

  const grip = mesh(G.grip, M.grip);
  grip.position.y = GUARD_Y - 0.15 - 0.29;
  body.add(grip);
  for (const y of [GUARD_Y - 0.17, GUARD_Y - 0.72]) {
    const r = mesh(G.ring, M.silver);
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    body.add(r);
  }
  const pommel = mesh(G.octa, M.silverFlat);
  pommel.position.y = GUARD_Y - 0.87;
  pommel.scale.set(0.075, 0.2, 0.075);
  body.add(pommel);
  const pgem = mesh(G.octa, M.crystal);
  pgem.position.set(0, GUARD_Y - 0.87, 0.04);
  pgem.scale.set(0.025, 0.07, 0.022);
  body.add(pgem);

  const halo = glowSprite(VIOLET, 0.9, 0.3);
  halo.position.set(0, GUARD_Y, 0.1);
  body.add(halo);

  // blade tip position (blade arc), used for tipY
  const phi = KAPPA * BLADE_LEN;
  const tipRootY = (BLADE_BASE + Math.sin(phi) / KAPPA + BODY_OFFSET) * SCALE;
  const bottom = (GUARD_Y - 1.07 + BODY_OFFSET) * SCALE;

  root.userData = {
    kind: 'dagger',
    side,
    glow: { core: crystal, halo, rune: shell },
    length: tipRootY - bottom,
    tipY: tipRootY,
    color: VIOLET,
    RV,
    materials: M,
    parts: { root, scaleG, body, guardG, crystal, shell, blade, halo, grip, pommel },
    axis: { guardY: (GUARD_Y + BODY_OFFSET) * SCALE, bottom, top: tipRootY },
    tick: (dt, time, sword) => {
      M.energy.map.offset.x -= dt * (0.5 + 0.6 * Math.min(2, sword.glow));
      RV.uTime.value = time;
      if (RV.uReveal.value < 9) {
        root.updateWorldMatrix(true, false);
        RV.uRootInv.value.copy(root.matrixWorld).invert();
      }
    },
  };
  return root;
}

export function disposeVoidDagger(root) {
  const { materials, glow } = root.userData;
  materials.energy.map?.dispose();
  for (const m of Object.values(materials)) m.dispose();
  glow.halo?.material?.dispose();
}
