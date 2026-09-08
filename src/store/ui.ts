"use client";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { PasteMode } from "@/lib/paste";
import type { AnimProp } from "@/lib/types";

export type Picker = null | "device" | "scene";
export type Theme = "light" | "dark";

export interface ExportProgress {
  label: string;
  progress: number;
  cancel?: () => void;
}

export interface PasteRequest { files: File[]; projectId: string; shotId: string | null; mediaId: string | null }
export type TourKind = "editor" | "timeline" | "autoMotion";

interface UIState {
  time: number;
  playing: boolean;
  loop: boolean;
  recording: boolean;
  activeShotId: string | null;
  activeTextOverlayId: string | null;
  cameraPose: { shotId: string; index: number } | null;
  theme: Theme;
  timelineOpen: boolean;
  timelineMode: "simple" | "advanced";
  timelineZoom: number;
  picker: Picker;
  inspectorOpen: boolean;
  cameraTab: "manual" | "presets";
  autoMotion: boolean;
  toast: { id: number; text: string; action?: { label: string; onClick: () => void } } | null;
  exporting: ExportProgress | null;
  modal: null | "info" | "shortcuts" | "projects" | "preferences" | "changelog" | "whatsnew";
  dragging: boolean;
  viewport: { w: number; h: number };
  hasInteracted: boolean;
  dpr: number;
  setDpr: (d: number) => void;
  /** Space is held (pan modifier); spaceDragged tells the keyup handler not to toggle playback */
  spaceHeld: boolean;
  spaceDragged: boolean;
  /** pointer/wheel interaction in progress (render at a lighter pixel ratio) */
  interacting: boolean;
  /** centre guides drawn over the viewport */
  guides: boolean;
  /** pan snaps back to centre when close */
  snapCenter: boolean;
  /** interface sounds (export chime, invalid-action blip) */
  sounds: boolean;
  captureShortcut: boolean;
  pasteMode: PasteMode;
  pasteRequest: PasteRequest | null;
  setCaptureShortcut: (enabled: boolean) => void;
  setPasteMode: (mode: PasteMode) => void;
  setPasteRequest: (request: PasteRequest | null) => void;
  timelineHeight: number;
  /** selected keyframe diamonds on the timeline */
  selectedKeys: { shotId: string; prop: AnimProp; t: number }[];
  /** shots picked out on the timeline, moved and deleted as a group */
  selectedShots: string[];
  setSelectedKeys: (k: { shotId: string; prop: AnimProp; t: number }[]) => void;
  setSelectedShots: (ids: string[]) => void;
  /** shot whose image is being cropped */
  cropShot: string | null;
  /** Explicit canvas positioning mode; project identity prevents a stale mode after switching. */
  captionPosition: { projectId: string; shotId?: string; overlayId?: string } | null;
  setCropShot: (id: string | null) => void;
  /** onboarding tour step (null = not running) */
  tourStep: number | null;
  tourKind: TourKind;
  startTour: (kind: TourKind) => void;
  setTourStep: (s: number | null) => void;
  setGuides: (g: boolean) => void;
  setSnapCenter: (s: boolean) => void;
  setSounds: (s: boolean) => void;
  setTimelineHeight: (h: number) => void;

  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  toggleLoop: () => void;
  setRecording: (r: boolean) => void;
  setActiveShot: (id: string | null) => void;
  setActiveTextOverlay: (id: string | null) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setTimelineOpen: (o: boolean) => void;
  setTimelineMode: (m: "simple" | "advanced") => void;
  setTimelineZoom: (z: number) => void;
  setPicker: (p: Picker) => void;
  setCameraTab: (t: "manual" | "presets") => void;
  setAutoMotion: (a: boolean) => void;
  showToast: (text: string, action?: { label: string; onClick: () => void }) => void;
  clearToast: () => void;
  setExporting: (e: ExportProgress | null) => void;
  setModal: (m: UIState["modal"]) => void;
  setDragging: (d: boolean) => void;
  setViewport: (w: number, h: number) => void;
}

let toastId = 0;
const pref = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(`mok:${key}`); return v === null ? fallback : v === "1"; } catch { return fallback; } };
const savePref = (key: string, v: boolean) => { try { localStorage.setItem(`mok:${key}`, v ? "1" : "0"); } catch {} };
const bounded = (v: number, fallback: number, min: number, max: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const numberPref = (key: string, fallback: number, min: number, max: number) => {
  try { const v = localStorage.getItem(`mok:${key}`); return v === null ? fallback : bounded(Number(v), fallback, min, max); } catch { return fallback; }
};

export const useUI = create<UIState>()(subscribeWithSelector((set, get) => ({
  time: 0,
  playing: false,
  loop: true,
  recording: false,
  activeShotId: null,
  activeTextOverlayId: null,
  cameraPose: null,
  theme: "light",
  timelineOpen: true,
  timelineMode: (() => {
    try { return localStorage.getItem("mok:timelineMode") === "simple" ? "simple" : "advanced"; } catch { return "advanced"; }
  })() as "simple" | "advanced",
  timelineZoom: 1,
  picker: null,
  inspectorOpen: false,
  cameraTab: "manual",
  autoMotion: false,
  toast: null,
  exporting: null,
  modal: null,
  dragging: false,
  viewport: { w: 1200, h: 700 },
  hasInteracted: false,
  dpr: numberPref("dpr", 2, 1, 3),
  spaceHeld: false,
  spaceDragged: false,
  interacting: false,
  guides: false,
  snapCenter: pref("snapCenter", true),
  sounds: pref("sounds", true),
  captureShortcut: pref("captureShortcut", true),
  pasteMode: (() => { try { const value = localStorage.getItem("mok:pasteMode"); return value === "replace" || value === "add" ? value : "ask"; } catch { return "ask"; } })(),
  pasteRequest: null,
  setCaptureShortcut: (captureShortcut) => { set({ captureShortcut }); savePref("captureShortcut", captureShortcut); },
  setPasteMode: (pasteMode) => { set({ pasteMode }); try { localStorage.setItem("mok:pasteMode", pasteMode); } catch {} },
  setPasteRequest: (pasteRequest) => set({ pasteRequest }),
  timelineHeight: numberPref("timelineHeight", 216, 100, 500),
  selectedKeys: [],
  setSelectedKeys: (selectedKeys) => set({ selectedKeys, ...(selectedKeys.length ? { activeTextOverlayId: null, cameraPose: null } : {}) }),
  selectedShots: [],
  setSelectedShots: (selectedShots) => set({ selectedShots, ...(selectedShots.length ? { activeTextOverlayId: null } : {}) }),
  cropShot: null,
  captionPosition: null,
  setCropShot: (cropShot) => set({ cropShot }),
  tourStep: null,
  tourKind: "editor",
  startTour: (tourKind) => set({ tourKind, tourStep: 0, playing: false }),
  setTourStep: (tourStep) => set({ tourStep }),
  setGuides: (guides) => set({ guides }),
  setSnapCenter: (snapCenter) => { set({ snapCenter }); savePref("snapCenter", snapCenter); },
  setSounds: (sounds) => { set({ sounds }); savePref("sounds", sounds); },
  setTimelineHeight: (v) => { const timelineHeight = bounded(v, 216, 100, 500); set({ timelineHeight }); try { localStorage.setItem("mok:timelineHeight", String(timelineHeight)); } catch {} },
  setDpr: (v) => { const dpr = bounded(v, 2, 1, 3); set({ dpr }); try { localStorage.setItem("mok:dpr", String(dpr)); } catch {} },

  setTime: (time) => set({ time: bounded(time, 0, 0, Number.MAX_SAFE_INTEGER), cameraPose: null }),
  setPlaying: (playing) => set({ playing: playing && !get().recording, ...(playing ? { cameraPose: null } : {}) }),
  toggleLoop: () => set({ loop: !get().loop }),
  setRecording: (recording) => set({ recording, ...(recording ? { playing: false } : {}) }),
  setActiveShot: (activeShotId) => set({ activeShotId, activeTextOverlayId: null, cameraPose: null }),
  setActiveTextOverlay: (activeTextOverlayId) => set({ activeTextOverlayId, selectedKeys: [], selectedShots: [], cameraPose: null }),
  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem("mok:theme", theme);
      document.documentElement.classList.toggle("dark", theme === "dark");
    } catch {}
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  setTimelineMode: (timelineMode) => { set({ timelineMode, cameraPose: null }); try { localStorage.setItem("mok:timelineMode", timelineMode); } catch {} },
  setTimelineZoom: (timelineZoom) => set({ timelineZoom: bounded(timelineZoom, 1, 0.25, 8) }),
  setPicker: (picker) => set({ picker }),
  setCameraTab: (cameraTab) => set({ cameraTab }),
  setAutoMotion: (autoMotion) => set({ autoMotion }),
  showToast: (text, action) => set({ toast: { id: ++toastId, text, action } }),
  clearToast: () => set({ toast: null }),
  setExporting: (exporting) => set({ exporting }),
  setModal: (modal) => set({ modal }),
  setDragging: (dragging) => set({ dragging }),
  setViewport: (w, h) => set({ viewport: { w, h } }),
})));
