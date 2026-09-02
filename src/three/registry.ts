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

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
