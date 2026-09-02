"use client";
import { create } from "zustand";
import type { RootState } from "@react-three/fiber";
import type { EffectComposer } from "postprocessing";

/** Non-reactive handles to the live R3F root, used by the export pipeline. */
export const viewport = {
  state: null as RootState | null,
  composer: null as EffectComposer | null,
  /** debug: mesh inventory of the currently loaded glTF device */
  glbInfo: null as null | (() => unknown),
};

interface RenderFlags {
  /** render with a transparent background (export) */
  transparent: boolean;
  /** hdr/model loading state for the overlay */
  loading: number;
  setTransparent: (t: boolean) => void;
}
export const useRenderFlags = create<RenderFlags>()((set) => ({
  transparent: false,
  loading: 0,
  setTransparent: (transparent) => set({ transparent }),
}));

/** Measured bounds of loaded glTF devices (scene units, after scale + rotation), keyed by device id. */
export interface ModelBounds { minY: number; maxY: number; width: number; height: number; screenAspect?: number }
export const useModelBounds = create<{ bounds: Record<string, ModelBounds>; set: (id: string, b: Partial<ModelBounds>) => void }>()((set) => ({
  bounds: {},
  set: (id, b) => set((s) => {
    const prev = s.bounds[id];
    const base: ModelBounds = prev ?? { minY: 0, maxY: 0, width: 0, height: 0 };
    const next: ModelBounds = { ...base, ...b };
    if (prev && prev.minY === next.minY && prev.width === next.width && prev.height === next.height && prev.screenAspect === next.screenAspect) return s;
    return { bounds: { ...s.bounds, [id]: next } };
  }),
}));

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
