"use client";
import { useEffect, useRef } from "react";
import { useEditor, redo, undo, hasKeyClipboard, hasShotClipboard } from "@/store/editor";
import { APP_VERSION } from "@/lib/version";
import type { AnimProp } from "@/lib/types";
import { useUI } from "@/store/ui";
import { loadAutosave, saveAutosave, saveProject, exportProjectFile, importProjectFile, downloadBlob } from "@/lib/persistence";
import { extractFiles } from "@/lib/media";
import { importFilesToShot, applyCameraPreset } from "@/lib/actions";
import * as actions from "@/lib/actions";
import * as capture from "@/export/capture";
import { viewport as registryViewport } from "@/three/registry";
import { anim as animState } from "@/three/anim";
import { shotStart, totalDuration } from "@/lib/animation";
import { captureImage } from "@/export/capture";
import { getAspect, TEMPLATES, EFFECT_DEFS, SCENES } from "@/lib/presets";
import { DEVICES } from "@/lib/devices";
import * as screens from "@/lib/screens";
import { clamp } from "@/lib/cn";
import { preferModel } from "@/lib/devices";

export function useBootstrap() {
  useEffect(() => {
    const ui = useUI.getState();
    // debug handle for QA / power users
    (window as unknown as { __mok: unknown }).__mok = { useEditor, useUI, actions, capture, registry: registryViewport, templates: TEMPLATES, anim: animState, effectDefs: EFFECT_DEFS, devices: DEVICES, scenes: SCENES, screens };
    ui.setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    let cancelled = false;
    loadAutosave().then((p) => {
      if (cancelled || !p) return;
      // one-time upgrade: projects saved before the photoreal models existed keep working but switch to them
      try {
        if (!localStorage.getItem("mok:migrated-glb")) {
          p.mockup.device = preferModel(p.mockup.device);
          localStorage.setItem("mok:migrated-glb", "1");
        }
      } catch {}
      useEditor.getState().replaceProject(p);
      useEditor.temporal.getState().clear();
      useUI.getState().setActiveShot(p.shots[0]?.id ?? null);
    });
    // first visit: the tour; later versions: what's new
    try {
      const seen = localStorage.getItem("mok:seen-version");
      if (!seen && !localStorage.getItem("mok:toured")) window.setTimeout(() => useUI.getState().setTourStep(0), 1500);
      else if (seen && seen !== APP_VERSION) window.setTimeout(() => useUI.getState().setModal("whatsnew"), 1200);
      localStorage.setItem("mok:seen-version", APP_VERSION);
    } catch {}
    return () => { cancelled = true; };
  }, []);
}

export function useAutosave() {
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useEditor.subscribe((s) => s.project, (p) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void saveAutosave(p); }, 800);
    });
    return () => { unsub(); if (timer) window.clearTimeout(timer); };
  }, []);
}

export function usePasteImport() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const files = extractFiles(e.clipboardData);
      if (files.length) { e.preventDefault(); void importFilesToShot(files); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}

export function exportSizeFor(aspectId: ReturnType<typeof useEditor.getState>["project"]["aspect"], long: number, viewport: { w: number; h: number }, orientation?: "landscape" | "square" | "portrait"): [number, number] {
  const a = getAspect(aspectId);
  let ratio = a.ratio ?? viewport.w / Math.max(1, viewport.h);
  if (a.px) return a.px;
  if (a.ratio === null && orientation) ratio = orientation === "square" ? 1 : orientation === "portrait" ? 1 / ratio : ratio;
  if (ratio >= 1) return [long, Math.round(long / ratio / 2) * 2];
  return [Math.round((long * ratio) / 2) * 2, long];
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
  await saveProject(p);
  if (toastIt) useUI.getState().showToast(`Saved “${p.name}”`);
}

export async function exportProjectToFile() {
  const p = useEditor.getState().project;
  const blob = await exportProjectFile(p);
  downloadBlob(blob, `${slug(p.name)}.mok.json`);
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export async function importProjectFromFile() {
  const [file] = await pickFiles("application/json,.json,.mok");
  if (!file) return;
  try {
    const p = await importProjectFile(file);
    useEditor.getState().replaceProject(p);
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
      if (mod && e.key.toLowerCase() === "v") {
        if (hasKeyClipboard()) { e.preventDefault(); ed.pasteKeyframes(); ui.showToast("Keyframes pasted at the playhead"); }
        else if (hasShotClipboard()) { e.preventDefault(); ed.pasteShot(ui.activeShotId ?? undefined); }
        return;
      }
      if (mod) return;
      const p = useEditor.getState().project;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!e.repeat) useUI.setState({ spaceHeld: true, spaceDragged: false });
          break;
        case "t": case "T": ui.setTimelineOpen(!ui.timelineOpen); break;
        case "r": case "R": ui.setRecording(!ui.recording); break;
        case "?": ui.setModal(ui.modal === "shortcuts" ? null : "shortcuts"); break;
        case "ArrowLeft": { e.preventDefault(); const step = e.shiftKey ? 1 : 1 / p.fps; ui.setTime(clamp(ui.time - step, 0, totalDuration(p))); break; }
        case "ArrowRight": { e.preventDefault(); const step = e.shiftKey ? 1 : 1 / p.fps; ui.setTime(clamp(ui.time + step, 0, totalDuration(p))); break; }
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
        case "k": case "K": if (!e.repeat) { ed.stampKeyframes(CAMERA_PROPS); ui.showToast("Camera keyframes added"); } break;
        case "Backspace": case "Delete": {
          if (!ui.selectedKeys.length) break;
          e.preventDefault();
          const keys = ui.selectedKeys;
          ed.update((pp) => {
            for (const key of keys) {
              const s = pp.shots.find((x) => x.id === key.shotId);
              if (!s) continue;
              const list = (s.keyframes[key.prop] ?? []).filter((k) => Math.abs(k.t - key.t) > 0.0005);
              if (list.length) s.keyframes[key.prop] = list; else delete s.keyframes[key.prop];
            }
          });
          ui.setSelectedKeys([]);
          break;
        }
      }
    };
    const onKeyDownSpace = (e: KeyboardEvent) => { if (e.code === "Space" && !isTyping(e)) spaceDown.current = true; };
    const onKeyUpSpace = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDown.current = false;
      const ui = useUI.getState();
      if (ui.spaceHeld && !ui.spaceDragged && !isTyping(e)) ui.setPlaying(!ui.playing);
      useUI.setState({ spaceHeld: false, spaceDragged: false });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onKeyDownSpace, true);
    document.addEventListener("keyup", onKeyUpSpace, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onKeyDownSpace, true);
      document.removeEventListener("keyup", onKeyUpSpace, true);
    };
  }, []);
  return spaceDown;
}
