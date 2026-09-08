"use client";
import { useEffect, useRef } from "react";
import { beginInteraction, endInteraction, useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { canPositionCaption, positionedCaption, updateCaptionPosition } from "@/lib/captionPosition";
import { captureEditIntent } from "@/lib/editIntent";
import { useProjectOwnership } from "@/lib/projectOwnership";
import { clamp } from "@/lib/cn";
import { Button } from "@/components/ui";

/** An explicit DOM tool keeps caption dragging separate from device orbit and from exported pixels. */
export function CaptionPositionOverlay() {
  const mode = useUI((s) => s.captionPosition);
  const caption = useEditor((s) => positionedCaption(s.project, mode));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; fromX: number; fromY: number; intent: ReturnType<typeof captureEditIntent> } | null>(null);
  const finish = (restore = false) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (restore && mode && d.intent.current()) updateCaptionPosition(mode, d.fromX, d.fromY);
    d.intent.dispose(); endInteraction();
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    const check = () => {
      if (useUI.getState().captionPosition && !canPositionCaption()) { finishRef.current(); useUI.setState({ captionPosition: null }); }
    };
    check();
    const a = useEditor.subscribe(check), b = useUI.subscribe(check), c = useProjectOwnership.subscribe(check);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !useUI.getState().captionPosition) return;
      e.preventDefault(); e.stopPropagation(); finishRef.current(true); useUI.setState({ captionPosition: null });
    };
    window.addEventListener("keydown", escape, true);
    return () => { a(); b(); c(); window.removeEventListener("keydown", escape, true); finishRef.current(); };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, [mode]);
  if (!mode || !caption || !canPositionCaption()) return null;
  return <div ref={ref} data-caption-position="" role="region" aria-label="Position caption on canvas" className="absolute inset-0 z-20 cursor-move touch-none outline outline-2 -outline-offset-2 outline-accent/60"
    onPointerDown={(e) => {
      e.stopPropagation();
      if (e.button !== 0 || !e.isPrimary || drag.current || (e.target as HTMLElement).closest("button") || !canPositionCaption()) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, fromX: caption.x, fromY: caption.y, intent: captureEditIntent(() => canPositionCaption()) };
      beginInteraction();
    }}
    onPointerMove={(e) => {
      e.stopPropagation(); const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      if (!d.intent.current()) { finish(); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      let x = clamp(d.fromX + (e.clientX - d.x) / Math.max(1, rect.width), -.5, .5), y = clamp(d.fromY - (e.clientY - d.y) / Math.max(1, rect.height), -.5, .5);
      if (useUI.getState().snapCenter) { if (Math.abs(x) < .01) x = 0; if (Math.abs(y) < .01) y = 0; }
      updateCaptionPosition(mode, Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
    }}
    onPointerUp={(e) => { e.stopPropagation(); if (drag.current?.pointerId === e.pointerId) finish(); }} onPointerCancel={(e) => { e.stopPropagation(); if (drag.current?.pointerId === e.pointerId) finish(true); }} onLostPointerCapture={(e) => { e.stopPropagation(); if (drag.current?.pointerId === e.pointerId) finish(); }}
    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
    <div className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-black/25 shadow" style={{ left: `${(caption.x + .5) * 100}%`, top: `${(.5 - caption.y) * 100}%` }}><div className="absolute left-1/2 top-1 h-5 w-px bg-white/80" /><div className="absolute left-1 top-1/2 h-px w-5 bg-white/80" /></div>
    <div className="absolute left-1/2 top-3 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-lg">
      <span className="label min-w-0 text-center">Drag caption · Esc to exit</span>
      <Button size="sm" onClick={() => { finish(); useUI.setState({ captionPosition: null }); }}>Done</Button>
    </div>
  </div>;
}
