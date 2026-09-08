import * as THREE from "three";

/** Fade the remote receiver into the same output-space fog as the dome. Nearby shading still
 * comes entirely from the lights, so moving a softbox moves its pool across the sweep. */
export function addSweepFade(material: THREE.Material, size: number): void {
  const installed = material.userData.sweepFade as THREE.Uniform<number> | undefined;
  if (installed) { installed.value = size; return; }
  const scale = new THREE.Uniform(size);
  material.userData.sweepFade = scale;
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.sweepScale = scale;
    shader.vertexShader = `varying vec3 vSweepWorld;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>", "vSweepWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>",
    );
    shader.fragmentShader = `varying vec3 vSweepWorld; uniform float sweepScale;\n${shader.fragmentShader}`.replace(
      "#include <fog_fragment>", `#include <fog_fragment>
      #ifdef USE_FOG
        float sweepFade = smoothstep(sweepScale * 0.9, sweepScale * 3.5, length(vSweepWorld.xz));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, sweepFade);
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `${key}:photographic-sweep-v1`;
  material.needsUpdate = true;
}
