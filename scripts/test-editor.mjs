// Run with Node 22.15+ / 24: node --test scripts/test-editor.mjs
// Load the real TypeScript stores/actions using the project's existing compiler.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import * as THREE from "three";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = pathToFileURL(`${root}/src/`).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    let base;
    if (specifier.startsWith("@/")) base = resolve(root, "src", specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.startsWith(sourceRoot)) base = fileURLToPath(new URL(specifier, context.parentURL));
    if (base) {
      const path = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(p) && /\.tsx?$/.test(p));
      if (path) return nextResolve(pathToFileURL(path).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && /\.tsx?$/.test(url)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { useEditor, undo, beginInteraction, endInteraction } = await import("../src/store/editor.ts");
const { useUI } = await import("../src/store/ui.ts");
const { applyTemplate } = await import("../src/lib/actions.ts");
const { createProject } = await import("../src/lib/defaults.ts");
const { TEMPLATES, SCENES, LIGHTINGS } = await import("../src/lib/presets.ts");
const { shotBase } = await import("../src/lib/animation.ts");
const { resolveShotView } = await import("../src/lib/shotView.ts");
const { STUDIO_LOOKS, applyStudioLook } = await import("../src/lib/looks.ts");
const { readScreenPlane, findDisplay } = await import("../src/three/screenPlane.ts");
const { ScreenSurface } = await import("../src/three/screen.ts");
const { ANIM_PROPS } = await import("../src/lib/types.ts");

// The tested projects contain media already; flush the delayed template sample check explicitly.
const pending = [];
globalThis.window = { setTimeout: (fn) => { pending.push(fn); return pending.length; } };
const screenshot = { id: "existing-screen", kind: "image", width: 1290, height: 2796, name: "My app.png" };
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

function start(project) {
  useUI.setState({ time: 0, activeShotId: project.shots[0].id, playing: false, recording: false, timelineMode: "advanced" });
  useEditor.getState().replaceProject(project);
  useEditor.temporal.getState().clear();
}

test("a still template replaces every shot's old look and preserves the user's source settings", () => {
  const project = createProject();
  for (const shot of project.shots) {
    Object.assign(shot, {
      media: screenshot, duration: 8, fit: "contain", speed: 0.75, trimStart: 1.5,
      device: "macbook-pro-16-glb", finish: "space-black", scene: "darkroom", lighting: "neon",
      blurMode: "depth", bokeh: false, notch: false,
      pose: { "camera.zoom": 6, "camera.panX": 0.7, "mockup.rotY": 130, "blur.focusDistance": 24 },
      keyframes: { "camera.x": [{ t: 0, v: 100, ease: "linear" }] },
      transitionOut: { type: "fade", duration: 0.6, color: "#000000" },
    });
  }
  const before = structuredClone(project.shots);
  start(project);
  applyTemplate("appstore-iphone");
  pending.splice(0).forEach((fn) => fn());
  const applied = useEditor.getState().project;
  const template = TEMPLATES.find((t) => t.id === "appstore-iphone");
  assert.equal(applied.shots.length, before.length);
  for (const [i, shot] of applied.shots.entries()) {
    const view = resolveShotView(applied, shot);
    assert.equal(view.device, template.device);
    assert.equal(view.scene, template.scene);
    assert.equal(view.lighting, applied.scene.lighting);
    assert.equal(view.blurMode, "off");
    assert.equal(view.bokeh, applied.blur.bokeh);
    assert.equal(view.notch, applied.mockup.notch);
    assert.equal(shotBase(applied, shot, "camera.zoom"), template.camera.zoom);
    assert.equal(shotBase(applied, shot, "camera.panX"), template.camera.panX);
    assert.equal(shotBase(applied, shot, "mockup.rotY"), template.rot.y);
    assert.equal(shotBase(applied, shot, "blur.focusDistance"), applied.blur.focusDistance);
    assert.deepEqual(shot.keyframes, {});
    assert.equal(shot.transitionOut, undefined);
    for (const key of ["id", "name", "duration", "media", "fit", "speed", "trimStart"]) assert.deepEqual(shot[key], before[i][key]);
  }
});

test("an animated template starts its new move from the template after a different device was edited", () => {
  const project = createProject();
  project.shots[0].media = screenshot;
  project.shots[0].pose = { "camera.zoom": 9, "mockup.rotY": 140 };
  project.shots[0].device = "browser";
  project.shots[0].keyframes = { "blur.strength": [{ t: 0, v: 19, ease: "linear" }] };
  start(project);
  applyTemplate("iphone-hero");
  pending.splice(0).forEach((fn) => fn());
  const applied = useEditor.getState().project;
  const shot = applied.shots[0];
  const template = TEMPLATES.find((t) => t.id === "iphone-hero");
  assert.equal(resolveShotView(applied, shot).device, template.device);
  assert.equal(shotBase(applied, shot, "camera.zoom"), template.camera.zoom);
  assert.equal(shotBase(applied, shot, "mockup.rotY"), template.rot.y);
  assert.equal(shot.keyframes["blur.strength"], undefined);
  assert.ok(Object.values(shot.keyframes).some((track) => track.length > 1), "the template's camera move is present");
  assert.deepEqual(shot.media, screenshot);
});

test("manual focus and returning to autofocus stay on the edited shot", () => {
  const project = createProject();
  project.blur.mode = "depth";
  project.blur.focusDistance = 0;
  start(project);
  useEditor.getState().setValue("blur.focusDistance", 4.2);
  let applied = useEditor.getState().project;
  assert.equal(shotBase(applied, applied.shots[0], "blur.focusDistance"), 4.2);
  assert.equal(shotBase(applied, applied.shots[1], "blur.focusDistance"), 0);
  assert.equal(applied.blur.focusDistance, 0);
  useEditor.getState().setValue("blur.focusDistance", 0);
  applied = useEditor.getState().project;
  assert.equal(shotBase(applied, applied.shots[0], "blur.focusDistance"), 0);
  assert.equal(shotBase(applied, applied.shots[1], "blur.focusDistance"), 0);
});

test("a lens template discards an unrelated manual focus distance and bokeh from the previous look", () => {
  const project = createProject();
  project.shots[0].media = screenshot;
  project.blur = { ...project.blur, mode: "depth", focusDistance: 24, bokeh: false, angle: 135 };
  start(project);
  applyTemplate("tablet-corner");
  pending.splice(0).forEach((fn) => fn());
  const applied = useEditor.getState().project;
  const defaults = createProject().blur;
  assert.equal(applied.blur.mode, "depth");
  assert.equal(applied.blur.focusDistance, 0);
  assert.equal(applied.blur.bokeh, defaults.bokeh);
  assert.equal(applied.blur.angle, defaults.angle);
  assert.equal(applied.blur.focusX, 0.32);
  assert.equal(applied.blur.focusY, 0.42);
});

test("all four studio looks reference available scenes and lighting", () => {
  assert.deepEqual(STUDIO_LOOKS.map((look) => look.id), ["softbox", "daylight", "midnight", "warm-paper"]);
  for (const look of STUDIO_LOOKS) {
    assert.ok(SCENES.some((scene) => scene.id === look.scene), `${look.id}: scene exists`);
    assert.ok(LIGHTINGS.some((lighting) => lighting.id === look.lighting), `${look.id}: lighting exists`);
    assert.match(look.color, /^#[\da-f]{6}$/i);
    const project = createProject();
    applyStudioLook(project, look);
    assert.equal(project.scene.preset, look.scene);
    assert.equal(project.scene.lighting, look.lighting);
    assert.equal(project.scene.background.color, look.color);
    assert.equal(project.mockup.reflection, look.reflection);
    assert.equal(project.mockup.gloss, look.gloss);
  }
});

test("studio looks preserve sources and composition while moving light animation relative to its previous base", () => {
  const project = createProject();
  project.scene.lightRotX = 15;
  project.scene.lightRotY = 350;
  project.scene.lightIntensity = 2;
  project.camera = { x: 50, y: -20, z: 15, fov: 40, zoom: 1.8, panX: 0.22, panY: -0.35 };
  project.blur = { ...project.blur, mode: "depth", focusDistance: 4.2, strength: 8, angle: 62 };
  project.mockup.rotZ = 35;
  project.screen.bg.image = screenshot;
  project.audio = { media: { ...screenshot, id: "music", kind: "audio" }, start: 1, trimStart: 0.3, volume: 0.5, fadeIn: 0.4, fadeOut: 0.8 };
  project.effects = [{ id: "grain", enabled: true, params: { amount: 0.1 } }];
  for (const [i, shot] of project.shots.entries()) {
    shot.media = { ...screenshot, id: `screen-${i}` };
    shot.scene = "concrete";
    shot.lighting = "cool";
    shot.device = "ipad-pro-13-glb";
    shot.finish = "silver";
    shot.blurMode = "radial";
    shot.bokeh = false;
    shot.pose = { "camera.zoom": 2.2, "mockup.rotX": 22, "mockup.lid": 65, "blur.focusDistance": 3, "blur.focusX": 0.8, "scene.lightRotX": 5, "scene.lightRotY": 365, "scene.lightIntensity": 1 };
    shot.keyframes = {
      "camera.panX": [{ t: 0, v: -0.3, ease: "easeIn" }, { t: 3, v: 0.4, ease: "smooth" }],
      "blur.strength": [{ t: 0, v: 3, ease: "linear" }, { t: 3, v: 8, ease: "smooth" }],
      "mockup.rotZ": [{ t: 0, v: 15, ease: "hold" }],
      "scene.lightRotX": [{ t: 0, v: 5, ease: "smooth", cp: [0.2, 0, 0.8, 1] }, { t: 3, v: 25, ease: "linear" }],
      "scene.lightRotY": [{ t: 0, v: 345, ease: "easeIn" }, { t: 3, v: 380, ease: "smooth" }],
      "scene.lightIntensity": [{ t: 0, v: 1, ease: "linear" }, { t: 3, v: 3, ease: "smooth" }],
    };
    for (const prop of ANIM_PROPS.filter((prop) => prop.startsWith("camera.") || prop.startsWith("blur."))) {
      shot.pose[prop] ??= 0.4;
      shot.keyframes[prop] ??= [{ t: 0, v: 0.4, ease: "linear" }, { t: 3, v: 0.8, ease: "smooth" }];
    }
  }
  for (const look of STUDIO_LOOKS) {
    const applied = structuredClone(project);
    applyStudioLook(applied, look);
    for (const key of ["camera", "blur", "screen", "audio", "effects"]) assert.deepEqual(applied[key], project[key], `${look.id}: ${key} preserved`);
    assert.deepEqual(omit(applied.mockup, ["reflection", "gloss"]), omit(project.mockup, ["reflection", "gloss"]), "device, finish and rotations stay in place");
    for (const [i, shot] of applied.shots.entries()) {
      assert.equal(shot.scene, undefined);
      assert.equal(shot.lighting, undefined);
      const before = project.shots[i];
      for (const [key, value] of Object.entries(before)) {
        if (!["scene", "lighting", "pose", "keyframes"].includes(key)) assert.deepEqual(shot[key], value, `${look.id}: shot ${key} preserved`);
      }
      for (const [prop, track] of Object.entries(before.keyframes)) {
        if (!prop.startsWith("scene.light")) { assert.deepEqual(shot.keyframes[prop], track); continue; }
        for (const [index, key] of track.entries()) {
          const actual = shot.keyframes[prop][index];
          assert.deepEqual(omit(actual, ["v"]), omit(key, ["v"]), "light timing and easing stay unchanged");
          if (prop === "scene.lightIntensity") assert.ok(Math.abs(actual.v / look.intensity - key.v / 2) < 1e-10, "relative exposure is preserved");
          else assert.equal(actual.v - applied.scene[prop.split(".")[1]], key.v - project.scene[prop.split(".")[1]], "rotation offset is preserved, including past 360°");
        }
      }
      for (const [prop, value] of Object.entries(before.pose)) {
        if (!prop.startsWith("scene.light")) assert.equal(shot.pose[prop], value);
      }
      assert.equal(shot.pose["scene.lightRotX"], -10);
      assert.equal(shot.pose["scene.lightRotY"], look.rotation + 15);
      assert.equal(shot.pose["scene.lightIntensity"], look.intensity / 2);
    }
  }
});

test("applying a studio look from an unlit scene keeps light values finite and nonnegative", () => {
  const project = createProject();
  project.scene.lightIntensity = 0;
  project.shots[0].keyframes["scene.lightIntensity"] = [{ t: 0, v: 0, ease: "linear" }, { t: 3, v: 0.3, ease: "smooth" }];
  applyStudioLook(project, STUDIO_LOOKS[0]);
  const values = project.shots[0].keyframes["scene.lightIntensity"].map((key) => key.v);
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
  assert.ok(Math.abs(values[1] - values[0] - 0.3) < 1e-10);
});

test("rapid studio look selections each undo in one step and restore the entire project", () => {
  const project = createProject();
  project.shots[0].media = screenshot;
  project.shots[0].scene = "concrete";
  project.shots[0].pose = { "camera.zoom": 2.5, "blur.focusDistance": 8 };
  start(project);
  const before = structuredClone(useEditor.getState().project);
  const choose = (look) => {
    beginInteraction();
    try { useEditor.getState().update((p) => applyStudioLook(p, look)); }
    finally { endInteraction(); }
  };
  choose(STUDIO_LOOKS[2]);
  assert.equal(useEditor.temporal.getState().pastStates.length, 1);
  const firstLook = structuredClone(useEditor.getState().project);
  choose(STUDIO_LOOKS[0]);
  assert.equal(useEditor.temporal.getState().pastStates.length, 2);
  undo();
  assert.deepEqual(useEditor.getState().project, firstLook);
  undo();
  assert.deepEqual(useEditor.getState().project, before);
});

const closeVector = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-5, `${message}: ${actual.toArray()} vs ${expected.toArray()}`);

test("screen plane follows baked tilt, nested nonuniform transforms and subsequent lid animation", () => {
  const baked = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.71, -0.36, 0.22));
  baked.setPosition(0.4, 0.8, -0.2);
  const geometry = new THREE.PlaneGeometry(2, 3, 3, 3).applyMatrix4(baked);
  const mesh = new THREE.Mesh(geometry);
  mesh.scale.set(1.7, 0.8, 1.2);
  mesh.rotation.set(-0.2, 0.5, 0.15);
  const lid = new THREE.Group();
  lid.rotation.set(0.6, 0.1, -0.25);
  lid.position.set(2, -1, 3);
  lid.add(mesh);
  const center = new THREE.Vector3(), normal = new THREE.Vector3();
  for (const lidAngle of [0.6, 1.2, -0.3]) {
    lid.rotation.x = lidAngle;
    lid.updateMatrixWorld(true);
    readScreenPlane(mesh, center, normal);
    const expectedCenter = new THREE.Vector3().applyMatrix4(baked).applyMatrix4(mesh.matrixWorld);
    const expectedNormal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(baked)).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
    closeVector(center, expectedCenter, "screen center");
    closeVector(normal, expectedNormal, "screen front normal");
  }
  geometry.dispose();
  mesh.material.dispose();
});

test("screen plane follows content orientation despite reversed winding and finds a tilted thin solid", () => {
  const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.8, 0.45, -0.22));
  for (const geometry of [new THREE.PlaneGeometry(3, 2).toNonIndexed(), new THREE.BoxGeometry(3, 2, 0.015)]) {
    geometry.applyMatrix4(tilt);
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld(true);
    const center = new THREE.Vector3(), normal = new THREE.Vector3();
    readScreenPlane(mesh, center, normal);
    const expected = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(tilt));
    closeVector(center, new THREE.Vector3(), "center of tilted screen");
    closeVector(normal, expected, "thin screen normal despite cancelling front/back faces");
    geometry.dispose();
    mesh.material.dispose();
  }
  const reversed = new THREE.PlaneGeometry(3, 2);
  const index = reversed.index;
  for (let i = 0; i < index.count; i += 3) {
    const second = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, second);
  }
  reversed.applyMatrix4(tilt);
  const mesh = new THREE.Mesh(reversed);
  mesh.updateMatrixWorld(true);
  const normal = new THREE.Vector3();
  readScreenPlane(mesh, new THREE.Vector3(), normal);
  closeVector(normal, new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(tilt)), "UV content front wins over reversed winding");
  // Without content coordinates, the triangle winding remains the available front-face signal.
  const noUv = reversed.clone();
  noUv.deleteAttribute("uv");
  const noUvMesh = new THREE.Mesh(noUv);
  noUvMesh.updateMatrixWorld(true);
  readScreenPlane(noUvMesh, new THREE.Vector3(), normal);
  closeVector(normal, new THREE.Vector3(0, 0, -1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(tilt)), "winding fallback without UVs");
  noUv.dispose();
  noUvMesh.material.dispose();
  reversed.dispose();
  mesh.material.dispose();
});

test("display discovery ignores a larger hidden model and non-screen materials", () => {
  const device = new THREE.Group();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 3), new THREE.MeshBasicMaterial());
  screen.material.reflection = 0.3;
  const staged = new THREE.Group();
  staged.visible = false;
  const hidden = new THREE.Mesh(new THREE.PlaneGeometry(20, 30), screen.material.clone());
  hidden.material.reflection = 0.3;
  staged.add(hidden);
  const body = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40));
  device.add(screen, staged, body);
  device.updateMatrixWorld(true);
  assert.equal(findDisplay(device), screen);
  screen.visible = false;
  assert.equal(findDisplay(device), null);
  device.traverse((object) => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
});

test("screen raster increases for export within GPU/memory bounds and restores preview without redundant allocation", (t) => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) } });
  t.after(() => { if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument); else delete globalThis.document; });
  const surface = new ScreenSurface();
  let redraws = 0;
  surface.draw = () => { redraws++; return false; };
  surface.setSize(1206, 2622);
  assert.equal(surface.height, 2560);
  assert.ok(Math.abs(surface.width / surface.height - 1206 / 2622) < 0.001);
  const preview = [surface.width, surface.height];
  surface.setSize(1206, 2622, 3840, true);
  assert.equal(surface.height, 3840);
  assert.ok(Math.abs(surface.width / surface.height - 1206 / 2622) < 0.001);
  const source = surface.texture.source, version = surface.texture.version, draws = redraws;
  surface.setSize(1206, 2622, 3840, true);
  assert.equal(surface.texture.source, source);
  assert.equal(surface.texture.version, version);
  assert.equal(redraws, draws);
  surface.setSize(3000, 3000, 7680, true);
  assert.ok(surface.width <= 4096 && surface.height <= 4096);
  assert.ok(surface.width * surface.height <= 12_000_000);
  surface.setSize(1206, 2622);
  assert.deepEqual([surface.width, surface.height], preview);
  surface.texture.dispose();
});
