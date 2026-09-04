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

/**
 * Live uniforms for the planar mirror the screen shows. `map` is the render target the room is
 * drawn into from the mirrored camera, `matrix` projects a world position into it, and `amount`
 * is the Reflection slider — at zero the shader skips the lookup and nothing renders the pass.
 */
export interface ScreenReflection {
  map: { value: THREE.Texture | null };
  matrix: { value: THREE.Matrix4 };
  amount: { value: number };
}

export type ScreenMaterial = THREE.MeshPhysicalMaterial & { reflection: ScreenReflection };

/** Screen material: emissive content + glossy clear coat for environment reflections. */
export function createScreenMaterial(texture: THREE.Texture): ScreenMaterial {
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
  }) as ScreenMaterial;
  m.reflection = { map: { value: null }, matrix: { value: new THREE.Matrix4() }, amount: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.reflectMap = m.reflection.map;
    shader.uniforms.reflectMatrix = m.reflection.matrix;
    shader.uniforms.reflectAmount = m.reflection.amount;
    shader.vertexShader = `uniform mat4 reflectMatrix;
varying vec4 vReflectUv;
${shader.vertexShader}`.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
      vReflectUv = reflectMatrix * modelMatrix * vec4( transformed, 1.0 );`,
    );
    shader.fragmentShader = `uniform sampler2D reflectMap;
uniform float reflectAmount;
varying vec4 vReflectUv;
${shader.fragmentShader}`
      .replace(
        "#include <emissivemap_fragment>",
        // anything mapped outside the content window (bezel overshoot on glTF screens) renders black
        `#include <emissivemap_fragment>
      #ifdef USE_EMISSIVEMAP
      { vec2 w = step(vec2(0.0), vEmissiveMapUv) * step(vEmissiveMapUv, vec2(1.0)); if (w.x * w.y < 0.5) discard; }
      #endif`,
      )
      .replace(
        "#include <aomap_fragment>",
        // the mirrored render of the room, projected back onto the glass at the fragment's own
        // screen position. It opens up towards grazing angles the way real glass does, but keeps a
        // floor at head-on so a display seen square still shows the deck in front of it.
        `if ( reflectAmount > 0.0 && vReflectUv.w > 0.0 ) {
        vec3 mirror = texture2DProj( reflectMap, vReflectUv ).rgb;
        float grazing = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 5.0 );
        // Glass is not a mirror: even at full Reflection the display has to stay the brighter of the
        // two, so the mirror comes in on a curve and never takes more than a third of the surface
        // head on, opening up towards grazing angles where a real screen does reflect the room.
        float mirrorGain = reflectAmount * reflectAmount * mix( 0.1, 0.42, grazing );
        reflectedLight.indirectSpecular += mirror * mirrorGain;
      }
      #include <aomap_fragment>`,
      );
  };
  m.customProgramCacheKey = () => "mok-screen";
  m.fog = false;
  return m;
}
