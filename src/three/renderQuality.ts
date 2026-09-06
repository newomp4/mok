"use client";
import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useRenderFlags } from "@/three/registry";
import { rasterSize } from "@/three/raster";

/** Fixed tiers avoid reallocating large square buffers while the preview is resized. */
export function renderQuality(width: number, height: number, dpr: number, exporting: boolean, maxTextureSize: number) {
  const limit = Math.max(1, Math.floor(Number.isFinite(maxTextureSize) ? maxTextureSize : 1));
  const ratio = exporting ? 1 : Math.max(1, Math.min(2, Number.isFinite(dpr) ? dpr : 1));
  const high = exporting && Math.max(width, height) > 2048;
  const reflection = rasterSize(width * ratio * (exporting ? 0.85 : 0.6), height * ratio * (exporting ? 0.85 : 0.6), Math.min(limit, exporting ? 2560 : 1440), exporting ? 4_000_000 : 1_500_000);
  return {
    reflection,
    floor: Math.min(limit, high ? 2048 : 1024),
    contact: Math.min(limit, high ? 2048 : 1024),
    shadow: Math.min(limit, high ? 4096 : 2048),
  };
}

export function useRenderQuality() {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const limit = useThree((s) => s.gl.capabilities.maxTextureSize);
  const exporting = useRenderFlags((s) => s.exporting);
  return useMemo(() => renderQuality(width, height, dpr, exporting, limit), [width, height, dpr, exporting, limit]);
}

/** Three does not resize existing shadow targets when mapSize changes. Release both VSM targets. */
export function resizeShadowMap(shadow: THREE.LightShadow, resolution: number): void {
  shadow.mapSize.set(resolution, resolution);
  if ((!shadow.map || (shadow.map.width === resolution && shadow.map.height === resolution)) &&
      (!shadow.mapPass || (shadow.mapPass.width === resolution && shadow.mapPass.height === resolution))) return;
  shadow.map?.dispose();
  shadow.mapPass?.dispose();
  shadow.map = null;
  shadow.mapPass = null;
  shadow.needsUpdate = true;
}
