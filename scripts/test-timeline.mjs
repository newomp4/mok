import "./test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { useEditor, currentShot, undo, redo } = await import("../src/store/editor.ts");
const { useUI } = await import("../src/store/ui.ts");
const { createProject } = await import("../src/lib/defaults.ts");
const { EASES, sampleTrack, reverseTrack, splitTrack, fadeAt, formatTime, shotBase, shotStart, totalDuration, setInHandle } = await import("../src/lib/animation.ts");
const { applyMotionPreset, applyTemplate, addShotFromCamera, composeAutoMotion, setShotMedia } = await import("../src/lib/actions.ts");
const { MOTION_PRESETS } = await import("../src/lib/presets.ts");
const { mediaType } = await import("../src/lib/media.ts");

globalThis.window = { setTimeout: () => 0 };
const media = (id) => ({ id, kind: "image", width: 1206, height: 2622, name: `${id}.png` });
const near = (a, b, label = "same sampled value") => assert.ok(Math.abs(a - b) < 0.0002, `${label}: ${a} vs ${b}`);
function start(project = createProject(), index = 0, localT = 0) {
  useEditor.getState().replaceProject(project);
  const p = useEditor.getState().project;
  useUI.setState({ time: shotStart(p, p.shots[index].id) + localT, activeShotId: p.shots[index].id, playing: false, recording: false, timelineMode: "advanced", selectedKeys: [], selectedShots: [] });
  useEditor.temporal.getState().clear();
  return useEditor.getState().project;
}

test("reversing every named ease preserves the exact backwards motion, including steps and overshoot", () => {
  for (const { id } of EASES) {
    const source = [{ t: 0, v: -2, ease: id }, { t: 3, v: 6, ease: "smooth" }];
    const reversed = reverseTrack(source, 3);
    const twice = reverseTrack(reversed, 3);
    for (let i = 0; i <= 120; i++) {
      const t = i / 40;
      near(sampleTrack(reversed, t), sampleTrack(source, 3 - t), `${id} reversed at ${t}`);
      near(sampleTrack(twice, t), sampleTrack(source, t), `${id} twice at ${t}`);
    }
  }
});

test("custom incoming and outgoing easing survives reversing", () => {
  const source = [{ t: -0.2, v: 0, ease: "linear", cp: [0.2, -0.1, 0.8, 1.2] }, { t: 2.7, v: 4, ease: "smooth" }];
  setInHandle(source[1], [0.6, 1.1]);
  const reversed = reverseTrack(source, 2.5);
  for (let i = 0; i <= 100; i++) near(sampleTrack(reversed, i / 40), sampleTrack(source, 2.5 - i / 40));
});

test("splitting all named eases and custom overshooting curves preserves every frame across the cut", () => {
  for (const { id } of EASES) {
    for (const custom of [false, true]) {
      const source = [{ t: 0, v: -1, ease: id }, { t: 3, v: 5, ease: "smooth" }, { t: 4, v: 2, ease: "linear" }];
      if (custom) { source[0].cp = [0.24, -0.15, 0.5, 1.3]; setInHandle(source[1], [0.76, 1.2]); }
      const before = structuredClone(source);
      const [left, right] = splitTrack(source, 1.27);
      for (let i = 0; i <= 160; i++) {
        const t = i / 40;
        near(t <= 1.27 ? sampleTrack(left, t) : sampleTrack(right, t - 1.27), sampleTrack(source, t), `${id}/${custom} split at ${t}`);
      }
      left[0].v = 100;
      assert.deepEqual(source, before, "split output does not alias original keys");
    }
  }
});

test("splitting on an existing key or outside a track preserves held values", () => {
  const source = [{ t: 1, v: 2, ease: "easeOut" }, { t: 2, v: 4, ease: "linear" }];
  for (const cut of [0.2, 1, 2, 3]) {
    const [a, b] = splitTrack(source, cut);
    for (const t of [0, 0.5, 1, 1.5, 2, 3, 4]) near(t < cut ? sampleTrack(a, t) : sampleTrack(b, t - cut), sampleTrack(source, t));
  }
});

test("transition fades occur at the real cut after timeline gaps", () => {
  const p = createProject();
  p.shots[0].gap = 2;
  p.shots[0].duration = 3;
  p.shots[0].transitionOut = { type: "fade", duration: 1, color: "#abcdef" };
  p.shots[1].gap = 4;
  assert.equal(shotStart(p, p.shots[1].id), 9);
  assert.deepEqual(fadeAt(p, 9), { alpha: 1, color: "#abcdef" });
  assert.equal(fadeAt(p, 3).alpha, 0);
  assert.equal(fadeAt(p, 8.75).alpha, 0.5);
  assert.equal(formatTime(59.999), "01:00.00");
});

test("keyframe stamping and toggling capture the edited shot's pose", () => {
  const p = createProject();
  p.shots[1].pose = { "camera.zoom": 3.4, "blur.focusDistance": 8 };
  start(p, 1, 0.5);
  useEditor.getState().toggleKeyframe("camera.zoom");
  useEditor.getState().stampKeyframes(["blur.focusDistance"]);
  const shot = useEditor.getState().project.shots[1];
  assert.equal(shot.keyframes["camera.zoom"][0].v, 3.4);
  assert.equal(shot.keyframes["blur.focusDistance"][0].v, 8);
});

test("recording a new track never changes another shot's unanimated base", () => {
  const p = start();
  const baseline = p.camera.zoom;
  useUI.setState({ recording: true });
  useEditor.getState().setValue("camera.zoom", 4);
  const after = useEditor.getState().project;
  assert.equal(after.camera.zoom, baseline);
  assert.equal(shotBase(after, after.shots[1], "camera.zoom"), baseline);
  assert.equal(after.shots[0].keyframes["camera.zoom"][0].v, 4);
});

test("Use for all shots applies the visible animated pose and clears conflicting target tracks", () => {
  const p = createProject();
  p.shots[0].keyframes["camera.zoom"] = [{ t: 0, v: 1, ease: "linear" }, { t: 3, v: 4, ease: "linear" }];
  p.shots[1].keyframes["camera.zoom"] = [{ t: 0, v: 8, ease: "smooth" }];
  start(p, 0, 1.5);
  useEditor.getState().applyPoseToAllShots(["camera.zoom"]);
  const after = useEditor.getState().project;
  assert.equal(shotBase(after, after.shots[1], "camera.zoom"), 2.5);
  assert.equal(after.shots[1].keyframes["camera.zoom"], undefined);
  assert.equal(after.shots[0].keyframes["camera.zoom"].length, 2);
});

test("inserting a shot inherits its preceding source/look and samples the actual closing frame", () => {
  const p = createProject();
  p.shots[0].media = media("first");
  p.shots[1].media = media("last");
  p.shots[0].device = "ipad-pro-13-glb";
  p.shots[0].scene = "concrete";
  p.shots[0].keyframes["camera.zoom"] = [{ t: 0, v: 1, ease: "linear" }, { t: 6, v: 5, ease: "linear" }];
  const before = start(p);
  const id = useEditor.getState().addShot("media", before.shots[0].id);
  const after = useEditor.getState().project;
  const shot = after.shots.find((s) => s.id === id);
  assert.equal(shot.media.id, "first");
  assert.equal(shot.device, "ipad-pro-13-glb");
  assert.equal(shot.scene, "concrete");
  assert.equal(shotBase(after, shot, "camera.zoom"), 3);
  assert.equal(currentShot(after).shot.id, id);
});

test("duplicate and paste select their new shots so the next camera edit targets the visible copy", () => {
  let p = start();
  useEditor.getState().duplicateShot(p.shots[0].id);
  p = useEditor.getState().project;
  assert.equal(currentShot(p).shot.id, p.shots[1].id);
  assert.equal(useUI.getState().activeShotId, p.shots[1].id);
  useEditor.getState().copyShot(p.shots[1].id);
  useEditor.getState().pasteShot(p.shots[1].id);
  p = useEditor.getState().project;
  assert.equal(currentShot(p).shot.id, p.shots[2].id);
  useEditor.getState().setValue("camera.zoom", 2.8);
  assert.equal(useEditor.getState().project.shots[2].pose["camera.zoom"], 2.8);
});

test("splitting video preserves speed, trim, gap, duration, motion, and hands the transition to the second half", () => {
  const p = createProject();
  const shot = p.shots[0];
  shot.media = { ...media("video"), kind: "video", duration: 20 };
  shot.duration = 4;
  shot.trimStart = 1.5;
  shot.speed = 2;
  shot.gap = 0.7;
  shot.transitionOut = { type: "fade", duration: 0.6, color: "#000000" };
  shot.keyframes["camera.x"] = [{ t: 0, v: -30, ease: "easeIn" }, { t: 4, v: 20, ease: "linear" }];
  const before = start(p);
  const original = structuredClone(before.shots[0]);
  const duration = totalDuration(before);
  useEditor.getState().splitShot(original.id, 1.2);
  const after = useEditor.getState().project;
  const [a, b] = after.shots;
  near(totalDuration(after), duration);
  assert.equal(a.gap, 0.7);
  assert.equal(b.gap, undefined);
  near(b.trimStart, 3.9);
  assert.equal(b.speed, 2);
  assert.equal(a.transitionOut, undefined);
  assert.deepEqual(b.transitionOut, original.transitionOut);
  assert.equal(currentShot(after).shot.id, b.id);
  for (let i = 0; i <= 160; i++) {
    const t = i / 40;
    near(t < 1.2 ? sampleTrack(a.keyframes["camera.x"], t) : sampleTrack(b.keyframes["camera.x"], t - 1.2), sampleTrack(original.keyframes["camera.x"], t));
  }
});

test("reordering and removing earlier shots keep the same shot under the playhead", () => {
  const p = start(createProject(), 1, 1.4);
  const viewed = p.shots[1].id;
  useEditor.getState().reorderShot(viewed, 0);
  let loc = currentShot(useEditor.getState().project);
  assert.equal(loc.shot.id, viewed);
  near(loc.localT, 1.4);
  useEditor.getState().addShot("media");
  const after = useEditor.getState().project;
  const appended = after.shots[2].id;
  useUI.setState({ activeShotId: appended, time: shotStart(after, appended) + 0.6 });
  useEditor.getState().removeShot(viewed);
  loc = currentShot(useEditor.getState().project);
  assert.equal(loc.shot.id, appended);
  near(loc.localT, 0.6);
});

test("rapid discrete commands each undo in one step and leave no stale selection", () => {
  const p = start();
  const before = structuredClone(p);
  useEditor.getState().duplicateShot(p.shots[0].id);
  const copy = useEditor.getState().project.shots[1].id;
  useEditor.getState().splitShot(copy, 1);
  assert.equal(useEditor.temporal.getState().pastStates.length, 2);
  undo();
  assert.equal(useEditor.getState().project.shots.length, 3);
  assert.ok(useEditor.getState().project.shots.some((s) => s.id === useUI.getState().activeShotId));
  undo();
  assert.deepEqual(useEditor.getState().project, before);
  assert.ok(useUI.getState().selectedShots.every((id) => before.shots.some((s) => s.id === id)));
  redo();
  assert.equal(useEditor.getState().project.shots.length, 3);
});

test("motion presets use the selected shot's own framing and preserve a longer duration", () => {
  const p = createProject();
  p.shots[1].duration = 8;
  p.shots[1].pose = { "camera.x": 65, "camera.zoom": 2.2, "mockup.rotY": 25 };
  const before = start(p, 1);
  const preset = MOTION_PRESETS.find((m) => m.id === "drift");
  const expected = preset.build(8, { ...before.camera, x: 65, zoom: 2.2 }, { x: before.mockup.rotX, y: 25, z: before.mockup.rotZ });
  applyMotionPreset(preset.id, before.shots[1].id);
  const after = useEditor.getState().project;
  assert.equal(after.shots[1].duration, 8);
  for (const [prop, track] of Object.entries(expected)) assert.deepEqual(after.shots[1].keyframes[prop], track);
  assert.equal(useEditor.temporal.getState().pastStates.length, 1);
});

test("shot from camera uses the last shot's held pose and is one undo step", () => {
  const p = createProject();
  p.shots[1].pose = { "camera.zoom": 3.1, "camera.panX": 0.3 };
  const before = start(p);
  const id = addShotFromCamera();
  const after = useEditor.getState().project;
  const added = after.shots.find((s) => s.id === id);
  assert.equal(added.keyframes["camera.zoom"][0].v, 3.1);
  assert.equal(added.keyframes["camera.panX"][0].v, 0.3);
  assert.equal(useEditor.temporal.getState().pastStates.length, 1);
  undo();
  assert.deepEqual(useEditor.getState().project, before);
});

test("templates with animation apply as one undo step", () => {
  const p = createProject();
  p.shots[0].media = media("existing");
  const before = start(p);
  applyTemplate("iphone-hero");
  assert.equal(useEditor.temporal.getState().pastStates.length, 1);
  undo();
  assert.deepEqual(useEditor.getState().project, before);
});

test("auto-motion respects the shot's overridden device and its short duration", () => {
  const build = (projectDevice) => {
    const p = createProject();
    p.mockup.device = projectDevice;
    p.shots[0].device = "ipad-pro-13-glb";
    p.shots[0].duration = 0.8;
    p.shots[0].focusAreas = [{ id: "a", x: 0.1, y: 0.2, w: 0.3, h: 0.25 }];
    start(p);
    composeAutoMotion(p.shots[0].id);
    return useEditor.getState().project.shots[0].keyframes;
  };
  const first = build("iphone-17-pro-glb");
  assert.deepEqual(first, build("ipad-pro-13-glb"));
  assert.ok(Object.values(first).flat().every((key) => key.t <= 0.8));
});

test("pasting over a key replaces its named easing as well as its value", () => {
  const p = createProject();
  p.shots[0].keyframes["camera.zoom"] = [{ t: 0, v: 2, ease: "easeIn" }, { t: 1, v: 3, ease: "hold" }];
  start(p);
  useEditor.getState().copyKeyframes([{ shotId: p.shots[0].id, prop: "camera.zoom", t: 0 }]);
  useUI.getState().setTime(1);
  useEditor.getState().pasteKeyframes();
  assert.equal(useEditor.getState().project.shots[0].keyframes["camera.zoom"][1].ease, "easeIn");
});

test("invalid targets and non-finite timeline edits are no-ops", () => {
  const p = start();
  useEditor.getState().removeShot("missing");
  useEditor.getState().splitShot(p.shots[0].id, NaN);
  useEditor.getState().setShotGap(p.shots[0].id, Infinity);
  useEditor.getState().setValue("camera.zoom", Infinity);
  setShotMedia("removed-shot", media("replacement"));
  assert.equal(useEditor.getState().project, p);
  assert.equal(useEditor.temporal.getState().pastStates.length, 0);
});

test("a remaining single shot can still edit the pose it inherited while the project had multiple shots", () => {
  const p = createProject();
  p.shots[0].pose = { "camera.zoom": 2.5, "blur.focusDistance": 8 };
  start(p);
  useEditor.getState().removeShot(p.shots[1].id);
  useEditor.getState().setValues({ "camera.zoom": 3.5, "blur.focusDistance": 5 });
  const after = useEditor.getState().project;
  assert.equal(shotBase(after, after.shots[0], "camera.zoom"), 3.5);
  assert.equal(shotBase(after, after.shots[0], "blur.focusDistance"), 5);
});

test("recording and playback remain mutually exclusive through the shared UI actions", () => {
  start();
  const ui = useUI.getState();
  ui.setPlaying(true);
  assert.equal(useUI.getState().playing, true);
  ui.setRecording(true);
  assert.equal(useUI.getState().recording, true);
  assert.equal(useUI.getState().playing, false, "starting a recording stops playback");
  ui.setPlaying(true);
  assert.equal(useUI.getState().playing, false, "keyboard and toolbar cannot play while recording");
  ui.setRecording(false);
  assert.equal(useUI.getState().playing, false, "ending a recording does not unexpectedly resume playback");
  ui.setPlaying(true);
  assert.equal(useUI.getState().playing, true);
  ui.setPlaying(false);
});

test("UI time and rendering preferences stay finite and within usable bounds", () => {
  const ui = useUI.getState();
  for (const [set, key, min, max, fallback] of [
    [ui.setTime, "time", 0, Number.MAX_SAFE_INTEGER, 0],
    [ui.setDpr, "dpr", 1, 3, 2],
    [ui.setTimelineHeight, "timelineHeight", 100, 500, 216],
    [ui.setTimelineZoom, "timelineZoom", 0.25, 8, 1],
  ]) {
    set(-1000); assert.equal(useUI.getState()[key], min, `${key} clamps its lower bound`);
    set(Number.MAX_VALUE); assert.equal(useUI.getState()[key], max, `${key} clamps its upper bound`);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      set(invalid); assert.equal(useUI.getState()[key], fallback, `${key} rejects ${invalid}`);
    }
  }
});

test("audio without browser MIME metadata is recognized and cannot replace a screen", () => {
  for (const name of ["sound.MP3", "sound.wav", "sound.m4a"]) {
    assert.ok(mediaType(new File(["audio"], name)).startsWith("audio/"), `${name} is routed using its extension`);
  }
  const p = start();
  setShotMedia(p.shots[0].id, { id: "audio", kind: "audio", name: "sound.mp3", width: 0, height: 0, duration: 2 });
  assert.equal(useEditor.getState().project, p, "screen assignment rejects audio even when called directly");
});

test("new text and logo shots preview after their entrance while media insertion stays at its first frame", () => {
  for (const kind of ["text", "logo", "media"]) {
    const p = start();
    const id = useEditor.getState().addShot(kind, p.shots[0].id);
    const after = useEditor.getState().project;
    const shot = after.shots.find((s) => s.id === id);
    const localT = useUI.getState().time - shotStart(after, id);
    assert.equal(currentShot(after).shot?.id, id, "the newly inserted shot remains the editing target");
    if (kind === "media") assert.equal(localT, 0, "media still opens at its first frame");
    else {
      assert.ok(localT > shot.enter.duration, `${kind} is past its transparent entrance`);
      assert.ok(localT < shot.duration - shot.exit.duration, `${kind} is before its exit fade`);
      useEditor.getState().updateShot(id, (s) => { s.name = "Editing the visible card"; });
      near(useUI.getState().time - shotStart(useEditor.getState().project, id), localT, "editing retains the visible preview position");
    }
  }
});
