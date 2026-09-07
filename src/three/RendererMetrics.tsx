"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useUI } from "@/store/ui";
import { anim } from "./anim";
import { useRenderFlags, viewport } from "./registry";
import { pollGpuQueries } from "./gpuTiming";

/** Whole-frame counters and nonblocking GPU timing; capability absence never prevents rendering. */
export function RendererMetrics() {
  const renderer = useThree((s) => s.gl);
  const state = useRef({ start: 0, frame: 0, slow: 0, fast: 0, gpuMs: null as number | null, active: null as WebGLQuery | null, pending: [] as WebGLQuery[] });
  const ext = useRef<{ TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null>(null);
  useEffect(() => {
    const gl = (renderer.getContext() as WebGL2RenderingContext);
    ext.current = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const previous = renderer.info.autoReset;
    renderer.info.autoReset = false;
    const timing = state.current;
    return () => {
      if (timing.active && ext.current && !gl.isContextLost()) gl.endQuery(ext.current.TIME_ELAPSED_EXT);
      if (timing.active) gl.deleteQuery(timing.active);
      for (const query of timing.pending) gl.deleteQuery(query);
      timing.pending.length = 0;
      timing.active = null;
      renderer.info.autoReset = previous;
      viewport.metrics = null;
    };
  }, [renderer]);
  useFrame(() => {
    const s = state.current, gl = (renderer.getContext() as WebGL2RenderingContext), extension = ext.current;
    s.start = performance.now();
    renderer.info.reset();
    if (!extension || gl.isContextLost()) return;
    pollGpuQueries(gl, extension, s);
    if (s.frame % 15 === 0 && s.pending.length < 3 && !gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
      s.active = gl.createQuery();
      if (s.active) gl.beginQuery(extension.TIME_ELAPSED_EXT, s.active);
    }
  }, -1000);
  useFrame(() => {
    const s = state.current, gl = (renderer.getContext() as WebGL2RenderingContext);
    if (s.active && ext.current) {
      if (!gl.isContextLost()) { gl.endQuery(ext.current.TIME_ELAPSED_EXT); s.pending.push(s.active); }
      else gl.deleteQuery(s.active);
      s.active = null;
    }
    const cpuMs = performance.now() - s.start;
    viewport.metrics = { cpuMs, gpuMs: s.gpuMs, frame: ++s.frame, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
    const ui = useUI.getState();
    if (anim.exporting || (!ui.playing && !ui.interacting)) { s.slow = s.fast = 0; return; }
    const cost = Math.max(cpuMs, s.gpuMs ?? 0);
    s.slow = cost > 32 ? s.slow + 1 : 0;
    s.fast = cost < 15 ? s.fast + 1 : 0;
    const scale = useRenderFlags.getState().previewScale;
    if (s.slow >= 20 && scale > 0.5) { useRenderFlags.setState({ previewScale: Math.max(0.5, scale - 0.25) }); s.slow = s.fast = 0; }
    else if (s.fast >= 80 && scale < 1) { useRenderFlags.setState({ previewScale: Math.min(1, scale + 0.25) }); s.slow = s.fast = 0; }
  }, 3);
  return null;
}
