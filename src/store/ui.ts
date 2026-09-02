"use client";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { AnimProp } from "@/lib/types";

export type Picker = null | "device" | "scene";
export type Theme = "light" | "dark";

export interface ExportProgress {
  label: string;
  progress: number;
  cancel?: () => void;
}

interface UIState {
  time: number;
  playing: boolean;
  loop: boolean;
  recording: boolean;
  activeShotId: string | null;
  theme: Theme;
  timelineOpen: boolean;
  timelineMode: "simple" | "advanced";
  timelineZoom: number;
  picker: Picker;
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
  timelineHeight: number;
  /** selected keyframe diamonds on the timeline */
  selectedKeys: { shotId: string; prop: AnimProp; t: number }[];
  setSelectedKeys: (k: { shotId: string; prop: AnimProp; t: number }[]) => void;
  setGuides: (g: boolean) => void;
  setSnapCenter: (s: boolean) => void;
  setSounds: (s: boolean) => void;
  setTimelineHeight: (h: number) => void;

  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  toggleLoop: () => void;
  setRecording: (r: boolean) => void;
  setActiveShot: (id: string | null) => void;
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

export const useUI = create<UIState>()(subscribeWithSelector((set, get) => ({
  time: 0,
  playing: false,
  loop: true,
  recording: false,
  activeShotId: null,
  theme: "light",
  timelineOpen: true,
  timelineMode: "advanced",
  timelineZoom: 1,
  picker: null,
  cameraTab: "manual",
  autoMotion: false,
  toast: null,
  exporting: null,
  modal: null,
  dragging: false,
  viewport: { w: 1200, h: 700 },
  hasInteracted: false,
  dpr: (() => { try { return Number(localStorage.getItem("mok:dpr")) || 2; } catch { return 2; } })(),
  spaceHeld: false,
  spaceDragged: false,
  interacting: false,
  guides: false,
  snapCenter: pref("snapCenter", true),
  sounds: pref("sounds", true),
  timelineHeight: (() => { try { return Number(localStorage.getItem("mok:timelineHeight")) || 216; } catch { return 216; } })(),
  selectedKeys: [],
  setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
  setGuides: (guides) => set({ guides }),
  setSnapCenter: (snapCenter) => { set({ snapCenter }); savePref("snapCenter", snapCenter); },
  setSounds: (sounds) => { set({ sounds }); savePref("sounds", sounds); },
  setTimelineHeight: (timelineHeight) => { set({ timelineHeight }); try { localStorage.setItem("mok:timelineHeight", String(timelineHeight)); } catch {} },
  setDpr: (dpr) => { set({ dpr }); try { localStorage.setItem("mok:dpr", String(dpr)); } catch {} },

  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  toggleLoop: () => set({ loop: !get().loop }),
  setRecording: (recording) => set({ recording }),
  setActiveShot: (activeShotId) => set({ activeShotId }),
  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem("mok:theme", theme);
      document.documentElement.classList.toggle("dark", theme === "dark");
    } catch {}
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  setTimelineMode: (timelineMode) => set({ timelineMode }),
  setTimelineZoom: (timelineZoom) => set({ timelineZoom }),
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
