import * as THREE from 'three';
import { VIOLET, extrude, glowSprite, mirroredShape, outline, sweepGeometry } from './WeaponKit.js';
import { makeRevealUniforms, makeWeaponMaterials } from './WeaponReveal.js';

/**
 * GOTHIC GREATSWORD: model.
 *
 * Tall, broad and heavy: a swept, horned crossguard with thorn spurs, a black
 * central mount holding the violet crystal and a silver spire, a diamond-wrap
 * grip with a faceted pommel, a broad double-bevelled blade with a glowing
 * fuller of violet energy, and ricasso fins at the base of the blade.
 * Silhouette: a cross with up-curved horns. Nothing like the katana's long,
 * single curve.
 *
 * Built tip-up with its origin near the centre of mass.
 */

const SCALE = 0.8;
const BODY_OFFSET = 0.125; // re-centres the model on its origin (pre-scale units)
const BLADE_BASE = -0.5;
const BLADE_LEN = 2.1;
const GUARD_Y = -0.6;

let GEO = null;
const shared = (g) => {
  g.userData.shared = true;
  return g;
};

function geometries() {
  if (GEO) return GEO;
  const G = {};

  // blade: broad 5-sided section, long point
  G.blade = shared(
    sweepGeometry({
      s0: 0, s1: BLADE_LEN, segs: 80, N: 5, kappa: 0, dir: 1, flat: true,
      sec: (s, t, jt, j) => {
        const u = s / BLADE_LEN;
        const k = u > 0.84 ? 1 - (u - 0.84) / 0.16 : 1;
        const w = (0.21 - 0.045 * u) * Math.pow(Math.max(k, 0), 0.8);
        const th = 0.034 * (1 - 0.35 * u) * Math.pow(Math.max(k, 0), 0.5);
        return [[w, 0], [-0.05 * w, th], [-w, th * 0.8], [-w, -th * 0.8], [-0.05 * w, -th], [w, 0]][j];
      },
    }),
  );

  // horned crossguard
  const guardHalf = outline([
    ['M', 0, 0.22],
    ['L', 0.3, 0.2],
    ['Q', 0.8, 0.18, 1.0, 0.6],
    ['Q', 0.95, 0.3, 0.78, 0.1],
    ['L', 1.06, 0.01],
    ['Q', 0.8, -0.08, 0.6, -0.16],
    ['L', 0.34, -0.3],
    ['Q', 0.16, -0.36, 0, -0.46],
  ]);
  G.guard = shared(extrude(mirroredShape(guardHalf), 0.1, 0.014));

  // lower thorn pair
  const thornHalf = outline([
    ['M', 0, 0.0],
    ['L', 0.14, 0.04],
    ['Q', 0.3, -0.02, 0.5, -0.38],
    ['Q', 0.26, -0.2, 0.14, -0.16],
    ['L', 0, -0.2],
  ]);
  G.thorn = shared(extrude(mirroredShape(thornHalf), 0.06, 0.01));

  // central mount (diamond) + spire
  G.mount = shared(
    extrude(
      new THREE.Shape([new THREE.Vector2(0, 0.52), new THREE.Vector2(0.17, 0.1), new THREE.Vector2(0, -0.5), new THREE.Vector2(-0.17, 0.1)]),
      0.16, 0.014,
    ),
  );
  G.octa = shared(new THREE.OctahedronGeometry(1));

  // ricasso fins
  const finHalf = outline([
    ['M', 0, 0.0],
    ['L', 0.2, 0.04],
    ['Q', 0.36, 0.22, 0.52, 0.62],
    ['Q', 0.32, 0.34, 0.22, 0.32],
    ['L', 0, 0.34],
  ]);
  G.fin = shared(extrude(mirroredShape(finHalf), 0.05, 0.008));

  G.grip = shared(new THREE.CylinderGeometry(0.068, 0.062, 0.62, 18, 1, true));
  G.ring = shared(new THREE.TorusGeometry(0.075, 0.016, 8, 20));
  G.strip = shared(new THREE.PlaneGeometry(0.09, 1.35));
  GEO = G;
  return G;
}

export function buildGreatsword() {
  const G = geometries();
  const RV = makeRevealUniforms();
  const M = makeWeaponMaterials(RV);
  const mesh = (geo, mat) => new THREE.Mesh(geo, mat);

  const root = new THREE.Group();
  root.name = 'greatsword';
  const scaleG = new THREE.Group();
  scaleG.scale.setScalar(SCALE);
  const body = new THREE.Group();
  body.position.y = BODY_OFFSET;
  root.add(scaleG);
  scaleG.add(body);

  // blade (+ ricasso fins)
  const blade = mesh(G.blade, M.blade);
  blade.position.y = BLADE_BASE;
  const fin = mesh(G.fin, M.silverFlat);
  fin.position.set(0, BLADE_BASE - 0.02, 0);
  body.add(blade, fin);

  // energy running along the blade (one shared material, two faces)
  const strips = [1, -1].map((side) => {
    const m = mesh(G.strip, M.energy);
    m.position.set(0, BLADE_BASE + 0.9, side * 0.04);
    if (side < 0) m.rotation.y = Math.PI;
    m.renderOrder = 4;
    body.add(m);
    return m;
  });
  M.energy.map.repeat.set(1, 2.2);

  // guard group (wings can unfold during the entry)
  const guardG = new THREE.Group();
  guardG.position.y = GUARD_Y;
  const wings = mesh(G.guard, M.silverFlat);
  guardG.add(wings);
  const thorns = mesh(G.thorn, M.guard);
  thorns.position.set(0, -0.22, -0.02);
  guardG.add(thorns);
  const mount = mesh(G.mount, M.black);
  guardG.add(mount);
  const spire = mesh(G.octa, M.silver);
  spire.position.set(0, 0.66, 0);
  spire.scale.set(0.085, 0.32, 0.065);
  guardG.add(spire);
  for (const [x, y] of [[0.3, 0.18], [-0.3, 0.18], [0.6, 0.06], [-0.6, 0.06]]) {
    const gem = mesh(G.octa, M.crystal);
    gem.position.set(x, y, 0.07);
    gem.scale.set(0.035, 0.07, 0.035);
    guardG.add(gem);
  }
  // the central crystal: this is the weapon's "core" glow
  const crystal = mesh(G.octa, M.crystal);
  crystal.position.set(0, 0.06, 0.1);
  crystal.scale.set(0.12, 0.26, 0.1);
  guardG.add(crystal);
  body.add(guardG);

  // grip + pommel
  const grip = mesh(G.grip, M.grip);
  grip.position.y = GUARD_Y - 0.46 - 0.28;
  body.add(grip);
  for (const y of [GUARD_Y - 0.5, GUARD_Y - 1.0]) {
    const r = mesh(G.ring, M.silver);
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    body.add(r);
  }
  const pommel = mesh(G.octa, M.silverFlat);
  pommel.position.y = GUARD_Y - 1.17;
  pommel.scale.set(0.13, 0.3, 0.13);
  body.add(pommel);
  const pgem = mesh(G.octa, M.crystal);
  pgem.position.set(0, GUARD_Y - 1.17, 0.07);
  pgem.scale.set(0.045, 0.09, 0.04);
  body.add(pgem);

  const halo = glowSprite(VIOLET, 1.4, 0.25);
  halo.position.set(0, GUARD_Y + 0.06, 0.16);
  body.add(halo);

  const gy = (GUARD_Y + BODY_OFFSET) * SCALE; // guard centre in root units
  const bottom = (GUARD_Y - 1.5 + BODY_OFFSET) * SCALE;
  const top = (BLADE_BASE + BLADE_LEN + BODY_OFFSET) * SCALE;

  root.userData = {
    kind: 'greatsword',
    glow: { core: crystal, halo, rune: strips[0] },
    length: top - bottom,
    tipY: top,
    color: VIOLET,
    RV,
    materials: M,
    parts: { root, scaleG, body, guardG, wings, crystal, strips, blade, halo, grip, pommel },
    axis: { guardY: gy, bottom, top },
    tick: (dt, time, sword) => {
      M.energy.map.offset.y -= dt * (0.35 + 0.35 * Math.min(2, sword.glow));
      RV.uTime.value = time;
      if (RV.uReveal.value < 9) {
        root.updateWorldMatrix(true, false);
        RV.uRootInv.value.copy(root.matrixWorld).invert();
      }
    },
  };
  return root;
}

export function disposeGreatsword(root) {
  const { materials, glow } = root.userData;
  materials.energy.map?.dispose(); // the streak texture is cloned per weapon; everything else is shared
  for (const m of Object.values(materials)) m.dispose();
  glow.halo?.material?.dispose();
}
