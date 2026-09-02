"use client";
import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useEditor, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { getAspect } from "@/lib/presets";
import { Viewport } from "@/three/Viewport";
import { extractFiles } from "@/lib/media";
import { importFilesToShot } from "@/lib/actions";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";
import { useActiveShot } from "@/three/Device";
import { AutoMotionOverlay } from "./AutoMotion";
import { pickFiles } from "./hooks";
import { anim } from "@/three/anim";
import { ACCEPTED_TYPES } from "@/lib/media";

function Toast() {
  const toast = useUI((s) => s.toast);
  const clear = useUI((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(clear, 4200);
    return () => window.clearTimeout(t);
  }, [toast, clear]);
  if (!toast) return null;
  return (
    <div className="fade-in pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/85 px-4 py-2 text-[12px] text-white shadow-lg backdrop-blur">
      <span>{toast.text}</span>
      {toast.action && (
        <button type="button" onClick={() => { toast.action?.onClick(); clear(); }} className="label rounded-full bg-white px-2.5 py-1 text-black">{toast.action.label}</button>
      )}
    </div>
  );
}

function LoadingPill() {
  const { active, progress } = useProgress();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (active) { setShow(true); return; }
    const t = window.setTimeout(() => setShow(false), 250);
    return () => window.clearTimeout(t);
  }, [active]);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex w-48 -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg bg-panel/90 px-4 py-3 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="label text-fg-2">Loading…</span>
        <span className="num text-[11px] text-fg">{Math.round(progress)}%</span>
      </div>
      <div className="h-0.5 overflow-hidden rounded bg-fill-2"><div className="h-full bg-fg transition-[width]" style={{ width: `${progress}%` }} /></div>
    </div>
  );
}

function UploadHint() {
  const shot = useActiveShot();
  const dragging = useUI((s) => s.dragging);
  if (shot?.media || dragging) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/85 py-1.5 pl-4 pr-1.5 text-[12px] text-white shadow-lg backdrop-blur">
      <span>Upload media to get started — or paste / drop.</span>
      <button type="button" onClick={() => void pickFiles(ACCEPTED_TYPES).then((f) => importFilesToShot(f))} className="label rounded-full bg-white px-3 py-1.5 text-black">Upload</button>
    </div>
  );
}

export function ViewportPane() {
  const aspect = useEditor((s) => s.project.aspect);
  const bgType = useEditor((s) => s.project.scene.background.type);
  const scenePreset = useEditor((s) => s.project.scene.preset);
  const dpr = useUI((s) => s.dpr);
  const dragging = useUI((s) => s.dragging);
  const setDragging = useUI((s) => s.setDragging);
  const setViewport = useUI((s) => s.setViewport);
  const autoMotion = useUI((s) => s.autoMotion);
  const containerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const ratio = getAspect(aspect).ratio;
  const no3d = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("no3d");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (ratio === null) { setFrame({ w: W, h: H }); setViewport(W, H); return; }
      let w = W, h = W / ratio;
      if (h > H) { h = H; w = H * ratio; }
      w = Math.floor(w); h = Math.floor(h);
      setFrame({ w, h });
      setViewport(w, h);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio, setViewport]);

  // orbit / pan / zoom — always start from the values currently on screen (keyframed or not)
  const drag = useRef<{ x: number; y: number; mode: "orbit" | "pan"; start: Record<string, number> } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const current = () => {
    const v = anim.values;
    const c = useEditor.getState().project.camera;
    return {
      cx: v ? v["camera.x"] : c.x, cy: v ? v["camera.y"] : c.y,
      px: v ? v["camera.panX"] : c.panX, py: v ? v["camera.panY"] : c.panY,
      zoom: v ? v["camera.zoom"] : c.zoom,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    const ui = useUI.getState();
    const mode: "orbit" | "pan" = ui.spaceHeld || e.button === 1 || e.button === 2 || e.shiftKey ? "pan" : "orbit";
    if (ui.spaceHeld) useUI.setState({ spaceDragged: true });
    const c = current();
    drag.current = { x: e.clientX, y: e.clientY, mode, start: { cx: c.cx, cy: c.cy, px: c.px, py: c.py } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    beginInteraction();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const ed = useEditor.getState();
    if (d.mode === "pan") {
      const h = Math.max(1, frame.h);
      ed.setValues({ "camera.panX": d.start.px + dx / h, "camera.panY": d.start.py - dy / h });
    } else {
      ed.setValues({ "camera.x": d.start.cx - dx * 0.35, "camera.y": clamp(d.start.cy + dy * 0.35, -89, 89) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    endInteraction();
  };

  // wheel / pinch zoom: non-passive so the browser never page-zooms, accumulated per gesture
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    let timer: number | null = null;
    let zoom = 1;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ed = useEditor.getState();
      if (timer === null) { beginInteraction(); zoom = current().zoom; }
      else window.clearTimeout(timer);
      timer = window.setTimeout(() => { endInteraction(); timer = null; }, 250);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
      zoom = clamp(zoom * factor, 0.2, 8);
      ed.setValue("camera.zoom", Math.round(zoom * 1000) / 1000);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); if (timer) window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.w, frame.h]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = extractFiles(e.dataTransfer);
    if (files.length) void importFilesToShot(files);
  };

  const transparent = scenePreset === "custom" && bgType === "transparent";

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel-2"
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <div
        ref={frameRef}
        className={cn("relative overflow-hidden touch-none", ratio !== null && "rounded-md shadow-[0_0_0_1px_var(--line)]", transparent && "checker")}
        style={{ width: frame.w || "100%", height: frame.h || "100%", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {frame.w > 0 && !no3d && <Viewport dpr={dpr} />}
      </div>
      <LoadingPill />
      <UploadHint />
      <Toast />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-full bg-panel px-4 py-2 shadow-lg">
            <Icon name="upload" size={14} className="text-accent" />
            <span className="label text-fg">Drop to use as source</span>
          </div>
        </div>
      )}
      {autoMotion && <AutoMotionOverlay />}
      <div className="pointer-events-none absolute left-3 top-3 z-10 hidden gap-1 lg:flex">
        <Hint>Drag · orbit</Hint><Hint>Scroll · zoom</Hint><Hint>Space + drag · pan</Hint>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="label-sm rounded-md bg-panel/80 px-1.5 py-1 text-muted backdrop-blur">{children}</span>;
}
