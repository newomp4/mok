"use client";
import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useEditor, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { getAspect } from "@/lib/presets";
import { Viewport } from "@/three/Viewport";
import { extractFiles } from "@/lib/media";
import { addAudioFile, importFilesToShot } from "@/lib/actions";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";
import { useActiveShot } from "@/three/Device";
import { AutoMotionOverlay } from "./AutoMotion";
import { pickFiles } from "./hooks";
import { anim } from "@/three/anim";
import { locate, sampleTrack } from "@/lib/animation";
import { useShallow } from "zustand/react/shallow";
import { ACCEPTED_TYPES } from "@/lib/media";
import { shotKind } from "@/lib/defaults";

let interactTimer: number | null = null;
function markInteracting() {
  const ui = useUI.getState();
  if (!ui.interacting) useUI.setState({ interacting: true });
  if (interactTimer) window.clearTimeout(interactTimer);
  interactTimer = window.setTimeout(() => { useUI.setState({ interacting: false }); interactTimer = null; }, 250);
}

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
  const toast = useUI((s) => s.toast);
  if (shot?.media || dragging || toast || shotKind(shot) !== "media") return null;
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
  const dprPref = useUI((s) => s.dpr);
  const interacting = useUI((s) => s.interacting);
  // ease the GPU while the user is dragging or zooming; full resolution settles back 250 ms later
  const dpr = interacting && dprPref > 1.5 ? 1.5 : dprPref;
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
    if (e.altKey && e.button === 0) {
      // place the blur focal point
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
      useEditor.getState().setValues({ "blur.focusX": Math.round(fx * 1000) / 1000, "blur.focusY": Math.round(fy * 1000) / 1000 });
      return;
    }
    const ui = useUI.getState();
    const mode: "orbit" | "pan" = ui.spaceHeld || e.button === 1 || e.button === 2 || e.shiftKey ? "pan" : "orbit";
    if (ui.spaceHeld) useUI.setState({ spaceDragged: true });
    const c = current();
    drag.current = { x: e.clientX, y: e.clientY, mode, start: { cx: c.cx, cy: c.cy, px: c.px, py: c.py } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    beginInteraction();
    markInteracting();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const ed = useEditor.getState();
    if (d.mode === "pan") {
      const h = Math.max(1, frame.h);
      let px = d.start.px + dx / h, py = d.start.py - dy / h;
      if (useUI.getState().snapCenter) { if (Math.abs(px) < 0.025) px = 0; if (Math.abs(py) < 0.025) py = 0; }
      ed.setValues({ "camera.panX": px, "camera.panY": py });
    } else {
      // Ultramock feel: half a degree per pixel; dragging down lowers the camera
      ed.setValues({ "camera.x": d.start.cx - dx * 0.5, "camera.y": clamp(d.start.cy + dy * 0.5, -89, 89) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    endInteraction();
    markInteracting();
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
      markInteracting();
      timer = window.setTimeout(() => { endInteraction(); timer = null; }, 250);
      // one mouse notch is ~100 units; a trackpad flings far more, so cap each event
      const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const delta = clamp(raw, -120, 120);
      // linear in camera distance, at Ultramock's measured rate (100 wheel units ≈ a sixth of the fit distance)
      const dist = 1 / zoom;
      const next = clamp(dist + delta * (e.ctrlKey ? 0.0035 : 0.0017), 0.12, 6);
      zoom = 1 / next;
      ed.setValue("camera.zoom", Math.round(zoom * 1000) / 1000);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); if (timer) window.clearTimeout(timer); };
  }, [frame.w, frame.h]);

  const [dropZone, setDropZone] = useState<"replace" | "new" | "audio" | null>(null);
  const onDrop = (e: React.DragEvent, zone: "replace" | "new" | "audio" | null) => {
    e.preventDefault();
    setDragging(false);
    setDropZone(null);
    const files = extractFiles(e.dataTransfer);
    if (!files.length) return;
    const audio = files[0].type.startsWith("audio/");
    if (zone === "audio" || audio) { void addAudioFile(files[0]); return; }
    if (zone === "new") {
      const ed = useEditor.getState();
      const id = ed.addShot("media", useUI.getState().activeShotId ?? undefined);
      void importFilesToShot(files, id);
      return;
    }
    void importFilesToShot(files);
  };

  const transparent = scenePreset === "custom" && bgType === "transparent";

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel-2"
      data-tour="viewport"
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) { setDragging(false); setDropZone(null); } }}
      onDrop={(e) => onDrop(e, dropZone)}
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
        <FocusMarker />
        <Guides />
      </div>
      <LoadingPill />
      <UploadHint />
      <Toast />
      {dragging && (
        // choose what the drop does, rather than always replacing the current shot
        <div className="absolute inset-0 z-30 grid grid-cols-3 gap-2 bg-black/35 p-3 backdrop-blur-[2px]">
          {([
            { id: "replace" as const, icon: "image", title: "Replace source", sub: "Put it on this shot" },
            { id: "new" as const, icon: "plus", title: "Add as new shot", sub: "Keep what is here" },
            { id: "audio" as const, icon: "audio", title: "Audio track", sub: "Music or voiceover" },
          ]).map((z) => (
            <div
              key={z.id}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropZone(z.id); }}
              onDragLeave={() => setDropZone((d) => (d === z.id ? null : d))}
              onDrop={(e) => { e.stopPropagation(); onDrop(e, z.id); }}
              className={cn("flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center transition-colors", dropZone === z.id ? "border-accent bg-accent/20" : "border-white/40 bg-white/5")}
            >
              <Icon name={z.icon} size={18} className="text-white" />
              <span className="label text-white">{z.title}</span>
              <span className="label-sm text-white/70">{z.sub}</span>
            </div>
          ))}
        </div>
      )}
      {autoMotion && <AutoMotionOverlay />}
      <div className="pointer-events-none absolute left-3 top-3 z-10 hidden gap-1 lg:flex">
        <Hint>Drag · orbit</Hint><Hint>Scroll · zoom</Hint><Hint>Space + drag · pan</Hint>
      </div>
    </div>
  );
}

/**
 * Blur focus guides: a circle for radial, a line for directional, a pair for tilt shift and a
 * crosshair for lens. Solid marks where the blur starts, dashed shows the falloff. They appear
 * while you adjust the blur (or hold Alt) and fade out again, so they never sit in a capture.
 */
function FocusMarker() {
  const mode = useEditor((s) => s.project.blur.mode);
  const angle = useEditor((s) => s.project.blur.angle ?? 0);
  const time = useUI((s) => s.time);
  const v = useEditor(useShallow((s) => {
    const loc = locate(s.project, time);
    const at = (prop: "blur.focusX" | "blur.focusY" | "blur.focusSize" | "blur.falloff") => {
      const [, k] = prop.split(".") as [string, keyof typeof s.project.blur];
      const track = loc.shot?.keyframes[prop];
      return track?.length ? sampleTrack(track, loc.localT) : (s.project.blur[k] as number);
    };
    return { x: at("blur.focusX"), y: at("blur.focusY"), size: at("blur.focusSize"), falloff: at("blur.falloff") };
  }));
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: number | null = null;
    const show = () => { setVisible(true); if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => setVisible(false), 1600); };
    const unsub = useEditor.subscribe((s) => s.project.blur, (a, b) => { if (a !== b) show(); });
    const unsubShot = useEditor.subscribe((s) => s.project.shots, () => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Alt") setVisible(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Alt") show(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    return () => { unsub(); unsubShot(); document.removeEventListener("keydown", onKey); document.removeEventListener("keyup", onKeyUp); if (timer) window.clearTimeout(timer); };
  }, []);
  if (mode === "off" || !visible) return null;
  const cx = v.x * 100, cy = v.y * 100;
  // the shader measures distance with x scaled by the aspect, so the guide is a circle in y units
  const r1 = v.size * 100, r2 = (v.size + v.falloff) * 100;
  const line = (offset: number, dashed: boolean) => (
    <div key={`${offset}${dashed}`} className="absolute inset-x-[-20%] border-t" style={{ top: `${cy + offset}%`, borderColor: dashed ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.9)", borderStyle: dashed ? "dashed" : "solid", transform: mode === "directional" ? `rotate(${-angle}deg)` : undefined, transformOrigin: `${cx}% 50%` }} />
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden mix-blend-difference">
      {mode === "radial" || mode === "depth" ? (
        <>
          {mode === "radial" && [r1, r2].map((r, i) => (
            <div key={i} className="absolute rounded-full border" style={{ left: `${cx}%`, top: `${cy}%`, width: `${r * 2}%`, aspectRatio: "1", transform: "translate(-50%, -50%)", borderColor: i ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.85)", borderStyle: i ? "dashed" : "solid" }} />
          ))}
          <div className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90" style={{ left: `${cx}%`, top: `${cy}%` }}>
            <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </div>
        </>
      ) : mode === "linear" ? (
        [line(-r1, false), line(r1, false), line(-r2, true), line(r2, true)]
      ) : (
        [line(0, false), line(-r2 / 2, true), line(r2 / 2, true)]
      )}
    </div>
  );
}

/** Centre guides: exact middle of the frame while composing. */
function Guides() {
  const on = useUI((s) => s.guides);
  if (!on) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 mix-blend-difference">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/70" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/70" />
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="label-sm rounded-md bg-panel/80 px-1.5 py-1 text-muted backdrop-blur">{children}</span>;
}
