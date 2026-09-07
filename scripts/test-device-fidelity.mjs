import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadModelGeometry } from './model-geometry.mjs';
const { meshFrame, stabilizeScreenNormals, planarizeScreenUVs, hideScreenOverlays, hideInvisibleModelMeshes, findScreenMeshes } = await import('../src/three/devices/GlbModel.tsx');
const { DEVICES } = await import('../src/lib/devices.ts');
const { disposeModelResources } = await import('../src/three/resources.ts');

function normalRange(mesh) {
  const normals = mesh.geometry.getAttribute('normal'), first = new THREE.Vector3().fromBufferAttribute(normals, 0);
  let range = 0;
  for (let i = 1; i < normals.count; i++) range = Math.max(range, first.distanceTo(new THREE.Vector3().fromBufferAttribute(normals, i)));
  return range;
}
function dispose(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(m => { if (!m.isMesh) return; geometries.add(m.geometry); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat); });
  for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
}
async function sourceDevice(id) {
  const spec = DEVICES.find(s => s.id === id), path = `public${spec.model.url}`;
  const root = new THREE.Group(); root.name = 'device';
  const model = await loadModelGeometry(path); model.rotation.set(...(spec.model.rotation ?? [0, 0, 0])); root.add(model); root.updateMatrixWorld(true);
  const source = readFileSync(path), json = JSON.parse(source.subarray(20, 20 + source.readUInt32LE(12)));
  model.traverse(m => {
    if (!m.isMesh) return;
    const raw = json.materials.find(mat => mat.name === m.material.name);
    m.material.transparent = raw?.alphaMode === 'BLEND';
    m.material.opacity = raw?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
    m.material.transmission = raw?.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0;
  });
  return { root, model, spec, screen: findScreenMeshes(model, spec.model.screenMesh)[0] };
}

test('shipped iPad planar screen loses quantized normal facets without mutating source geometry or shapes', async () => {
  const { root, model, spec, screen } = await sourceDevice('ipad-pro-13-glb');
  const source = screen.geometry, positions = source.getAttribute('position').array.slice(), normals = source.getAttribute('normal').array.slice(), index = source.index.array.slice();
  assert.ok(normalRange(screen) > .001, 'the shipped source actually contains varying planar normals');
  planarizeScreenUVs(screen, model, spec.screenPx[0] / spec.screenPx[1], spec.model.screenInset);
  assert.notEqual(screen.geometry, source); assert.ok(normalRange(screen) < 1e-8);
  assert.deepEqual(screen.geometry.getAttribute('position').array, positions); assert.deepEqual(screen.geometry.index.array, index);
  assert.deepEqual(source.getAttribute('normal').array, normals); assert.deepEqual(source.getAttribute('position').array, positions);
  assert.equal(screen.geometry.getAttribute('uv').count, screen.geometry.getAttribute('position').count);
  disposeModelResources(model); screen.geometry = source; dispose(root);
});

test('planar repair uses the normal transform under rotated, reflected and nonuniform parent transforms', () => {
  const geo = new THREE.PlaneGeometry(2, 1, 2, 2), mesh = new THREE.Mesh(geo);
  const normal = geo.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, (i % 2 ? 1 : -1) * .004, .002, .99999);
  mesh.rotation.set(.4, -.8, .2); mesh.scale.set(-1.3, .7, 2.1); mesh.updateMatrixWorld(true);
  const authored = geo.getAttribute('position').array.slice(), frame = meshFrame(mesh);
  assert.equal(stabilizeScreenNormals(geo, mesh.matrixWorld, frame), true);
  assert.ok(normalRange(mesh) < 1e-8);
  const worldNormal = new THREE.Vector3().fromBufferAttribute(geo.getAttribute('normal'), 0).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
  assert.ok(Math.abs(worldNormal.dot(frame.axes[2])) > .9999999); assert.deepEqual(geo.getAttribute('position').array, authored);
  dispose(mesh);
});

test('curvature, bevel normals and opposite-facing vertices are retained', () => {
  for (const kind of ['curved', 'bevel', 'backface']) {
    const geometry = new THREE.PlaneGeometry(2, 1, 2, 2), mesh = new THREE.Mesh(geometry);
    if (kind === 'curved') geometry.getAttribute('position').setZ(4, .1);
    else geometry.getAttribute('normal').setXYZ(4, kind === 'bevel' ? .1 : 0, 0, kind === 'bevel' ? .995 : -1);
    mesh.updateMatrixWorld(true); const before = geometry.getAttribute('normal');
    assert.equal(stabilizeScreenNormals(geometry, mesh.matrixWorld, meshFrame(mesh)), false, kind);
    assert.equal(geometry.getAttribute('normal'), before); dispose(mesh);
  }
});

test('separated screen cover is found in a tilted device frame without hiding back glass, cameras or thick distant shells', () => {
  const device = new THREE.Group(); device.name = 'device'; device.rotation.set(.6, -.8, .4);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshStandardMaterial());
  const group = new THREE.Group(); group.rotation.x = .7; group.add(screen); device.add(group);
  const glass = () => new THREE.MeshPhysicalMaterial({ transparent: true, opacity: .25, transmission: 1 });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(2.02, 1.02), glass()); front.position.z = .005;
  const back = front.clone(); back.position.z = -.005;
  const camera = new THREE.Mesh(new THREE.CircleGeometry(.1), glass()); camera.position.set(.7, .2, .006);
  const distant = front.clone(); distant.position.z = .06;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(2, 1, .1), glass()); shell.position.z = .065;
  const opaque = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshStandardMaterial()); opaque.position.z = .004;
  group.add(front, back, camera, distant, shell, opaque); device.updateMatrixWorld(true);
  front.name = 'front'; back.name = 'back'; camera.name = 'camera'; distant.name = 'distant'; shell.name = 'shell';
  assert.deepEqual(hideScreenOverlays(device, screen).map(m => m.name), ['front']);
  assert.equal(front.visible, false);
  for (const retained of [back, camera, distant, shell, opaque]) assert.equal(retained.visible, true);
  assert.equal(front.material.opacity, .25); assert.equal(front.material.transmission, 1);
  dispose(device);
});

test('actual iPhone 17 Pro cover is hidden while camera sapphire and authored material metadata remain intact', async () => {
  const { root, model, screen } = await sourceDevice('iphone-17-pro-glb');
  const cover = model.getObjectByName('Object_21'), sapphire = model.getObjectByName('Object_13');
  const material = cover.material, opacity = material.opacity;
  assert.deepEqual(hideScreenOverlays(model, screen).map(m => m.name), ['Object_21']);
  assert.equal(sapphire.visible, true); assert.equal(cover.material, material); assert.equal(material.opacity, opacity); assert.equal(material.transmission, 1);
  dispose(root);
});

test('curved source Watch display layers keep their normals and are not new overlay candidates', async () => {
  for (const [id, rear] of [['apple-watch-ultra-glb', 'NONHYSHLUQzoyez'], ['apple-watch-9-glb', 'hNUadlaBSDpAdCh']]) {
    const { root, model, screen } = await sourceDevice(id);
    const glass = model.getObjectByName(rear); assert.ok(glass);
    const normals = screen.geometry.getAttribute('normal');
    assert.equal(stabilizeScreenNormals(screen.geometry, screen.matrixWorld, meshFrame(screen)), false, 'curved Watch display must retain authored normals');
    assert.equal(screen.geometry.getAttribute('normal'), normals);
    assert.equal(hideScreenOverlays(model, screen).some(m => m === glass), false);
    assert.equal(glass.visible, true); dispose(root);
  }
});


test('zero-opacity authoring helpers are hidden without mutating cached data or suppressing transmissive and mixed surfaces', () => {
  const source = new THREE.Group();
  const zero = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const helper = new THREE.Mesh(geometry, zero); helper.name = 'helper'; helper.position.x = 100;
  const opaqueZero = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ opacity: 0 }));
  const transmitting = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0, transmission: 1 }));
  const mixed = new THREE.Mesh(geometry, [zero, new THREE.MeshStandardMaterial()]);
  const liveScreen = new THREE.Mesh(geometry, zero); liveScreen.name = 'screen';
  const parent = new THREE.Mesh(geometry, zero); parent.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  source.add(helper, opaqueZero, transmitting, mixed, liveScreen, parent);
  const instance = source.clone(true), protectedScreen = instance.getObjectByName('screen');
  const hidden = hideInvisibleModelMeshes(instance, [protectedScreen]);
  assert.deepEqual(hidden.map(m => m.name), ['helper']);
  assert.equal(helper.visible, true, 'source cache object is untouched');
  assert.equal(hidden[0].material, zero); assert.equal(zero.transparent, true); assert.equal(zero.opacity, 0);
  for (const child of instance.children.filter(m => m.name !== 'helper')) assert.equal(child.visible, true);
  const materialAfterFinish = zero.clone(); hidden[0].material = materialAfterFinish;
  assert.equal(hidden[0].visible, false, 'a finish-only material replacement cannot resurrect the helper');
  materialAfterFinish.dispose(); dispose(source);
});

test('Mac16 invisible helper sheets are excluded before feature detection and cannot be toggled back on', async () => {
  const { detectFeatures, applyKeyboardCase } = await import('../src/three/devices/GlbModel.tsx');
  const { visibleBounds } = await import('../src/three/bounds.ts');
  const { root, model, spec } = await sourceDevice('macbook-pro-16-glb');
  const screens = findScreenMeshes(model, spec.model.screenMesh), hidden = hideInvisibleModelMeshes(model, screens);
  assert.ok(hidden.some(m => m.name === 'Object_117')); assert.ok(hidden.some(m => m.name === 'Object_119'));
  const features = detectFeatures(model, screens[0], spec, new THREE.Scene());
  for (const m of hidden) {
    assert.equal(features.island.includes(m), false); assert.equal(features.caseParts.includes(m), false); assert.equal(features.band.includes(m), false);
  }
  applyKeyboardCase(model, features.caseParts, features.tilt, true);
  for (const m of hidden) assert.equal(m.visible, false);
  assert.equal(visibleBounds(model, new THREE.Matrix4()).isEmpty(), false);
  dispose(root);
});

test('Watch9 media is assigned only to the actual display, preserving rear sensors and their original UVs', async () => {
  const { root, model, spec } = await sourceDevice('apple-watch-9-glb');
  const screens = findScreenMeshes(model, spec.model.screenMesh);
  assert.deepEqual(screens.map(m => m.name), ['rpqLEPlKpASApqb']);
  const rear = ['uBMkHzJfTETpPSo', 'hUTWIfJTbVAiNOd', 'hNUadlaBSDpAdCh'].map(name => {
    const mesh = model.getObjectByName(name); assert.ok(mesh);
    return { mesh, material: mesh.material, uv: mesh.geometry.getAttribute('uv').array.slice() };
  });
  for (const screen of screens) planarizeScreenUVs(screen, model, spec.screenPx[0] / spec.screenPx[1]);
  hideScreenOverlays(model, screens[0]);
  for (const { mesh, material, uv } of rear) {
    assert.equal(mesh.visible, true, mesh.name); assert.equal(mesh.material, material);
    assert.deepEqual(mesh.geometry.getAttribute('uv').array, uv, 'rear authored atlas must not become a planar screenshot projection');
  }
  disposeModelResources(model); dispose(root);
});
