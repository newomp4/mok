// Geometry/material regressions; final GLSL compilation and appearance are checked in the browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { loadModelGeometry } from "./model-geometry.mjs";
import "./test-loader.mjs";

const { createScreenSpill, updateScreenSpill, createScreenReceiver, updateScreenReceiver, laptopReceivers, installScreenSpill } = await import("../src/three/screenSpill.ts");
const { addEnvironmentGain } = await import("../src/three/environmentGain.ts");
const { addMetalSurfaceDetail } = await import("../src/three/surfaceDetail.ts");
const { detectFeatures, findScreenMeshes, planarizeScreenUVs } = await import("../src/three/devices/GlbModel.tsx");
const { getDevice } = await import("../src/lib/devices.ts");
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const nearVector = (a, b) => { near(a.x, b.x); near(a.y, b.y); near(a.z, b.z); };
const texture = () => { const t = new THREE.Texture({ width: 2048, height: 1024 }); t.colorSpace = THREE.SRGBColorSpace; return t; };

test("screen emitter follows baked tilt, inset UVs, nested scale and animated lid without replacing uniforms", () => {
  const geo = new THREE.PlaneGeometry(4, 2, 2, 2).rotateX(-0.2);
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2 - 0.1, uv.getY(i) * 1.1 - 0.05);
  const root = new THREE.Group(), lid = new THREE.Group(), mesh = new THREE.Mesh(geo);
  root.rotation.set(0.3, -0.6, 0.2); root.scale.set(0.7, 1.2, 1.5); root.position.set(4, 1, -2);
  root.add(lid); lid.add(mesh); lid.position.y = 0.4;
  const spill = createScreenSpill(), map = texture(), inverse = spill.inverse.value, normal = spill.normal.value;
  for (const angle of [-0.8, 0, 0.7]) {
    lid.rotation.x = angle; root.updateWorldMatrix(true, true);
    assert.equal(updateScreenSpill(spill, mesh, map, 0.8), true);
    assert.equal(spill.inverse.value, inverse); assert.equal(spill.normal.value, normal);
    const positions = geo.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const world = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      nearVector(world.applyMatrix4(inverse), new THREE.Vector3(uv.getX(i), uv.getY(i), 0));
    }
    near(normal.length(), 1); near(spill.maxMip.value, 11); near(spill.strength.value, 0.8);
  }
  map.dispose(); geo.dispose(); mesh.material.dispose();
});

test("brightness/fade/off updates reset stale light immediately and borrow the changing screen texture", () => {
  const spill = createScreenSpill(), mesh = new THREE.Mesh(new THREE.PlaneGeometry()), map = texture();
  mesh.updateMatrixWorld();
  let disposed = 0; map.addEventListener("dispose", () => disposed++);
  for (const [gain, brightness, fade] of [[1, 1, 1], [2, 0.5, 0.4], [0, 2, 1], [1, 1, 0]]) {
    updateScreenSpill(spill, mesh, map, gain * brightness * fade);
    near(spill.strength.value, gain * brightness * fade);
  }
  map.image.width = 4096; updateScreenSpill(spill, mesh, map, 1);
  near(spill.maxMip.value, 12); assert.equal(spill.map.value, map);
  for (const value of [NaN, -1, Infinity]) { updateScreenSpill(spill, mesh, map, value); assert.equal(spill.strength.value, 0); }
  updateScreenSpill(spill, null, map, 1); assert.equal(spill.strength.value, 0);
  updateScreenSpill(spill, mesh, null, 1); assert.equal(spill.strength.value, 0);
  assert.equal(disposed, 0); map.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test("receiver frame preserves deck height and normal restrictions through arbitrary user rotations", () => {
  const frame = new THREE.Group(); frame.rotation.set(0.5, 0.7, -1.1); frame.position.set(1, -3, 2); frame.scale.set(2, 0.7, 1.5);
  const receiver = createScreenReceiver(frame, 0.08, 0.13); updateScreenReceiver(receiver);
  const localPoint = new THREE.Vector3(0.5, 0.1, 1), world = localPoint.clone().applyMatrix4(frame.matrixWorld);
  nearVector(world.applyMatrix4(receiver.inverse.value), localPoint);
  const expectedUp = new THREE.Vector3(0, 1, 0).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(frame.matrixWorld));
  nearVector(receiver.up.value, expectedUp);
  assert.ok(receiver.up.value.dot(expectedUp) > 0.55);
  assert.ok(receiver.up.value.dot(expectedUp.negate()) < 0.55, "underside cannot receive light");
});

test("screen-ray coordinates identify the reflected image and reject the display's back side", () => {
  const spill = createScreenSpill(), screen = new THREE.Mesh(new THREE.PlaneGeometry(4, 2)), map = texture();
  screen.position.set(0, 1, 0); screen.updateMatrixWorld(); updateScreenSpill(spill, screen, map, 1);
  const deckPoint = new THREE.Vector3(0, 0, 1), camera = new THREE.Vector3(0, 2, 3), normal = new THREE.Vector3(0, 1, 0);
  const source = deckPoint.clone().applyMatrix4(spill.inverse.value);
  const ray = camera.clone().sub(deckPoint).normalize().negate().reflect(normal).applyMatrix3(new THREE.Matrix3().setFromMatrix4(spill.inverse.value));
  assert.ok(source.z > 0 && ray.z < 0);
  const hit = source.addScaledVector(ray, -source.z / ray.z);
  nearVector(hit, new THREE.Vector3(0.5, 0.5, 0));
  assert.ok(new THREE.Vector3(0, 0, -1).applyMatrix4(spill.inverse.value).z < 0);
  // A display folded flat with its emitting face up must not illuminate the deck beneath it.
  screen.rotation.x = -Math.PI / 2; screen.position.y = 0.1; screen.updateMatrixWorld();
  updateScreenSpill(spill, screen, map, 1);
  assert.ok(new THREE.Vector3(0, 0, 0).applyMatrix4(spill.inverse.value).z < 0);
  map.dispose(); screen.geometry.dispose(); screen.material.dispose();
});

test("receiver shader composes with metal detail and HDR gain, retains PBR textures, and transforms instanced keys", () => {
  const frame = new THREE.Group(), receiver = createScreenReceiver(frame, 0, 1), spill = createScreenSpill();
  const material = new THREE.MeshStandardMaterial({ metalness: 0.8, roughness: 0.4 });
  addMetalSurfaceDetail(material); addEnvironmentGain(material);
  const normal = texture(); material.normalMap = normal;
  installScreenSpill(material, receiver, spill); installScreenSpill(material, receiver, spill);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.spillMap, spill.map); assert.equal(shader.uniforms.spillDeckInverse, receiver.inverse);
  assert.equal(material.normalMap, normal);
  assert.ok(shader.vertexShader.includes("instanceMatrix * spillPosition"));
  assert.ok(shader.vertexShader.includes("vMetalPosition"));
  assert.ok(shader.fragmentShader.includes("mokEnvironmentGain"));
  assert.ok(shader.fragmentShader.includes("BRDF_Lambert(material.diffuseContribution)"));
  assert.ok(shader.fragmentShader.includes("F_Schlick(material.specularColorBlended"));
  assert.ok(shader.fragmentShader.includes("sourceSpace.z > 0.0001"));
  assert.ok(shader.fragmentShader.includes("deckY >= spillDeckHeight.x"));
  assert.equal((material.customProgramCacheKey().match(/screen-spill-v1/g) ?? []).length, 1);
  assert.ok(shader.fragmentShader.includes("smoothstep(-filterWidth, filterWidth, uv)"), "blur includes the display border instead of clipping rough taps into bands");
  assert.ok(shader.fragmentShader.includes("footprint * 0.9"), "edge filtering follows material roughness and screen distance");
  assert.ok(shader.fragmentShader.includes("textureLod(spillMap"), "live color is sampled; no additive white constant can light black content");
  let disposed = 0; normal.addEventListener("dispose", () => disposed++); material.dispose(); assert.equal(disposed, 0); normal.dispose();
});

test("white diffuse emission remains energy bounded near a closed lid and unchanged at moderate openings", () => {
  const material = new THREE.MeshStandardMaterial();
  installScreenSpill(material, createScreenReceiver(new THREE.Group(), 0, 1), createScreenSpill());
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {});
  // Evaluate the shader's actual scalar quadrature/normalization expressions on a CPU grid.
  // A uniform white screen and white Lambert receiver reduce the RGB calculation to weight/PI.
  const weightExpression = shader.fragmentShader.match(/float weight = (emission[^;]+);/)?.[1];
  const normalizeExpression = shader.fragmentShader.match(/irradiance \*= ([^;]+);/)?.[1];
  assert.ok(weightExpression); assert.ok(normalizeExpression);
  const weightAt = new Function("emission", "incidence", "patchArea", "distanceSq", `return ${weightExpression};`);
  const normalize = new Function("projectedWeight", "PI", "min", "max", `return ${normalizeExpression};`);
  const peaks = [];
  for (const degrees of [0, 5, 15, 70]) {
    const angle = degrees * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
    const width = 3, height = 2, gap = 0.015, patchArea = width * height / 9;
    let rawPeak = 0, boundedPeak = 0;
    for (let iz = 0; iz <= 60; iz++) for (let ix = 0; ix <= 60; ix++) {
      const x = width * (ix / 60 - 0.5), z = height * iz / 60;
      let projectedWeight = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const sourceY = height * (sy + 0.5) / 3;
        const dx = width * ((sx + 0.5) / 3 - 0.5) - x, dy = gap + sourceY * sin, dz = sourceY * cos - z;
        const distanceSq = Math.max(dx * dx + dy * dy + dz * dz, 0.0001), distance = Math.sqrt(distanceSq);
        const emission = Math.max((dy * cos - dz * sin) / distance, 0), incidence = Math.max(dy / distance, 0);
        projectedWeight += weightAt(emission, incidence, patchArea, distanceSq);
      }
      const raw = projectedWeight / Math.PI, bounded = raw * normalize(projectedWeight, Math.PI, Math.min, Math.max);
      assert.ok(bounded <= 1 + 1e-12 && bounded >= 0, `white source radiance exceeded at ${degrees}°`);
      if (raw <= 1) near(bounded, raw, 1e-12);
      rawPeak = Math.max(rawPeak, raw); boundedPeak = Math.max(boundedPeak, bounded);
    }
    peaks.push({ rawPeak, boundedPeak });
  }
  assert.ok(peaks[0].rawPeak > 1.2, "fixture catches the previous near-closed quadrature excess");
  near(peaks[0].boundedPeak, 1, 1e-12);
  assert.ok(peaks[3].rawPeak < 1, "ordinary open lid does not require normalization");
  near(peaks[3].boundedPeak, peaks[3].rawPeak, 1e-12);
  material.dispose();
});

for (const name of ["macbook-pro-14", "macbook-pro-16"]) test(`${name} shipped geometry selects deck and keys, excluding the complete moving lid and hidden meshes`, async () => {
  const spec = getDevice(`${name}-glb`), model = await loadModelGeometry(new URL(`../public/models/${name}.glb`, import.meta.url)), native = new THREE.Group(), holder = new THREE.Group(), yaw = new THREE.Group(), scene = new THREE.Scene();
  native.name = "device-orientation"; yaw.name = "autoYaw"; scene.add(native); native.add(holder); holder.add(yaw); yaw.add(model);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  model.position.sub(box.getCenter(new THREE.Vector3())); holder.scale.setScalar(spec.model.size * 0.01 / Math.max(size.x, size.y, size.z));
  for (const name of spec.model.hide ?? []) { const object = model.getObjectByName(name); if (object) object.visible = false; }
  scene.updateMatrixWorld(true);
  const screen = findScreenMeshes(holder, spec.model.screenMesh)[0]; assert.ok(screen);
  planarizeScreenUVs(screen, holder, spec.screenPx[0] / spec.screenPx[1], spec.model.screenInset);
  const features = detectFeatures(holder, screen, spec, scene); assert.ok(features.lid);
  holder.visible = false; // Models must be fully prepared before a staged instance becomes visible.
  const selected = laptopReceivers(holder, screen, features.lid.pivot, native); assert.ok(selected);
  assert.ok(selected.meshes.size >= 3, `deck/keys/trackpad: ${selected.meshes.size} receivers`);
  assert.ok(selected.receiver.height.value.x < selected.receiver.height.value.y);
  for (const mesh of selected.meshes) {
    assert.notEqual(mesh, screen);
    for (let p = mesh; p && p !== holder; p = p.parent) { assert.notEqual(p, features.lid.pivot); assert.ok(p.visible); }
  }
  scene.traverse((object) => {
    object.geometry?.dispose();
    for (const material of (Array.isArray(object.material) ? object.material : object.material ? [object.material] : [])) material.dispose();
  });
});
