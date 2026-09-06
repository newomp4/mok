import * as THREE from "three";

/**
 * A small variation in the width of metal highlights. It lives in object space, so it follows
 * the device, and fades below a pixel instead of becoming sparkling noise during camera moves.
 * Authored textures, polished chrome, glass and nonmetal finishes keep their own shading.
 */
export function addMetalSurfaceDetail(material: THREE.MeshStandardMaterial): void {
  if (!material.isMeshStandardMaterial || material.metalness < 0.65 || material.roughness < 0.16 ||
      material.roughness > 0.8 || material.transparent || material.map || material.roughnessMap ||
      material.metalnessMap || material.normalMap || material.bumpMap) return;

  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.vertexShader = `varying vec3 vMetalPosition;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      `vec3 metalScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
      vMetalPosition = transformed * metalScale;
      #include <project_vertex>`,
    );
    shader.fragmentShader = `varying vec3 vMetalPosition;
      float metalHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float metalNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(metalHash(i), metalHash(i + vec2(1.0, 0.0)), f.x),
                   mix(metalHash(i + vec2(0.0, 1.0)), metalHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      ${shader.fragmentShader}`.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      // Scene units are 100 mm: elongated, submillimetre marks, visible only in close-ups.
      vec2 metalUv = vec2(vMetalPosition.x + vMetalPosition.z * 0.83, vMetalPosition.y) * vec2(420.0, 32.0);
      vec2 metalFootprint = fwidth(metalUv);
      float metalVisibility = 1.0 - smoothstep(0.3, 1.1, max(metalFootprint.x, metalFootprint.y));
      float metalGrain = (metalNoise(metalUv) - 0.5) * metalVisibility;
      roughnessFactor = clamp(roughnessFactor + metalGrain * 0.045, 0.08, 1.0);`,
    );
  };
  material.customProgramCacheKey = () => `${previousKey}:metal-surface-v1`;
  material.needsUpdate = true;
}
