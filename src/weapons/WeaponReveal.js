import * as THREE from 'three';
import { NOISE_GLSL } from './Katana.js';
import { bladeEmissiveTex, crystalMaterial, energyMaterial, handleTextures } from './WeaponKit.js';

/**
 * Per-weapon "materialise" shader patch used by the Greatsword and the Void
 * Daggers' entry animations. Every material of a weapon shares one uniform
 * set (RV) so a single value sweeps the whole model:
 *
 *   uMode 0  linear along the weapon's Y axis   (field = (y - uC) * uS + uO)
 *   uMode 1  radial from a point on the Y axis  (field = |y - uC| * uS)
 *
 * Fragments whose field exceeds the reveal front are discarded and the front
 * itself burns violet. uReveal >= 9 means "fully formed" (no discard).
 */

export function makeRevealUniforms() {
  return {
    uReveal: { value: 9 },
    uMode: { value: 0 },
    uC: { value: 0 },
    uS: { value: 0.3 },
    uO: { value: 0.5 },
    uTime: { value: 0 },
    uEdge: { value: 1 },
    uRootInv: { value: new THREE.Matrix4() },
  };
}

export function patchReveal(mat, RV, { edge = true } = {}) {
  mat.customProgramCacheKey = () => 'wreveal_' + (edge ? 'e' : 'n');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, RV);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP; uniform mat4 uRootInv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = (uRootInv * modelMatrix * vec4(transformed,1.0)).xyz;');
    let fs = sh.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vRP; uniform float uReveal,uMode,uC,uS,uO,uTime,uEdge;\n' + NOISE_GLSL,
    );
    fs = fs.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      float rLin = clamp((vRP.y - uC) * uS + uO, 0., 1.);
      float rRad = clamp(abs(vRP.y - uC) * uS, 0., 1.);
      float rField = mix(rLin, rRad, step(0.5, uMode)) * 0.8 + fbm(vRP * 5.0 + vec3(0., uTime * 0.2, 0.)) * 0.2;
      float rFront = uReveal * 1.2 - 0.1;
      if (rField > rFront) discard;
      float rEdge = (1.0 - smoothstep(0.0, 0.06, rFront - rField)) * step(uReveal, 2.0) * uEdge;`,
    );
    if (edge) {
      fs = fs.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.7,0.4,1.0) * rEdge * 3.2 + vec3(1.0,0.85,1.0) * pow(rEdge, 3.0) * 1.8;`,
      );
    }
    sh.fragmentShader = fs;
  };
  return mat;
}

/** Drive a weapon's reveal from a 0..1 progress value. */
export function setReveal(RV, k) {
  RV.uReveal.value = k >= 1 ? 9 : k * 1.05;
}

/**
 * A fresh, per-weapon set of black-metal / silver / blade / grip / crystal /
 * energy materials, all wired to the weapon's reveal uniforms.
 */
export function makeWeaponMaterials(RV, glowColor = 0x9a5cff) {
  const h = handleTextures();
  const M = {
    black: new THREE.MeshStandardMaterial({ color: 0x0e0c16, metalness: 1, roughness: 0.3 }),
    guard: new THREE.MeshStandardMaterial({ color: 0x2a2836, metalness: 0.95, roughness: 0.3 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc4c7d4, metalness: 1, roughness: 0.24 }),
    silverFlat: new THREE.MeshStandardMaterial({ color: 0xc4c7d4, metalness: 1, roughness: 0.3, flatShading: true }),
    blade: new THREE.MeshStandardMaterial({
      color: 0x8c8aa4, metalness: 1, roughness: 0.22,
      emissive: 0xffffff, emissiveMap: bladeEmissiveTex(), emissiveIntensity: 0.85,
    }),
    grip: new THREE.MeshStandardMaterial({
      map: h.map, roughness: 0.55, metalness: 0.25,
      emissive: 0xffffff, emissiveMap: h.emissive, emissiveIntensity: 0.6,
    }),
    crystal: crystalMaterial(glowColor, 2.4),
  };
  for (const m of Object.values(M)) patchReveal(m, RV);
  M.energy = patchReveal(energyMaterial(0.8), RV, { edge: false });
  return M;
}
