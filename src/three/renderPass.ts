import * as THREE from "three";

/** Extra camera passes must not inherit the composer's disabled clearing or consume pending shadows. */
export function withOffscreenPass<T>(gl: THREE.WebGLRenderer, render: () => T, updateShadows = false): T {
  const target = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel();
  const color = gl.getClearColor(new THREE.Color()).clone(), alpha = gl.getClearAlpha();
  const autoClear = gl.autoClear, clearColor = gl.autoClearColor, clearDepth = gl.autoClearDepth, clearStencil = gl.autoClearStencil;
  const xr = gl.xr.enabled, autoShadow = gl.shadowMap.autoUpdate, shadowUpdate = gl.shadowMap.needsUpdate;
  try {
    gl.xr.enabled = false;
    gl.autoClear = gl.autoClearColor = gl.autoClearDepth = gl.autoClearStencil = true;
    gl.setClearColor(0x000000, 0);
    if (!updateShadows) { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = false; }
    return render();
  } finally {
    gl.setRenderTarget(target, face, mip);
    gl.setClearColor(color, alpha);
    gl.autoClear = autoClear; gl.autoClearColor = clearColor; gl.autoClearDepth = clearDepth; gl.autoClearStencil = clearStencil;
    gl.xr.enabled = xr;
    gl.shadowMap.autoUpdate = autoShadow;
    if (!updateShadows) gl.shadowMap.needsUpdate = shadowUpdate;
  }
}

export function isEffectivelyVisible(object: THREE.Object3D): boolean {
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
}

/** Preserve original visibility even when a list contains hidden objects or overlapping entries. */
export function withHiddenObjects<T>(objects: Iterable<THREE.Object3D>, render: () => T): T {
  const hidden = new Map<THREE.Object3D, boolean>();
  for (const object of objects) {
    if (!hidden.has(object)) hidden.set(object, object.visible);
    object.visible = false;
  }
  try { return render(); }
  finally { for (const [object, visible] of hidden) object.visible = visible; }
}

/** Replace the near plane only when its projective intersection is finite and non-degenerate. */
export function clipReflectionCamera(camera: THREE.PerspectiveCamera, plane: THREE.Plane): boolean {
  const p = camera.projectionMatrix.elements;
  const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const q = new THREE.Vector4((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
  const denominator = clip.dot(q);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) return false;
  clip.multiplyScalar(2 / denominator);
  p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}
