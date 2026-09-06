import "./test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { useEditor, currentShot, undo, redo } = await import("../src/store/editor.ts");
const { useUI } = await import("../src/store/ui.ts");
const { createProject } = await import("../src/lib/defaults.ts");
const { EASES, sampleTrack, reverseTrack, splitTrack, fadeAt, formatTime, shotBase, shotStart, totalDuration, setInHandle } = await import("../src/lib/animation.ts");
const { applyMotionPreset, applyTemplate, addShotFromCamera, composeAutoMotion, setShotMedia, mapFocusAreaToScreen, autoMotionMediaTime } = await import("../src/lib/actions.ts");
const { MOTION_PRESETS } = await import("../src/lib/presets.ts");
const { mediaType } = await import("../src/lib/media.ts");
const { getDevice } = await import("../src/lib/devices.ts");
const { resolveShotView } = await import("../src/lib/shotView.ts");
const { deviceOrientation, keyboardCaseAvailable, effectiveKeyboardCase, orientationQuarterTurn, orientedScreenPixels, orientedScreenMillimeters, orientedBounds, orientationFitSize } = await import("../src/lib/orientation.ts");
const { deviceLayout } = await import("../src/three/devices/layout.ts");
const { ScreenSurface } = await import("../src/three/screen.ts");
const { shouldPlayShotVideo } = await import("../src/three/Device.tsx");
const { applyKeyboardCase } = await import("../src/three/devices/GlbModel.tsx");
const { visibleBounds } = await import("../src/three/bounds.ts");
const THREE = await import("three");

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
    p.shots[0].media = media("auto-motion source");
    p.shots[0].duration = 0.8;
    p.shots[0].focusAreas = [{ id: "a", x: 0.1, y: 0.2, w: 0.3, h: 0.25 }];
    start(p);
    assert.equal(composeAutoMotion(p.shots[0].id), 1);
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

test("focus mapping matches centered contain, top-aligned cover, stretch, and browser chrome", () => {
  const area = (x, y, w, h) => ({ id: "region", x, y, w, h });
  const screen = { width: 100, height: 100 };
  assert.deepEqual(mapFocusAreaToScreen(area(0, 0, 1, 1), { width: 200, height: 100 }, screen, "contain"), area(0, 0.25, 1, 0.5));
  assert.deepEqual(mapFocusAreaToScreen(area(0, 0, 1, 1), { width: 100, height: 200 }, screen, "contain"), area(0.25, 0, 0.5, 1));
  assert.deepEqual(mapFocusAreaToScreen(area(0.25, 0, 0.5, 1), { width: 200, height: 100 }, screen, "cover"), area(0, 0, 1, 1));
  assert.equal(mapFocusAreaToScreen(area(0, 0, 0.2, 1), { width: 200, height: 100 }, screen, "cover"), null, "horizontally cropped regions are invisible");
  assert.deepEqual(mapFocusAreaToScreen(area(0, 0, 1, 0.25), { width: 100, height: 200 }, screen, "cover"), area(0, 0, 1, 0.5), "cover preserves the top of tall screenshots");
  assert.equal(mapFocusAreaToScreen(area(0, 0.6, 1, 0.3), { width: 100, height: 200 }, screen, "cover"), null, "the off-screen bottom is skipped");
  const stretched = mapFocusAreaToScreen(area(0.2, 0.3, 0.4, 0.5), { width: 200, height: 100 }, screen, "stretch");
  for (const [key, expected] of Object.entries({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 })) near(stretched[key], expected);
  const browser = mapFocusAreaToScreen(area(0, 0, 1, 1), { width: 100, height: 100 }, { width: 100, height: 105, chromeHeight: 5 }, "cover");
  near(browser.y, 5 / 105); near(browser.h, 100 / 105);
  assert.equal(mapFocusAreaToScreen(area(0, 0, 1, 1), { width: 0, height: 100 }, screen, "cover"), null);
});

test("auto-motion frames fitted content and leaves existing animation intact when every area is cropped", () => {
  const p = createProject();
  p.shots[0].media = { ...media("wide"), width: 4000, height: 1000 };
  p.shots[0].fit = "contain";
  p.shots[0].focusAreas = [{ id: "a", x: 0.4, y: 0.2, w: 0.2, h: 0.5 }];
  const spec = { width: 1206, height: 2622 };
  const fitted = mapFocusAreaToScreen(p.shots[0].focusAreas[0], p.shots[0].media, spec, "contain");
  start(p); assert.equal(composeAutoMotion(p.shots[0].id), 1);
  const containKeys = useEditor.getState().project.shots[0].keyframes;
  p.shots[0].fit = "stretch";
  p.shots[0].focusAreas = [fitted];
  start(p); assert.equal(composeAutoMotion(p.shots[0].id), 1);
  assert.deepEqual(useEditor.getState().project.shots[0].keyframes, containKeys, "equivalent screen regions produce the same framing");
  p.shots[0].fit = "cover";
  p.shots[0].focusAreas = [{ id: "hidden", x: 0, y: 0.2, w: 0.05, h: 0.2 }];
  p.shots[0].keyframes = containKeys;
  const before = start(p);
  assert.equal(composeAutoMotion(p.shots[0].id), 0);
  assert.equal(useEditor.getState().project, before, "an invisible target never destroys the existing camera move");
});

test("auto-motion video preview follows shot trim, speed, local playhead and source looping", () => {
  const shot = { duration: 4, trimStart: 1.25, speed: 2, media: { ...media("clip"), kind: "video", duration: 6 } };
  near(autoMotionMediaTime(shot, 0), 1.25);
  near(autoMotionMediaTime(shot, 1.5), 4.25);
  near(autoMotionMediaTime(shot, 3), 1.25);
  near(autoMotionMediaTime(shot, -10), 1.25);
  near(autoMotionMediaTime(shot, 10), 3.25);
  assert.equal(autoMotionMediaTime({ ...shot, media: null }, 1), 0);
});

test("orientation preserves native devices and resolves each shot's requested upright screen", () => {
  const phone = getDevice("iphone-17-pro-glb"), tablet = getDevice("ipad-pro-13-glb"), laptop = getDevice("macbook-pro-14-glb");
  assert.equal(deviceOrientation(phone), "portrait");
  assert.equal(deviceOrientation(tablet), "landscape", "legacy iPad projects retain their authored landscape layout");
  assert.equal(orientationQuarterTurn(phone, "landscape"), -1);
  assert.equal(orientationQuarterTurn(tablet, "portrait"), 1);
  assert.equal(orientationQuarterTurn(laptop, "portrait"), 0, "unsupported devices keep their authored shape");
  assert.deepEqual(orientedScreenPixels(phone, "landscape"), [phone.screenPx[1], phone.screenPx[0]]);
  assert.deepEqual(orientedScreenMillimeters(tablet, "portrait"), [tablet.screenMm[1], tablet.screenMm[0]]);
  const p = createProject();
  p.mockup.orientation = "landscape";
  p.shots[0].orientation = "portrait";
  assert.equal(resolveShotView(p, p.shots[0]).orientation, "portrait");
  assert.equal(resolveShotView(p, p.shots[1]).orientation, "landscape");
  start(p);
  const id = useEditor.getState().addShot("media", p.shots[0].id);
  assert.equal(useEditor.getState().project.shots.find((s) => s.id === id).orientation, "portrait");
});

test("orientation refits both axes and places the floor under asymmetric native bounds", () => {
  const b = { width: 2, height: 4, minX: -0.8, maxX: 1.2, minY: -2.1, maxY: 1.9 };
  assert.deepEqual(orientedBounds(b, -1), { width: 4, height: 2, floorY: -1.2 });
  assert.deepEqual(orientedBounds(b, 1), { width: 4, height: 2, floorY: -0.8 });
  assert.deepEqual(orientedBounds(b, 0), { width: 2, height: 4, floorY: -2.1 });
  for (const aspect of [9 / 16, 1, 16 / 9]) {
    const fit = orientationFitSize(4, 2, 4, -1, aspect);
    assert.ok(fit >= 2 && fit * aspect >= 4, "both physical axes fit the output viewport");
    const phone = getDevice("iphone-17-pro-glb");
    const portrait = deviceLayout(phone, null, "portrait", aspect), landscape = deviceLayout(phone, null, "landscape", aspect);
    assert.ok(landscape.height < portrait.height);
    assert.equal(landscape.quarterTurn, -1);
  }
});

test("tablet keyboard availability follows each shot without changing the saved case preference", () => {
  const p = createProject(), tablet = getDevice("ipad-pro-13-glb");
  p.mockup.device = tablet.id; p.mockup.orientation = "landscape"; p.mockup.caseKeyboard = true;
  p.shots[0].orientation = "portrait";
  assert.equal(keyboardCaseAvailable(tablet, "portrait"), false);
  assert.equal(keyboardCaseAvailable(tablet), true, "legacy projects retain the native attachment");
  assert.equal(effectiveKeyboardCase(tablet, resolveShotView(p, p.shots[0]).orientation, p.mockup.caseKeyboard), false);
  assert.equal(effectiveKeyboardCase(tablet, resolveShotView(p, p.shots[1]).orientation, p.mockup.caseKeyboard), true);
  start(p);
  useEditor.getState().update((draft) => { draft.shots[0].orientation = "landscape"; });
  const after = useEditor.getState().project;
  assert.equal(after.mockup.caseKeyboard, true);
  assert.equal(effectiveKeyboardCase(tablet, resolveShotView(after, after.shots[0]).orientation, after.mockup.caseKeyboard), true);
  assert.equal(effectiveKeyboardCase(tablet, "landscape", false), false, "an explicitly disabled attachment stays disabled");
  const portraitNativeTablet = { ...tablet, screenPx: [2064, 2752] };
  assert.equal(keyboardCaseAvailable(portraitNativeTablet, "portrait"), true);
  assert.equal(keyboardCaseAvailable(portraitNativeTablet, "landscape"), false, "availability comes from the authored model, not a hard-coded label");
});

test("hidden tablet attachments leave the display upright and disappear from bounds and reflection geometry", () => {
  const tablet = getDevice("ipad-pro-13-glb"), tilt = 0.3;
  const device = new THREE.Group(); device.name = "device";
  device.rotation.set(0.4, -0.2, 0.1); device.position.set(2, -1, 0.5);
  const orientation = new THREE.Group(); orientation.name = "device-orientation"; device.add(orientation);
  const root = new THREE.Group(), yaw = new THREE.Group(); yaw.name = "autoYaw"; root.add(yaw); orientation.add(root);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.1)); slab.rotation.x = -tilt; yaw.add(slab);
  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 5)); keyboard.position.set(0, -2, 2); yaw.add(keyboard);
  const measure = () => { orientation.updateWorldMatrix(true, true); return visibleBounds(root, orientation.matrixWorld.clone().invert(), new THREE.Box3(), true); };
  applyKeyboardCase(root, [keyboard], tilt, effectiveKeyboardCase(tablet, "landscape", true));
  const native = measure();
  assert.equal(keyboard.visible, true);
  orientation.rotation.z = Math.PI / 2;
  applyKeyboardCase(root, [keyboard], tilt, effectiveKeyboardCase(tablet, "portrait", true));
  const portrait = measure(), size = portrait.getSize(new THREE.Vector3());
  near(size.x, 4); near(size.y, 3); near(size.z, 0.1);
  near(portrait.getCenter(new THREE.Vector3()).length(), 0, "tablet stays centred under user and orientation transforms");
  assert.equal(keyboard.visible, false);
  const reflectedMeshes = []; device.traverseVisible((object) => { if (object.isMesh) reflectedMeshes.push(object); });
  assert.deepEqual(reflectedMeshes, [slab], "the reflection pass traverses only the display slab");
  const oriented = orientedBounds({ width: size.x, height: size.y, minX: portrait.min.x, maxX: portrait.max.x, minY: portrait.min.y, maxY: portrait.max.y }, 1);
  near(oriented.floorY, -2); near(oriented.height, 4);
  const sceneSize = Math.max(size.x, size.y) * 1.04;
  near(sceneSize, 4.16);
  assert.ok(sceneSize < Math.max(...native.getSize(new THREE.Vector3()).toArray()) * 1.04, "physical rig sizing excludes the hidden keyboard");
  const fit = orientationFitSize(oriented.width, oriented.height, sceneSize, 1, 9 / 16);
  assert.ok(fit >= oriented.height && fit * 9 / 16 >= oriented.width);
  orientation.rotation.z = 0;
  applyKeyboardCase(root, [keyboard], tilt, effectiveKeyboardCase(tablet, "landscape", true));
  const restored = measure();
  assert.equal(keyboard.visible, true);
  near(yaw.rotation.x, 0);
  near(restored.min.distanceTo(native.min), 0); near(restored.max.distanceTo(native.max), 0);
  slab.geometry.dispose(); keyboard.geometry.dispose(); slab.material.dispose(); keyboard.material.dispose();
});

test("auto-motion uses an overridden landscape screen's fitted pixels and physical axes", () => {
  const p = createProject(), shot = p.shots[0], phone = getDevice(p.mockup.device);
  shot.orientation = "landscape";
  shot.media = { ...media("landscape"), width: 1920, height: 1080 };
  shot.fit = "contain";
  shot.focusAreas = [{ id: "corner", x: 0.05, y: 0.1, w: 0.3, h: 0.3 }];
  start(p); useUI.getState().setViewport(1600, 900);
  assert.equal(composeAutoMotion(shot.id), 1);
  const keys = useEditor.getState().project.shots[0].keyframes;
  const [width, height] = orientedScreenPixels(phone, "landscape");
  const area = mapFocusAreaToScreen(shot.focusAreas[0], shot.media, { width, height }, "contain");
  const [mmW, mmH] = orientedScreenMillimeters(phone, "landscape");
  const layout = deviceLayout(phone, shot.media, "landscape", 16 / 9);
  const zoom = keys["camera.zoom"][0].v, viewH = layout.fitSize * 1.18;
  near(keys["camera.panX"][0].v, -(area.x + area.w/2 - 0.5) * mmW * 0.01 * zoom / viewH);
  near(keys["camera.panY"][0].v, -(0.5 - area.y - area.h/2) * mmH * 0.01 * zoom / viewH);
});

test("screen raster counter-rotation keeps every media corner upright for both orientation directions", () => {
  const oldDocument = globalThis.document;
  const canvases = [];
  globalThis.document = { createElement() {
    let matrix = [1, 0, 0, 1, 0, 0]; const stack = [], draws = [], texts = [];
    const multiply = (a, b, c, d, e, f) => { const [A, B, C, D, E, F] = matrix; matrix = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F]; };
    const ctx = new Proxy({
      save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
      translate(x, y) { multiply(1, 0, 0, 1, x, y); }, rotate(a) { multiply(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); }, scale(x, y) { multiply(x, 0, 0, y, 0, 0); },
      drawImage(...args) { draws.push({ args, matrix: [...matrix] }); }, fillText(...args) { texts.push({ args, font: this.font }); },
      createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; },
      getImageData() { return { data: new Uint8ClampedArray(128).fill(255) }; },
    }, { get(target, key) { return key in target ? target[key] : () => {}; } });
    const canvas = { width: 0, height: 0, getContext: () => ctx, draws, texts };
    canvases.push(canvas); return canvas;
  } };
  try {
    for (const [W, H, turn] of [[120, 260, -1], [260, 120, 1]]) {
      const surface = new ScreenSurface();
      surface.setSize(W, H);
      surface.setQuarterTurn(turn);
      const element = { source: true };
      surface.setMedia({ element, kind: "image", width: H, height: W }, "stretch", { kind: "none" });
      const draw = surface.canvas.draws.findLast((draw) => draw.args[0] === element);
      assert.equal(surface.contentWidth, H); assert.equal(surface.contentHeight, W);
      const [a, b, c, d, e, f] = draw.matrix;
      for (const [x, y] of [[0, 0], [H, 0], [0, W], [H, W]]) {
        const nx = a*x+c*y+e, ny = b*x+d*y+f;
        const wx = nx-W/2, wy = H/2-ny, angle = turn*Math.PI/2;
        near(wx*Math.cos(angle)-wy*Math.sin(angle), x-H/2, "upright screen horizontal coordinate");
        near(wx*Math.sin(angle)+wy*Math.cos(angle), W/2-y, "upright screen vertical coordinate");
      }
      surface.setMedia(null, "cover", { kind: "none" });
      surface.canvas.texts.length = 0;
      surface.setStatusBar(true);
      const status = surface.canvas.texts.find((text) => text.args[0] === "9:41");
      assert.ok(status, "empty-screen placeholder also respects the status bar toggle");
      assert.ok(Number(status.font.match(/(\d+)px/)[1]) <= Math.min(W, H) * 0.04 + 1, "status bar glyphs use the short edge in landscape");
      surface.dispose();
    }
  } finally { globalThis.document = oldDocument; }
});

test("templates discard old orientation overrides and old project length", () => {
  const p = createProject();
  p.duration = 50; p.mockup.orientation = "landscape"; p.shots[0].orientation = "portrait";
  start(p); applyTemplate("clean-demo");
  let after = useEditor.getState().project;
  assert.equal(after.mockup.orientation, undefined);
  assert.ok(after.shots.every((shot) => shot.orientation === undefined));
  assert.equal(after.duration, after.shots.reduce((sum, shot) => sum + (shot.gap ?? 0) + shot.duration, 0));
  useEditor.getState().update((p) => { p.shots[0].orientation = "landscape"; });
  applyTemplate("flat-look"); after = useEditor.getState().project;
  assert.ok(after.shots.every((shot) => shot.orientation === undefined));
});

test("video preview holds its frame inside timeline gaps and beyond the last shot", () => {
  const p = createProject();
  p.shots[0].gap = 1; p.shots[0].duration = 2;
  p.shots[1].gap = 2; p.shots[1].duration = 3;
  p.duration = 12;
  for (const time of [0, 0.5, 3, 4.9, 8, 11.9, 12]) assert.equal(shouldPlayShotVideo(p, time, true), false, `source pauses at held frame ${time}`);
  for (const time of [1, 2.9, 5, 7.9]) assert.equal(shouldPlayShotVideo(p, time, true), true, `source plays within shot at ${time}`);
  assert.equal(shouldPlayShotVideo(p, 2, false), false);
  assert.equal(shouldPlayShotVideo(p, 2, true, true), false, "export owns deterministic seeking");
});
