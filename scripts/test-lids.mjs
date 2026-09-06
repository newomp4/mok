import "./test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { fileURLToPath } from "node:url";
import { loadModelGeometry } from "./model-geometry.mjs";

const { getDevice } = await import("../src/lib/devices.ts");
const { detectFeatures, findScreenMeshes, setLidAngle } = await import("../src/three/devices/GlbModel.tsx");
const { readScreenPlane } = await import("../src/three/screenPlane.ts");
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

/** Exact transformed vertices, independent of the hinge detector's slab boxes. */
function bounds(object, inverse) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  object.traverseVisible((mesh) => {
    if (!mesh.isMesh) return;
    matrix.multiplyMatrices(inverse, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(matrix));
  });
  return box;
}

for (const [id, keySurface] of [["macbook-pro-14-glb", "QYMcPaZnXQfyXcJ"], ["macbook-pro-16-glb", "Object_76"]]) {
  test(`${id} closes over the keys and stays above the floor at 0, 20, 90, 110 and 135 degrees`, async () => {
    for (const rotation of [[0, 0, 0], [0.3, -0.6, 0.2]]) {
      const spec = getDevice(id), source = await loadModelGeometry(fileURLToPath(new URL(`../public${spec.model.url}`, import.meta.url)));
      const original = new THREE.Box3().setFromObject(source), size = original.getSize(new THREE.Vector3());
      source.position.sub(original.getCenter(new THREE.Vector3()));
      const scene = new THREE.Scene(), device = new THREE.Group(), root = new THREE.Group(), yaw = new THREE.Group();
      device.name = "device"; yaw.name = "autoYaw"; yaw.add(source); root.add(yaw); device.add(root); scene.add(device);
      root.scale.setScalar(spec.model.size * 0.01 / Math.max(size.x, size.y, size.z));
      device.rotation.set(...rotation); device.position.set(1, -2, 0.5);
      root.updateWorldMatrix(true, true);
      const inverse = device.matrixWorld.clone().invert();
      for (const name of spec.model.hide ?? []) root.getObjectByName(name).visible = false;
      const screen = findScreenMeshes(root, spec.model.screenMesh)[0], authored = bounds(screen, inverse);
      const keyTop = bounds(root.getObjectByName(keySurface), inverse).max.y;
      const features = detectFeatures(root, screen, spec, scene), lid = features.lid;
      assert.ok(lid, "the shipped model exposes an articulated lid");
      near(lid.natural, 110, 0.11);
      setLidAngle(lid, lid.natural);
      near(bounds(screen, inverse).min.distanceTo(authored.min), 0);
      near(bounds(screen, inverse).max.distanceTo(authored.max), 0, 2e-5);
      lid.pivot.visible = false;
      const deck = bounds(root, inverse);
      lid.pivot.visible = true;
      let firstClosed;
      for (const angle of [0, 20, 90, 110, 135, 0]) {
        setLidAngle(lid, angle); root.updateWorldMatrix(true, true);
        const screenBox = bounds(screen, inverse), lidBox = bounds(lid.pivot, inverse), normal = new THREE.Vector3();
        readScreenPlane(screen, new THREE.Vector3(), normal); normal.transformDirection(inverse);
        near(normal.y, -Math.cos(angle * Math.PI / 180)); near(normal.z, Math.sin(angle * Math.PI / 180));
        assert.ok(lidBox.min.y > deck.min.y - 0.002, `${angle}° lid remains above the floor`);
        assert.ok(screenBox.min.y > deck.min.y + 0.005, `${angle}° display never dives through the base`);
        lid.pivot.visible = false;
        near(bounds(root, inverse).min.distanceTo(deck.min), 0); near(bounds(root, inverse).max.distanceTo(deck.max), 0);
        lid.pivot.visible = true;
        if (angle === 0) {
          assert.ok(screenBox.min.y > keyTop && screenBox.max.y < keyTop + 0.01, "closed display rests just above the key tops");
          assert.ok(screenBox.max.y - screenBox.min.y < 0.001, "closed display is horizontal");
          near(lidBox.max.z, deck.max.z, 0.001, "front edge aligns with the base");
          if (firstClosed) near(screenBox.min.distanceTo(firstClosed.min) + screenBox.max.distanceTo(firstClosed.max), 0);
          firstClosed = screenBox;
        }
        if (angle === 90) assert.ok(screenBox.max.z - screenBox.min.z < 0.001, "90° display is upright");
      }
      const resources = new Set();
      root.traverse((mesh) => { if (mesh.isMesh) { resources.add(mesh.geometry); for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(material); } });
      resources.forEach((resource) => resource.dispose());
    }
  });
}
