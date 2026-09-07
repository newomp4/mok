import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const { planRenderQuality, availableSampleCounts } = await import('../src/three/qualityPlan.ts');
const { LinearCapturePass } = await import('../src/three/effects/LinearCapturePass.ts');
const { DetailShadowPass, receivesDetailShadows, createDetailMaskMaterial } = await import('../src/three/effects/DetailShadowPass.ts');
const { pollGpuQueries } = await import('../src/three/gpuTiming.ts');
const options = { width: 1920, height: 1080, maxTextureSize: 8192, maxSamples: 4 };

test('memory planning reduces buffers before refusing export and never changes requested dimensions', () => {
  const full = planRenderQuality(options), large = planRenderQuality({ ...options, width: 3840, height: 2160 });
  assert.equal(full.supported, true); assert.equal(full.samples, 4);
  assert.equal(large.supported, true); assert.ok(large.samples < full.samples);
  assert.ok(large.estimatedBytes <= large.budgetBytes); assert.match(large.note, /dimensions stay unchanged/);
  const impossible = planRenderQuality({ ...options, width: 7680, height: 7680, motionSamples: 8, depth: true });
  assert.equal(impossible.supported, false); assert.match(impossible.reason, /memory budget/);
});

test('invalid dimensions are rejected before allocation including NaN and a GPU smaller than the UI maximum', () => {
  for (const width of [0, -1, 1920.5, NaN, Infinity, 8193]) assert.equal(planRenderQuality({ ...options, width }).supported, false);
  assert.equal(planRenderQuality({ ...options, maxTextureSize: 1024 }).supported, false);
});

test('hardware AA counts match both actual attachments, with safe zero-sample fallback', () => {
  const gl = { RENDERBUFFER: 1, RGBA16F: 2, DEPTH_COMPONENT24: 3, SAMPLES: 4,
    getInternalformatParameter(_target, format) { return new Int32Array(format === 2 ? [4] : [4, 2]); } };
  const supportedSamples = availableSampleCounts(gl);
  assert.deepEqual(supportedSamples, [0, 4]);
  const large = planRenderQuality({ ...options, supportedSamples, width: 3840, height: 2160 });
  assert.equal(large.samples, 0); // 2 would silently allocate 4 on this device.
  assert.deepEqual(availableSampleCounts({ getInternalformatParameter() { throw new Error('lost'); } }), [0]);
  assert.equal(planRenderQuality({ ...options, depth: true }).samples, 0);
});

test('motion integration, optional detail shading and high resolution screen raster have memory reservations', () => {
  const ample = { ...options, budgetBytes: 2 * 1024 ** 3 };
  const base = planRenderQuality(ample), motion = planRenderQuality({ ...ample, motionSamples: 32 });
  assert.ok(motion.estimatedBytes > base.estimatedBytes);
  assert.equal(motion.estimatedBytes, planRenderQuality({ ...ample, motionSamples: 2 }).estimatedBytes, 'one sum buffer regardless of temporal sample count');
  assert.ok(planRenderQuality({ ...ample, detailShadows: true }).estimatedBytes > base.estimatedBytes);
  const high = planRenderQuality({ ...ample, width: 6000, height: 2000 });
  assert.equal(high.supported, true); assert.equal(high.screenMaxEdge, 8192); assert.equal(high.screenMaxPixels, 24_000_000);
});

function renderer() {
  let target = new THREE.WebGLRenderTarget(8, 8), alpha = .7;
  const color = new THREE.Color('#456789');
  return {
    autoClear: false, autoClearColor: false, autoClearDepth: false, autoClearStencil: false,
    xr: { enabled: true }, shadowMap: { autoUpdate: true, needsUpdate: true },
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget(t) { target = t; }, getClearColor(out) { return out.copy(color); }, getClearAlpha: () => alpha,
    setClearColor(c, a = 1) { color.set(c); alpha = a; }, render() {}, clear() {},
  };
}

test('interrupted motion frames reject incomplete output, restore renderer state and release their buffer', () => {
  const pass = new LinearCapturePass(), gl = renderer(), target = gl.getRenderTarget(), color = gl.getClearColor(new THREE.Color());
  const input = new THREE.WebGLRenderTarget(4, 4), output = input.clone();
  try {
    assert.throws(() => pass.beginFrame(0), /samples/); pass.beginFrame(2);
    assert.throws(() => pass.beginFrame(2), /unfinished/);
    gl.render = () => { throw new Error('lost frame'); }; pass.beginSample();
    assert.throws(() => pass.render(gl, input, output), /lost frame/);
    assert.equal(gl.getRenderTarget(), target); assert.deepEqual(gl.getClearColor(new THREE.Color()), color);
    assert.equal(gl.getClearAlpha(), .7); assert.equal(gl.xr.enabled, true); assert.equal(gl.shadowMap.needsUpdate, true);
    assert.throws(() => pass.endFrame(), /every requested/);
    let released = false; pass.sum.addEventListener('dispose', () => { released = true; }); pass.cancel(); assert.equal(released, true);
    gl.render = () => {}; pass.beginFrame(1); pass.beginSample(); pass.render(gl, input, output); pass.endFrame();
    assert.equal(pass.enabled, false);
  } finally { pass.dispose(); input.dispose(); output.dispose(); target.dispose(); }
});

test('detail shadow mask excludes screens, transparent glass, mirrors and unlit cards', () => {
  const lit = new THREE.MeshStandardMaterial(), screen = lit.clone(), glass = lit.clone(), mirror = lit.clone(), card = new THREE.MeshBasicMaterial();
  screen.emissiveMap = new THREE.Texture(); glass.transparent = true; mirror.reflection = .5;
  assert.equal(receivesDetailShadows(lit), true);
  for (const mat of [screen, glass, mirror, card]) assert.equal(receivesDetailShadows(mat), false);
  screen.emissiveMap.dispose(); for (const mat of [lit, screen, glass, mirror, card]) mat.dispose();
});

test('a failed detail mask restores exact material arrays, scene overrides and pending shadows', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), gl = renderer(), target = gl.getRenderTarget();
  const originals = [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), originals); scene.add(mesh);
  const background = new THREE.Color('red'), override = new THREE.MeshBasicMaterial(); scene.background = background; scene.overrideMaterial = override;
  const pass = new DetailShadowPass(scene, camera), input = new THREE.WebGLRenderTarget(4, 4), output = input.clone(); pass.strength = 1;
  gl.render = () => { assert.notEqual(mesh.material, originals); throw new Error('mask failure'); };
  try {
    assert.throws(() => pass.render(gl, input, output), /mask failure/);
    assert.equal(mesh.material, originals); assert.equal(scene.background, background); assert.equal(scene.overrideMaterial, override);
    assert.equal(gl.getRenderTarget(), target); assert.equal(gl.shadowMap.needsUpdate, true);
  } finally { pass.dispose(); mesh.geometry.dispose(); for (const m of originals) m.dispose(); override.dispose(); input.dispose(); output.dispose(); target.dispose(); }
});

test('detail-mask variants preserve mirrored faces, cutout textures and clipping while ignoring texture RGB', () => {
  const texture = new THREE.Texture(), alpha = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, map: texture, alphaMap: alpha, alphaTest: .5, opacity: .7, vertexColors: true });
  source.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 1)];
  const mask = createDetailMaskMaterial(source);
  assert.equal(mask.side, THREE.DoubleSide); assert.equal(mask.map, texture); assert.equal(mask.alphaMap, alpha);
  assert.equal(mask.alphaTest, .5); assert.equal(mask.opacity, .7); assert.equal(mask.vertexColors, true);
  assert.equal(mask.clippingPlanes, source.clippingPlanes); assert.equal(mask.fog, false);
  const shader = { fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  mask.onBeforeCompile(shader, {}); assert.match(shader.fragmentShader, /outgoingLight = diffuse;/);
  assert.ok(shader.fragmentShader.indexOf('alphatest_fragment') < shader.fragmentShader.indexOf('outgoingLight = diffuse;'));
  let sourceDisposed = 0; texture.addEventListener('dispose', () => { sourceDisposed++; });
  mask.dispose(); assert.equal(sourceDisposed, 0); source.dispose(); texture.dispose(); alpha.dispose();
});

test('zero-strength detail shading skips the scene mask and bounded variants release when their sources leave', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), gl = renderer(), target = gl.getRenderTarget();
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
  const pass = new DetailShadowPass(scene, camera), input = new THREE.WebGLRenderTarget(4, 4), output = input.clone();
  let masks = 0, copies = 0, released = 0, variant;
  gl.render = (rendered) => { if (rendered === scene) { masks++; variant = mesh.material; } else copies++; };
  try {
    pass.strength = 0; pass.render(gl, input, output); assert.equal(masks, 0); assert.equal(copies, 1);
    pass.strength = 1; pass.render(gl, input, output); variant.addEventListener('dispose', () => { released++; });
    pass.render(gl, input, output); assert.equal(released, 0); assert.equal(pass.variants.size, 1);
    scene.remove(mesh); pass.render(gl, input, output); assert.equal(released, 1); assert.equal(pass.variants.size, 0);
    scene.add(mesh); pass.render(gl, input, output); variant.addEventListener('dispose', () => { released++; });
    pass.strength = 0; pass.render(gl, input, output); assert.equal(released, 2); assert.equal(pass.variants.size, 0);
  } finally { pass.dispose(); mesh.geometry.dispose(); material.dispose(); input.dispose(); output.dispose(); target.dispose(); }
});

test('GPU timing publishes the newest completed query and discards invalid disjoint samples', () => {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }, deleted = [];
  const state = { pending: [{ ns: 50e6 }, { ns: 20e6 }, { ns: 8e6 }], gpuMs: null };
  const gl = { QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, getParameter: () => false,
    getQueryParameter(query, param) { return param === 3 ? true : query.ns; }, deleteQuery(query) { deleted.push(query); } };
  pollGpuQueries(gl, extension, state); assert.equal(state.gpuMs, 8); assert.equal(state.pending.length, 0); assert.equal(deleted.length, 3);
  state.pending.push({ ns: 1e6 }); gl.getParameter = () => true;
  pollGpuQueries(gl, extension, state); assert.equal(state.gpuMs, null); assert.equal(state.pending.length, 0);
});


test('an active exposure keeps its fixed raster across unrelated layout resizes', () => {
  const pass = new LinearCapturePass(), gl = renderer(), input = new THREE.WebGLRenderTarget(4, 4), output = input.clone();
  try {
    pass.setSize(640, 360); pass.beginFrame(2); pass.beginSample(); pass.render(gl, input, output);
    const sum = pass.sum; let released = false; sum.addEventListener('dispose', () => { released = true; });
    pass.setSize(1013, 570); assert.equal(released, false); assert.equal(sum.width, 640); assert.equal(sum.height, 360);
    pass.beginSample(); pass.render(gl, input, output); pass.endFrame();
    pass.setSize(1013, 570); assert.equal(released, true); assert.equal(sum.width, 1013);
  } finally { pass.dispose(); input.dispose(); output.dispose(); gl.getRenderTarget().dispose(); }
});

test('lens blur retains source alpha and keeps half-float radiance targets linear', async () => {
  const { LinearDepthOfFieldEffect } = await import('../src/three/effects/LinearDepthOfFieldEffect.ts');
  const { MaskFunction } = await import('postprocessing');
  const effect = new LinearDepthOfFieldEffect(new THREE.PerspectiveCamera());
  try {
    assert.equal(Number(effect.defines.get("MASK_FUNCTION")), MaskFunction.MULTIPLY_RGB);
    effect.initialize({ capabilities: {}, outputColorSpace: THREE.SRGBColorSpace }, true, THREE.HalfFloatType);
    for (const key of ['renderTarget', 'renderTargetNear', 'renderTargetFar', 'renderTargetMasked']) assert.equal(effect[key].texture.colorSpace, THREE.NoColorSpace);
  } finally { effect.dispose(); }
});

test('caption detail masks preserve only glyph coverage in either render layer', () => {
  const texture = new THREE.Texture();
  for (const front of [true, false]) {
    const source = new THREE.ShaderMaterial({ name: 'Caption overlay', uniforms: { map: { value: texture }, opacity: { value: .4 } }, transparent: front, depthTest: false, depthWrite: false, blending: front ? THREE.NormalBlending : THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const mask = createDetailMaskMaterial(source);
    assert.equal(receivesDetailShadows(source), false); assert.equal(mask.map, texture); assert.equal(mask.opacity, .4);
    assert.equal(mask.depthWrite, false); assert.equal(mask.depthTest, false); assert.equal(mask.blending, source.blending);
    assert.equal(mask.color.getHex(), 0); mask.dispose(); source.dispose();
  }
  texture.dispose();
});
