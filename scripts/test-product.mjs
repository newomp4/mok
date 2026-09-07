import "./test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
const { createProject, normalizeProject, createLogoShot, createTextShot } = await import("../src/lib/defaults.ts");
const { resolveShotEffects, resolveScreenPadding, editShotEffects } = await import("../src/lib/shotView.ts");
const { screenContentRect, fitScreenMedia, mapScreenFocusArea } = await import("../src/lib/screenLayout.ts");
const { applyPastedMedia, canReplacePastedMedia } = await import("../src/lib/paste.ts");
const { useEditor, undo, beginInteraction, endInteraction } = await import("../src/store/editor.ts");
const { useUI } = await import("../src/store/ui.ts");
const { TEMPLATES } = await import("../src/lib/presets.ts");
const { mapFocusAreaToScreen, applyTemplate } = await import("../src/lib/actions.ts");
const { ScreenSurface } = await import("../src/three/screen.ts");
const { publishVideoFrame, clearVideoFrame } = await import("../src/lib/videoFrames.ts");
const effect = (amount = .4) => ({ id: "vignette", enabled: true, params: { amount } });
const ref = (id, kind = "image", duration) => ({ id, kind, name: `${id}.${kind === "video" ? "mp4" : "png"}`, width: 1000, height: 600, ...(duration ? { duration } : {}) });
function reset(p = createProject()) {
  useEditor.getState().replaceProject(p);
  useEditor.temporal.getState().clear();
  useUI.setState({ time: 0, activeShotId: p.shots[0]?.id, playing: false, recording: false });
  return useEditor.getState().project;
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("old projects inherit effects and zero padding; malformed overrides cannot poison rendering", () => {
  const p = createProject(); delete p.screen.padding; p.effects = [effect()];
  p.shots[0].effects = []; p.shots[0].screenPadding = 9;
  p.shots[1].effects = "invalid"; p.shots[1].screenPadding = NaN;
  p.scene.detailShadows = Infinity;
  const q = normalizeProject(p);
  assert.equal(q.screen.padding, 0);
  assert.equal(q.shots[0].screenPadding, .45);
  assert.deepEqual(resolveShotEffects(q, q.shots[0]), []);
  assert.equal(q.shots[1].effects, undefined);
  assert.equal(resolveShotEffects(q, q.shots[1]), q.effects);
  assert.equal(resolveScreenPadding(q, q.shots[1]), 0);
  assert.equal(q.scene.detailShadows, 0);
  p.shots[0].effects = [effect(), effect(.9), { id: "broken", params: {} }];
  assert.equal(normalizeProject(p).shots[0].effects.length, 1);
});

test("shot editing snapshots inherited effects and resetting resumes live project defaults", () => {
  const p = createProject(); p.effects = [effect()];
  editShotEffects(p, p.shots[0].id, (fx) => { fx[0].params.amount = .8; });
  assert.equal(p.effects[0].params.amount, .4);
  assert.equal(resolveShotEffects(p, p.shots[0])[0].params.amount, .8);
  editShotEffects(p, null, (fx) => { fx[0].params.amount = .2; });
  assert.equal(resolveShotEffects(p, p.shots[1])[0].params.amount, .2);
  assert.equal(resolveShotEffects(p, p.shots[0])[0].params.amount, .8);
  delete p.shots[0].effects;
  assert.equal(resolveShotEffects(p, p.shots[0]), p.effects);
});

test("per-shot effects and padding survive duplication, splitting, portable normalization and undo", () => {
  const p = createProject(); p.effects = [effect()]; p.screen.padding = .1;
  p.shots[0].effects = []; p.shots[0].screenPadding = .25;
  reset(p);
  useEditor.getState().duplicateShot(p.shots[0].id);
  let q = useEditor.getState().project;
  assert.deepEqual(q.shots[1].effects, []); assert.equal(q.shots[1].screenPadding, .25);
  assert.notEqual(q.shots[0].effects, q.shots[1].effects);
  useEditor.getState().splitShot(q.shots[0].id, 1);
  q = normalizeProject(JSON.parse(JSON.stringify(useEditor.getState().project)));
  assert.deepEqual(q.shots[1].effects, []); assert.equal(q.shots[1].screenPadding, .25);
  undo(); assert.equal(useEditor.getState().project.shots.length, 3);
});

test("templates reset stale shot effect and padding overrides", () => {
  const p = createProject(); p.shots[0].effects = [effect()]; p.shots[0].screenPadding = .3; p.screen.padding = .2;
  p.shots[0].media = ref("keep"); reset(p);
  const previous = globalThis.window; globalThis.window = { setTimeout: () => 0 };
  try { applyTemplate(TEMPLATES.find((t) => !t.sequence).id); } finally { globalThis.window = previous; }
  const q = useEditor.getState().project;
  assert.equal(q.screen.padding, 0);
  assert.ok(q.shots.every((s) => s.effects === undefined && s.screenPadding === undefined));
  assert.equal(q.shots[0].media.id, "keep");
});

test("screen inset is uniform below browser chrome and honors every fit mode", () => {
  const screen = { width: 1000, height: 650, chromeHeight: 50, padding: .1 };
  assert.deepEqual(screenContentRect(screen), { x: 60, y: 110, width: 880, height: 480 });
  const media = { width: 1000, height: 600 };
  const contain = fitScreenMedia(media, screen, "contain").draw;
  assert.deepEqual(contain, { x: 100, y: 110, width: 800, height: 480 });
  const cover = fitScreenMedia(media, screen, "cover").draw;
  assert.deepEqual(cover, { x: 60, y: 110, width: 880, height: 528 });
  assert.deepEqual(fitScreenMedia(media, screen, "stretch").draw, screenContentRect(screen));
  const tall = fitScreenMedia({ width: 100, height: 1000 }, screen, "cover").draw;
  assert.equal(tall.y, 110, "cover remains top-aligned");
});

test("Auto-motion clips focus regions to the padded media rectangle, including cropped and rotated sources", () => {
  const area = { id: "all", x: 0, y: 0, w: 1, h: 1 };
  for (const [width, height] of [[1206, 2622], [2622, 1206]]) for (const fit of ["cover", "contain", "stretch"]) {
    const screen = { width, height, padding: .2 };
    const media = { width: 1800, height: 1200 }; // already-cropped image dimensions
    const mapped = mapFocusAreaToScreen(area, media, screen, fit);
    assert.deepEqual(mapped, mapScreenFocusArea(area, media, screen, fit));
    const clip = screenContentRect(screen);
    assert.ok(mapped.x * width >= clip.x - 1e-8);
    assert.ok(mapped.y * height >= clip.y - 1e-8);
    assert.ok((mapped.x + mapped.w) * width <= clip.x + clip.width + 1e-8);
    assert.ok((mapped.y + mapped.h) * height <= clip.y + clip.height + 1e-8);
  }
  assert.equal(mapScreenFocusArea({ id: "bottom", x: 0, y: .9, w: 1, h: .1 }, { width: 100, height: 1000 }, { width: 1000, height: 600, padding: .1 }, "cover"), null);
  const mapped = mapScreenFocusArea(area, { width: 1000, height: 600 }, { width: 1000, height: 650, chromeHeight: 50, padding: .1 }, "contain");
  close(mapped.x, .1); close(mapped.y, 110 / 650); close(mapped.w, .8); close(mapped.h, 480 / 650);
});

test("paste replacement preserves timing and overrides; new shots get independent sources and a single audio lane", () => {
  const p = createProject(), target = p.shots[0]; target.media = ref("old", "video", 20);
  target.duration = 7; target.trimStart = 4; target.speed = 1.5; target.fit = "contain"; target.effects = [effect()]; target.screenPadding = .12;
  target.keyframes = { "camera.zoom": [{ t: 1, v: 2, ease: "linear" }] };
  const before = structuredClone(target);
  const first = applyPastedMedia(p, [ref("new", "video", 50), ref("second"), ref("song", "audio", 10)], "replace", target.id);
  assert.equal(first, target.id);
  assert.deepEqual({ ...target, media: before.media }, before);
  assert.equal(p.shots[1].media.id, "second"); assert.equal(p.shots[1].duration, 3);
  assert.notEqual(p.shots[1].effects, target.effects);
  assert.deepEqual(p.shots[1].keyframes, {});
  assert.equal(p.audio.media.id, "song");
  const empty = createProject(); empty.shots = [];
  const id = applyPastedMedia(empty, [ref("long", "video", 100)], "add", null);
  assert.equal(empty.shots[0].id, id); assert.equal(empty.shots[0].duration, 30);
});

test("paste handles text, logo, missing media and undo without implicit card replacement", () => {
  const p = createProject(); const text = createTextShot(), logo = createLogoShot(); p.shots = [text, logo];
  assert.equal(canReplacePastedMedia(text), false);
  assert.equal(canReplacePastedMedia(logo, [{ kind: "video" }]), false);
  applyPastedMedia(p, [ref("logo")], "replace", logo.id);
  assert.equal(logo.logo.media.id, "logo");
  applyPastedMedia(p, [ref("video", "video", 4)], "replace", text.id);
  assert.equal(text.kind, "text"); assert.equal(p.shots[1].media.id, "video");
  const source = createProject(); source.shots[0].media = ref("missing"); reset(source);
  beginInteraction(); try { useEditor.getState().update((q) => applyPastedMedia(q, [ref("replacement")], "replace", source.shots[0].id)); } finally { endInteraction(); }
  assert.equal(useEditor.getState().project.shots[0].media.id, "replacement");
  undo(); assert.equal(useEditor.getState().project.shots[0].media.id, "missing");
});

test("source audio is opt-in and splits preserve the original fade envelope across multiple cuts", () => {
  const p = createProject(); p.shots[0].duration = 8; p.shots[0].audio = { enabled: true, volume: .7, fadeIn: 5, fadeOut: 4 };
  reset(p); useEditor.getState().splitShot(p.shots[0].id, 2);
  let q = useEditor.getState().project;
  assert.deepEqual(q.shots[0].audio.envelope, { offset: 0, duration: 8 });
  assert.deepEqual(q.shots[1].audio.envelope, { offset: 2, duration: 8 });
  useEditor.getState().splitShot(q.shots[1].id, 2);
  q = normalizeProject(JSON.parse(JSON.stringify(useEditor.getState().project)));
  assert.equal(q.shots[0].audio.fadeIn, 5, "migration must not clamp the shared envelope to the shorter split");
  assert.deepEqual(q.shots[2].audio.envelope, { offset: 4, duration: 8 });
  assert.equal(normalizeProject(createProject()).shots[0].audio, undefined);
});

test("screen canvas uses decoded frame versions, restores DOM video and applies padding to both", () => {
  const savedDocument = globalThis.document;
  const draws = [], clips = [];
  const context = new Proxy({}, { get: (_, key) => key === "drawImage" ? (...args) => draws.push(args) : key === "rect" ? (...args) => clips.push(args) : key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : key === "getImageData" ? () => ({ data: new Uint8ClampedArray(128) }) : () => {}, set: () => true });
  globalThis.document = { createElement: () => ({ width: 1000, height: 600, getContext: () => context }) };
  const surface = new ScreenSurface();
  try {
    surface.width = 1000; surface.height = 600;
    const video = { currentTime: 0 };
    surface.setMedia({ kind: "video", ref: ref("video", "video", 2), width: 1000, height: 600, element: video }, "contain", { kind: "none" });
    surface.setPadding(.1);
    assert.equal(surface.draw(), false);
    const decoded = { width: 500, height: 300 };
    publishVideoFrame("video", decoded, 1000, 600);
    assert.equal(surface.draw(), true); assert.equal(draws.at(-1)[0], decoded);
    assert.deepEqual(clips.at(-1), [60, 60, 880, 480]);
    assert.deepEqual(draws.at(-1).slice(1), [100, 60, 800, 480]);
    assert.equal(surface.draw(), false);
    publishVideoFrame("video", decoded, 1000, 600); assert.equal(surface.draw(), true);
    clearVideoFrame(); assert.equal(surface.draw(), true); assert.equal(draws.at(-1)[0], video);
    surface.setQuarterTurn(-1);
    assert.equal(surface.contentWidth, 600); assert.equal(surface.contentHeight, 1000);
    assert.ok(clips.at(-1).every(Number.isFinite));
  } finally { clearVideoFrame(); surface.dispose(); globalThis.document = savedDocument; }
});

test("workflow tours and clipboard preferences never mutate the active project", () => {
  reset(); const before = structuredClone(useEditor.getState().project);
  for (const kind of ["editor", "timeline", "autoMotion"]) {
    useUI.getState().startTour(kind); useUI.getState().setTourStep(2); useUI.getState().setTourStep(null);
  }
  useUI.getState().setPasteMode("add"); useUI.getState().setCaptureShortcut(false);
  assert.deepEqual(useEditor.getState().project, before);
  useUI.getState().setPasteMode("ask"); useUI.getState().setCaptureShortcut(true);
});
