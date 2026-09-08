import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
const { AssetCache } = await import('../src/three/assetCache.ts');
const { prepareModelGpu, setEnvironmentPreparation, waitForGpuPreparation } = await import('../src/three/gpuPreparation.ts');
const { shadowBias, calibrateShadow, createReceiverOnlyShadowMaterial } = await import('../src/three/shadowCalibration.ts');
const { reflectionSamples } = await import('../src/three/reflectionSamples.ts');
const { applyMaterialProfile } = await import('../src/three/materialProfiles.ts');
const { renderQuality } = await import('../src/three/renderQuality.ts');
const { planRenderQuality } = await import('../src/three/qualityPlan.ts');

test('preview planning accounts for the actual DPR3 canvas instead of estimating a DPR2 raster', () => {
  const actual = renderQuality(1000, 500, 3, false, 8192);
  const expected = planRenderQuality({ width: 3000, height: 1500, maxTextureSize: 8192 });
  assert.equal(actual.estimatedBytes, expected.estimatedBytes);
  assert.equal(actual.samples, expected.samples);
});

test('receiver-only floor material cannot write VSM depth or moments while the mesh still receives shadows', () => {
  const material = createReceiverOnlyShadowMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial());
  floor.receiveShadow = true; floor.customDepthMaterial = material; floor.customDistanceMaterial = material;
  assert.equal(floor.receiveShadow, true);
  assert.equal(material.depthWrite, false); assert.equal(material.colorWrite, false);
  assert.match(material.fragmentShader, /discard/);
  let disposed = false; material.addEventListener('dispose', () => { disposed = true; });
  material.dispose(); assert.equal(disposed, true);
  floor.geometry.dispose(); floor.material.dispose();
});

test('model cache protects active, staged and compiling leases while evicting oldest unused assets', () => {
  const disposed = [], cache = new AssetCache(3, (value) => disposed.push(value));
  for (const key of ['visible', 'staged', 'compiling']) cache.put(key, key);
  const release = ['visible', 'staged', 'compiling'].map((key) => cache.retain(key));
  cache.put('old-unused', 'old-unused'); cache.put('recent-unused', 'recent-unused'); cache.trim();
  assert.deepEqual(disposed, ['old-unused', 'recent-unused']);
  cache.put('next', 'next'); const next = cache.retain('next'); cache.trim();
  assert.equal(cache.size, 4, 'pinned assets may temporarily exceed the cache budget');
  release[1](); release[1](); assert.equal(cache.size, 3); assert.equal(disposed.at(-1), 'staged');
  release[0](); release[2](); next();
});

test('GPU preparation waits for lighting, uploads shared textures once, and compiles with the real scene', async () => {
  const calls = [], scene = new THREE.Scene(), root = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  let resolveEnvironment, resolveCompile;
  const gl = { initTexture(t) { calls.push(t); }, compileAsync(...args) { calls.push(args); return new Promise((resolve) => { resolveCompile = resolve; }); } };
  setEnvironmentPreparation(gl, new Promise((resolve) => { resolveEnvironment = resolve; }));
  const task = prepareModelGpu(gl, root, camera, scene, new AbortController().signal);
  await Promise.resolve(); assert.equal(calls.length, 0);
  resolveEnvironment(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [texture, [root, camera, scene]]);
  let ready = false; void task.then(() => { ready = true; });
  assert.equal(ready, false); resolveCompile(); await task; assert.equal(ready, true);
  material.dispose(); texture.dispose(); root.children[0].geometry.dispose();
});

test('cancelled GPU work never reports ready and export waits can abort without disposing its shaders', async () => {
  let finish;
  const gl = { initTexture() {}, compileAsync() { return new Promise((resolve) => { finish = resolve; }); } };
  const controller = new AbortController();
  const task = prepareModelGpu(gl, new THREE.Group(), new THREE.PerspectiveCamera(), new THREE.Scene(), controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  const waitController = new AbortController(), waiting = waitForGpuPreparation(waitController.signal);
  waitController.abort(); await assert.rejects(waiting, { name: 'AbortError' });
  controller.abort(); finish(); await assert.rejects(task, { name: 'AbortError' });
  await waitForGpuPreparation();
});

test('normal profiles preserve authored relief except the identified anodized 17 Pro surface', () => {
  const normal = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ normalMap: normal });
  material.name = 'Keyboard'; material.normalScale.set(.4, -.4); applyMaterialProfile('macbook-pro-14', material);
  assert.deepEqual(material.normalScale.toArray(), [.4, -.4]);
  material.name = 'Anodized_aluminum'; applyMaterialProfile('iphone-17-pro-glb', material);
  assert.deepEqual(material.normalScale.toArray(), [.26, -.26]);
  material.dispose(); normal.dispose();
});

test('reflection MSAA uses exact common half-float/depth counts and never silently rounds 2 up to 4', () => {
  function renderer(color, depth) { return { getContext() { return { RENDERBUFFER: 1, RGBA16F: 2, DEPTH_COMPONENT24: 3, SAMPLES: 4, getInternalformatParameter(_target, format) { return new Int32Array(format === 2 ? color : depth); } }; } }; }
  const onlyFour = renderer([4], [4, 2]);
  assert.equal(reflectionSamples(onlyFour, 2), 0); assert.equal(reflectionSamples(onlyFour, 4), 4);
  assert.equal(reflectionSamples(renderer([4, 2], [2]), 2), 2);
  assert.equal(reflectionSamples(renderer([], [4, 2]), 4), 0);
});

test('shadow bias scales with actual texel coverage and fitted light camera contains the caster', () => {
  assert.equal(shadowBias(3, 10, 4096).normalBias, shadowBias(3, 10, 2048).normalBias / 2);
  const device = new THREE.Group(); device.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, .15), new THREE.MeshStandardMaterial()));
  device.rotation.set(.2, .6, .1); device.updateWorldMatrix(true, true);
  const light = new THREE.DirectionalLight(); light.position.set(-3, 5, 3); light.shadow.radius = 20;
  calibrateShadow(light, device, -1.2, 2, 2048);
  const camera = light.shadow.camera, point = new THREE.Vector3();
  const corners = new THREE.Box3().setFromObject(device);
  for (let i = 0; i < 8; i++) {
    point.set(i & 1 ? corners.max.x : corners.min.x, i & 2 ? corners.max.y : corners.min.y, i & 4 ? corners.max.z : corners.min.z).project(camera);
    assert.ok(Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1);
  }
  assert.ok(light.shadow.normalBias < .005);
  const radius = light.shadow.radius; calibrateShadow(light, device, -1.2, 2, 2048); assert.equal(light.shadow.radius, radius);
  device.children[0].geometry.dispose(); device.children[0].material.dispose();
});

test('spotlight VSM reserves depth precision near its actual caster without clipping or detaching shadows', () => {
  for (const scale of [.5, 1, 4]) {
    const device = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, .12, 1.4), new THREE.MeshStandardMaterial());
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, .03), new THREE.MeshStandardMaterial()); lid.position.set(0, .65, -.65);
    device.add(mesh, lid); device.scale.setScalar(scale); device.rotation.y = .3; device.updateWorldMatrix(true, true);
    const light = new THREE.SpotLight(); light.position.set(-4 * scale, 7 * scale, -4 * scale); light.distance = 44 * scale; light.angle = .6; light.shadow.radius = 52;
    calibrateShadow(light, device, -.12 * scale, 2 * scale, 2048);
    const camera = light.shadow.camera, previous = camera.projectionMatrix.clone(), radius = light.shadow.radius;
    assert.ok(camera.near > scale, 'empty space near the light must not consume VSM precision');
    assert.equal(camera.far, light.distance, 'shadow calibration must preserve light falloff');
    assert.ok(light.shadow.normalBias < .01 * scale, 'precision fix must not detach receiver shadows');
    const corners = new THREE.Box3().setFromObject(device), point = new THREE.Vector3();
    for(let i=0;i<8;i++) {
      point.set(i & 1 ? corners.max.x : corners.min.x, i & 2 ? corners.max.y : corners.min.y, i & 4 ? corners.max.z : corners.min.z).project(camera);
      assert.ok(point.z > -1 && point.z < 1, 'fitted near/far clips the deck or articulated lid');
    }
    light.shadow.updateMatrices(light);
    assert.deepEqual(camera.projectionMatrix, previous, 'Three must not replace calibration on the first shadow draw');
    calibrateShadow(light, device, -.12 * scale, 2 * scale, 2048); assert.equal(light.shadow.radius, radius);
    mesh.geometry.dispose(); mesh.material.dispose(); lid.geometry.dispose(); lid.material.dispose();
  }
});

test('all 129 shipped model textures carry complete validated KTX2 mip chains and unchanged image dimensions', () => {
  let images = 0;
  for (const file of readdirSync('public/models').filter((name) => name.endsWith('.glb'))) {
    const bytes = readFileSync(`public/models/${file}`), size = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + size)), binary = bytes.subarray(28 + size);
    const report = JSON.parse(readFileSync(`docs/research/assets/${file}.report.json`));
    const structure = createHash('sha256').update(JSON.stringify(Object.fromEntries(['nodes', 'meshes', 'materials', 'accessors', 'animations', 'scenes', 'scene', 'asset'].map((key) => [key, gltf[key]])))).digest('hex');
    assert.equal(structure, report.sourceInvariants.structure, `${file}: source scene/material/UV structure changed`);
    const imageViews = new Set(gltf.images.map((image) => image.bufferView)), geometry = createHash('sha256');
    for (const [i, view] of gltf.bufferViews.entries()) {
      if (view.buffer === 0 && !imageViews.has(i)) geometry.update(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
      const compressed = view.extensions?.EXT_meshopt_compression;
      if (compressed?.buffer === 0) geometry.update(binary.subarray(compressed.byteOffset ?? 0, (compressed.byteOffset ?? 0) + compressed.byteLength));
    }
    assert.equal(geometry.digest('hex'), report.sourceInvariants.geometry, `${file}: compressed geometry changed`);
    assert.ok(gltf.extensionsRequired.includes('KHR_texture_basisu'));
    assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
    assert.equal(gltf.images.length, report.textures.length);
    for (const [i, image] of gltf.images.entries()) {
      assert.equal(image.mimeType, 'image/ktx2');
      const view = gltf.bufferViews[image.bufferView], data = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
      assert.equal(data.subarray(0, 12).toString('hex'), 'ab4b5458203230bb0d0a1a0a');
      const width = data.readUInt32LE(20), height = data.readUInt32LE(24), levels = data.readUInt32LE(40);
      assert.equal(width, report.textures[i].width); assert.equal(height, report.textures[i].height);
      assert.equal(levels, 1 + Math.floor(Math.log2(Math.max(width, height))));
      assert.equal(createHash('sha256').update(data).digest('hex'), report.textures[i].sha256);
      for (let level = 0; level < levels; level++) {
        const offset = Number(data.readBigUInt64LE(80 + level * 24)), length = Number(data.readBigUInt64LE(88 + level * 24));
        assert.ok(length > 0 && offset + length <= data.length, `${file} image ${i} mip ${level}`);
      }
      images++;
    }
  }
  assert.equal(images, 129);
});

test('original 2K HDRs have verified provenance, dimensions and unchanged 1K fallbacks', () => {
  const manifest = JSON.parse(readFileSync('public/hdri/2k/manifest.json'));
  assert.equal(manifest.length, 6);
  for (const item of manifest) {
    const hdr = readFileSync(`public/hdri/2k/${item.name}.hdr`), fallback = readFileSync(`public/hdri/${item.name}.hdr`);
    assert.ok(hdr.subarray(0, 1000).toString().includes('-Y 1024 +X 2048'));
    assert.ok(fallback.subarray(0, 1000).toString().includes('-Y 512 +X 1024'));
    assert.equal(createHash('sha256').update(hdr).digest('hex'), item.sha256);
    assert.equal(item.license, 'CC0-1.0'); assert.ok(item.url.startsWith('https://dl.polyhaven.org/'));
  }
});
