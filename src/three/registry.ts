"use client";
import { create } from "zustand";
import type { RootState } from "@react-three/fiber";
import type { EffectComposer } from "postprocessing";
import type { RenderQualityPlan } from "./qualityPlan";

export interface LinearCapture {
  beginFrame(samples: number): void;
  /** Arm exactly one deterministic advance; incidental React renders cannot add exposure. */
  beginSample(): void;
  endFrame(): void;
  cancel(): void;
}

/** Non-reactive handles to the live R3F root, used by the export pipeline. */
export const viewport = {
  /** live getter for the R3F root; calling it returns the current state, never a stale snapshot */
  get: null as null | (() => RootState),
  get state(): RootState | null { return viewport.get ? viewport.get() : null; },
  composer: null as EffectComposer | null,
  linearCapture: null as LinearCapture | null,
  metrics: null as null | { cpuMs: number; gpuMs: number | null; calls: number; triangles: number; textures: number; geometries: number; frame: number },
  /** debug: mesh inventory of the currently loaded glTF device */
  glbInfo: null as null | (() => unknown),
};

interface RenderFlags {
  previewScale: number;
  qualityPlan: RenderQualityPlan | null;
  setQualityPlan: (plan: RenderQualityPlan | null) => void;
  /** Use export-quality buffers even when the requested dimensions match the preview. */
  exporting: boolean;
  setExporting: (value: boolean) => void;
  /** render with a transparent background (export) */
  transparent: boolean;
  /** hdr/model loading state for the overlay */
  loading: number;
  setTransparent: (t: boolean) => void;
}
export const useRenderFlags = create<RenderFlags>()((set) => ({
  previewScale: 1,
  qualityPlan: null,
  setQualityPlan: (qualityPlan) => set({ qualityPlan }),
  exporting: false,
  setExporting: (exporting) => set({ exporting }),
  transparent: false,
  loading: 0,
  setTransparent: (transparent) => set({ transparent }),
}));

/**
 * The glTF device actually on screen. It lags the picked one for as long as a newly picked model
 * takes to prepare, so the framing and the screen canvas can stay with the device still being shown
 * instead of jumping to a model that is not there yet.
 */
export const useShownDevice = create<{ id: string | null; set: (id: string | null) => void }>()((set) => ({
  id: null,
  set: (id) => set({ id }),
}));

/** Measured bounds of loaded glTF devices (scene units, after scale + rotation), keyed by device id. */
export interface ModelFeatures { lid: boolean; island: boolean; caseParts: boolean; band: boolean }
export interface ModelBounds { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number; screenAspect?: number; features?: ModelFeatures }
export const useModelBounds = create<{ bounds: Record<string, ModelBounds>; set: (id: string, b: Partial<ModelBounds>) => void }>()((set) => ({
  bounds: {},
  set: (id, b) => set((s) => {
    const prev = s.bounds[id];
    const base: ModelBounds = prev ?? { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
    const next: ModelBounds = { ...base, ...b };
    const f = prev?.features, g = next.features;
    const sameF = (!f && !g) || (!!f && !!g && f.lid === g.lid && f.island === g.island && f.caseParts === g.caseParts && f.band === g.band);
    if (prev && prev.minX === next.minX && prev.maxX === next.maxX && prev.minY === next.minY && prev.maxY === next.maxY && prev.width === next.width && prev.height === next.height && prev.screenAspect === next.screenAspect && sameF) return s;
    return { bounds: { ...s.bounds, [id]: next } };
  }),
}));

/**
 * One frame's worth of waiting. A hidden tab stops servicing requestAnimationFrame entirely, which
 * would park an export mid-encode until the window came back, so a timer takes over while the page
 * is in the background and the export keeps running.
 */
export function nextFrame(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return new Promise((r) => setTimeout(r, 16));
  return new Promise((r) => requestAnimationFrame(() => r()));
}
