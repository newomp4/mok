import * as THREE from "three";
import { isEffectivelyVisible, withHiddenObjects, withOffscreenPass } from "@/three/renderPass";

// Three height bands approximate a growing area-light penumbra. Filtering each band separately
// keeps the feet crisp without also sharpening the shadow of a raised lid or floating device.
const blurFragment = `
  uniform sampler2D tDiffuse;
  uniform vec2 stepSize;
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.0);
    for (int i = -4; i <= 4; i++) {
      float x = float(i);
      float weight = exp(-0.5 * x * x / 4.0) / 4.898030625;
      sum.r += texture2D(tDiffuse, vUv + stepSize * x * 0.12).r * weight;
      sum.g += texture2D(tDiffuse, vUv + stepSize * x * 0.45).g * weight;
      sum.b += texture2D(tDiffuse, vUv + stepSize * x).b * weight;
    }
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/** Only empty surfaces are excluded; an opaque material's opacity does not make it invisible. */
export function castsContactShadow(material: THREE.Material): boolean {
  const transmission = (material as THREE.MeshPhysicalMaterial).transmission ?? 0;
  return material.visible && !(material.transparent && material.opacity <= 0 && transmission <= 0);
}

export function createContactShadowResources(size: number, resolution: number) {
  const target = new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.HalfFloatType });
  const blurred = new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.HalfFloatType, depthBuffer: false });
  target.texture.generateMipmaps = blurred.texture.generateMipmaps = false;
  const geometry = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2);
  // The camera looks up from the floor: the nearest underside, not the last drawn surface,
  // determines the contact height. Both faces participate when a source is an open thin shell.
  const depth = new THREE.MeshDepthMaterial({ depthTest: true, depthWrite: true, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      `vec4(vec3(0.0), 1.0);
       float heightBand = clamp(fragCoordZ * 4.0, 0.0, 2.0);
       vec3 bands = max(vec3(0.0), 1.0 - abs(vec3(0.0, 1.0, 2.0) - heightBand));
       gl_FragColor.rgb = bands * pow(1.0 - fragCoordZ, 2.0);`,
    );
  };
  const blurMaterial = () => new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, stepSize: { value: new THREE.Vector2() } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: blurFragment, depthTest: false, depthWrite: false,
  });
  const horizontal = blurMaterial(), vertical = blurMaterial();
  const plane = new THREE.Mesh(geometry, horizontal);
  const catcher = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthWrite: false });
  catcher.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      vec3 bands = texture2D(map, vMapUv).rgb;
      diffuseColor = vec4(0.0, 0.0, 0.0, opacity * clamp(bands.r + bands.g + bands.b, 0.0, 1.0));
    `);
  };
  catcher.customProgramCacheKey = () => "contact-height-bands-v1";
  return { target, blurred, geometry, depth, horizontal, vertical, plane, catcher };
}

/** Render model depth without camera overlays, receivers or fully transparent source helpers. */
export function renderContactShadow(gl: THREE.WebGLRenderer, scene: THREE.Scene, mainCamera: THREE.Camera, shadow: THREE.Object3D, camera: THREE.OrthographicCamera, resources: ReturnType<typeof createContactShadowResources>, blur: number): void {
  if (!isEffectivelyVisible(shadow)) return;
  const background = scene.background, override = scene.overrideMaterial;
  const { target, blurred, depth, plane, horizontal, vertical } = resources;
  const hidden: THREE.Object3D[] = [shadow, ...mainCamera.children];
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (object.name === "ground-shadow-catcher" || materials.every((m) => !castsContactShadow(m))) hidden.push(object);
  });
  withHiddenObjects(hidden, () => {
    try {
      scene.background = null;
      scene.overrideMaterial = depth;
      withOffscreenPass(gl, () => {
        gl.setRenderTarget(target);
        gl.render(scene, camera);
        plane.material = horizontal;
        horizontal.uniforms.tDiffuse.value = target.texture;
        horizontal.uniforms.stepSize.value.set(Math.max(0, blur) / 256, 0);
        gl.setRenderTarget(blurred);
        gl.render(plane, camera);
        plane.material = vertical;
        vertical.uniforms.tDiffuse.value = blurred.texture;
        vertical.uniforms.stepSize.value.set(0, Math.max(0, blur) / 256);
        gl.setRenderTarget(target);
        gl.render(plane, camera);
      });
    } finally {
      scene.background = background;
      scene.overrideMaterial = override;
    }
  });
}
