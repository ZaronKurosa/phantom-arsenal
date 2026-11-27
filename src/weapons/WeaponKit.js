import * as THREE from 'three';

/**
 * Shared building blocks for every weapon model: seeded randomness, canvas
 * textures (cached), curved "sweep" lofting, the black-metal / silver / violet
 * material set and the point-size uniform used by every GPU particle system.
 *
 * Nothing here knows about a specific weapon.
 */

export const TAU = Math.PI * 2;
export const VIOLET = 0x9a5cff;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mkCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ------------------------------------------------------------------ */
/* Point-size uniform shared by all weapon particle shaders             */
/* ------------------------------------------------------------------ */

/** pixels-per-world-unit at distance 1 (same value the orbiting motes use) */
export const PX = { value: 800 };
export function setWeaponViewport(heightPx, fovDeg, pixelRatio = 1) {
  PX.value = (heightPx * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
}

/* ------------------------------------------------------------------ */
/* Cached procedural textures                                           */
/* ------------------------------------------------------------------ */

const CACHE = {};
const once = (key, fn) => (CACHE[key] ??= fn());

export function drawRune(ctx, x, y, h, rng) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2);
  const w = h * 0.55;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, h / 2);
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const yy = -h / 2 + rng() * h;
    const d = rng() < 0.5 ? -1 : 1;
    const l = w * (0.5 + rng() * 0.8);
    ctx.moveTo(0, yy);
    ctx.lineTo(d * l, yy + (rng() - 0.5) * h * 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/** Blade emissive: u along the length, v around the 5-sided section. Violet bevels + runes (from Purple Awakening). */
export function bladeEmissiveTex() {
  return once('bladeEmissive', () => {
    const W = 2048;
    const H = 128;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    const rng = mulberry(7);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const bevel = (y0, y1) => {
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(190,130,255,1)');
      gr.addColorStop(0.35, 'rgba(130,60,255,.55)');
      gr.addColorStop(1, 'rgba(90,30,200,.12)');
      g.fillStyle = gr;
      g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
    };
    bevel(0, H * 0.2);
    bevel(H, H * 0.8);
    g.fillStyle = 'rgba(100,40,220,.10)';
    g.fillRect(0, H * 0.2, W, H * 0.2);
    g.fillRect(0, H * 0.6, W, H * 0.2);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const yc of [H * 0.3, H * 0.7]) {
      for (let k = 0; k < 7; k++) {
        let x = rng() * W * 0.8;
        let y = yc;
        g.beginPath();
        g.moveTo(x, y);
        const len = 300 + rng() * 600;
        for (let i = 0; i < len; i += 14) {
          x += 14;
          y = yc + (rng() - 0.5) * 11;
          g.lineTo(x, y);
        }
        g.strokeStyle = `rgba(170,110,255,${0.35 + rng() * 0.4})`;
        g.lineWidth = 2;
        g.stroke();
      }
      g.strokeStyle = 'rgba(200,150,255,.95)';
      g.lineWidth = 2.4;
      for (let x = 120; x < W - 140; x += 78 + rng() * 24) drawRune(g, x, yc, 17, rng);
    }
    return canvasTex(c);
  });
}

/** Black cord wrap with violet lozenges: 3 across, 5 down. */
export function handleTextures() {
  return once('handle', () => {
    const W = 512;
    const H = 1024;
    const cols = 3;
    const rows = 5;
    const cw = W / cols;
    const rh = H / rows;
    const a = mkCanvas(W, H);
    const g = a.getContext('2d');
    const b = mkCanvas(W, H);
    const e = b.getContext('2d');
    g.fillStyle = '#0a0810';
    g.fillRect(0, 0, W, H);
    e.fillStyle = '#000';
    e.fillRect(0, 0, W, H);
    g.strokeStyle = '#1f1a33';
    g.lineWidth = 3;
    for (let i = -H; i < W + H; i += 13) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H * 0.6, H);
      g.stroke();
      g.beginPath();
      g.moveTo(i, H);
      g.lineTo(i + H * 0.6, 0);
      g.stroke();
    }
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const cx = q * cw + cw / 2;
        const cy = r * rh + rh / 2;
        const hw = cw * 0.27;
        const hh = rh * 0.4;
        const path = (c) => {
          c.beginPath();
          c.moveTo(cx, cy - hh);
          c.lineTo(cx + hw, cy);
          c.lineTo(cx, cy + hh);
          c.lineTo(cx - hw, cy);
          c.closePath();
        };
        const gr = g.createLinearGradient(cx, cy - hh, cx, cy + hh);
        gr.addColorStop(0, '#9b5cff');
        gr.addColorStop(0.5, '#5a22c8');
        gr.addColorStop(1, '#2a0c70');
        path(g);
        g.fillStyle = gr;
        g.fill();
        g.lineWidth = 5;
        g.strokeStyle = '#c4c7d6';
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, 6, 0, TAU);
        g.fillStyle = '#e4e6f0';
        g.fill();
        path(e);
        e.fillStyle = 'rgba(130,60,255,.9)';
        e.fill();
      }
    }
    return { map: canvasTex(a), emissive: canvasTex(b) };
  });
}

function drawOrnament(g, W, H, base, ink, seed, thin) {
  const rng = mulberry(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = ink;
  g.fillStyle = ink;
  for (const yc of [H * 0.25, H * 0.75]) {
    const stem = (x) => yc + Math.sin(x / 90) * 26 + Math.sin(x / 37 + 1.3) * 6;
    g.lineWidth = thin ? 3 : 6;
    g.beginPath();
    for (let x = 100; x < W - 200; x += 3) {
      const y = stem(x);
      if (x === 100) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    let n = 0;
    for (let x = 150; x < W - 260; x += 92, n++) {
      const y = stem(x);
      const dir = n % 2 ? 1 : -1;
      const edge = Math.abs(x - W / 2) / (W / 2);
      const len = (62 + rng() * 40) * (1 + 0.8 * edge * edge);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len * 0.25, y + dir * len * 0.6, x + len * 0.95, y + dir * len * 0.36);
      g.quadraticCurveTo(x + len * 0.5, y + dir * len * 0.16, x, y);
      if (thin) g.stroke();
      else g.fill();
      g.lineWidth = thin ? 3 : 4;
      g.beginPath();
      g.moveTo(x + len * 0.1, y + dir * 4);
      g.quadraticCurveTo(x + len * 0.55, y + dir * len * 0.9, x + len * 0.2, y + dir * len * 1.05);
      g.stroke();
      g.beginPath();
      g.arc(x + len * 0.2, y + dir * len * 1.05, thin ? 3 : 7, 0, TAU);
      if (thin) g.stroke();
      else g.fill();
    }
  }
  g.lineWidth = thin ? 2 : 4;
  for (const yy of [0, H * 0.5, H - 1]) {
    g.beginPath();
    g.moveTo(60, yy);
    g.lineTo(W - 120, yy);
    g.stroke();
  }
}

/** Sheath: silver filigree on black lacquer + violet rune emissive. */
export function sheathTextures() {
  return once('sheath', () => {
    const W = 2048;
    const H = 512;
    const a = mkCanvas(W, H);
    const o = mkCanvas(W, H);
    const e = mkCanvas(W, H);
    const ga = a.getContext('2d');
    const go = o.getContext('2d');
    const ge = e.getContext('2d');
    drawOrnament(ga, W, H, '#09080f', '#bcbfce', 11, false);
    const rn = mulberry(3);
    for (let i = 0; i < 4000; i++) {
      ga.fillStyle = `rgba(${rn() < 0.5 ? '255,255,255' : '90,60,160'},${rn() * 0.05})`;
      ga.fillRect(rn() * W, rn() * H, 2, 2);
    }
    drawOrnament(go, W, H, 'rgb(255,58,95)', 'rgb(255,85,255)', 11, false);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, W, H);
    ge.save();
    ge.globalAlpha = 0.55;
    drawOrnament(ge, W, H, 'rgba(0,0,0,0)', '#6a28d8', 11, true);
    ge.restore();
    const rng = mulberry(21);
    ge.strokeStyle = '#c79bff';
    ge.lineWidth = 3;
    ge.shadowColor = '#a45cff';
    ge.shadowBlur = 12;
    for (const yc of [H * 0.25, H * 0.75]) {
      for (const off of [-78, 78]) for (let x = 150; x < W - 250; x += 66 + rng() * 22) drawRune(ge, x, yc + off, 26, rng);
      for (let x = 240; x < W - 300; x += 285) {
        ge.beginPath();
        ge.arc(x, yc, 9, 0, TAU);
        ge.fillStyle = '#d6b0ff';
        ge.fill();
        ge.stroke();
      }
    }
    return { map: canvasTex(a), orm: canvasTex(o, false), emissive: canvasTex(e) };
  });
}

/** Soft violet glow sprite texture. */
export function weaponGlowTexture() {
  return once('glow', () => {
    const c = mkCanvas(128, 128);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(190,140,255,.55)');
    gr.addColorStop(0.6, 'rgba(110,50,230,.15)');
    gr.addColorStop(1, 'rgba(80,20,200,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return canvasTex(c);
  });
}

/** Vertical streak texture used by the "energy running along the blade" overlays. */
export function energyStreakTex() {
  return once('streak', () => {
    const W = 64;
    const H = 512;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const rng = mulberry(44);
    for (let i = 0; i < 38; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const len = 40 + rng() * 160;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(160,100,255,0)');
      gr.addColorStop(0.5, `rgba(${180 + rng() * 60},${120 + rng() * 60},255,${0.5 + rng() * 0.5})`);
      gr.addColorStop(1, 'rgba(160,100,255,0)');
      g.fillStyle = gr;
      g.fillRect(x, y, 2 + rng() * 5, len);
      g.fillRect(x, y - H, 2 + rng() * 5, len); // wrap
    }
    const t = canvasTex(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */

/**
 * Loft a cross-section along a circular arc.
 *   sec(s, t, jt, j) -> [a, b]  a = in-plane offset along the arc normal, b = thickness (z)
 *   kappa  curvature (0 = straight)
 *   dir    -1: Purple Awakening frame (extends along -Y, curves toward +X)
 *          +1: tip-up frame (extends along +Y, curves toward +X; negate X via mirror)
 */
export function sweepGeometry({ s0, s1, segs, N, sec, kappa = 0.12, dir = -1, flat = false }) {
  const pos = [];
  const uv = [];
  const idx = [];
  const k = Math.abs(kappa) < 1e-4 ? 0 : kappa;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const s = lerp(s0, s1, t);
    const phi = k * s;
    let cx;
    let cy;
    let nx;
    let ny;
    if (k === 0) {
      cx = 0;
      cy = dir * s;
      nx = 1;
      ny = 0;
    } else {
      cx = (1 - Math.cos(phi)) / k;
      cy = (dir * Math.sin(phi)) / k;
      nx = Math.cos(phi);
      ny = dir * Math.sin(phi);
    }
    for (let j = 0; j <= N; j++) {
      const [a, b] = sec(s, t, j / N, j);
      pos.push(cx + nx * a, cy + ny * a, b);
      uv.push(t, j / N);
    }
  }
  const row = N + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

export const ellipse = (A, B) => (jt) => [A * Math.cos(jt * TAU), B * Math.sin(jt * TAU)];

/** Closed polygon from a half outline (x >= 0, listed top -> bottom), mirrored across x = 0. */
export function mirroredShape(half) {
  const pts = half.map(([x, y]) => new THREE.Vector2(x, y));
  const left = half
    .slice(1, -1)
    .reverse()
    .map(([x, y]) => new THREE.Vector2(-x, y));
  return new THREE.Shape([...pts, ...left]);
}

/** Sample a quadratic-curve outline (list of ['M'|'L'|'Q', ...]) into points. */
export function outline(cmds, div = 8) {
  const pts = [];
  let cx = 0;
  let cy = 0;
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') {
      cx = c[1];
      cy = c[2];
      pts.push([cx, cy]);
    } else {
      const [, qx, qy, x, y] = c;
      for (let i = 1; i <= div; i++) {
        const t = i / div;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const d = t * t;
        pts.push([a * cx + b * qx + d * x, a * cy + b * qy + d * y]);
      }
      cx = x;
      cy = y;
    }
  }
  return pts;
}

export function extrude(shape, depth, bevel = 0.012) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* ------------------------------------------------------------------ */
/* Materials (black metal, silver, violet crystal)                      */
/* ------------------------------------------------------------------ */

/** A fresh crystal material (each weapon animates its own). */
export function crystalMaterial(color = VIOLET, intensity = 2.4) {
  return new THREE.MeshStandardMaterial({
    color: 0x5a22c8,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.12,
    metalness: 0.2,
    flatShading: true,
  });
}

export function glowSprite(color = 0x8a44ff, scale = 1, opacity = 0.4) {
  const m = new THREE.SpriteMaterial({
    map: weaponGlowTexture(),
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity,
    fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  s.renderOrder = 4;
  return s;
}

/** Additive strip with scrolling energy streaks ("violet energy running along the blade"). */
export function energyMaterial(opacity = 0.8) {
  const tex = energyStreakTex().clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xb68cff,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Dispose every geometry + material under an object, except shared cached materials. */
export function disposeTree(root, keep = new Set()) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!keep.has(m) && !m.userData?.shared) m.dispose();
  });
}
