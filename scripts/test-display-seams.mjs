import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadModelGeometry } from './model-geometry.mjs';
const { addDisplaySeamBacking } = await import('../src/three/displaySeams.ts');
const { meshFrame } = await import('../src/three/devices/GlbModel.tsx');
const { disposeModelResources } = await import('../src/three/resources.ts');

test('Mac16 source crack is sealed internally without moving glass, bezel or silhouette', async () => {
  const source = await loadModelGeometry('public/models/macbook-pro-16.glb'), root = source.clone(true);
  root.updateMatrixWorld(true);
  const screen = root.getObjectByName('Object_123'), bezel = root.getObjectByName('Object_129'), rim = root.getObjectByName('Object_131');
  const snapshots = [screen, bezel, rim].map(mesh => ({ mesh, geometry: mesh.geometry, position: mesh.geometry.attributes.position.array.slice(), uv: mesh.geometry.attributes.uv?.array.slice(), material: mesh.material, matrix: mesh.matrixWorld.clone() }));
  const f = meshFrame(screen), n = f.axes[2].clone(); if (n.z < 0) n.negate();
  const u = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), v = new THREE.Vector3().crossVectors(n, u);
  const frame = new THREE.Matrix4().makeBasis(u, v, n).setPosition(f.center), inverse = frame.clone().invert();
  const projected = mesh => {
    mesh.updateWorldMatrix(true, true); const p = mesh.geometry.attributes.position, box = new THREE.Box3();
    for (let i = 0; i < p.count; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
    return box;
  };
  assert.equal(addDisplaySeamBacking(root, 'macbook-pro-14-glb', screen, frame), null);
  const backing = addDisplaySeamBacking(root, 'macbook-pro-16-glb', screen, frame);
  assert.ok(backing); assert.equal(backing.parent, bezel);
  assert.equal(addDisplaySeamBacking(root, 'macbook-pro-16-glb', screen, frame), backing, 'repeat preparation must not add duplicate surfaces');
  assert.equal(backing.castShadow, false); assert.equal(backing.receiveShadow, false);
  assert.equal(backing.material.transparent, false); assert.equal(backing.material.color.getHex(), 0);
  const black = projected(backing), border = projected(bezel), outline = projected(rim);
  assert.ok(black.min.y < border.min.y - .1, 'fixture must expose and cover the actual lower source crack');
  assert.ok(black.max.z < border.min.z, 'backing must sit behind the authored glass/bezel');
  assert.ok(outline.containsBox(black), 'backing must remain inside the existing rim silhouette and thickness');
  for (const old of snapshots) {
    assert.equal(old.mesh.geometry, old.geometry); assert.equal(old.mesh.material, old.material);
    assert.deepEqual(old.mesh.geometry.attributes.position.array, old.position); assert.deepEqual(old.mesh.geometry.attributes.uv?.array, old.uv);
    assert.ok(old.mesh.matrixWorld.equals(old.matrix));
  }
  const local = backing.matrix.clone();
  for (const angle of [70, 110, 160]) {
    bezel.rotation.x += angle * Math.PI / 180; root.rotation.set(.2, -.8, .4); root.updateMatrixWorld(true);
    assert.ok(backing.matrixWorld.equals(bezel.matrixWorld.clone().multiply(local)), 'backing must follow any authored lid and user transform');
  }
  const disposed = []; backing.material.addEventListener('dispose', () => disposed.push('material')); backing.geometry.addEventListener('dispose', () => disposed.push('geometry'));
  let sourceDisposed = false; bezel.geometry.addEventListener('dispose', () => { sourceDisposed = true; });
  disposeModelResources(root); assert.deepEqual(disposed.sort(), ['geometry', 'material']); assert.equal(sourceDisposed, false);
});
