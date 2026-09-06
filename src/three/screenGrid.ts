import * as THREE from "three";

/** Display subpixels live in screen UV space, so they move with the glass and leave the set alone. */
export function installScreenGrid(material: THREE.MeshPhysicalMaterial) {
  const uniforms = { strength: { value: 0 }, pitch: { value: 6 }, resolution: { value: new THREE.Vector2(1206, 2622) } };
  material.userData.screenGrid = uniforms;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.mokGridStrength = uniforms.strength;
    shader.uniforms.mokGridPitch = uniforms.pitch;
    shader.uniforms.mokGridResolution = uniforms.resolution;
    shader.fragmentShader = `uniform float mokGridStrength;\nuniform float mokGridPitch;\nuniform vec2 mokGridResolution;\n${shader.fragmentShader}`.replace("#include <emissivemap_fragment>", `
#include <emissivemap_fragment>
#ifdef USE_EMISSIVEMAP
  if (mokGridStrength > 0.001) {
    vec2 grid = vEmissiveMapUv * mokGridResolution / max(1.0, mokGridPitch);
    vec2 footprint = fwidth(grid);
    // Blend to the unmodified image before subpixels become too small to resolve; avoids moiré.
    float resolved = 1.0 - smoothstep(0.22, 0.75, max(footprint.x, footprint.y));
    vec3 phase = abs(fract(vec3(grid.x) - vec3(1.0/6.0, 0.5, 5.0/6.0) + 0.5) - 0.5);
    float aa = min(0.08, footprint.x * 0.5);
    vec3 rgb = vec3(1.0) - smoothstep(vec3(0.135 - aa), vec3(0.165 + aa), phase);
    float row = 1.0 - smoothstep(0.40, 0.49, abs(fract(grid.y) - 0.5));
    totalEmissiveRadiance *= mix(vec3(1.0), rgb * row * 3.7, clamp(mokGridStrength, 0.0, 1.0) * resolved);
  }
#endif
`);
  };
  material.customProgramCacheKey = () => `${cacheKey}|mok-screen-grid-v1`;
  return uniforms;
}
