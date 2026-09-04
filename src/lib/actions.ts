"use client";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { CAMERA_PRESETS, MOTION_PRESETS, TEMPLATES, getScene } from "./presets";
import type { AnimProp, Keyframe, MediaRef, Project, Shot } from "./types";
import { importMedia } from "./media";
import { getDevice } from "./devices";
import { getSampleScreen, sampleScreenBlob } from "./screens";
import { getBase, shotStart } from "./animation";
import { createLogoShot, createProject, createShot, createTextShot, defaultLogoStyle, shotKind } from "./defaults";
import { deviceLayout } from "@/three/devices/layout";
import { S } from "@/three/geometry";

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
    p.camera = { x: -22, y: -18, z: 0, fov: 24, zoom: 1.12, panX: 0.02, panY: -0.02 };
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
  ed.update((p) => {
    const shot = p.shots.find((s) => s.id === targetId);
    if (!shot) return;
    // the preset fills the shot you have; it never shortens a longer one (Ultramock fixed the same thing)
    const span = Math.max(shot.duration, m.duration);
    shot.duration = span;
    const kfs = m.build(span, p.camera, { x: p.mockup.rotX, y: p.mockup.rotY, z: p.mockup.rotZ });
    for (const [prop, list] of Object.entries(kfs) as [AnimProp, Keyframe[]][]) shot.keyframes[prop] = list;
  });
  const p = useEditor.getState().project;
  if (targetId) useUI.getState().setTime(shotStart(p, targetId));
}

let templateToken = 0;

export function applyTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  const token = ++templateToken;
  const ed = useEditor.getState();
  ed.update((p) => {
    const spec = getDevice(t.device);
    p.mockup.device = spec.id;
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
    p.blur = { ...p.blur, mode: "off", ...(t.blur ?? {}) };
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
      for (const shot of p.shots) { shot.keyframes = {}; shot.transitionOut = undefined; }
    }
  });
  const first = useEditor.getState().project.shots[0]?.id ?? null;
  if (t.motion && !t.sequence) applyMotionPreset(t.motion, first ?? undefined);
  useUI.getState().setActiveShot(first);
  // a fade-in means t=0 is a blank frame, so park the playhead just past it
  const fadeIn = useEditor.getState().project.fade?.in ?? 0;
  useUI.getState().setTime(fadeIn > 0 ? Math.round((fadeIn + 0.4) * 100) / 100 : 0);
  // a template should look finished straight away: fill empty media shots with its sample screen.
  // rendering one costs a canvas draw and an IndexedDB write, so switching templates quickly only
  // ever renders the screen of the one you settle on.
  if (t.screen) {
    const screen = t.screen;
    window.setTimeout(() => {
      if (token !== templateToken) return;
      const p = useEditor.getState().project;
      if (p.shots.some((sh) => shotKind(sh) === "media" && sh.media)) return;
      void applySampleScreen(screen).then(() => {
        if (token !== templateToken) return;
        const ref = useEditor.getState().project.shots.find((sh) => sh.media)?.media ?? null;
        if (ref) useEditor.getState().update((pp) => { for (const sh of pp.shots) if (shotKind(sh) === "media") sh.media = ref; });
      });
    }, 180);
  }
}

const POSE_PROPS: AnimProp[] = ["camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY"];

/**
 * Appends a shot the way Ultramock's simple timeline does: the sequence's current pose is frozen
 * onto the shot before it, the new shot starts from that pose, and the playhead parks at its end so
 * moving the camera sets where the shot lands. The move is written as ordinary, editable keyframes.
 */
export function addShotFromCamera(): string {
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
  const shot = p.shots.find((s) => s.id === id)!;
  // park exactly on the closing keyframe so moving the camera edits it rather than adding another
  useUI.getState().setTime(shotStart(p, id) + shot.duration);
  useUI.getState().showToast("Shot added — move the camera to set where it lands");
  return id;
}

/** The camera pose the sequence is left in after its last shot. */
function endPose(p: Project): Partial<Record<AnimProp, number>> {
  const last = p.shots[p.shots.length - 1];
  const out: Partial<Record<AnimProp, number>> = {};
  for (const prop of POSE_PROPS) {
    const track = last?.keyframes[prop];
    out[prop] = track?.length ? track[track.length - 1].v : getBase(p, prop);
  }
  return out;
}

export function setShotMedia(shotId: string | null, media: MediaRef | null) {
  useEditor.getState().update((p) => {
    const shot = (shotId && p.shots.find((s) => s.id === shotId)) || p.shots[0];
    if (shot) shot.media = media;
  });
}

export async function addAudioFile(file: File) {
  const ui = useUI.getState();
  try {
    const ref = await importMedia(file);
    if (ref.kind !== "audio") { ui.showToast("That file is not an audio file"); return; }
    useEditor.getState().setAudio({ media: ref, start: 0, trimStart: 0, volume: 1, fadeIn: 0, fadeOut: 0 });
    ui.showToast(`Audio added · ${ref.name}`);
  } catch (e) {
    ui.showToast(`Could not import audio: ${(e as Error).message}`);
  }
}

export async function importLogo(file: File, shotId: string) {
  const ui = useUI.getState();
  try {
    const ref = await importMedia(file);
    if (ref.kind !== "image") { ui.showToast("Logos must be images (PNG or SVG)"); return; }
    useEditor.getState().updateShot(shotId, (s) => { if (!s.logo) s.logo = defaultLogoStyle(); s.logo.media = ref; });
  } catch (e) {
    ui.showToast(`Could not import logo: ${(e as Error).message}`);
  }
}

export async function importFilesToShot(files: File[], shotId?: string | null): Promise<MediaRef | null> {
  if (!files.length) return null;
  const ui = useUI.getState();
  if (files[0].type.startsWith("audio/")) { await addAudioFile(files[0]); return null; }
  // several files at once become a sequence: the first replaces the target, the rest follow it
  if (files.length > 1) {
    const first = await importFilesToShot([files[0]], shotId);
    const ed = useEditor.getState();
    let after = shotId ?? ui.activeShotId ?? ed.project.shots[0]?.id ?? null;
    for (const f of files.slice(1)) {
      if (f.type.startsWith("audio/")) continue;
      const id = ed.addShot("media", after ?? undefined);
      await importFilesToShot([f], id);
      after = id;
    }
    ui.showToast(`${files.length} files added as ${files.length} shots`);
    return first;
  }
  const targetId = shotId ?? ui.activeShotId;
  const target = useEditor.getState().project.shots.find((s) => s.id === targetId);
  if (target && shotKind(target) === "logo") { await importLogo(files[0], target.id); return null; }
  if (target && shotKind(target) === "text") { ui.showToast("Text shots have no media. Select a media shot or add one with +."); return null; }
  try {
    const ref = await importMedia(files[0]);
    const previous = target?.media ?? null;
    setShotMedia(shotId ?? ui.activeShotId, ref);
    if (ref.kind === "video") {
      useEditor.getState().update((p) => {
        const shot = p.shots.find((s) => s.id === (shotId ?? ui.activeShotId)) ?? p.shots[0];
        if (shot && ref.duration && ref.duration > 0.5) shot.duration = Math.min(30, Math.round(ref.duration * 10) / 10);
      });
      // a video is a timeline job, so show the timeline rather than leaving it collapsed
      if (!ui.timelineOpen) ui.setTimelineOpen(true);
    }
    const label = `${ref.kind === "video" ? "Video" : "Image"} added · ${ref.width} × ${ref.height}`;
    if (previous && target) {
      // the shot already had media: offer to keep it and put the new file on a new shot instead
      ui.showToast(`${label} · replaced ${previous.name}`, {
        label: "Add as new shot instead",
        onClick: () => {
          const ed = useEditor.getState();
          ed.updateShot(target.id, (s) => { s.media = previous; });
          const id = ed.addShot("media", target.id);
          ed.updateShot(id, (s) => { s.media = ref; if (ref.kind === "video" && ref.duration && ref.duration > 0.5) s.duration = Math.min(30, Math.round(ref.duration * 10) / 10); });
        },
      });
    } else ui.showToast(label);
    return ref;
  } catch (e) {
    ui.showToast(`Could not import file: ${(e as Error).message}`);
    return null;
  }
}

export async function importBackgroundImage(file: File) {
  const ui = useUI.getState();
  try {
    const ref = await importMedia(file);
    useEditor.getState().update((p) => {
      p.scene.background.type = "image";
      p.scene.background.image = ref;
    });
  } catch (e) {
    ui.showToast(`Could not import image: ${(e as Error).message}`);
  }
}

/** Put one of the built-in sample screens on a shot, rendered at the device's native resolution. */
export async function applySampleScreen(id: string, shotId?: string | null) {
  const ui = useUI.getState();
  const ed = useEditor.getState();
  const spec = getDevice(ed.project.mockup.device);
  const screen = getSampleScreen(id);
  if (!screen) return;
  const targetId = shotId ?? ui.activeShotId ?? ed.project.shots[0]?.id;
  const shot = ed.project.shots.find((x) => x.id === targetId);
  // The samples are laid out for a phone- or laptop-shaped screen. A device close to those
  // proportions gets the sample at its native resolution so it fits the glass exactly; anything
  // squarer — a watch, a portrait tablet — would crop the layout, so it is drawn at the proportions
  // it was designed for and the shot's fit mode places it.
  const landscape = screen.shape === "landscape";
  const design = landscape ? 1.6 : 0.46;
  let [w, h] = spec.screenPx;
  if (spec.family === "flat") [w, h] = landscape ? [1600, 1000] : [1206, 2622];
  else if (Math.abs(w / h - design) / design > 0.15) {
    const long = Math.max(w, h);
    [w, h] = landscape ? [long, Math.round(long / design)] : [Math.round(long * design), long];
  }
  // cap the long edge but keep the aspect, or the sample would be stretched on the screen
  const cap = 2560;
  const scale = Math.min(1, cap / Math.max(w, h));
  const blob = await sampleScreenBlob(id, Math.round(w * scale), Math.round(h * scale));
  if (!blob) return;
  const file = new File([blob], `${screen.name}.png`, { type: "image/png" });
  const ref = await importMedia(file);
  setShotMedia(shot?.id ?? null, ref);
  ui.showToast(`${screen.name} sample screen added`);
}

export async function importScreenBackground(file: File) {
  const ui = useUI.getState();
  try {
    const ref = await importMedia(file);
    if (ref.kind !== "image") { ui.showToast("Screen backgrounds must be images"); return; }
    useEditor.getState().update((p) => { p.screen.bg = { type: "image", color: p.screen.bg?.color ?? "#000000", image: ref }; });
  } catch (e) {
    ui.showToast(`Could not import image: ${(e as Error).message}`);
  }
}

/** Build camera keyframes that glide between the shot's focus areas. */
export function composeAutoMotion(shotId: string, shuffleSeed = 0) {
  const ed = useEditor.getState();
  const p = ed.project;
  const shot = p.shots.find((s) => s.id === shotId);
  if (!shot || shot.focusAreas.length === 0) return;
  const spec = getDevice(p.mockup.device);
  const layout = deviceLayout(spec, shot.media);
  const fov = 24;
  const viewH1 = layout.fitSize * 1.18; // view height at zoom 1
  const ui = useUI.getState();
  const viewAspect = ui.viewport.w / Math.max(1, ui.viewport.h);
  const [sw, sh] = spec.family === "flat" && layout.flat ? [layout.flat.w * S, layout.flat.h * S] : [spec.screenMm[0] * S, spec.screenMm[1] * S];
  const areas = [...shot.focusAreas];
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
  const D = Math.max(2, shot.duration);
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
}

export function newProject() {
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
