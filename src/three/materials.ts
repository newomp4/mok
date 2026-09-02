import * as THREE from "three";
import type { Finish } from "@/lib/devices";

export interface FinishMaterials {
  frame: THREE.MeshStandardMaterial;
  back: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  lens: THREE.MeshPhysicalMaterial;
  lensRing: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  band: THREE.MeshStandardMaterial;
  keys: THREE.MeshStandardMaterial;
}

export function createFinishMaterials(f: Finish): FinishMaterials {
  const frame = new THREE.MeshStandardMaterial({
    color: new THREE.Color(f.color),
    metalness: f.metalness ?? 0.95,
    roughness: f.roughness ?? 0.38,
    envMapIntensity: 1,
  });
  const back = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(f.back ?? f.color),
    metalness: 0.1,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#050506"),
    metalness: 0,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#07070a"),
    metalness: 0.2,
    roughness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.4,
  });
  const lensRing = new THREE.MeshStandardMaterial({
    color: new THREE.Color(f.color).lerp(new THREE.Color("#ffffff"), 0.15),
    metalness: 1,
    roughness: 0.25,
  });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color("#101012"), metalness: 0.3, roughness: 0.5 });
  const band = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.band ?? "#2a2a2c"), metalness: 0.05, roughness: 0.75 });
  const keys = new THREE.MeshStandardMaterial({ color: new THREE.Color("#1b1b1d"), metalness: 0.1, roughness: 0.6 });
  const all = { frame, back, glass, lens, lensRing, dark, band, keys };
  for (const mat of Object.values(all)) mat.fog = false;
  return all;
}

export function disposeMaterials(m: FinishMaterials) {
  Object.values(m).forEach((x) => x.dispose());
}

/** Screen material: emissive content + glossy clear coat for environment reflections. */
export function createScreenMaterial(texture: THREE.Texture): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#000000"),
    emissive: new THREE.Color("#ffffff"),
    emissiveMap: texture,
    emissiveIntensity: 1,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1,
    side: THREE.DoubleSide,
  });
  // anything mapped outside the content window (bezel overshoot on glTF screens) renders black
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      #ifdef USE_EMISSIVEMAP
      { vec2 w = step(vec2(0.0), vEmissiveMapUv) * step(vEmissiveMapUv, vec2(1.0)); totalEmissiveRadiance *= w.x * w.y; }
      #endif`,
    );
  };
  m.customProgramCacheKey = () => "mok-screen";
  m.fog = false;
  return m;
}
