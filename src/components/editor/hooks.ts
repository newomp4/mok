"use client";
import { useEffect, useRef } from "react";
import { useEditor, redo, undo, beginInteraction, endInteraction, hasKeyClipboard, hasShotClipboard, lastCopyWasKeyframes } from "@/store/editor";
import { APP_VERSION } from "@/lib/version";
import type { AnimProp, Project } from "@/lib/types";
import { useUI } from "@/store/ui";
import { loadAutosave, saveAutosave, saveProject, saveProjectIfSaved, exportProjectFile, importProjectFile, downloadBlob } from "@/lib/persistence";
import * as persistence from "@/lib/persistence";
import { setStorageErrorHandler, pruneMedia } from "@/lib/persistence";
import { extractFiles, onMediaPersistFailed } from "@/lib/media";
import { importFilesToShot, applyCameraPreset } from "@/lib/actions";
import * as actions from "@/lib/actions";
import * as capture from "@/export/capture";
import { viewport as registryViewport } from "@/three/registry";
import { anim as animState } from "@/three/anim";
import { shotStart, totalDuration, editableDuration } from "@/lib/animation";
import { captureImage } from "@/export/capture";
import { getAspect, TEMPLATES, EFFECT_DEFS, SCENES } from "@/lib/presets";
import { DEVICES, getDevice, preferModel, type DeviceSpec } from "@/lib/devices";
import * as screens from "@/lib/screens";
import { clamp } from "@/lib/cn";
import { hasOpenLayer } from "@/components/ui";

export function useBootstrap() {
  useEffect(() => {
    const ui = useUI.getState();
    // debug handle for QA / power users
    (window as unknown as { __mok: unknown }).__mok = { useEditor, useUI, actions, capture, registry: registryViewport, templates: TEMPLATES, anim: animState, effectDefs: EFFECT_DEFS, devices: DEVICES, scenes: SCENES, screens, persistence, version: APP_VERSION };
    ui.setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setStorageErrorHandler((what) => useUI.getState().showToast(what));
    onMediaPersistFailed((name, reason) => useUI.getState().showToast(
      reason === "animated-gif"
        ? `${name} is an animated GIF — export the clip as MP4 or WebM`
        : `${name} is only in this session — the browser blocked storage`,
    ));
    let cancelled = false;
    // a saved project reaches the store from the autosave, the Projects modal or a .mok import alike,
    // so the upgrade to the photoreal models runs on whatever lands there
    const unsubModels = useEditor.subscribe((s) => s.project, (p) => {
      if (migrateToModels(p)) useEditor.setState({ project: { ...p } });
    });
    const initialProject = useEditor.getState().project;
    loadAutosave().then((p) => {
      if (cancelled || !p || useEditor.getState().project !== initialProject) return;
      useEditor.getState().replaceProject(p);
      useEditor.temporal.getState().clear();
      useUI.getState().setActiveShot(p.shots[0]?.id ?? null);
    }).catch(() => { if (!cancelled) ui.showToast("The previous session could not be restored. Your saved projects are still in Projects."); });
    // first visit: the tour; later versions: what's new
    let welcomeTimer: number | undefined;
    try {
      const seen = localStorage.getItem("mok:seen-version");
      const markSeen = () => { try { localStorage.setItem("mok:seen-version", APP_VERSION); } catch {} };
      if (!seen && !localStorage.getItem("mok:toured")) welcomeTimer = window.setTimeout(() => { if (!hasOpenLayer() && !useUI.getState().exporting) { useUI.getState().setTourStep(0); markSeen(); } }, 1500);
      else if (seen && seen !== APP_VERSION) welcomeTimer = window.setTimeout(() => { if (!hasOpenLayer() && !useUI.getState().exporting) { useUI.getState().setModal("whatsnew"); markSeen(); } }, 1200);
      else markSeen();
    } catch {}
    return () => { cancelled = true; window.clearTimeout(welcomeTimer); unsubModels(); };
  }, []);
}

/**
 * The procedural and glTF specs give the same colour different finish ids, so a finish the new
 * device does not have is carried over by name — from the spec the id came from — and only falls
 * back to the first finish when there is no equivalent.
 */
function swapFinish(from: string, to: DeviceSpec, finish: string): string {
  if (to.finishes.some((f) => f.id === finish)) return finish;
  const origin = getDevice(from).finishes.find((f) => f.id === finish) ?? DEVICES.flatMap((d) => d.finishes).find((f) => f.id === finish);
  return (to.finishes.find((f) => f.name === origin?.name) ?? to.finishes[0]).id;
}

/**
 * Projects saved before the photoreal models existed point at the procedural devices, which the
 * picker no longer offers, and can carry a finish id that belongs to no spec at all. Returns
 * whether anything had to change.
 */
export function migrateToModels(p: Project): boolean {
  let changed = false;
  const was = p.mockup.device;
  const spec = getDevice(preferModel(was));
  const finish = swapFinish(was, spec, p.mockup.finish);
  if (spec.id !== was || finish !== p.mockup.finish) {
    p.mockup.device = spec.id;
    p.mockup.finish = finish;
    changed = true;
  }
  // a sequence can cut between devices, so the per-shot overrides need the same treatment
  for (const s of p.shots) {
    const shotSpec = s.device ? getDevice(preferModel(s.device)) : spec;
    if (s.finish) {
      const f = swapFinish(s.device ?? was, shotSpec, s.finish);
      if (f !== s.finish) { s.finish = f; changed = true; }
    }
    if (s.device && shotSpec.id !== s.device) { s.device = shotSpec.id; changed = true; }
  }
  return changed;
}

/** Sweep unreferenced media out of storage once the editor has settled after load. */
export function useMediaPrune() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      void pruneMedia(useEditor.getState().project);
    }, 6000);
    return () => window.clearTimeout(t);
  }, []);
}

export function useAutosave() {
  useEffect(() => {
    let timer: number | null = null;
    let pending: Project | null = null;
    const persist = (p: Project) => {
      void saveAutosave(p);
      void saveProjectIfSaved(p).catch(() => {});
    };
    const flush = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (pending) { const p = pending; pending = null; persist(p); }
    };
    const unsub = useEditor.subscribe((s) => s.project, (p) => {
      if (pending && pending.id !== p.id) flush();
      if (timer !== null) window.clearTimeout(timer);
      pending = p;
      timer = window.setTimeout(flush, 800);
    });
    const hidden = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => { unsub(); flush(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", flush); };
  }, []);
}

export function usePasteImport() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (hasOpenLayer() || useUI.getState().exporting || useUI.getState().tourStep !== null) return;
      const files = extractFiles(e.clipboardData);
      if (files.length) { e.preventDefault(); void importFilesToShot(files); return; }
      // Let the native paste event deliver files before considering the editor's internal copy.
      // Otherwise copying a keyframe once makes later clipboard screenshots impossible to paste.
      if (lastCopyWasKeyframes() && hasKeyClipboard()) {
        e.preventDefault(); useEditor.getState().pasteKeyframes(); useUI.getState().showToast("Keyframes pasted at the playhead");
      } else if (hasShotClipboard()) {
        e.preventDefault(); useEditor.getState().pasteShot(useUI.getState().activeShotId ?? undefined);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}

export function exportSizeFor(aspectId: ReturnType<typeof useEditor.getState>["project"]["aspect"], long: number, viewport: { w: number; h: number }, orientation?: "landscape" | "square" | "portrait"): [number, number] {
  const a = getAspect(aspectId);
  let ratio = a.ratio ?? Math.max(1, viewport.w) / Math.max(1, viewport.h);
  if (!Number.isFinite(ratio) || ratio <= 0) ratio = 16 / 9;
  long = Math.max(2, Math.round((Number.isFinite(long) ? long : 1920) / 2) * 2);
  if (a.px) return a.px;
  // the viewport is whatever shape the window is, so the orientation choice works off its long side
  if (a.ratio === null && orientation) {
    const wide = Math.max(ratio, 1 / ratio);
    ratio = orientation === "square" ? 1 : orientation === "portrait" ? 1 / wide : wide;
  }
  if (ratio >= 1) return [long, Math.max(2, Math.round(long / ratio / 2) * 2)];
  return [Math.max(2, Math.round((long * ratio) / 2) * 2), long];
}

export async function quickCapture() {
  const ui = useUI.getState();
  const p = useEditor.getState().project;
  if (ui.exporting) return;
  const [w, h] = exportSizeFor(p.aspect, 2560, ui.viewport);
  ui.setExporting({ label: "Capturing…", progress: 0.3 });
  try {
    const blob = await captureImage({ width: w, height: h, format: "png", transparent: p.scene.background.type === "transparent" });
    downloadBlob(blob, `${slug(p.name)}-${w}x${h}.png`);
    ui.showToast(`Captured ${w} × ${h} PNG`);
  } catch (e) {
    ui.showToast(`Capture failed: ${(e as Error).message}`);
  } finally {
    ui.setExporting(null);
  }
}

export function slug(s: string): string {
  return (s || "mok").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mok";
}

export async function saveCurrentProject(toastIt = true) {
  const p = useEditor.getState().project;
  try {
    await saveProject(p);
    if (toastIt) useUI.getState().showToast(`Saved “${p.name}”`);
  } catch (error) { useUI.getState().showToast(`Could not save “${p.name}”: ${(error as Error).message}`); }
}

export async function exportProjectToFile() {
  const p = useEditor.getState().project;
  try {
    const blob = await exportProjectFile(p);
    downloadBlob(blob, `${slug(p.name)}.mok.json`);
  } catch (error) { useUI.getState().showToast(`Project export failed: ${(error as Error).message}`); }
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    let settled = false;
    const done = (files: File[]) => { if (settled) return; settled = true; input.remove(); resolve(files); };
    input.onchange = () => done(Array.from(input.files ?? []));
    input.oncancel = () => done([]);
    document.body.appendChild(input);
    input.click();
  });
}

export async function importProjectFromFile() {
  const original = useEditor.getState().project;
  const originalModal = useUI.getState().modal;
  const [file] = await pickFiles("application/json,.json,.mok");
  if (!file) return;
  try {
    const p = await importProjectFile(file);
    if (useEditor.getState().project !== original) { useUI.getState().showToast("The project changed while importing. Import again to open this file."); return; }
    useEditor.getState().replaceProject(p);
    if (useUI.getState().modal === originalModal) useUI.getState().setModal(null);
    useEditor.temporal.getState().clear();
    useUI.getState().setTime(0);
    useUI.getState().setActiveShot(p.shots[0]?.id ?? null);
    useUI.getState().showToast(`Imported “${p.name}”`);
  } catch (e) {
    useUI.getState().showToast(`Import failed: ${(e as Error).message}`);
  }
}

const CAMERA_PROPS: AnimProp[] = ["camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY", "mockup.rotX", "mockup.rotY", "mockup.rotZ"];

export function useShortcuts() {
  const spaceDown = useRef(false);
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      // an export renders frame by frame; a stray keypress would change what is being encoded
      if (e.defaultPrevented || ui.exporting || ui.modal || ui.cropShot || ui.tourStep !== null || hasOpenLayer()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        if (ui.modal) ui.setModal(null);
        else if (ui.autoMotion) ui.setAutoMotion(false);
        else if (ui.picker) ui.setPicker(null);
        return;
      }
      if (isTyping(e)) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveCurrentProject(); return; }
      if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); void quickCapture(); return; }
      const ed = useEditor.getState();
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const active = ui.activeShotId ?? ed.project.shots[0]?.id;
        if (!active) return;
        if (e.shiftKey) { const start = shotStart(ed.project, active); ed.splitShot(active, ui.time - start); }
        else ed.duplicateShot(active);
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        if (ui.selectedKeys.length) { e.preventDefault(); ed.copyKeyframes(ui.selectedKeys); ui.showToast(`Copied ${ui.selectedKeys.length} keyframe${ui.selectedKeys.length === 1 ? "" : "s"}`); }
        else if (ui.activeShotId) { e.preventDefault(); ed.copyShot(ui.activeShotId); ui.showToast("Shot copied"); }
        return;
      }
      if (mod && e.altKey && e.key.toLowerCase() === "a") {
        // select every keyframe in the project
        e.preventDefault();
        const keys: { shotId: string; prop: AnimProp; t: number }[] = [];
        for (const shot of ed.project.shots) for (const [prop, list] of Object.entries(shot.keyframes) as [AnimProp, { t: number }[]][]) for (const k of list ?? []) keys.push({ shotId: shot.id, prop, t: k.t });
        ui.setSelectedKeys(keys);
        ui.showToast(`${keys.length} keyframe${keys.length === 1 ? "" : "s"} selected`);
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        // File pastes and the most recently copied editor item are handled by usePasteImport.
        return;
      }
      if (mod) return;
      const p = useEditor.getState().project;
      switch (e.key) {
        case " ":
          if ((e.target as HTMLElement)?.closest('button, a[href], [role="button"], [role="switch"], [role="slider"]')) return;
          e.preventDefault();
          if (!e.repeat) useUI.setState({ spaceHeld: true, spaceDragged: false });
          break;
        case "t": case "T": ui.setTimelineOpen(!ui.timelineOpen); break;
        case "r": case "R": ui.setRecording(!ui.recording); break;
        case "?": ui.setModal(ui.modal === "shortcuts" ? null : "shortcuts"); break;
        case "ArrowLeft": { e.preventDefault(); const step = e.shiftKey ? 1 : 1 / p.fps; ui.setTime(clamp(ui.time - step, 0, editableDuration(p))); break; }
        case "ArrowRight": { e.preventDefault(); const step = e.shiftKey ? 1 : 1 / p.fps; ui.setTime(clamp(ui.time + step, 0, editableDuration(p))); break; }
        case "Home": ui.setTime(0); break;
        case "End": ui.setTime(totalDuration(p)); break;
        case "1": applyCameraPreset("hero"); break;
        case "2": applyCameraPreset("angled"); break;
        case "3": applyCameraPreset("flat"); break;
        case "4": applyCameraPreset("bottom"); break;
        case "5": applyCameraPreset("detail"); break;
        case "6": applyCameraPreset("top"); break;
        case "7": applyCameraPreset("profile"); break;
        case "8": applyCameraPreset("dramatic"); break;
        case "9": applyCameraPreset("float"); break;
        case "l": case "L": ui.toggleLoop(); break;
        case "d": case "D": if (!e.repeat) ui.toggleTheme(); break;
        case "g": case "G": if (!e.repeat) ui.setGuides(!ui.guides); break;
        case "k": case "K": {
          if (e.repeat) break;
          // stamp the tracks this shot already animates; fall back to the camera on an un-animated shot
          const shot = ed.project.shots.find((s) => s.id === ui.activeShotId) ?? ed.project.shots[0];
          const existing = shot ? (Object.keys(shot.keyframes) as AnimProp[]).filter((k) => (shot.keyframes[k]?.length ?? 0) > 0) : [];
          const props = existing.length ? existing : CAMERA_PROPS;
          ed.stampKeyframes(props);
          ui.showToast(`${props.length} keyframe${props.length === 1 ? "" : "s"} added`);
          break;
        }
        case "Backspace": case "Delete": {
          // keyframes come first: a shot selection is the fallback, so one press never spends both
          if (ui.selectedKeys.length) {
            e.preventDefault();
            ed.deleteSelectedKeyframes();
            break;
          }
          if (!ui.selectedShots.length) break;
          e.preventDefault();
          const before = ed.project.shots.length;
          beginInteraction();
          for (const id of ui.selectedShots) ed.removeShot(id);
          endInteraction();
          const gone = before - useEditor.getState().project.shots.length;
          ui.setSelectedShots([]);
          if (gone) ui.showToast(`${gone} shot${gone === 1 ? "" : "s"} deleted`);
          break;
        }
        case "ArrowUp": case "ArrowDown": {
          // nudge the selected keyframes one frame (shift = ten)
          if (!ui.selectedKeys.length) break;
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) / p.fps;
          ed.moveSelectedKeyframes(e.key === "ArrowUp" ? -step : step, e.altKey);
          break;
        }
      }
    };
    const onKeyDownSpace = (e: KeyboardEvent) => { if (e.code === "Space" && !isTyping(e) && !hasOpenLayer()) spaceDown.current = true; };
    const onKeyUpSpace = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDown.current = false;
      const ui = useUI.getState();
      if (ui.spaceHeld && !ui.spaceDragged && !isTyping(e) && !ui.exporting && !ui.modal && ui.tourStep === null && !hasOpenLayer()) ui.setPlaying(!ui.playing);
      useUI.setState({ spaceHeld: false, spaceDragged: false });
    };
    const release = () => { spaceDown.current = false; useUI.setState({ spaceHeld: false, spaceDragged: false }); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onKeyDownSpace, true);
    document.addEventListener("keyup", onKeyUpSpace, true);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onKeyDownSpace, true);
      document.removeEventListener("keyup", onKeyUpSpace, true);
      window.removeEventListener("blur", release);
    };
  }, []);
  return spaceDown;
}
