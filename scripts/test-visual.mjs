import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import * as THREE from 'three';
const { buildDeckHeightField } = await import('../src/three/screenOcclusion.ts');
const { configureConcreteMaps, concretePaths, CONCRETE_TILE_WORLD } = await import('../src/three/concreteAssets.ts');
const { modelTransportURL, chooseModelEncoding, modelTransportManifest } = await import('../src/lib/modelTransport.ts');
const { rendererKtxLoader } = await import('../src/three/ktxLoader.ts');
const { applyMaterialProfile } = await import('../src/three/materialProfiles.ts');
const { modelTransportResponse } = await import('../src/lib/modelTransportServer.ts');

function sample(field, x, z) {
  const image = field.texture.image, u = (x - field.bounds.x) * field.bounds.z, v = (z - field.bounds.y) * field.bounds.w;
  const column = Math.max(0, Math.min(image.width - 1, Math.floor(u * image.width))), row = Math.max(0, Math.min(image.height - 1, Math.floor(v * image.height)));
  return field.height.x + image.data[row * image.width + column] / 255 * field.height.y;
}

test('actual key geometry blocks the light path while the gaps, underside and exterior stay open', () => {
  const frame = new THREE.Group(), deck = new THREE.Mesh(new THREE.BoxGeometry(3, .08, 2));
  deck.position.y = -.04; frame.add(deck);
  const key = new THREE.Mesh(new THREE.BoxGeometry(.4, .15, .5)); key.position.set(0, .075, 0); frame.add(key);
  frame.rotation.set(.4, -.7, .2); frame.scale.set(1.3, .8, 1.1); frame.updateWorldMatrix(true, true);
  const field = buildDeckHeightField([deck, key], frame, -.03, .2); assert.ok(field);
  assert.ok(field.texture.image.data.byteLength <= 65536);
  assert.ok(Math.abs(sample(field, 0, 0) - .15) < .002, 'keycap top comes from actual triangles');
  assert.ok(Math.abs(sample(field, .6, 0)) < .002, 'gap exposes the deck, not a bounding-box slab');
  // The same six ray positions as the shader: a shallow source is blocked by the raised key.
  function visible(start, end) {
    for (let i = 0; i < 6; i++) {
      const t = ((i + .65) / 6) ** 2, point = start.clone().lerp(end, t);
      if (point.y < sample(field, point.x, point.z) - 2 * field.bias) return false;
    }
    return true;
  }
  assert.equal(visible(new THREE.Vector3(-.4, 0, 0), new THREE.Vector3(.6, .12, 0)), false);
  assert.equal(visible(new THREE.Vector3(-.4, 0, .7), new THREE.Vector3(.6, .12, .7)), true);
  assert.equal(visible(new THREE.Vector3(0, .15, 0), new THREE.Vector3(0, .7, -.8)), true, 'key cannot shadow its own upper face');
  field.texture.dispose(); for (const mesh of [deck, key]) { mesh.geometry.dispose(); mesh.material.dispose(); }
});

test('mirrored instances contribute physical upper surfaces without modifying geometry', () => {
  const frame = new THREE.Group(), geo = new THREE.BoxGeometry(.4, .1, .4), mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-.3, .05, 0));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeScale(-1, 1, 1).setPosition(.3, .05, 0)); frame.add(mesh); frame.updateMatrixWorld(true);
  const before = geo.getAttribute('position').array.slice(), field = buildDeckHeightField([mesh], frame, 0, .2);
  assert.ok(field); assert.ok(sample(field, -.3, 0) > .098); assert.ok(sample(field, .3, 0) > .098);
  assert.deepEqual(geo.getAttribute('position').array, before);
  field.texture.dispose(); mesh.dispose(); geo.dispose(); mesh.material.dispose();
});

test('concrete tiers use original-map full mip chains, correct color slots and shared linear ARM', () => {
  const report = JSON.parse(readFileSync('docs/research/assets/concrete-layers-02.json'));
  assert.equal(report.license, 'CC0-1.0'); assert.equal(report.maps.length, 6);
  for (const map of report.maps) {
    const bytes = readFileSync(map.output);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), map.sha256);
    assert.ok(bytes.includes(Buffer.from('KTXorientation\0ru')), 'floor maps preserve GL lower-left origin, including normal handedness');
    assert.equal(bytes.readUInt32LE(20), map.width); assert.equal(bytes.readUInt32LE(40), Math.log2(map.width) + 1);
    assert.match(map.sourceUrl, /^https:\/\/dl.polyhaven.org\//);
    for (let i = 0; i < map.levels; i++) assert.ok(Number(bytes.readBigUInt64LE(80 + i * 24)) + Number(bytes.readBigUInt64LE(88 + i * 24)) <= bytes.length);
  }
  const arm = new THREE.Texture(), maps = { diff: new THREE.Texture(), normal: new THREE.Texture(), rough: arm, ao: arm, tier: '2k' };
  configureConcreteMaps(maps, 100, 4);
  assert.equal(maps.diff.colorSpace, THREE.SRGBColorSpace); assert.equal(arm.colorSpace, THREE.NoColorSpace);
  assert.equal(arm.anisotropy, 4); assert.equal(arm.repeat.x, 100 / CONCRETE_TILE_WORLD);
  assert.ok(concretePaths('1k').every(p => p.includes('/1k/') && p.endsWith('.ktx2')));
  for (const texture of new Set(Object.values(maps).filter(x => x?.isTexture))) texture.dispose();
});

test('generated transport variants decode byte-for-byte to every original shipped GLB', () => {
  for (const [name, entry] of Object.entries(modelTransportManifest)) {
    const original = readFileSync(`public/models/${name}`);
    assert.equal(createHash('sha256').update(original).digest('hex'), entry.hash);
    for (const [encoding, decode] of [['br', brotliDecompressSync], ['gzip', gunzipSync]]) {
      const compressed = readFileSync(`public/model-transport/${entry[encoding].file}`);
      assert.equal(compressed.length, entry[encoding].bytes); assert.deepEqual(decode(compressed), original);
    }
    assert.equal(modelTransportURL(`/models/${name}`), `/api/models/${name}?v=${entry.hash}`);
  }
  assert.equal(modelTransportURL('/unlisted.glb'), '/unlisted.glb');
});

test('transport negotiation respects exclusions, weighted clients, identity and conditional requests', async () => {
  for (const [accept, expected] of [[null, 'identity'], ['gzip, br', 'br'], ['br;q=0,gzip;q=.8', 'gzip'], ['br;q=.2,gzip;q=.9', 'gzip'], ['*;q=0', null], ['*;q=0,identity;q=1', 'identity'], ['br;q=bad,gzip;q=0', 'identity']]) assert.equal(chooseModelEncoding(accept), expected);
  const name = 'macbook-pro-14.glb', entry = modelTransportManifest[name], url = `http://localhost/api/models/${name}?v=${entry.hash}`;
  const response = await modelTransportResponse(new Request(url, { headers: { 'Accept-Encoding': 'br' } }), name);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), 'br'); assert.equal(response.headers.get('vary'), 'Accept-Encoding'); assert.match(response.headers.get('cache-control'), /immutable/);
  const body = Buffer.from(await response.arrayBuffer()); assert.equal(body.length, entry.br.bytes); assert.deepEqual(brotliDecompressSync(body), readFileSync(`public/models/${name}`));
  const head = await modelTransportResponse(new Request(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } }), name);
  assert.equal(head.headers.get('content-encoding'), 'gzip'); assert.equal(head.headers.get('content-length'), String(entry.gzip.bytes)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const missing = await modelTransportResponse(new Request(url), name, '/nonexistent-mok-transport-test');
  assert.equal(missing.status, 307); assert.equal(missing.headers.get('location'), `/models/${name}`);
  assert.equal(missing.headers.get('content-encoding'), null);
  const cached = await modelTransportResponse(new Request(url, { headers: { 'Accept-Encoding': 'br', 'If-None-Match': response.headers.get('etag') } }), name);
  assert.equal(cached.status, 304); assert.equal((await cached.arrayBuffer()).byteLength, 0);
  assert.equal((await modelTransportResponse(new Request(url), '../macbook-pro-14.glb')).status, 404);
  assert.equal((await modelTransportResponse(new Request(url + 'wrong'), name)).status, 404);
});


test('invisible helper planes cannot block screen light, while opaque geometry ignores opacity', () => {
  const frame = new THREE.Group(), helper = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({transparent:true,opacity:0}));
  helper.position.y=.1;frame.add(helper);frame.updateMatrixWorld(true);
  assert.equal(buildDeckHeightField([helper],frame,0,.2),null);
  helper.material.transparent=false;
  const field=buildDeckHeightField([helper],frame,0,.2);assert.ok(field);
  field.texture.dispose();helper.geometry.dispose();helper.material.dispose();
});

test('concrete and models share one renderer-local transcoder and release it on context loss', () => {
  const domElement=new EventTarget(), gl={domElement,extensions:{has:()=>false}};
  const first=rendererKtxLoader(gl),second=rendererKtxLoader(gl);assert.equal(first,second);
  let disposed=0;first.dispose=()=>{disposed++};domElement.dispatchEvent(new Event('webglcontextlost'));assert.equal(disposed,1);
  const replacement=rendererKtxLoader(gl);assert.notEqual(replacement,first);replacement.dispose=()=>{disposed++};domElement.dispatchEvent(new Event('webglcontextlost'));assert.equal(disposed,2);
});

test('MacBook enclosure calibration is exact-source-only and preserves authored channels and key relief', () => {
  const normal=new THREE.Texture(), rough=new THREE.Texture();
  const material=new THREE.MeshStandardMaterial({normalMap:normal,roughnessMap:rough,roughness:.45,metalness:1});material.name='hPcehRUjcLAosED';material.normalScale.set(1,-1);
  applyMaterialProfile('macbook-pro-14-glb',material);assert.deepEqual(material.normalScale.toArray(),[.55,-.55]);assert.equal(material.normalMap,normal);assert.equal(material.roughnessMap,rough);assert.equal(material.roughness,.45);assert.equal(material.metalness,1);
  material.name='IlNnjEDxsExlBOr';material.normalScale.set(1,1);applyMaterialProfile('macbook-pro-14-glb',material);assert.deepEqual(material.normalScale.toArray(),[1,1]);
  material.name='hPcehRUjcLAosED';applyMaterialProfile('macbook-pro-16-glb',material);assert.deepEqual(material.normalScale.toArray(),[1,1]);
  normal.dispose();rough.dispose();material.dispose();
});
