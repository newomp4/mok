// CPU regression coverage. Shader compilation, loaded-device appearance and output alpha require browser QA.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect, EffectAttribute, EffectPass, NoiseEffect, PixelationEffect, ToneMappingEffect, VignetteEffect } from "postprocessing";
import "./test-loader.mjs";

const { rasterSize } = await import("../src/three/raster.ts");
const { visibleBounds } = await import("../src/three/bounds.ts");
const { disposeResources, ownModelResource, disposeModelResources, tintBandMaterials } = await import("../src/three/resources.ts");
const { EFFECT_MERGE_MODE, FocusBlurEffect, GhostEffect, SharpenEffect, LiquidGlassEffect, GlassBorderEffect, createLensDistortion } = await import("../src/three/effects/effects.ts");
const { sampleRoundedRect, sweepRoundedRect, domeProfile } = await import("../src/three/sweep.ts");
const { roundedPlaneGeometry } = await import("../src/three/geometry.ts");
const { paintImage } = await import("../src/three/background.ts");
const { addScreenGlow, screenGlow } = await import("../src/three/screenGlow.ts");
const { cameraClipRange } = await import("../src/three/Scene.tsx");
const { wrapLines, CARD_Z, enterExitAt } = await import("../src/three/CardLayer.tsx");
const { planarizeScreenUVs, findScreenMeshes } = await import("../src/three/devices/GlbModel.tsx");
const { useModelBounds } = await import("../src/three/registry.ts");
const { deviceLayout, flatSize } = await import("../src/three/devices/layout.ts");
const { DEVICES, PREFERRED_MODEL, getDevice } = await import("../src/lib/devices.ts");
const { LIGHTINGS } = await import("../src/lib/presets.ts");
const { cssFamily, ensureFont, onFontsReady } = await import("../src/lib/fonts.ts");
const { addEnvironmentGain } = await import("../src/three/environmentGain.ts");
const { renderQuality, resizeShadowMap } = await import("../src/three/renderQuality.ts");
const { createContactShadowResources } = await import("../src/three/ContactShadow.tsx");
const { createScreenMaterial, createFinishMaterials, disposeMaterials } = await import("../src/three/materials.ts");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} should equal ${b}`);
const vectorNear = (a, b) => { near(a.x, b.x); near(a.y, b.y); near(a.z, b.z); };

function compilePhysical(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
}

test("material HDR gain composes with animated scene intensity for diffuse, specular and clearcoat IBL", () => {
  const material = new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.3, clearcoat: 1 });
  let previousCalls = 0;
  material.onBeforeCompile = (shader) => { previousCalls++; shader.uniforms.authored = { value: 7 }; };
  material.customProgramCacheKey = () => "authored";
  addEnvironmentGain(material); addEnvironmentGain(material);
  const shader = compilePhysical(material);
  assert.equal(previousCalls, 1);
  assert.equal(shader.uniforms.authored.value, 7);
  assert.equal(material.customProgramCacheKey(), "authored:environment-gain-v1");
  assert.equal((shader.fragmentShader.match(/envMapIntensity \* mokEnvironmentGain/g) ?? []).length, 2);
  assert.ok(shader.fragmentShader.includes("vec3 getIBLIrradiance"));
  assert.ok(shader.fragmentShader.includes("vec3 getIBLRadiance"));
  for (const sceneGain of [0, 0.5, 2]) for (const gloss of [0.2, 1, 3]) {
    material.envMapIntensity = gloss;
    near(shader.uniforms.mokEnvironmentGain.value * sceneGain, gloss * sceneGain);
  }
  material.envMap = new THREE.Texture();
  assert.equal(shader.uniforms.mokEnvironmentGain.value, 1, "explicit maps already receive material gain from Three");
  material.envMap.dispose(); material.dispose();
});

test("screen reflection gain remains live and composes with the existing mirror shader", () => {
  const texture = new THREE.Texture();
  const material = createScreenMaterial(texture);
  const shader = compilePhysical(material);
  assert.ok(shader.fragmentShader.includes("reflectedLight.indirectSpecular += mirror * mirrorGain"));
  for (const reflection of [0, 0.2, 1]) {
    material.envMapIntensity = reflection;
    assert.equal(shader.uniforms.mokEnvironmentGain.value, reflection);
  }
  const mats = createFinishMaterials({ id: "test", name: "Test", color: "#777777", roughness: 0.3 });
  assert.equal(compilePhysical(mats.lens).uniforms.mokEnvironmentGain.value, 1.4);
  disposeMaterials(mats); material.dispose(); texture.dispose();
});

test("reflection and shadow quality tiers obey both texture axes, pixel budgets and GPU limits", () => {
  const preview = renderQuality(1920, 1080, 2, false, 8192);
  const exported = renderQuality(3840, 2160, 1, true, 8192);
  assert.deepEqual([preview.floor, preview.contact, preview.shadow], [1024, 1024, 2048]);
  assert.deepEqual([exported.floor, exported.contact, exported.shadow], [2048, 2048, 4096]);
  assert.ok(exported.reflection[0] > preview.reflection[0]);
  for (const exporting of [false, true]) for (const limit of [512, 2048, 8192]) {
    for (const [w, h] of [[1, 8192], [8192, 1], [7680, 4320], [4320, 7680], [8192, 8192]]) {
      const q = renderQuality(w, h, 2, exporting, limit);
      const [rw, rh] = q.reflection;
      assert.ok(rw >= 1 && rh >= 1 && Math.max(rw, rh, q.floor, q.contact, q.shadow) <= limit);
      assert.ok(rw * rh <= (exporting ? 4_000_000 : 1_500_000));
    }
  }
  assert.deepEqual(renderQuality(1920, 1080, 2, false, 8192), preview, "leaving export restores economical preview targets");
});

test("landscape camera fitting cannot shrink the room or clip a wide device's shadow catcher", () => {
  for (const spec of DEVICES.filter((s) => s.family === "phone" || s.family === "tablet")) {
    const portrait = deviceLayout(spec, null, "portrait", 9 / 16);
    const landscape = deviceLayout(spec, null, "landscape", 2.6);
    const narrow = deviceLayout(spec, null, "landscape", 0.5);
    assert.equal(landscape.sceneSize, portrait.sceneSize);
    assert.equal(narrow.sceneSize, portrait.sceneSize, "canvas aspect changes framing, never physical shadow margins");
    assert.ok(landscape.sceneSize * 3.2 > Math.max(spec.body.w, spec.body.h) * 0.01 * 2);
  }
});

test("shadow resolution changes release both VSM targets exactly once and preserve same-size buffers", () => {
  const shadow = new THREE.DirectionalLight().shadow;
  const raw = new THREE.WebGLRenderTarget(2048, 2048), blur = raw.clone();
  let disposed = 0;
  raw.addEventListener("dispose", () => disposed++); blur.addEventListener("dispose", () => disposed++);
  shadow.map = raw; shadow.mapPass = blur;
  resizeShadowMap(shadow, 2048);
  assert.equal(disposed, 0); assert.equal(shadow.map, raw);
  resizeShadowMap(shadow, 4096);
  assert.equal(disposed, 2); assert.equal(shadow.map, null); assert.equal(shadow.mapPass, null);
  assert.deepEqual(shadow.mapSize.toArray(), [4096, 4096]);
  assert.equal(shadow.needsUpdate, true);
  resizeShadowMap(shadow, 4096);
  assert.equal(disposed, 2);
});

test("contact-shadow resize resources own and release every render target, material and geometry", () => {
  for (const resolution of [1024, 2048]) {
    const owned = createContactShadowResources(3, resolution);
    assert.equal(owned.target.width, resolution); assert.equal(owned.blurred.height, resolution);
    const shader = { fragmentShader: THREE.ShaderLib.depth.fragmentShader };
    owned.depth.onBeforeCompile(shader, {});
    assert.equal(owned.depth.depthTest, true);
    assert.equal(owned.depth.depthWrite, true);
    assert.equal(owned.target.texture.type, THREE.HalfFloatType);
    assert.equal(owned.blurred.depthBuffer, false);
    let disposed = 0;
    for (const resource of [owned.target, owned.blurred, owned.geometry, owned.depth, owned.horizontal, owned.vertical, owned.catcher]) resource.addEventListener("dispose", () => disposed++);
    disposeResources(owned);
    assert.equal(disposed, 7);
  }
});

test("canvas font shorthand preserves complete quoted local-font stacks and waits for the bundled face", async () => {
  const previousDocument = globalThis.document, previousStyle = globalThis.getComputedStyle;
  let stack = "'GeistSans', 'GeistSans Fallback'";
  let requested = "", finishLoad;
  const faceReady = new Promise((resolve) => { finishLoad = resolve; });
  globalThis.document = { documentElement: {}, fonts: { load: (font) => { requested = font; return faceReady; } } };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => stack });
  try {
    assert.equal(cssFamily("Geist"), stack);
    assert.equal(`600 35.1px ${cssFamily("Geist")}`, "600 35.1px 'GeistSans', 'GeistSans Fallback'");
    let finished = false;
    const pending = ensureFont("Geist", 600).then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    assert.equal(requested, "600 32px 'GeistSans', 'GeistSans Fallback'");
    finishLoad([{}]);
    await pending;
    assert.equal(finished, true);
    stack = '"GeistMono", "GeistMono Fallback", monospace';
    assert.equal(cssFamily("Geist Mono"), stack);
    stack = "";
    assert.equal(cssFamily("Geist Mono"), "ui-monospace, monospace");
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousStyle;
  }
});

test("paused text redraws after fonts settle and load later, with no callbacks after unmount", async () => {
  const previousDocument = globalThis.document;
  const fonts = new EventTarget();
  let settle;
  fonts.ready = new Promise((resolve) => { settle = resolve; });
  globalThis.document = { fonts };
  try {
    let redraws = 0;
    const stop = onFontsReady(() => redraws++);
    settle(); await Promise.resolve();
    assert.equal(redraws, 1);
    fonts.dispatchEvent(new Event("loadingdone"));
    assert.equal(redraws, 2);
    stop();
    fonts.dispatchEvent(new Event("loadingdone"));
    assert.equal(redraws, 2);
    const stopBeforeReady = onFontsReady(() => redraws++);
    stopBeforeReady(); await Promise.resolve();
    assert.equal(redraws, 2);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("portrait, landscape and square raster allocations preserve aspect and obey both limits", () => {
  for (const [width, height] of [[4320, 7680], [7680, 4320], [10000, 10000], [100, 20000]]) {
    const [w, h] = rasterSize(width, height, 4096);
    assert.ok(w > 0 && h > 0 && Math.max(w, h) <= 4096);
    assert.ok(w * h <= 12_000_000);
    assert.ok(Math.abs(w / h - width / height) <= 2 / Math.min(w, h));
  }
  assert.deepEqual(rasterSize(1920, 1080, 4096), [1920, 1080]);
  assert.deepEqual(rasterSize(0, NaN, 4096), [1, 1]);
});

test("camera-mounted cards and fades remain in the frustum at extreme zoom distances", () => {
  for (const distance of [0.1, 1, 5, 50, 500, 5000]) {
    const { near: clipNear, far } = cameraClipRange(distance);
    assert.ok(clipNear > 0 && clipNear < CARD_Z * 0.8);
    assert.ok(far > distance && far > clipNear);
    const camera = new THREE.PerspectiveCamera(24, 1, clipNear, far);
    for (const z of [CARD_Z, CARD_Z * 0.8]) {
      const projected = new THREE.Vector3(0, 0, -z).project(camera);
      assert.ok(projected.z > -1 && projected.z < 1);
    }
  }
});

test("visible bounds exclude hidden descendants and stay stable when the whole device rotates", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.1));
  mesh.position.set(1, 0.5, -0.2);
  root.add(mesh);
  const hidden = new THREE.Group(); hidden.visible = false;
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200)));
  root.add(hidden);
  root.updateMatrixWorld(true);
  const baseline = visibleBounds(root, root.matrixWorld.clone().invert());
  root.rotation.set(0.8, 0.5, -0.4); root.position.set(3, -2, 1); root.scale.set(1.5, 0.7, 2);
  root.updateMatrixWorld(true);
  const rotated = visibleBounds(root, root.matrixWorld.clone().invert());
  vectorNear(rotated.min, baseline.min); vectorNear(rotated.max, baseline.max);
  root.visible = false;
  assert.ok(visibleBounds(root, root.matrixWorld.clone().invert()).isEmpty());
  assert.ok(!visibleBounds(root, root.matrixWorld.clone().invert(), new THREE.Box3(), true).isEmpty());
});

test("visible bounds include instances and remeasure an animated lid", () => {
  const root = new THREE.Group();
  const keyboard = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  keyboard.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-4, 0, 0));
  keyboard.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 0, 0));
  root.add(keyboard);
  const lid = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.1)); panel.position.y = 1.5; lid.add(panel); root.add(lid);
  const open = visibleBounds(root, new THREE.Matrix4());
  near(open.min.x, -4.5); near(open.max.x, 4.5);
  lid.rotation.x = -Math.PI / 2;
  const closed = visibleBounds(root, new THREE.Matrix4());
  assert.ok(closed.max.y < open.max.y);
  assert.ok(closed.min.z < open.min.z);
});

test("GLTF cleanup disposes private clones without destroying cached source geometry or textures", () => {
  const root = new THREE.Group();
  const sourceGeometry = new THREE.PlaneGeometry(1, 2);
  const texture = new THREE.Texture();
  const sourceMaterial = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(sourceGeometry, sourceMaterial); root.add(mesh);
  let sourceDisposals = 0, cloneDisposals = 0;
  sourceGeometry.addEventListener("dispose", () => sourceDisposals++);
  sourceMaterial.addEventListener("dispose", () => sourceDisposals++);
  texture.addEventListener("dispose", () => sourceDisposals++);
  planarizeScreenUVs(mesh, root, 0.5);
  assert.notEqual(mesh.geometry, sourceGeometry);
  mesh.geometry.addEventListener("dispose", () => cloneDisposals++);
  const clone = ownModelResource(root, sourceMaterial.clone());
  clone.addEventListener("dispose", () => cloneDisposals++);
  disposeModelResources(root);
  assert.equal(cloneDisposals, 2); assert.equal(sourceDisposals, 0);
  // Strict Mode can reuse these same objects after cleanup; ownership must not be forgotten.
  disposeModelResources(root);
  assert.equal(cloneDisposals, 4); assert.equal(sourceDisposals, 0);
});

test("watch color dragging reuses materials and preserves multi-material slots and authored color", () => {
  const root = new THREE.Group(), mesh = new THREE.Mesh();
  const source = [new THREE.MeshStandardMaterial({ color: "#123456" }), new THREE.MeshBasicMaterial({ color: "#abcdef" })];
  const first = tintBandMaterials(root, mesh, source, "#ffffff");
  for (let i = 0; i < 100; i++) {
    const tinted = tintBandMaterials(root, mesh, source, `#${i.toString(16).padStart(6, "0")}`);
    assert.equal(tinted[0], first[0]); assert.equal(tinted[1], first[1]);
  }
  assert.equal(root.userData.ownedResources.size, 2);
  assert.equal(source[0].color.getHexString(), "123456");
  assert.equal(source[1].color.getHexString(), "abcdef");
  assert.ok(Array.isArray(tintBandMaterials(root, mesh, [source[0]], "#777777")));
  disposeModelResources(root);
});

test("component-owned resource bundles dispose each unique object once", () => {
  let disposed = 0;
  const resource = { dispose() { disposed++; } };
  disposeResources({ a: resource, same: resource, count: 2, empty: null });
  assert.equal(disposed, 1);
});

test("floating-point custom blur targets remain linear while byte targets use sRGB", () => {
  const renderer = { outputColorSpace: THREE.SRGBColorSpace };
  for (const EffectClass of [FocusBlurEffect, GhostEffect]) {
    const effect = new EffectClass();
    effect.initialize(renderer, true, THREE.UnsignedByteType);
    assert.equal(effect.renderTarget.texture.colorSpace, THREE.SRGBColorSpace);
    effect.initialize(renderer, true, THREE.HalfFloatType);
    assert.equal(effect.renderTarget.texture.type, THREE.HalfFloatType);
    assert.equal(effect.renderTarget.texture.colorSpace, THREE.NoColorSpace);
    effect.dispose();
  }
});

test("effects sampling neighboring pixels declare convolution for correct pass ordering", () => {
  for (const EffectClass of [FocusBlurEffect, GhostEffect, SharpenEffect, LiquidGlassEffect]) {
    const effect = new EffectClass();
    assert.ok(effect.getAttributes() & EffectAttribute.CONVOLUTION, EffectClass.name);
    if (EffectClass === GhostEffect) assert.ok(effect.getAttributes() & EffectAttribute.DEPTH);
    effect.dispose();
  }
});

test("the complete effect stack assembles real EffectPass shaders without UV/convolution conflicts", () => {
  const camera = new THREE.PerspectiveCamera();
  // This is the failure reproduced in the browser: adding Pixel grid to an existing focus blur.
  const incompatible = new EffectPass(camera, new FocusBlurEffect(), new PixelationEffect(8));
  assert.throws(() => incompatible.recompile(), /incompatible|cannot be merged/);
  incompatible.dispose();
  assert.equal(EFFECT_MERGE_MODE, "none", "EffectComposer must give every effect its own pass");
  for (const blur of [new FocusBlurEffect(), new DepthOfFieldEffect(camera)]) {
    const effects = [blur, new ChromaticAberrationEffect(), createLensDistortion(), new PixelationEffect(8),
      new SharpenEffect(), new GhostEffect(), new LiquidGlassEffect(), new BloomEffect({ mipmapBlur: true }),
      new ToneMappingEffect(), new GlassBorderEffect(), new NoiseEffect(), new VignetteEffect()];
    const passes = effects.map((effect) => new EffectPass(camera, effect));
    try {
      for (const pass of passes) assert.doesNotThrow(() => pass.recompile());
    } finally { for (const pass of passes) pass.dispose(); }
  }
});

test("directional blur and zero-strength blur skip the unused Kawase render pass", () => {
  const effect = new FocusBlurEffect();
  let renders = 0;
  effect.blurPass.render = () => { renders++; };
  effect.setParams(0.5, 0.5, 0.4, 0.2, "directional", 10, false, 20);
  effect.update({}, {});
  assert.equal(renders, 0);
  assert.equal(effect.uniforms.get("active").value, 1);
  effect.setParams(0.5, 0.5, 0.4, 0.2, "radial", 0, false);
  effect.update({}, {}); assert.equal(renders, 0);
  effect.setParams(0.5, 0.5, 0.4, 0.2, "radial", 5, false);
  effect.update({}, {}); assert.equal(renders, 1);
  effect.dispose();
});

test("whole-frame liquid glass reaches exactly the four frame edges", () => {
  const effect = new LiquidGlassEffect();
  effect.set(0.2, 0.3, 0.2, 0.4, 0.1, 1, 0.2, 0.4, 1);
  effect.coverFrame();
  const center = effect.uniforms.get("center").value, half = effect.uniforms.get("halfSize").value;
  near(center.x - half.x, 0); near(center.y - half.y, 0);
  near(center.x + half.x, 1); near(center.y + half.y, 1);
  effect.dispose();
});

test("submillimeter swept geometry never grows a forced two-millimeter corner radius", () => {
  const width = 0.012, height = 0.04, radius = 0.001;
  const { p } = sampleRoundedRect(width, height, radius);
  for (const point of p) { assert.ok(Math.abs(point.x) <= width / 2 + 1e-9); assert.ok(Math.abs(point.y) <= height / 2 + 1e-9); }
  near(p[0].x, width / 2 - radius);
  const geometry = sweepRoundedRect(width, height, radius, domeProfile(0.003, 0.0005));
  for (const attribute of Object.values(geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.x - geometry.boundingBox.min.x <= width + 1e-8);
  geometry.dispose();
});

test("background image repaint clears old pixels and blur preserves image aspect", () => {
  const calls = [];
  const ctx = {
    filter: "blur(2px)", globalAlpha: 0.3, globalCompositeOperation: "multiply",
    save() { calls.push(["save"]); }, restore() { calls.push(["restore"]); },
    clearRect(...args) { calls.push(["clear", ...args]); }, fillRect(...args) { calls.push(["fill", ...args]); },
    drawImage(...args) { calls.push(["image", ...args]); },
  };
  const image = {};
  paintImage(ctx, image, 1600, 900, 1000, 1000, 0.6, "#ffeecc");
  assert.deepEqual(calls.slice(0, 3).map((x) => x[0]), ["save", "clear", "fill"]);
  const draw = calls.find((x) => x[0] === "image");
  near(draw[4] / draw[5], 1600 / 900);
  assert.ok(draw[4] >= 1000 && draw[5] >= 1000);
  assert.equal(calls.at(-1)[0], "restore");
});

test("screen spill attaches live uniforms only to opted-in floor materials and preserves their shader", () => {
  const floor = new THREE.MeshStandardMaterial(), device = new THREE.MeshStandardMaterial();
  const originalDeviceKey = device.customProgramCacheKey();
  let originalCompile = 0;
  floor.onBeforeCompile = () => { originalCompile++; };
  addScreenGlow(floor);
  const once = floor.onBeforeCompile;
  addScreenGlow(floor);
  assert.equal(floor.onBeforeCompile, once);
  assert.equal(device.customProgramCacheKey(), originalDeviceKey);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  floor.onBeforeCompile(shader, {});
  assert.equal(originalCompile, 1);
  assert.equal(shader.uniforms.screenGlowColor, screenGlow.color);
  assert.equal(shader.uniforms.screenGlowPosition, screenGlow.position);
  assert.equal(shader.uniforms.screenGlowIntensity, screenGlow.intensity);
  assert.match(shader.vertexShader, /vScreenGlowWorld =/);
  assert.match(shader.fragmentShader, /reflectedLight\.directDiffuse \+= glowIrradiance/);
  assert.ok(!device.userData.screenGlow);
  floor.dispose(); device.dispose();
});

test("long emoji and combining-mark title tokens wrap without splitting graphemes", () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const ctx = { measureText: (s) => ({ width: Array.from(segmenter.segment(s)).length * 10 }) };
  assert.deepEqual(wrapLines(ctx, "👩🏽‍💻👩🏽‍💻👩🏽‍💻", 10), ["👩🏽‍💻", "👩🏽‍💻", "👩🏽‍💻"]);
  assert.deepEqual(wrapLines(ctx, "e\u0301e\u0301e\u0301", 20), ["e\u0301e\u0301", "e\u0301"]);
  assert.deepEqual(wrapLines(ctx, "First\n\nLast", 100), ["First", "", "Last"]);
});

test("model bounds publish maxY-only updates", () => {
  const id = "renderer-test";
  useModelBounds.getState().set(id, { minY: -1, maxY: 1, width: 2, height: 2 });
  useModelBounds.getState().set(id, { maxY: 3 });
  assert.equal(useModelBounds.getState().bounds[id].maxY, 3);
});

test("screen UV remapping preserves cached source geometry and selected inset/aspect", () => {
  const source = roundedPlaneGeometry(2, 1, 0.05);
  const sourceUV = Array.from(source.getAttribute("uv").array);
  const screen = new THREE.Mesh(source); screen.name = "Screen";
  const root = new THREE.Group(); root.name = "device"; root.add(screen);
  planarizeScreenUVs(screen, root, 1);
  assert.deepEqual(Array.from(source.getAttribute("uv").array), sourceUV);
  near(screen.userData.screenAspect, 1);
  assert.equal(findScreenMeshes(root, "Screen")[0], screen);
  const uv = screen.geometry.getAttribute("uv");
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < uv.count; i++) { low = Math.min(low, uv.getX(i)); high = Math.max(high, uv.getX(i)); }
  assert.ok(low < 0 && high > 1, "overshoot should fall outside the live content window");
  disposeModelResources(root); source.dispose();
});

test("all device definitions and flat/browser media layouts produce finite usable dimensions", () => {
  assert.equal(new Set(DEVICES.map((d) => d.id)).size, DEVICES.length);
  for (const device of DEVICES) {
    const layout = deviceLayout(device);
    for (const key of ["height", "floorY", "fitSize", "lean"]) assert.ok(Number.isFinite(layout[key]), `${device.id}: ${key}`);
    assert.ok(layout.height > 0 && layout.fitSize > 0, device.id);
    assert.ok(device.finishes.length > 0);
    const screen = roundedPlaneGeometry(device.screenMm[0] * 0.01, device.screenMm[1] * 0.01, device.screenRadius * 0.01);
    for (const value of screen.getAttribute("position").array) assert.ok(Number.isFinite(value), device.id);
    screen.dispose();
  }
  for (const target of Object.values(PREFERRED_MODEL)) assert.ok(DEVICES.some((d) => d.id === target && d.model), target);
  const media = { width: 900, height: 1600 };
  near(flatSize(getDevice("flat"), media).w / flatSize(getDevice("flat"), media).h, 900 / 1600);
  const browser = flatSize(getDevice("browser"), media);
  near(browser.px[1], Math.round(1600 + 900 * 0.045));
});

test("every declared device model, GLTF external resource and HDR light asset exists", () => {
  for (const device of DEVICES.filter((d) => d.model)) {
    const path = resolve(projectRoot, "public", device.model.url.slice(1));
    assert.ok(existsSync(path), device.id);
    const bytes = readFileSync(path);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${device.id}: GLB magic`);
    assert.equal(bytes.readUInt32LE(4), 2, `${device.id}: GLB version`);
    assert.equal(bytes.readUInt32LE(8), bytes.length, `${device.id}: GLB length`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
    assert.ok(gltf.meshes?.length > 0, device.id);
    for (const resource of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (resource.uri && !resource.uri.startsWith("data:")) assert.ok(existsSync(resolve(dirname(path), decodeURIComponent(resource.uri))), `${device.id}: ${resource.uri}`);
    }
  }
  for (const light of LIGHTINGS) assert.ok(existsSync(resolve(projectRoot, "public", light.file.slice(1))), light.id);
});

test("overlapping card enter/exit transitions remain finite and end at zero opacity", () => {
  const shot = { duration: 0.2, enter: { effect: "slideUp", duration: 1 }, exit: { effect: "scale", duration: 1 } };
  for (const t of [0, 0.1, 0.2]) {
    const frame = enterExitAt(shot, t);
    for (const v of Object.values(frame)) assert.ok(Number.isFinite(v));
    assert.ok(frame.opacity >= 0 && frame.opacity <= 1);
  }
  assert.equal(enterExitAt(shot, 0).opacity, 0);
  assert.equal(enterExitAt(shot, 0.2).opacity, 0);
});
