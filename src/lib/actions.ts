"use client";
import { useEditor, beginInteraction, endInteraction, isShotScoped } from "@/store/editor";
import { useUI, type PasteRequest } from "@/store/ui";
import { CAMERA_PRESETS, MOTION_PRESETS, TEMPLATES, getScene } from "./presets";
import { ANIM_LABELS, type AnimProp, type FitMode, type FocusArea, type Keyframe, type MediaRef, type Project, type Shot } from "./types";
import { deleteMedia, importMedia, mediaType } from "./media";
import { getDevice } from "./devices";
import { getSampleScreen, sampleScreenBlob } from "./screens";
import { contentDuration, locate, MAX_PROJECT_DURATION, sampleTrack, shotBase, shotStart } from "./animation";
import { resolveScreenPadding, resolveShotView } from "./shotView";
import { orientedScreenMillimeters, orientedScreenPixels } from "./orientation";
import { createLogoShot, createProject, createShot, createTextShot, shotKind } from "./defaults";
import { deviceLayout } from "@/three/devices/layout";
import { S } from "@/three/geometry";
import { applyPastedMedia, type PasteMode } from "./paste";
import { mapScreenFocusArea, type ScreenBounds } from "./screenLayout";
import { canEditProject } from "./projectOwnership";
import { captureEditIntent } from "./editIntent";

export function applyCameraPreset(id: string) {
  const p = CAMERA_PRESETS.find((c) => c.id === id);
  if (!p) return;
  const values: Partial<Record<AnimProp, number>> = {
    "camera.x": p.camera.x, "camera.y": p.camera.y, "camera.z": p.camera.z, "camera.fov": p.camera.fov,
    "camera.zoom": p.camera.zoom, "camera.panX": p.camera.panX, "camera.panY": p.camera.panY,
  };
  if (p.rot) { values["mockup.rotX"] = p.rot.x; values["mockup.rotY"] = p.rot.y; values["mockup.rotZ"] = p.rot.z; }
  useEditor.getState().setValues(values);
}

export function resetCamera() {
  useEditor.getState().update((p) => {
    p.camera = { ...createProject().camera };
    p.mockup.rotX = 0; p.mockup.rotY = 0; p.mockup.rotZ = 0;
    const isCamera = (k: AnimProp) => k.startsWith("camera.") || k === "mockup.rotX" || k === "mockup.rotY" || k === "mockup.rotZ";
    for (const s of p.shots) {
      for (const k of Object.keys(s.keyframes) as AnimProp[]) if (isCamera(k)) delete s.keyframes[k];
      // a shot holding its own framing would otherwise survive the reset and keep the old pose
      if (s.pose) {
        for (const k of Object.keys(s.pose) as AnimProp[]) if (isCamera(k)) delete s.pose[k];
        if (!Object.keys(s.pose).length) delete s.pose;
      }
    }
  });
}

export function resetBlur() {
  useEditor.getState().update((p) => {
    p.blur = { mode: "off", strength: 10, focusSize: 0.52, falloff: 0, bokeh: true, focusX: 0.5, focusY: 0.5, focusDistance: 0 };
    for (const s of p.shots) {
      for (const k of Object.keys(s.keyframes) as AnimProp[]) if (k.startsWith("blur.")) delete s.keyframes[k];
      // the same for a lens a shot holds on its own, plus the mode and bokeh it may have overridden
      if (s.pose) {
        for (const k of Object.keys(s.pose) as AnimProp[]) if (k.startsWith("blur.")) delete s.pose[k];
        if (!Object.keys(s.pose).length) delete s.pose;
      }
      delete s.blurMode;
      delete s.bokeh;
    }
  });
}

export function applyMotionPreset(id: string, shotId?: string) {
  const m = MOTION_PRESETS.find((x) => x.id === id);
  if (!m) return;
  const ed = useEditor.getState();
  const targetId = shotId ?? useUI.getState().activeShotId ?? ed.project.shots[0]?.id;
  const target = ed.project.shots.find((s) => s.id === targetId);
  if (!target || shotKind(target) !== "media") return;
  beginInteraction();
  try { ed.update((p) => {
    const shot = p.shots.find((s) => s.id === targetId);
    if (!shot) return;
    // the preset fills the shot you have; it never shortens a longer one (Ultramock fixed the same thing)
    const span = Math.max(shot.duration, m.duration);
    shot.duration = span;
    const camera = Object.fromEntries(Object.keys(p.camera).map((key) => [key, shotBase(p, shot, `camera.${key}` as AnimProp)])) as Project["camera"];
    const kfs = m.build(span, camera, { x: shotBase(p, shot, "mockup.rotX"), y: shotBase(p, shot, "mockup.rotY"), z: shotBase(p, shot, "mockup.rotZ") });
    for (const [prop, list] of Object.entries(kfs) as [AnimProp, Keyframe[]][]) shot.keyframes[prop] = list;
  }); } finally { endInteraction(); }
  const p = useEditor.getState().project;
  if (targetId) useUI.setState({ time: shotStart(p, targetId), activeShotId: targetId, selectedKeys: [], playing: false });
}

let templateToken = 0;

export function applyTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  const token = ++templateToken;
  const ed = useEditor.getState();
  beginInteraction();
  try {
  ed.update((p) => {
    const spec = getDevice(t.device);
    p.mockup.device = spec.id;
    delete p.mockup.orientation;
    p.mockup.finish = spec.finishes.some((f) => f.id === t.finish) ? t.finish : spec.finishes[0].id;
    p.mockup.rotX = t.rot.x; p.mockup.rotY = t.rot.y; p.mockup.rotZ = t.rot.z;
    const s = getScene(t.scene);
    p.scene.preset = t.scene;
    p.scene.lighting = s.lighting;
    p.scene.lightRotY = s.lightRotY;
    p.scene.lightRotX = 0;
    p.scene.lightIntensity = s.lightIntensity;
    p.scene.contactShadow = s.contactShadow;
    p.scene.background = { ...s.background, ...(t.background ?? {}) };
    p.camera = { ...t.camera };
    if (t.aspect) p.aspect = t.aspect;
    p.blur = { ...createProject().blur, mode: "off", ...(t.blur ?? {}) };
    p.screen.padding = 0;
    p.effects = t.effects ? t.effects.map((e) => ({ ...e, params: { ...e.params } })) : [];
    p.fade = t.fade ? { ...t.fade } : { in: 0, out: 0, color: "#000000" };
    if (t.sequence) {
      // keep whatever media and logo the user already has
      const media = p.shots.find((sh) => shotKind(sh) === "media" && sh.media)?.media ?? null;
      const logoMedia = p.shots.find((sh) => shotKind(sh) === "logo" && sh.logo?.media)?.logo?.media ?? null;
      const rot = { x: p.mockup.rotX, y: p.mockup.rotY, z: p.mockup.rotZ };
      p.shots = t.sequence.map((ts, i) => {
        const name = ts.name ?? `${ts.kind === "media" ? "Shot" : ts.kind === "text" ? "Text" : "Logo"} ${i + 1}`;
        const shot = ts.kind === "text" ? createTextShot(name, ts.duration) : ts.kind === "logo" ? createLogoShot(name, ts.duration) : createShot(name, ts.duration);
        if (ts.kind === "media") shot.media = media;
        if (ts.kind === "text" && ts.text) shot.text = { ...shot.text!, ...ts.text };
        if (ts.kind === "logo") shot.logo = { ...shot.logo!, ...(ts.logo ?? {}), media: ts.logo?.media ?? logoMedia };
        if (ts.enter) shot.enter = { ...ts.enter };
        if (ts.exit) shot.exit = { ...ts.exit };
        if (ts.transitionOut) shot.transitionOut = { ...ts.transitionOut };
        if (ts.motion) {
          const m = MOTION_PRESETS.find((x) => x.id === ts.motion);
          if (m) for (const [prop, list] of Object.entries(m.build(ts.duration, p.camera, rot)) as [AnimProp, Keyframe[]][]) shot.keyframes[prop] = list;
        }
        if (ts.camera) for (const [k, v] of Object.entries(ts.camera)) if (v !== undefined) shot.keyframes[`camera.${k}` as AnimProp] = [{ t: 0, v, ease: "smooth" }];
        if (ts.keyframes) for (const [prop, list] of Object.entries(ts.keyframes) as [AnimProp, Keyframe[]][]) shot.keyframes[prop] = list.map((k) => ({ ...k }));
        return shot;
      });
    } else {
      // plain templates work on media shots only; card shots from a previous template are dropped
      p.shots = p.shots.filter((sh) => shotKind(sh) === "media");
      if (!p.shots.length) p.shots = [createShot("Shot 1", 3), createShot("Shot 2", 3)];
      for (const shot of p.shots) {
        shot.keyframes = {};
        delete shot.transitionOut;
        // A template replaces the look as well as the animation. Otherwise a shot's earlier
        // framing, device or lens silently takes precedence over the template we just applied.
        delete shot.pose;
        delete shot.device;
        delete shot.orientation;
        delete shot.finish;
        delete shot.scene;
        delete shot.lighting;
        delete shot.blurMode;
        delete shot.bokeh;
        delete shot.notch;
        delete shot.effects;
        delete shot.screenPadding;
      }
    }
  });
  const first = useEditor.getState().project.shots[0]?.id ?? null;
  if (t.motion && !t.sequence) applyMotionPreset(t.motion, first ?? undefined);
  ed.update((p) => { p.duration = Math.min(MAX_PROJECT_DURATION, contentDuration(p)); });
  useUI.getState().setActiveShot(first);
  // a fade-in means t=0 is a blank frame, so park the playhead just past it
  const fadeIn = useEditor.getState().project.fade?.in ?? 0;
  useUI.getState().setTime(fadeIn > 0 ? Math.round((fadeIn + 0.4) * 100) / 100 : 0);
  useUI.setState({ selectedKeys: [], selectedShots: first ? [first] : [], playing: false });
  // a template should look finished straight away: fill empty media shots with its sample screen.
  // rendering one costs a canvas draw and an IndexedDB write, so switching templates quickly only
  // ever renders the screen of the one you settle on.
  if (t.screen) {
    const screen = t.screen;
    const projectId = useEditor.getState().project.id;
    window.setTimeout(() => {
      if (token !== templateToken) return;
      const p = useEditor.getState().project;
      if (p.id !== projectId) return;
      if (p.shots.some((sh) => shotKind(sh) === "media" && sh.media)) return;
      const target = p.shots.find((sh) => shotKind(sh) === "media");
      if (!target) return;
      void applySampleScreen(screen, target.id).then(() => {
        if (token !== templateToken || useEditor.getState().project.id !== projectId) return;
        const ref = useEditor.getState().project.shots.find((sh) => sh.id === target.id)?.media ?? null;
        if (ref) useEditor.getState().update((pp) => { for (const sh of pp.shots) if (shotKind(sh) === "media" && !sh.media) sh.media = ref; });
      });
    }, 180);
  }
  } finally { endInteraction(); }
}

const POSE_PROPS: AnimProp[] = ["camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY"];

/**
 * Appends a shot the way Ultramock's simple timeline does: the sequence's current pose is frozen
 * onto the shot before it, the new shot starts from that pose, and the playhead parks at its end so
 * moving the camera sets where the shot lands. The move is written as ordinary, editable keyframes.
 */
export function addShotFromCamera(): string {
  if (!canEditProject(useEditor.getState().project.id)) { useUI.getState().showToast("This project is read-only. Choose Edit here to add a shot."); return ""; }
  beginInteraction();
  try {
  const ed = useEditor.getState();
  const pose = endPose(ed.project);
  const prev = ed.project.shots[ed.project.shots.length - 1];
  // pin the previous shot to the pose it currently holds, so the new move has something to leave from
  if (prev && !POSE_PROPS.some((p) => prev.keyframes[p]?.length)) {
    ed.updateShot(prev.id, (shot) => {
      for (const prop of POSE_PROPS) shot.keyframes[prop] = [{ t: 0, v: pose[prop] ?? 0, ease: "smooth" }];
    });
  }
  const id = useEditor.getState().addShot("media");
  useEditor.getState().updateShot(id, (shot) => {
    for (const prop of POSE_PROPS) {
      const v = pose[prop] ?? 0;
      shot.keyframes[prop] = [
        { t: 0, v, ease: "smooth", cp: [0.42, 0, 0.58, 1] },
        { t: shot.duration, v, ease: "smooth" },
      ];
    }
  });
  const p = useEditor.getState().project;
  const shot = p.shots.find((s) => s.id === id);
  if (!shot) return "";
  // park exactly on the closing keyframe so moving the camera edits it rather than adding another
  useUI.getState().setTime(shotStart(p, id) + shot.duration);
  useUI.getState().showToast("Shot added — move the camera to set where it lands");
  return id;
  } finally { endInteraction(); }
}

/** The camera pose the sequence is left in after its last shot. */
function endPose(p: Project): Partial<Record<AnimProp, number>> {
  const last = p.shots[p.shots.length - 1];
  const out: Partial<Record<AnimProp, number>> = {};
  for (const prop of POSE_PROPS) {
    const track = last?.keyframes[prop];
    out[prop] = track?.length && last ? sampleTrack(track, last.duration) : shotBase(p, last, prop);
  }
  return out;
}

export function setShotMedia(shotId: string | null, media: MediaRef | null) {
  if (media?.kind === "audio") return;
  const ed = useEditor.getState();
  const targetId = shotId ?? useUI.getState().activeShotId ?? ed.project.shots[0]?.id;
  if (!ed.project.shots.some((s) => s.id === targetId && shotKind(s) === "media")) return;
  useEditor.getState().update((p) => {
    const shot = p.shots.find((s) => s.id === targetId);
    if (shot) {
      if (shot.media?.id !== media?.id) { delete shot.trimStart; delete shot.speed; }
      shot.media = media;
    }
  });
}

export async function addAudioFile(file: File) {
  if (!mediaType(file).startsWith("audio/")) { useUI.getState().showToast("That file is not an audio file"); return; }
  await importFilesToShot([file]);
}

export async function importLogo(file: File, shotId: string) {
  if (!mediaType(file).startsWith("image/")) { useUI.getState().showToast("Logos must be images (PNG or SVG)"); return; }
  const shot = useEditor.getState().project.shots.find((s) => s.id === shotId);
  if (!shot || shotKind(shot) !== "logo") return;
  await importFilesToShot([file], shotId);
}

export async function importFilesToShot(files: File[], shotId?: string | null): Promise<MediaRef | null> {
  if (!files.length) return null;
  const ui = useUI.getState(), original = useEditor.getState().project;
  const targetId = shotId ?? ui.activeShotId ?? original.shots[0]?.id;
  const target = original.shots.find((s) => s.id === targetId);
  const hasVisuals = files.some((file) => !mediaType(file).startsWith("audio/"));
  const originalSource = (shotKind(target) === "logo" ? target?.logo?.media : target?.media)?.id;
  const intent = captureEditIntent((p) => {
    if (!hasVisuals) return p.audio?.media.id === original.audio?.media.id;
    const current = p.shots.find((s) => s.id === targetId);
    return !!current && shotKind(current) === shotKind(target) && (shotKind(current) === "logo" ? current.logo?.media : current.media)?.id === originalSource;
  });
  const refs: MediaRef[] = [], failures: string[] = [];
  let committed = false;
  try {
    if (!intent.current()) return null;
    // Decode first. A failed later source must never leave an inherited duplicate in the timeline.
    for (const file of files) {
      let ref: MediaRef | null = null;
      try {
        ref = await importMedia(file);
        if (!intent.current()) { await deleteMedia(ref.id); return null; }
        if (ref.kind === "audio" && refs.some((r) => r.kind === "audio")) throw new Error("only one soundtrack can be added at a time");
        if (ref.kind !== "audio" && (!target || shotKind(target) === "text")) throw new Error("select a media or logo shot first");
        if (ref.kind !== "audio" && shotKind(target) === "logo" && ref.kind !== "image") throw new Error("logos must be images");
        refs.push(ref);
      } catch (error) {
        if (ref) await deleteMedia(ref.id);
        failures.push(`${file.name}: ${(error as Error).message}`);
      }
      if (!intent.current()) return null;
    }
    if (!refs.length) { ui.showToast(`No files added · ${failures.join("; ")}`); return null; }
    const visuals = refs.filter((r) => r.kind !== "audio"), first = visuals[0] ?? null;
    const before = useEditor.getState().project;
    const oldIds = new Set(before.shots.map((s) => s.id));
    beginInteraction();
    try {
      useEditor.getState().update((p) => {
        applyPastedMedia(p, refs, "replace", targetId ?? null);
        const replaced = p.shots.find((s) => s.id === targetId);
        if (first && replaced && shotKind(replaced) === "media") {
          if (originalSource !== first.id) { delete replaced.trimStart; delete replaced.speed; }
          if (first.kind === "video" && first.duration && first.duration > .5) replaced.duration = Math.min(30, Math.round(first.duration * 10) / 10);
        }
        // New shots start where the preceding media shot's animation ends, just like Add media.
        for (const [i, shot] of p.shots.entries()) if (!oldIds.has(shot.id)) {
          const source = [...p.shots.slice(0, i)].reverse().find((s) => shotKind(s) === "media");
          if (!source) continue;
          for (const key of ["fit", "device", "orientation", "finish", "scene", "lighting", "blurMode", "bokeh", "notch", "screenPadding", "effects"] as const) {
            if (source[key] !== undefined) Object.assign(shot, { [key]: structuredClone(source[key]) });
          }
          shot.pose = Object.fromEntries((Object.keys(ANIM_LABELS) as AnimProp[]).filter(isShotScoped).map((prop) => [prop, source.keyframes[prop]?.length ? sampleTrack(source.keyframes[prop]!, source.duration) : shotBase(p, source, prop)]));
        }
      });
    } finally { endInteraction(); }
    committed = useEditor.getState().project !== before;
    if (!committed) return null;
    const p = useEditor.getState().project;
    const added = p.shots.filter((s) => !oldIds.has(s.id));
    if (added.length) { const last = added[added.length - 1]; useUI.setState({ activeShotId: last.id, selectedShots: [last.id], selectedKeys: [], playing: false, time: shotStart(p, last.id) }); }
    if (refs.some((r) => r.kind === "video" || r.kind === "audio")) ui.setTimelineOpen(true);
    if (files.length > 1 || failures.length) {
      ui.showToast(`${refs.length} file${refs.length === 1 ? "" : "s"} added${failures.length ? ` · ${failures.length} skipped: ${failures.join("; ")}` : ""}`);
    } else if (!first) ui.showToast(`Audio added · ${refs[0].name}`);
    else if (target && shotKind(target) === "media" && target.media) {
      const previous = target.media;
      ui.showToast(`${first.kind === "video" ? "Video" : "Image"} added · replaced ${previous.name}`, {
        label: "Add as new shot instead",
        onClick: () => {
          const ed = useEditor.getState();
          if (ed.project.id !== original.id || ed.project.shots.find((s) => s.id === target.id)?.media?.id !== first.id || !canEditProject(original.id)) return;
          beginInteraction();
          try {
            ed.updateShot(target.id, (s) => { s.media = previous; s.duration = target.duration; s.trimStart = target.trimStart; s.speed = target.speed; });
            const id = ed.addShot("media", target.id);
            ed.updateShot(id, (s) => { s.media = first; if (first.kind === "video" && first.duration && first.duration > .5) s.duration = Math.min(30, Math.round(first.duration * 10) / 10); });
          } finally { endInteraction(); }
        },
      });
    } else ui.showToast(`${first.kind === "video" ? "Video" : "Image"} added · ${first.width} × ${first.height}`);
    return first;
  } catch (error) { ui.showToast(`Could not import file: ${(error as Error).message}`); return null; }
  finally { intent.dispose(); if (!committed) await Promise.all(refs.map((ref) => deleteMedia(ref.id))); }
}

export async function importBackgroundImage(file: File) {
  const ui = useUI.getState();
  const original = useEditor.getState().project;
  const target = JSON.stringify({ scene: original.scene.preset, background: original.scene.background });
  const intent = captureEditIntent((p) => JSON.stringify({ scene: p.scene.preset, background: p.scene.background }) === target);
  let ref: MediaRef | null = null, committed = false;
  try {
    if (!intent.current()) return;
    ref = await importMedia(file);
    if (!intent.current()) return;
    if (ref.kind !== "image") { ui.showToast("Backgrounds must be images"); return; }
    const before = useEditor.getState().project;
    useEditor.getState().update((p) => {
      p.scene.background.type = "image";
      p.scene.background.image = ref;
    });
    committed = useEditor.getState().project !== before;
  } catch (e) {
    if (intent.current()) ui.showToast(`Could not import image: ${(e as Error).message}`);
  } finally { intent.dispose(); if (ref && !committed) await deleteMedia(ref.id); }
}

/** Put one of the built-in sample screens on a shot, rendered at the device's native resolution. */
export async function applySampleScreen(id: string, shotId?: string | null) {
  const ui = useUI.getState();
  const ed = useEditor.getState();
  const screen = getSampleScreen(id);
  if (!screen) return;
  const targetId = shotId ?? ui.activeShotId ?? ed.project.shots[0]?.id;
  const shot = ed.project.shots.find((x) => x.id === targetId);
  if (!shot || shotKind(shot) !== "media") return;
  const view = resolveShotView(ed.project, shot);
  const intent = captureEditIntent((p) => {
    const current = p.shots.find((s) => s.id === shot.id);
    if (!current || shotKind(current) !== "media" || current.media?.id !== shot.media?.id) return false;
    const currentView = resolveShotView(p, current);
    return currentView.device === view.device && currentView.orientation === view.orientation;
  });
  let ref: MediaRef | null = null, committed = false;
  try {
    if (!intent.current()) return;
    const spec = getDevice(shot.device ?? ed.project.mockup.device);
    // The samples are laid out for a phone- or laptop-shaped screen. A device close to those
    // proportions gets the sample at its native resolution so it fits the glass exactly; anything
    // squarer — a watch, a portrait tablet — would crop the layout, so it is drawn at the proportions
    // it was designed for and the shot's fit mode places it.
    const landscape = screen.shape === "landscape";
    const design = landscape ? 1.6 : 0.46;
    let [w, h] = orientedScreenPixels(spec, resolveShotView(ed.project, shot).orientation);
    if (spec.family === "flat") [w, h] = landscape ? [1600, 1000] : [1206, 2622];
    else if (Math.abs(w / h - design) / design > 0.15) {
      const long = Math.max(w, h);
      [w, h] = landscape ? [long, Math.round(long / design)] : [Math.round(long * design), long];
    }
    // cap the long edge but keep the aspect, or the sample would be stretched on the screen
    const cap = 2560;
    const scale = Math.min(1, cap / Math.max(w, h));
    const blob = await sampleScreenBlob(id, Math.round(w * scale), Math.round(h * scale));
    if (!blob || !intent.current()) return;
    const file = new File([blob], `${screen.name}.png`, { type: "image/png" });
    ref = await importMedia(file);
    if (!intent.current()) return;
    const before = useEditor.getState().project;
    setShotMedia(shot.id, ref);
    committed = useEditor.getState().project !== before;
    if (committed) ui.showToast(`${screen.name} sample screen added`);
  } catch (e) {
    if (intent.current()) ui.showToast(`Could not add sample screen: ${(e as Error).message}`);
  } finally { intent.dispose(); if (ref && !committed) await deleteMedia(ref.id); }
}

export async function importScreenBackground(file: File) {
  const ui = useUI.getState();
  const target = JSON.stringify(useEditor.getState().project.screen.bg);
  const intent = captureEditIntent((p) => JSON.stringify(p.screen.bg) === target);
  let ref: MediaRef | null = null, committed = false;
  try {
    if (!intent.current()) return;
    ref = await importMedia(file);
    if (!intent.current()) return;
    if (ref.kind !== "image") { ui.showToast("Screen backgrounds must be images"); return; }
    const before = useEditor.getState().project;
    useEditor.getState().update((p) => { p.screen.bg = { type: "image", color: p.screen.bg?.color ?? "#000000", image: ref }; });
    committed = useEditor.getState().project !== before;
  } catch (e) {
    if (intent.current()) ui.showToast(`Could not import image: ${(e as Error).message}`);
  } finally { intent.dispose(); if (ref && !committed) await deleteMedia(ref.id); }
}

/** Map a source-image region to the visible device screen using the same fit as ScreenSurface. */
export function mapFocusAreaToScreen(area: FocusArea, media: Pick<MediaRef, "width" | "height">, screen: ScreenBounds, fit: FitMode): FocusArea | null {
  return mapScreenFocusArea(area, media, screen, fit);
}

/** Source frame for a shot, including trim, speed and the same looping used by the renderer. */
export function autoMotionMediaTime(shot: Pick<Shot, "duration" | "trimStart" | "speed" | "media">, localT: number): number {
  const duration = shot.media?.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0;
  const t = Number.isFinite(localT) ? Math.max(0, Math.min(shot.duration, localT)) : 0;
  return ((shot.trimStart ?? 0) + t * (shot.speed ?? 1)) % duration;
}

/** Build camera keyframes that glide between visible focus areas; return how many were composed. */
export function composeAutoMotion(shotId: string, shuffleSeed = 0) {
  const ed = useEditor.getState();
  const p = ed.project;
  const shot = p.shots.find((s) => s.id === shotId);
  if (!shot || shotKind(shot) !== "media" || !shot.media || shot.focusAreas.length === 0) return 0;
  shuffleSeed = Number.isFinite(shuffleSeed) ? Math.max(0, Math.floor(shuffleSeed)) : 0;
  const spec = getDevice(shot.device ?? p.mockup.device);
  const ui = useUI.getState();
  const viewAspect = ui.viewport.w / Math.max(1, ui.viewport.h);
  const orientation = resolveShotView(p, shot).orientation;
  const layout = deviceLayout(spec, shot.media, orientation, viewAspect);
  const fov = 24;
  const viewH1 = layout.fitSize * 1.18; // view height at zoom 1
  const [screenMmW, screenMmH] = orientedScreenMillimeters(spec, orientation);
  const [sw, sh] = spec.family === "flat" && layout.flat ? [layout.flat.w * S, layout.flat.h * S] : [screenMmW * S, screenMmH * S];
  const [screenW, screenH] = layout.flat?.px ?? orientedScreenPixels(spec, orientation);
  const screen = { width: screenW, height: screenH, padding: resolveScreenPadding(p, shot), chromeHeight: spec.id === "browser" ? Math.round(screenW * 0.045) : 0 };
  const areas = shot.focusAreas.map((area) => mapFocusAreaToScreen(area, shot.media!, screen, shot.fit)).filter((area): area is FocusArea => area !== null);
  if (!areas.length) return 0;
  if (shuffleSeed) {
    // deterministic shuffle
    let seed = shuffleSeed;
    for (let i = areas.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [areas[i], areas[j]] = [areas[j], areas[i]];
    }
  }
  const n = areas.length;
  const D = Math.max(0.2, shot.duration);
  const seg = D / n;
  const eases: Keyframe["ease"][] = ["easeInOut", "smooth", "expoInOut"];
  const ease = eases[shuffleSeed % eases.length];
  const tracks: Partial<Record<AnimProp, Keyframe[]>> = { "camera.zoom": [], "camera.panX": [], "camera.panY": [], "camera.x": [], "camera.y": [] };
  areas.forEach((a, i) => {
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const worldW = a.w * sw, worldH = a.h * sh;
    const needH = Math.max(worldH, worldW / viewAspect) / 0.62;
    const zoom = Math.min(4, Math.max(1, viewH1 / needH));
    const wx = (cx - 0.5) * sw, wy = (0.5 - cy) * sh;
    const panX = -wx * zoom / viewH1;
    const panY = -wy * zoom / viewH1;
    const t0 = i * seg + (i === 0 ? 0 : seg * 0.15);
    const t1 = (i + 1) * seg - (i === n - 1 ? 0 : seg * 0.25);
    const push = (prop: AnimProp, v: number) => {
      tracks[prop]!.push({ t: Math.round(t0 * 100) / 100, v, ease });
      tracks[prop]!.push({ t: Math.round(t1 * 100) / 100, v, ease });
    };
    push("camera.zoom", zoom);
    push("camera.panX", panX);
    push("camera.panY", panY);
    push("camera.x", (i % 2 === 0 ? -1 : 1) * (4 + (shuffleSeed % 5)));
    push("camera.y", 6 + (i % 3) * 2);
  });
  ed.update((pp) => {
    const s = pp.shots.find((x) => x.id === shotId);
    if (!s) return;
    for (const [prop, kfs] of Object.entries(tracks) as [AnimProp, Keyframe[]][]) s.keyframes[prop] = kfs;
    s.keyframes["camera.fov"] = [{ t: 0, v: fov, ease: "smooth" }];
  });
  ui.setTime(shotStart(useEditor.getState().project, shotId));
  return areas.length;
}

export function newProject() {
  templateToken++;
  const p = createProject();
  useEditor.getState().replaceProject(p);
  useEditor.temporal.getState().clear();
  useUI.getState().setTime(0);
  useUI.getState().setActiveShot(p.shots[0].id);
}

export function projectSummary(p: Project): string {
  return `${getDevice(p.mockup.device).name} · ${p.shots.length} shot${p.shots.length === 1 ? "" : "s"}`;
}

export function shotAt(p: Project, id: string | null): Shot | null {
  return p.shots.find((s) => s.id === id) ?? p.shots[0] ?? null;
}

let pasteGeneration = 0;
/** Clipboard intent is captured before the chooser/decoder can outlive its target project. */
export function requestPaste(files: File[]) {
  if (!files.length) return;
  const p = useEditor.getState().project, ui = useUI.getState();
  const shot = locate(p, ui.time).shot;
  const request: PasteRequest = { files, projectId: p.id, shotId: shot?.id ?? null, mediaId: (shotKind(shot) === "logo" ? shot?.logo?.media?.id : shot?.media?.id) ?? null };
  if (ui.pasteMode === "ask") ui.setPasteRequest(request);
  else void executePaste(request, ui.pasteMode);
}

export async function executePaste(request: PasteRequest, mode: Exclude<PasteMode, "ask">): Promise<void> {
  const intent = ++pasteGeneration;
  const ui = useUI.getState();
  ui.setPasteRequest(null);
  const edit = captureEditIntent();
  const current = () => {
    const p = useEditor.getState().project;
    const shot = p.shots.find((s) => s.id === request.shotId);
    const mediaId = (shotKind(shot) === "logo" ? shot?.logo?.media?.id : shot?.media?.id) ?? null;
    return edit.current() && intent === pasteGeneration && p.id === request.projectId && (!request.shotId || !!shot) && (mode !== "replace" || mediaId === request.mediaId);
  };
  if (!current()) { edit.dispose(); ui.showToast("The paste target changed. Paste again to choose its destination."); return; }
  const refs: MediaRef[] = [];
  let committed = false;
  try {
    for (const file of request.files) {
      refs.push(await importMedia(file));
      if (!current()) { ui.showToast("The paste target changed. Paste again to choose its destination."); return; }
    }
    let first: string | null = null;
    const before = useEditor.getState().project;
    beginInteraction();
    try { useEditor.getState().update((p) => { first = applyPastedMedia(p, refs, mode, request.shotId); }); }
    finally { endInteraction(); }
    committed = useEditor.getState().project !== before;
    if (!committed) return;
    const p = useEditor.getState().project;
    if (first) useUI.setState({ activeShotId: first, selectedShots: [first], selectedKeys: [], playing: false, time: shotStart(p, first) });
    if (refs.some((r) => r.kind === "video" || r.kind === "audio")) ui.setTimelineOpen(true);
    ui.showToast(mode === "replace" ? "Pasted media · existing clip timing preserved" : "Pasted media as new shots");
  } catch (e) { ui.showToast(`Could not paste media: ${(e as Error).message}`); }
  finally { edit.dispose(); if (!committed) await Promise.all(refs.map((ref) => deleteMedia(ref.id))); }
}
