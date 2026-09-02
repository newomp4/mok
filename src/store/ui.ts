"use client";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

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
  modal: null | "info" | "shortcuts" | "projects" | "preferences" | "changelog";
  dragging: boolean;
  viewport: { w: number; h: number };
  hasInteracted: boolean;
  dpr: number;
  setDpr: (d: number) => void;

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
