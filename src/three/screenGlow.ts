import * as THREE from "three";

/** Shared live values; only floor materials opt in to illumination from the display. */
export const screenGlow = {
  color: new THREE.Uniform(new THREE.Color()),
  position: new THREE.Uniform(new THREE.Vector3()),
  direction: new THREE.Uniform(new THREE.Vector3(0, 0, 1)),
  intensity: new THREE.Uniform(0),
};

/** Three's layers filter lights by camera, not by receiving mesh. Apply this spill to floors only. */
export function addScreenGlow(material: THREE.MeshStandardMaterial) {
  if (material.userData.screenGlow) return;
  material.userData.screenGlow = true;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.screenGlowColor = screenGlow.color;
    shader.uniforms.screenGlowPosition = screenGlow.position;
    shader.uniforms.screenGlowDirection = screenGlow.direction;
    shader.uniforms.screenGlowIntensity = screenGlow.intensity;
    shader.vertexShader = `varying vec3 vScreenGlowWorld;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      "vScreenGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>",
    );
    shader.fragmentShader = `varying vec3 vScreenGlowWorld;
      uniform vec3 screenGlowColor;
      uniform vec3 screenGlowPosition;
      uniform vec3 screenGlowDirection;
      uniform float screenGlowIntensity;
      ${shader.fragmentShader}`.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
      if (screenGlowIntensity > 0.0) {
        vec3 glowVector = screenGlowPosition - vScreenGlowWorld;
        float glowDistanceSq = max(dot(glowVector, glowVector), 0.0001);
        vec3 glowDirection = glowVector * inversesqrt(glowDistanceSq);
        float glowFront = max(dot(-glowDirection, screenGlowDirection), 0.0);
        float glowCosine = max(dot(geometryNormal, mat3(viewMatrix) * glowDirection), 0.0);
        vec3 glowIrradiance = screenGlowColor * screenGlowIntensity * glowFront * glowCosine / glowDistanceSq;
        reflectedLight.directDiffuse += glowIrradiance * BRDF_Lambert(diffuseColor.rgb);
      }`);
  };
  material.customProgramCacheKey = () => `${cacheKey}:screen-glow-v1`;
  material.needsUpdate = true;
}
