import { Pass } from "postprocessing";
import * as THREE from "three";
import { withOffscreenPass } from "../renderPass";

const fragment = /* glsl */`
uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform sampler2D receiverMask;
uniform mat4 inverseProjection;
uniform vec2 resolution;
uniform float projectionScale;
uniform float radius;
uniform float strength;
varying vec2 vUv;
vec3 positionAt(vec2 uv) {
  float depth = texture2D(depthBuffer, uv).r;
  vec4 p = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
void main() {
  vec4 color = texture2D(inputBuffer, vUv);
  if (strength <= 0.0) { gl_FragColor = color; return; }
  float mask = texture2D(receiverMask, vUv).r;
  if (mask < 0.99 || color.a < 0.999 || texture2D(depthBuffer, vUv).r > 0.99999) {
    gl_FragColor = color; return;
  }
  vec3 p = positionAt(vUv);
  vec3 normal = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(normal, -p) < 0.0) normal = -normal;
  float projected = clamp(radius * projectionScale / max(-p.z, 0.001), 1.0 / resolution.y, 0.06);
  vec2 aspect = vec2(resolution.y / resolution.x, 1.0);
  float occlusion = 0.0;
  for (int i = 0; i < 16; i++) {
    float angle = float(i) * 2.39996323;
    float ring = sqrt((float(i) + 0.5) / 16.0);
    vec2 uv = vUv + vec2(cos(angle), sin(angle)) * ring * projected * aspect;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
    vec3 difference = positionAt(uv) - p;
    float distanceToSample = length(difference);
    float horizon = max(0.0, dot(normal, difference / max(distanceToSample, 0.00001)) - 0.15);
    float attenuation = 1.0 - smoothstep(radius * 0.25, radius, distanceToSample);
    occlusion += horizon * attenuation;
  }
  gl_FragColor = vec4(color.rgb * (1.0 - strength * min(0.65, occlusion / 8.0)), color.a);
}`;

/** Only opaque lit materials receive detail shading. Emissive screens and camera cards are masked. */
export function receivesDetailShadows(material: THREE.Material): boolean {
  const lit = material as THREE.MeshStandardMaterial;
  return !!lit.isMeshStandardMaterial && !material.transparent && !lit.emissiveMap && !("reflection" in material);
}

/** Keep the source silhouette/culling while replacing only its output color with the receiver ID. */
export function createDetailMaskMaterial(source: THREE.Material): THREE.MeshBasicMaterial {
  const mask = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  mask.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", "outgoingLight = diffuse;\n#include <opaque_fragment>");
  };
  mask.customProgramCacheKey = () => "mok-detail-mask-v1";
  updateDetailMaskMaterial(mask, source);
  return mask;
}

function updateDetailMaskMaterial(mask: THREE.MeshBasicMaterial, source: THREE.Material): void {
  const original = source as THREE.MeshStandardMaterial;
  const map = original.map ?? null, alphaMap = original.alphaMap ?? null;
  if (mask.side !== source.side || mask.map !== map || mask.alphaMap !== alphaMap || mask.transparent !== source.transparent ||
      mask.vertexColors !== source.vertexColors || mask.alphaHash !== source.alphaHash || mask.clippingPlanes !== source.clippingPlanes || mask.clipIntersection !== source.clipIntersection) mask.needsUpdate = true;
  mask.color.setHex(receivesDetailShadows(source) ? 0xffffff : 0x000000);
  mask.side = source.side; mask.map = map; mask.alphaMap = alphaMap;
  mask.alphaTest = source.alphaTest; mask.alphaHash = source.alphaHash;
  mask.opacity = source.opacity; mask.transparent = source.transparent; mask.vertexColors = source.vertexColors;
  mask.depthTest = source.depthTest; mask.depthWrite = source.depthWrite; mask.depthFunc = source.depthFunc;
  mask.polygonOffset = source.polygonOffset; mask.polygonOffsetFactor = source.polygonOffsetFactor; mask.polygonOffsetUnits = source.polygonOffsetUnits;
  mask.clippingPlanes = source.clippingPlanes; mask.clipIntersection = source.clipIntersection;
}

export class DetailShadowPass extends Pass {
  strength = 0;
  radius = 0.04;
  private sourceScene: THREE.Scene;
  private sourceCamera: THREE.Camera;
  private mask: THREE.WebGLRenderTarget;
  private variants = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  private shader: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super("Detail shadows");
    this.sourceScene = scene; this.sourceCamera = camera;
    this.needsDepthTexture = true;
    this.mask = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.mask.texture.name = "Detail-shadow receiver mask";
    this.shader = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader: fragment,
      uniforms: {
        inputBuffer: { value: null }, depthBuffer: { value: null }, receiverMask: { value: this.mask.texture },
        inverseProjection: { value: new THREE.Matrix4() }, resolution: { value: new THREE.Vector2(1, 1) },
        projectionScale: { value: 1 }, radius: { value: this.radius }, strength: { value: this.strength },
      },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    this.fullscreenMaterial = this.shader;
  }
  set mainScene(scene: THREE.Scene) { this.sourceScene = scene; }
  set mainCamera(camera: THREE.Camera) { this.sourceCamera = camera; }
  setDepthTexture(texture: THREE.Texture | null): void { this.shader.uniforms.depthBuffer.value = texture; }
  setSize(width: number, height: number): void {
    this.shader.uniforms.resolution.value.set(width, height);
    const scale = Math.min(0.5, 1024 / Math.max(width, height));
    this.mask.setSize(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
  }
  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    const scene = this.sourceScene, camera = this.sourceCamera;
    const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const used = new Set<THREE.Material>();
    const background = scene.background, override = scene.overrideMaterial;
    if (this.strength > 0) withOffscreenPass(renderer, () => {
      try {
        scene.background = null; scene.overrideMaterial = null;
        scene.traverseVisible((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          materials.set(mesh, mesh.material);
          const select = (mat: THREE.Material) => {
            used.add(mat);
            let variant = this.variants.get(mat);
            if (!variant) { variant = createDetailMaskMaterial(mat); this.variants.set(mat, variant); }
            else updateDetailMaskMaterial(variant, mat);
            return variant;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(select) : select(mesh.material);
        });
        renderer.setRenderTarget(this.mask);
        renderer.render(scene, camera);
      } finally {
        for (const [mesh, original] of materials) mesh.material = original;
        scene.background = background; scene.overrideMaterial = override;
        this.releaseUnused(used);
      }
    });
    else this.releaseUnused(used);
    this.shader.uniforms.inputBuffer.value = inputBuffer.texture;
    this.shader.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.shader.uniforms.projectionScale.value = camera.projectionMatrix.elements[5] * 0.5;
    this.shader.uniforms.radius.value = this.radius;
    this.shader.uniforms.strength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }
  private releaseUnused(used: Set<THREE.Material>): void {
    for (const [source, mask] of this.variants) if (!used.has(source)) { mask.dispose(); this.variants.delete(source); }
  }
  dispose(): void { this.mask.dispose(); this.releaseUnused(new Set()); this.shader.dispose(); }
}
