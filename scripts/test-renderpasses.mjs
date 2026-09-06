import "./test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

const { withOffscreenPass, withHiddenObjects, isEffectivelyVisible, clipReflectionCamera } = await import("../src/three/renderPass.ts");
const { createContactShadowResources, renderContactShadow } = await import("../src/three/ContactShadow.tsx");
const { disposeResources } = await import("../src/three/resources.ts");

function renderer() {
  const initialTarget = new THREE.WebGLCubeRenderTarget(16);
  let target = initialTarget, face = 3, mip = 2, alpha = 0.7;
  const color = new THREE.Color("#456789");
  return {
    autoClear: false, autoClearColor: false, autoClearDepth: false, autoClearStencil: false,
    xr: { enabled: true }, shadowMap: { autoUpdate: true, needsUpdate: true },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(t, f = 0, m = 0) { target = t; face = f; mip = m; },
    getClearColor(out) { return out.copy(color); }, getClearAlpha: () => alpha,
    setClearColor(c, a = 1) { color.set(c); alpha = a; },
    render() {},
  };
}

function snapshot(gl) {
  return {
    target: gl.getRenderTarget(), face: gl.getActiveCubeFace(), mip: gl.getActiveMipmapLevel(),
    color: gl.getClearColor(new THREE.Color()).getHex(), alpha: gl.getClearAlpha(),
    clear: [gl.autoClear, gl.autoClearColor, gl.autoClearDepth, gl.autoClearStencil],
    xr: gl.xr.enabled, shadows: { ...gl.shadowMap },
  };
}

test("offscreen passes clear independently of the composer and restore framebuffer, alpha, XR and pending shadows", () => {
  for (const fail of [false, true]) {
    const gl = renderer(), before = snapshot(gl), target = new THREE.WebGLRenderTarget(8, 8);
    const run = () => withOffscreenPass(gl, () => {
      assert.deepEqual([gl.autoClear, gl.autoClearColor, gl.autoClearDepth, gl.autoClearStencil], [true, true, true, true]);
      assert.equal(gl.getClearColor(new THREE.Color()).getHex(), 0); assert.equal(gl.getClearAlpha(), 0);
      assert.equal(gl.xr.enabled, false);
      assert.deepEqual(gl.shadowMap, { autoUpdate: false, needsUpdate: false }, "reflection cannot consume a main-camera shadow refresh");
      gl.setRenderTarget(target);
      if (fail) throw new Error("failed render");
      return "done";
    });
    if (fail) assert.throws(run, /failed render/); else assert.equal(run(), "done");
    assert.deepEqual(snapshot(gl), before);
    before.target.dispose(); target.dispose();
  }
});

test("nested offscreen passes return to their calling target and preserve original object visibility", () => {
  const gl = renderer(), before = snapshot(gl), target = new THREE.WebGLRenderTarget(8, 8);
  const visible = new THREE.Group(), hidden = new THREE.Group(); hidden.visible = false;
  assert.throws(() => withHiddenObjects([visible, hidden, visible], () => withOffscreenPass(gl, () => {
    assert.equal(visible.visible, false); assert.equal(hidden.visible, false);
    gl.setRenderTarget(target, 2, 1);
    const outer = snapshot(gl);
    withOffscreenPass(gl, () => { gl.setRenderTarget(null); });
    assert.deepEqual(snapshot(gl), outer);
    throw new Error("blur failed");
  })), /blur failed/);
  assert.equal(visible.visible, true); assert.equal(hidden.visible, false);
  assert.deepEqual(snapshot(gl), before);
  const parent = new THREE.Group(); parent.add(visible); parent.visible = false;
  assert.equal(isEffectivelyVisible(visible), false, "staged scene parents suppress their passes");
  parent.visible = true; assert.equal(isEffectivelyVisible(visible), true);
  before.target.dispose(); target.dispose();
});

function contactFixture() {
  const gl = renderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const shadow = new THREE.Group(), contactCamera = new THREE.OrthographicCamera();
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  const hiddenOverlay = overlay.clone(); hiddenOverlay.visible = false;
  camera.add(overlay, hiddenOverlay); scene.add(camera, shadow);
  scene.background = new THREE.Color("#eeddcc");
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: "red" });
  const resources = createContactShadowResources(3, 32);
  const clean = () => {
    disposeResources(resources); gl.getRenderTarget()?.dispose();
    scene.overrideMaterial.dispose(); overlay.geometry.dispose(); overlay.material.dispose();
  };
  return { gl, scene, camera, shadow, contactCamera, overlay, hiddenOverlay, resources, clean };
}

test("moving a contact-shadow caster replaces the old silhouette and excludes camera overlays", () => {
  const f = contactFixture();
  let caster = "left", calls = 0;
  const pixels = new Map([[f.resources.target, new Set(["stale silhouette"])]]);
  f.gl.render = (object) => {
    calls++;
    const target = f.gl.getRenderTarget();
    if (f.gl.autoClear) pixels.set(target, new Set());
    assert.equal(f.gl.getClearAlpha(), 0, "empty contact pixels have no alpha");
    if (object === f.scene) {
      assert.equal(f.scene.background, null); assert.equal(f.scene.overrideMaterial, f.resources.depth);
      assert.equal(f.shadow.visible, false); assert.equal(f.overlay.visible, false); assert.equal(f.hiddenOverlay.visible, false);
      pixels.get(target).add(caster);
    } else {
      const input = object.material.uniforms.tDiffuse.value;
      const source = input === f.resources.target.texture ? f.resources.target : f.resources.blurred;
      pixels.set(target, new Set(pixels.get(source)));
    }
  };
  try {
    renderContactShadow(f.gl, f.scene, f.camera, f.shadow, f.contactCamera, f.resources, 2.4);
    assert.deepEqual([...pixels.get(f.resources.target)], ["left"]);
    caster = "right";
    renderContactShadow(f.gl, f.scene, f.camera, f.shadow, f.contactCamera, f.resources, 2.4);
    assert.deepEqual([...pixels.get(f.resources.target)], ["right"], "previous positions do not accumulate into a trail");
    assert.equal(calls, 10); assert.equal(f.overlay.visible, true); assert.equal(f.hiddenOverlay.visible, false);
    f.shadow.visible = false;
    renderContactShadow(f.gl, f.scene, f.camera, f.shadow, f.contactCamera, f.resources, 2.4);
    assert.equal(calls, 10, "a hidden/transparent catcher never spends a GPU pass");
  } finally { f.clean(); }
});

test("depth and blur failures restore scene overrides, renderer state and all temporary visibility", () => {
  for (const failAt of [1, 2, 5]) {
    const f = contactFixture(), before = snapshot(f.gl), background = f.scene.background, override = f.scene.overrideMaterial;
    let calls = 0;
    f.gl.render = () => { if (++calls === failAt) throw new Error("GPU pass failed"); };
    try {
      assert.throws(() => renderContactShadow(f.gl, f.scene, f.camera, f.shadow, f.contactCamera, f.resources, 2.4), /GPU pass failed/);
      assert.deepEqual(snapshot(f.gl), before);
      assert.equal(f.scene.background, background); assert.equal(f.scene.overrideMaterial, override);
      assert.equal(f.shadow.visible, true); assert.equal(f.overlay.visible, true); assert.equal(f.hiddenOverlay.visible, false);
    } finally { f.clean(); }
  }
});

test("reflection clipping rejects degenerate planes without corrupting projection and clips the correct half-space", () => {
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 100);
  for (const plane of [new THREE.Plane(new THREE.Vector3(), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), -100), new THREE.Plane(new THREE.Vector3(NaN, 0, 1), 0)]) {
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
    assert.equal(clipReflectionCamera(camera, plane), false);
    assert.deepEqual(camera.projectionMatrix.elements, projection.elements);
    assert.deepEqual(camera.projectionMatrixInverse.elements, inverse.elements);
  }
  assert.equal(clipReflectionCamera(camera, new THREE.Plane(new THREE.Vector3(0, 0, -1), -2)), true);
  assert.ok(new THREE.Vector3(0, 0, -1).project(camera).z < -1, "geometry behind the reflection plane is clipped");
  assert.ok(new THREE.Vector3(0, 0, -3).project(camera).z > -1, "geometry in front of the mirror remains visible");
  const identity = camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse);
  identity.elements.forEach((value, i) => assert.ok(Math.abs(value - (i % 5 === 0 ? 1 : 0)) < 1e-9));
});
