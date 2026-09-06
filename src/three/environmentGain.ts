import * as THREE from "three";

const installed = new WeakSet<THREE.MeshStandardMaterial>();

/**
 * Three uses scene.environmentIntensity instead of material.envMapIntensity when a material
 * inherits scene.environment. Keep the scene's animated intensity/rotation and apply the
 * material's gain inside the IBL functions; explicitly assigned environment maps already use it.
 */
export function addEnvironmentGain(material: THREE.MeshStandardMaterial): void {
  if (installed.has(material)) return;
  installed.add(material);
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const gain = {
    get value() { return material.envMap === null ? material.envMapIntensity : 1; },
  };
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.mokEnvironmentGain = gain;
    shader.fragmentShader = `uniform float mokEnvironmentGain;\n${shader.fragmentShader}`.replace(
      "#include <envmap_physical_pars_fragment>",
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace(/\benvMapIntensity\b/g, "(envMapIntensity * mokEnvironmentGain)"),
    );
  };
  material.customProgramCacheKey = () => `${key}:environment-gain-v1`;
  material.needsUpdate = true;
}
