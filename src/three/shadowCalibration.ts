import * as THREE from "three";
import { visibleBounds } from "@/three/bounds";

const bounds = new THREE.Box3(), lightBounds = new THREE.Box3(), identity = new THREE.Matrix4();
const point = new THREE.Vector3(), ray = new THREE.Vector3(), position = new THREE.Vector3(), target = new THREE.Vector3();
const radiusBases = new WeakMap<THREE.LightShadow, { authored: number; applied: number }>();

/** VSM also draws receiveShadow meshes as casters. Infinite floors must only receive shadows. */
export function createReceiverOnlyShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "Receiver-only floor shadow",
    vertexShader: "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "void main(){ discard; }",
    colorWrite: false, depthWrite: false,
  });
}

/** Sub-texel receiver offsets scale with the shadow's actual coverage, not a fixed 2 mm gap. */
export function shadowBias(span: number, depth: number, resolution: number) {
  const texel = Math.max(1e-6, span) / Math.max(1, resolution);
  return { normalBias: texel * 0.65, bias: -Math.min(0.0004, texel * 0.15 / Math.max(0.01, depth)) };
}

/** Fit the visible caster and its bounded floor projection in the current light frame. */
export function calibrateShadow(light: THREE.DirectionalLight | THREE.SpotLight, device: THREE.Object3D, floorY: number, fitSize: number, resolution: number): void {
  const shadow = light.shadow, camera = shadow.camera;
  light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
  light.getWorldPosition(position); light.target.getWorldPosition(target);
  camera.position.copy(position); camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateMatrixWorld();
  let span = fitSize * 3.2;
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    visibleBounds(device, identity, bounds);
    if (bounds.isEmpty()) return;
    ray.subVectors(target, position).normalize(); lightBounds.makeEmpty();
    for (let i = 0; i < 8; i++) {
      point.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
      lightBounds.expandByPoint(point.clone().applyMatrix4(camera.matrixWorldInverse));
      // Very low lights can throw unbounded shadows. Keep the useful local receiver region stable.
      if (ray.y < -0.04 && point.y >= floorY) point.addScaledVector(ray, Math.min(fitSize * 4, (floorY - point.y) / ray.y));
      point.y = floorY;
      lightBounds.expandByPoint(point.applyMatrix4(camera.matrixWorldInverse));
    }
    const c = camera as THREE.OrthographicCamera;
    const pad = fitSize * 0.1;
    let width = Math.max(fitSize * 0.7, lightBounds.max.x - lightBounds.min.x + pad * 2);
    let height = Math.max(fitSize * 0.7, lightBounds.max.y - lightBounds.min.y + pad * 2);
    const texel = Math.max(width, height) / resolution;
    const cx = Math.round((lightBounds.min.x + lightBounds.max.x) / 2 / texel) * texel;
    const cy = Math.round((lightBounds.min.y + lightBounds.max.y) / 2 / texel) * texel;
    width += texel * 2; height += texel * 2;
    c.left = cx - width / 2; c.right = cx + width / 2; c.bottom = cy - height / 2; c.top = cy + height / 2;
    c.near = Math.max(0.01, -lightBounds.max.z - pad); c.far = Math.max(c.near + 0.1, -lightBounds.min.z + pad);
    c.updateProjectionMatrix(); span = Math.max(width, height);
  } else {
    const distance = position.distanceTo(target);
    span = 2 * Math.tan((camera as THREE.PerspectiveCamera).fov * Math.PI / 360) * distance;
  }
  Object.assign(shadow, shadowBias(span, camera.far - camera.near, resolution));
  let radius = radiusBases.get(shadow);
  if (!radius || radius.applied !== shadow.radius) radius = { authored: shadow.radius, applied: shadow.radius };
  radius.applied = radius.authored * fitSize * 3.2 / Math.max(span, 0.01);
  shadow.radius = radius.applied;
  radiusBases.set(shadow, radius);
}
