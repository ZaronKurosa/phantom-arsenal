import * as THREE from 'three';
import { clamp, smoothstep } from '../utils/MathUtils.js';

/**
 * Procedural sword construction.
 *
 * Blades are custom lofted meshes (hollow-ground cross-section with fuller,
 * silver bevelled edges, tapered tips), guards are extruded gothic outlines,
 * grips and pommels are lathed. Everything is built once per variant and the
 * geometries/materials are cached; Sword instances only clone the glow
 * materials so each sword can pulse independently.
 */

export const VARIANTS = [
  { id: 'nightfang', name: 'Nightfang', desc: 'Gothic longsword', glow: 0x9a5cff },
  { id: 'wraith', name: 'Crescent Wraith', desc: 'Curved reaper blade', glow: 0xc266ff },
  { id: 'requiem', name: 'Requiem', desc: 'Winged flamberge', glow: 0x7f8cff },
];

/* ------------------------------------------------------------------ */
/* Shared materials and textures                                       */
/* ------------------------------------------------------------------ */

let SHARED = null;

function makeRuneTexture() {
  const W = 128;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  g.strokeStyle = '#d9bfff';
  g.fillStyle = '#d9bfff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = '#a35cff';
  g.shadowBlur = 10;

  // glowing energy vein along the centre
  const grad = g.createLinearGradient(W / 2 - 5, 0, W / 2 + 5, 0);
  grad.addColorStop(0, 'rgba(170,100,255,0)');
  grad.addColorStop(0.5, 'rgba(210,170,255,0.55)');
  grad.addColorStop(1, 'rgba(170,100,255,0)');
  g.fillStyle = grad;
  g.fillRect(W / 2 - 5, 0, 10, H);
  g.fillStyle = '#d9bfff';

  const cells = 12;
  const ch = H / cells;
  g.lineWidth = 5;
  for (let i = 0; i < cells; i++) {
    const y0 = i * ch + 16;
    const y1 = (i + 1) * ch - 16;
    const mid = (y0 + y1) / 2;
    g.beginPath();
    switch (Math.floor(rnd() * 6)) {
      case 0:
        g.moveTo(W / 2, y0); g.lineTo(W / 2, y1);
        g.moveTo(W / 2 - 26, mid - 10); g.lineTo(W / 2, mid + 8); g.lineTo(W / 2 + 26, mid - 10);
        break;
      case 1:
        g.moveTo(W / 2 - 24, y0); g.lineTo(W / 2 + 24, mid); g.lineTo(W / 2 - 24, y1);
        break;
      case 2:
        g.arc(W / 2, mid, 22, 0, Math.PI * 2);
        g.moveTo(W / 2, y0); g.lineTo(W / 2, y1);
        break;
      case 3:
        g.moveTo(W / 2 - 22, y0); g.lineTo(W / 2 + 22, y1);
        g.moveTo(W / 2 + 22, y0); g.lineTo(W / 2 - 22, y1);
        break;
      case 4:
        g.moveTo(W / 2 - 24, y1); g.lineTo(W / 2 - 24, y0); g.lineTo(W / 2 + 24, mid); g.lineTo(W / 2 - 24, mid);
        break;
      default:
        g.moveTo(W / 2, y0); g.lineTo(W / 2 - 24, mid); g.lineTo(W / 2, y1); g.lineTo(W / 2 + 24, mid); g.closePath();
        break;
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function makeGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    blade: new THREE.MeshStandardMaterial({ color: 0x14141c, metalness: 1, roughness: 0.27, envMapIntensity: 1.9 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xd2d5e0, metalness: 1, roughness: 0.2, envMapIntensity: 1.6 }),
    silverFlat: new THREE.MeshStandardMaterial({ color: 0xc9ccd8, metalness: 1, roughness: 0.28, flatShading: true, envMapIntensity: 1.5 }),
    guard: new THREE.MeshStandardMaterial({ color: 0x2c2a38, metalness: 0.92, roughness: 0.3, envMapIntensity: 1.9 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x120c14, metalness: 0.05, roughness: 0.85 }),
    trimLine: new THREE.LineBasicMaterial({ color: 0xd7daea, transparent: true, opacity: 0.85 }),
    runeTex: makeRuneTexture(),
    glowTex: makeGlowTexture(),
  };
  return SHARED;
}

/* ------------------------------------------------------------------ */
/* Blade loft                                                          */
/* ------------------------------------------------------------------ */

const tipFactor = (t, tipStart) => {
  if (t <= tipStart) return 1;
  const r = (t - tipStart) / (1 - tipStart);
  return Math.max(0, 1 - Math.pow(r, 1.35));
};

const SILVER_SEGMENTS = new Set([0, 4, 5, 9]);

function buildBlade(P) {
  const S = P.sections || 96;
  const L = P.length;
  const sectionData = [];
  const verts = [];

  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const cx = P.curve ? P.curve(t) : 0;
    const cy = t * L;
    const t1 = Math.max(0, t - 0.5 / S);
    const t2 = Math.min(1, t + 0.5 / S);
    const dx = P.curve ? P.curve(t2) - P.curve(t1) : 0;
    const dy = (t2 - t1) * L;
    const len = Math.hypot(dx, dy) || 1;
    const px = dy / len;
    const py = -dx / len;

    const f = tipFactor(t, P.tipStart);
    const wl = P.wL(t) * f;
    const wr = P.wR(t) * f;
    const th = P.th(t) * f;
    const fw = P.fuller(t, wl, wr);
    const c = P.fc ? P.fc(t, wl, wr) : 0;
    const uv = [
      [-wl, 0],
      [-wl * 0.52, th],
      [c - fw, th * 0.5],
      [c + fw, th * 0.5],
      [wr * 0.52, th],
      [wr, 0],
      [wr * 0.52, -th],
      [c + fw, -th * 0.5],
      [c - fw, -th * 0.5],
      [-wl * 0.52, -th],
    ];
    const ring = uv.map(([u, v]) => [cx + px * u, cy + py * u, v]);
    verts.push(ring);
    sectionData.push({ t, cx, cy, px, py, fw, c, thHalf: th * 0.5 });
  }

  const positions = [];
  for (let i = 0; i <= S; i++) {
    for (let k = 0; k < 10; k++) {
      for (let e = 0; e < 2; e++) {
        const p = verts[i][(k + e) % 10];
        positions.push(p[0], p[1], p[2]);
      }
    }
  }
  const vi = (i, k, e) => i * 20 + k * 2 + e;
  const black = [];
  const silver = [];
  for (let i = 0; i < S; i++) {
    for (let k = 0; k < 10; k++) {
      const a = vi(i, k, 0);
      const b = vi(i, k, 1);
      const c = vi(i + 1, k, 1);
      const d = vi(i + 1, k, 0);
      const target = SILVER_SEGMENTS.has(k) ? silver : black;
      target.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...black, ...silver]);
  geometry.addGroup(0, black.length, 0);
  geometry.addGroup(black.length, silver.length, 1);
  geometry.computeVertexNormals();

  /* rune ribbon lying in the fuller on both faces */
  const rp = [];
  const ruv = [];
  const ri = [];
  const repeat = P.runeRepeat || 0.5;
  let n = 0;
  for (const face of [1, -1]) {
    let prevIdx = -1;
    for (let i = 0; i <= S; i++) {
      const s = sectionData[i];
      if (s.fw < 0.008 || s.t < 0.05) {
        prevIdx = -1;
        continue;
      }
      const hw = s.fw * 0.92;
      const z = face * (s.thHalf + 0.0035);
      const l = [s.cx + s.px * (s.c - hw), s.cy + s.py * (s.c - hw), z];
      const r = [s.cx + s.px * (s.c + hw), s.cy + s.py * (s.c + hw), z];
      rp.push(...l, ...r);
      const v = s.t * P.length * repeat;
      ruv.push(0, v, 1, v);
      if (prevIdx >= 0) ri.push(prevIdx, prevIdx + 1, n + 1, prevIdx, n + 1, n);
      prevIdx = n;
      n += 2;
    }
  }
  const runes = new THREE.BufferGeometry();
  runes.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  runes.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  runes.setIndex(ri);

  return { geometry, runes, sectionData };
}

/* ------------------------------------------------------------------ */
/* Guards, grips, pommels                                               */
/* ------------------------------------------------------------------ */

function shapeFromHalf(half, scale = 1) {
  const pts = [];
  for (const [x, y] of half) pts.push(new THREE.Vector2(x * scale, y * scale));
  for (let i = half.length - 1; i >= 0; i--) {
    const [x, y] = half[i];
    if (x === 0) continue;
    pts.push(new THREE.Vector2(-x * scale, y * scale));
  }
  return new THREE.Shape(pts);
}

function extrude(shape, depth, bevel = 0.012) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function starShape(points, rOuter, rInner, rotation = Math.PI / 2) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rotation + (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function lathe(points, segments = 16) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

function gripGeometry(len, radius) {
  const pts = [[0.001, 0]];
  const N = 22;
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    const wrap = Math.abs(Math.sin(t * Math.PI * 7));
    const end = Math.min(1, t * 10, (1 - t) * 10);
    pts.push([radius * (0.82 + 0.18 * wrap) * (0.7 + 0.3 * end), -t * len]);
  }
  pts.push([0.001, -len]);
  return lathe(pts, 14);
}

/* ------------------------------------------------------------------ */
/* Variant definitions                                                  */
/* ------------------------------------------------------------------ */

const DEFS = {
  nightfang: {
    blade: {
      length: 2.05,
      tipStart: 0.86,
      wL: (t) => 0.148 - 0.04 * t,
      wR: (t) => 0.148 - 0.04 * t,
      th: (t) => 0.03 * (1 - 0.3 * t),
      fuller: (t, wl, wr) => Math.min(wl, wr) * 0.3 * smoothstep(0.03, 0.1, t) * (1 - smoothstep(0.6, 0.82, t)),
      runeRepeat: 0.55,
    },
    guardHalf: [
      [0, 0.07], [0.18, 0.075], [0.34, 0.1], [0.46, 0.17], [0.54, 0.29], [0.57, 0.43], [0.5, 0.33],
      [0.45, 0.22], [0.4, 0.13], [0.46, 0.04], [0.52, -0.06], [0.5, -0.2], [0.4, -0.1], [0.3, -0.045],
      [0.16, -0.045], [0, -0.05],
    ],
    guardDepth: 0.13,
    gripLen: 0.5,
    gripR: 0.042,
    core: { geo: () => new THREE.OctahedronGeometry(0.095, 0), scale: [0.8, 1.25, 0.8] },
  },
  wraith: {
    blade: {
      length: 2.25,
      tipStart: 0.84,
      curve: (t) => 0.46 * t * t,
      wL: () => 0.04,
      wR: (t) => 0.15 - 0.045 * t,
      th: (t) => 0.034 - 0.006 * t,
      fuller: (t, wl, wr) => wr * 0.16 * smoothstep(0.04, 0.12, t) * (1 - smoothstep(0.62, 0.84, t)),
      fc: (t, wl, wr) => (wr - wl) * 0.35,
      runeRepeat: 0.6,
    },
    guardKind: 'star',
    guardDepth: 0.07,
    gripLen: 0.52,
    gripR: 0.04,
    core: { geo: () => new THREE.IcosahedronGeometry(0.085, 1), scale: [1, 1, 1] },
  },
  requiem: {
    blade: {
      length: 2.5,
      tipStart: 0.82,
      wL: (t) => (0.175 - 0.04 * t) * (1 + 0.15 * Math.sin(t * 38) * (1 - smoothstep(0.6, 0.85, t))),
      wR: (t) => (0.175 - 0.04 * t) * (1 + 0.15 * Math.sin(t * 38 + 3.1) * (1 - smoothstep(0.6, 0.85, t))),
      th: (t) => 0.036 * (1 - 0.3 * t),
      fuller: (t, wl, wr) => Math.min(wl, wr) * 0.28 * smoothstep(0.03, 0.1, t) * (1 - smoothstep(0.58, 0.8, t)),
      sections: 120,
      runeRepeat: 0.5,
    },
    guardHalf: [
      [0, 0.09], [0.2, 0.1], [0.45, 0.08], [0.72, -0.02], [0.9, -0.22], [0.98, -0.5], [0.84, -0.34],
      [0.66, -0.17], [0.5, -0.07], [0.3, -0.05], [0, -0.06],
    ],
    guardScale: 0.66,
    guardDepth: 0.16,
    gripLen: 0.6,
    gripR: 0.046,
    core: { geo: () => new THREE.OctahedronGeometry(0.12, 1), scale: [0.9, 1.5, 0.9] },
  },
};

/* ------------------------------------------------------------------ */
/* Template builder                                                     */
/* ------------------------------------------------------------------ */

const TEMPLATES = new Map();

function mesh(geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = false;
  if (name) m.name = name;
  return m;
}

function build(id) {
  const S = shared();
  const def = DEFS[id];
  const g = new THREE.Group();
  g.name = id;

  /* blade */
  const { geometry, runes } = buildBlade(def.blade);
  const blade = mesh(geometry, [S.blade, S.silver], 'blade');
  blade.material[0].side = THREE.DoubleSide;
  blade.material[1].side = THREE.DoubleSide;
  blade.position.y = 0.06;
  g.add(blade);

  const runeMesh = new THREE.Mesh(
    runes,
    new THREE.MeshBasicMaterial({
      map: S.runeTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  runeMesh.position.y = 0.06;
  runeMesh.userData.glow = 'rune';
  runeMesh.renderOrder = 3;
  g.add(runeMesh);

  /* guard */
  const guard = new THREE.Group();
  guard.name = 'guard';
  if (def.guardKind === 'star') {
    const disc = mesh(extrude(starShape(10, 0.36, 0.19), def.guardDepth, 0.014), S.guard, 'guardDisc');
    guard.add(disc);
    const ringGeo = new THREE.TorusGeometry(0.2, 0.012, 8, 40);
    const ring = mesh(ringGeo, S.silver);
    ring.position.z = def.guardDepth / 2 + 0.012;
    guard.add(ring);
    // curved horns
    const horn = new THREE.Shape();
    horn.moveTo(0, 0);
    horn.quadraticCurveTo(0.34, 0.02, 0.5, 0.36);
    horn.quadraticCurveTo(0.3, 0.16, 0, 0.1);
    horn.closePath();
    const hornGeo = extrude(horn, 0.05, 0.008);
    for (const sx of [1, -1]) {
      const h = mesh(hornGeo, S.guard);
      h.position.x = sx * 0.16;
      h.scale.x = sx;
      guard.add(h);
    }
  } else {
    const shape = shapeFromHalf(def.guardHalf, def.guardScale || 1);
    const gm = mesh(extrude(shape, def.guardDepth), S.guard, 'guardBody');
    guard.add(gm);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(gm.geometry, 30), S.trimLine);
    guard.add(edges);
  }
  // central boss
  const boss = mesh(new THREE.CylinderGeometry(0.11, 0.12, def.guardDepth + 0.06, 6).rotateX(Math.PI / 2), S.guard);
  guard.add(boss);
  const bossRing = mesh(new THREE.TorusGeometry(0.105, 0.011, 6, 6), S.silver);
  bossRing.position.z = (def.guardDepth + 0.06) / 2 + 0.004;
  guard.add(bossRing);
  g.add(guard);

  /* glowing core */
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x1d0a38,
    emissive: new THREE.Color(0xa65bff),
    emissiveIntensity: 2.4,
    metalness: 0.2,
    roughness: 0.15,
    toneMapped: false,
  });
  const core = new THREE.Mesh(def.core.geo(), coreMat);
  core.scale.set(...def.core.scale);
  core.position.z = (def.guardDepth + 0.06) / 2 + 0.05;
  core.userData.glow = 'core';
  g.add(core);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: S.glowTex,
      color: 0xa65bff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
      toneMapped: false,
    }),
  );
  halo.scale.setScalar(0.85);
  halo.position.z = core.position.z + 0.06;
  halo.userData.glow = 'halo';
  halo.renderOrder = 4;
  g.add(halo);

  /* grip */
  const grip = mesh(gripGeometry(def.gripLen, def.gripR), S.leather, 'grip');
  grip.position.y = -0.04;
  g.add(grip);
  const topFerrule = mesh(new THREE.TorusGeometry(def.gripR + 0.006, 0.01, 6, 16).rotateX(Math.PI / 2), S.silver);
  topFerrule.position.y = -0.045;
  g.add(topFerrule);
  const botFerrule = topFerrule.clone();
  botFerrule.position.y = -0.04 - def.gripLen;
  g.add(botFerrule);

  /* pommel */
  const pBase = -0.04 - def.gripLen;
  let pommel;
  if (id === 'nightfang') {
    pommel = mesh(lathe([[0.001, 0], [0.07, -0.05], [0.085, -0.1], [0.06, -0.17], [0.001, -0.23]], 6), S.silverFlat);
  } else if (id === 'wraith') {
    pommel = mesh(new THREE.TorusGeometry(0.075, 0.017, 8, 24), S.silver);
    pommel.position.y = pBase - 0.08;
    g.add(pommel);
    pommel = null;
  } else {
    pommel = mesh(new THREE.IcosahedronGeometry(0.085, 1), S.silverFlat);
    pommel.position.y = pBase - 0.09;
    g.add(pommel);
    const spike = mesh(new THREE.ConeGeometry(0.03, 0.14, 6), S.silverFlat);
    spike.rotation.x = Math.PI;
    spike.position.y = pBase - 0.22;
    g.add(spike);
    pommel = null;
  }
  if (pommel) {
    pommel.position.y = pBase;
    g.add(pommel);
  }

  /* centre the model on its visual middle so rotation feels natural */
  const box = new THREE.Box3().setFromObject(g);
  const centre = (box.max.y + box.min.y) / 2;
  const model = new THREE.Group();
  model.name = id + '-model';
  g.position.y = -centre;
  model.add(g);
  model.userData.length = box.max.y - box.min.y;
  model.userData.bladeLength = def.blade.length;
  model.userData.tipY = box.max.y - centre;
  return model;
}

export function getTemplate(id) {
  if (!DEFS[id]) id = 'nightfang';
  if (!TEMPLATES.has(id)) TEMPLATES.set(id, build(id));
  return TEMPLATES.get(id);
}

/**
 * Creates a lightweight instance: geometry and static materials are shared,
 * only the glowing parts get their own materials.
 */
export function instantiate(id) {
  const tpl = getTemplate(id);
  const inst = tpl.clone(true);
  const glow = { rune: null, core: null, halo: null };
  inst.traverse((o) => {
    const kind = o.userData?.glow;
    if (!kind) return;
    o.material = o.material.clone();
    glow[kind] = o;
  });
  inst.userData = { ...tpl.userData, glow };
  return inst;
}

export function variantMeta(id) {
  return VARIANTS.find((v) => v.id === id) || VARIANTS[0];
}

export const _clamp = clamp; // keeps tree-shaking quiet about the shared util import
