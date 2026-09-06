import "./test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
const { useEditor, undo } = await import("../src/store/editor.ts");
const { useUI } = await import("../src/store/ui.ts");
const { createProject, normalizeProject } = await import("../src/lib/defaults.ts");
const { contentDuration, totalDuration, editableDuration, parseDuration, timelineTickStep, MAX_PROJECT_DURATION, locate, fadeAt } = await import("../src/lib/animation.ts");
const { enterExitAt } = await import("../src/three/CardLayer.tsx");
const { installScreenGrid } = await import("../src/three/screenGrid.ts");
globalThis.window = { setTimeout: () => 0 };
function start(p = createProject()) {
  useEditor.getState().replaceProject(p);
  useEditor.temporal.getState().clear();
  useUI.setState({ time: 0, playing: false, recording: false, activeShotId: p.shots[0].id });
  return useEditor.getState().project;
}

test("project length migrates old files, rejects invalid values and preserves a shorter explicit endpoint", () => {
  const p = createProject(); p.shots[0].gap = 2;
  assert.equal(normalizeProject(p).duration, 8);
  p.duration = 2;
  assert.equal(totalDuration(normalizeProject(p)), 2);
  p.duration = NaN;
  assert.equal(totalDuration(normalizeProject(p)), 8);
  for (const [text, expected] of [["1:02.5", 62.5], ["2.75", 2.75], ["3:00", 180], ["3:00.001", null], ["24:00", null], ["0:60", null], ["2:", null], ["1e2", null], ["-1", null], ["0", null], ["Infinity", null], ["1440:00", null]]) assert.equal(parseDuration(text), expected, text);
});

test("long legacy content remains editable with a bounded endpoint and ruler", () => {
  const p = createProject(); p.shots[0].duration = 86400;
  const migrated = normalizeProject(p);
  assert.equal(migrated.duration, MAX_PROJECT_DURATION);
  assert.equal(migrated.shots[0].duration, 86400, "migration must retain the original clip and its editable timing");
  p.duration = 86400;
  assert.equal(normalizeProject(p).duration, MAX_PROJECT_DURATION);
  for (const pps of [38.4, 96, 768]) {
    const end = contentDuration(migrated) + 2;
    const step = timelineTickStep(end, pps);
    assert.ok(Math.floor(end / step) + 1 <= 2000, "the tick count must stay bounded at every zoom");
  }
  assert.equal(timelineTickStep(14, 96), 0.5, "normal short projects retain useful half-second ticks");
  const current = start();
  useEditor.getState().updateShot(current.shots[0].id, (s) => { s.duration = 300; });
  assert.equal(totalDuration(useEditor.getState().project), MAX_PROJECT_DURATION, "automatic extension must respect the same resource limit");
});

test("trimming, deletion, extension and undo keep a predictable project endpoint", () => {
  const p = start();
  useEditor.getState().updateShot(p.shots[1].id, (s) => { s.duration = 1; });
  assert.equal(contentDuration(useEditor.getState().project), 4);
  assert.equal(totalDuration(useEditor.getState().project), 6);
  useEditor.getState().removeShot(p.shots[1].id);
  assert.equal(totalDuration(useEditor.getState().project), 6);
  useEditor.getState().updateShot(p.shots[0].id, (s) => { s.duration = 8; });
  assert.equal(totalDuration(useEditor.getState().project), 8);
  useEditor.getState().duplicateShot(p.shots[0].id);
  assert.equal(totalDuration(useEditor.getState().project), 16);
  undo();
  assert.equal(totalDuration(useEditor.getState().project), 8);
});

test("lengthening holds the final frame and project fade uses the export endpoint", () => {
  const p = start();
  useEditor.getState().update((d) => { d.duration = 10; d.fade = { in: 0, out: 2, color: "#000000" }; });
  const longer = useEditor.getState().project;
  assert.equal(locate(longer, 9).shot.id, p.shots[1].id);
  assert.equal(locate(longer, 9).localT, 3);
  assert.equal(fadeAt(longer, 9).alpha, 0.5);
  useEditor.getState().update((d) => { d.duration = 2; });
  useEditor.getState().update((d) => { d.camera.zoom = 2; });
  assert.equal(totalDuration(useEditor.getState().project), 2, "an unrelated edit must not extend an explicit trim");
  assert.equal(contentDuration(useEditor.getState().project), 6, "the later clips are retained");
});

test("blur transitions use an actual blur radius and settle to sharp content without scaling", () => {
  const shot = { ...createProject().shots[0], enter: { effect: "blur", duration: 1 }, exit: { effect: "blur", duration: 1 } };
  assert.ok(enterExitAt(shot, 0.2).blur > enterExitAt(shot, 0.8).blur);
  assert.equal(enterExitAt(shot, 1.5).blur, 0);
  assert.ok(enterExitAt(shot, 2.9).blur > 0);
  assert.equal(enterExitAt(shot, 0.5).scale, 1);
});

test("screen grid preserves upstream reflection hooks and exposes live uniforms without recompilation", () => {
  const mat = new THREE.MeshPhysicalMaterial();
  mat.onBeforeCompile = (shader) => { shader.uniforms.prior = { value: 1 }; };
  mat.customProgramCacheKey = () => "reflection-and-gain";
  const grid = installScreenGrid(mat);
  const shader = { uniforms: {}, vertexShader: "", fragmentShader: "#include <emissivemap_fragment>" };
  mat.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.prior.value, 1);
  grid.strength.value = 0.75;
  assert.equal(shader.uniforms.mokGridStrength.value, 0.75);
  assert.match(mat.customProgramCacheKey(), /^reflection-and-gain\|/);
  assert.match(shader.fragmentShader, /fwidth\(grid\)/);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \*=/);
  mat.dispose();
});

test("retained clips remain inspectable past the export endpoint without a permanent fade overlay", () => {
  const p = createProject(); p.duration = 2; p.fade = { in: 0, out: 1, color: "#000000" };
  assert.equal(totalDuration(p), 2);
  assert.equal(editableDuration(p), 6);
  assert.equal(locate(p, 3.1).shot.id, p.shots[1].id);
  assert.equal(fadeAt(p, 2).alpha, 1);
  assert.equal(fadeAt(p, 3.1).alpha, 0);
});
