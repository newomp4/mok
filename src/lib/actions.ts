"use client";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { CAMERA_PRESETS, MOTION_PRESETS, TEMPLATES, getScene } from "./presets";
import type { AnimProp, Keyframe, MediaRef, Project, Shot } from "./types";
import { importMedia } from "./media";
import { getDevice } from "./devices";
import { shotStart } from "./animation";
import { createProject, defaultLogoStyle, shotKind } from "./defaults";
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
    p.camera = { x: -18, y: 14, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 };
    for (const s of p.shots) for (const k of Object.keys(s.keyframes) as AnimProp[]) if (k.startsWith("camera.")) delete s.keyframes[k];
  });
}

export function resetBlur() {
  useEditor.getState().update((p) => {
    p.blur = { mode: "off", strength: 10, focusSize: 0.52, falloff: 0, bokeh: true, focusX: 0.5, focusY: 0.5 };
    for (const s of p.shots) for (const k of Object.keys(s.keyframes) as AnimProp[]) if (k.startsWith("blur.")) delete s.keyframes[k];
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
    shot.duration = m.duration;
    const kfs = m.build(m.duration, p.camera, { x: p.mockup.rotX, y: p.mockup.rotY, z: p.mockup.rotZ });
    for (const [prop, list] of Object.entries(kfs) as [AnimProp, Keyframe[]][]) shot.keyframes[prop] = list;
  });
  const p = useEditor.getState().project;
  if (targetId) useUI.getState().setTime(shotStart(p, targetId));
}

export function applyTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
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
    for (const shot of p.shots) shot.keyframes = {};
  });
  if (t.motion) applyMotionPreset(t.motion, useEditor.getState().project.shots[0]?.id);
  useUI.getState().setTime(0);
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
  const targetId = shotId ?? ui.activeShotId;
  const target = useEditor.getState().project.shots.find((s) => s.id === targetId);
  if (target && shotKind(target) === "logo") { await importLogo(files[0], target.id); return null; }
  if (target && shotKind(target) === "text") { ui.showToast("Text shots have no media. Select a media shot or add one with +."); return null; }
  try {
    const ref = await importMedia(files[0]);
    setShotMedia(shotId ?? ui.activeShotId, ref);
    if (ref.kind === "video") {
      useEditor.getState().update((p) => {
        const shot = p.shots.find((s) => s.id === (shotId ?? ui.activeShotId)) ?? p.shots[0];
        if (shot && ref.duration && ref.duration > 0.5) shot.duration = Math.min(30, Math.round(ref.duration * 10) / 10);
      });
    }
    ui.showToast(`${ref.kind === "video" ? "Video" : "Image"} added · ${ref.width} × ${ref.height}`);
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
