"use client";
import { useEffect, useRef } from "react";
import { beginInteraction, endInteraction, useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { cn, clamp } from "@/lib/cn";
import { canEditProject } from "@/lib/projectOwnership";
import { captureEditIntent } from "@/lib/editIntent";
import { trimTextOverlay } from "@/lib/textOverlays";
import type { TextOverlay } from "@/lib/types";

const MIME = "application/x-mok-text-track";
export function selectTextTrack(track: TextOverlay) {
  const ui = useUI.getState();
  useUI.setState({ activeTextOverlayId: track.id, cameraPose: null, selectedShots: [], selectedKeys: [], playing: false,
    time: ui.time >= track.start && ui.time < track.start + track.duration ? ui.time : track.start + Math.min(track.duration / 2, track.enter?.duration ?? 0), inspectorOpen: true });
}
function dropTrack(e: React.DragEvent, layer: TextOverlay["layer"], targetId?: string) {
  const id = e.dataTransfer.getData(MIME);
  if (!id || id === targetId) return;
  e.preventDefault(); e.stopPropagation();
  const after = e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2;
  useEditor.getState().update((p) => {
    const track = p.textOverlays?.find((t) => t.id === id);
    if (!track) return;
    p.textOverlays = p.textOverlays!.filter((t) => t.id !== id); track.layer = layer;
    const index = targetId ? p.textOverlays.findIndex((t) => t.id === targetId) : -1;
    p.textOverlays.splice(index < 0 ? p.textOverlays.length : index + (after ? 1 : 0), 0, track);
  });
}
const dragOver = (e: React.DragEvent) => { if (e.dataTransfer.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } };
export function TextLayerLabel({ layer }: { layer: TextOverlay["layer"] }) {
  return <div data-text-layer={layer} onDragOver={dragOver} onDrop={(e) => dropTrack(e, layer)} className="label-sm flex h-6 items-center border-b border-line bg-fill/40 px-3 text-muted">{layer === "front" ? "In front of device" : "Behind device"}</div>;
}
export function TextTrackLabel({ track, active }: { track: TextOverlay; active: boolean }) {
  return <div draggable data-text-label={track.id} onDragStart={(e) => { e.dataTransfer.setData(MIME, track.id); e.dataTransfer.effectAllowed = "move"; }} onDragOver={dragOver} onDrop={(e) => dropTrack(e, track.layer, track.id)} onClick={() => selectTextTrack(track)} className={cn("group flex h-[30px] cursor-grab items-center gap-1 border-b border-line px-2", active && "bg-accent-soft/60")}>
    <Icon name="type" size={11} className="shrink-0 text-accent" />
    <span className="label min-w-0 flex-1 truncate" title={track.name}>{track.name}</span>
    <IconButton icon={track.enabled ? "eye" : "eye-off"} size={11} label={track.enabled ? `Hide ${track.name}` : `Show ${track.name}`} onClick={(e) => { e.stopPropagation(); useEditor.getState().updateTextOverlay(track.id, (t) => { t.enabled = !t.enabled; }); }} className="h-5 w-5" />
    <IconButton icon={track.layer === "front" ? "chevron-down" : "chevron-up"} size={11} label={track.layer === "front" ? `Move ${track.name} behind device` : `Move ${track.name} in front of device`} onClick={(e) => { e.stopPropagation(); useEditor.getState().updateTextOverlay(track.id, (t) => { t.layer = t.layer === "front" ? "behind" : "front"; }); }} className="h-5 w-5" />
  </div>;
}

type Drag = { pointer: number; x: number; mode: "move" | "start" | "end" | "enter" | "exit"; original: TextOverlay; intent: ReturnType<typeof captureEditIntent> };
export function TextTrackBar({ track, active, pps }: { track: TextOverlay; active: boolean; pps: number }) {
  const drag = useRef<Drag | null>(null);
  const finish = (restore = false) => {
    const d = drag.current; if (!d) return; drag.current = null;
    if (restore && d.intent.current()) useEditor.getState().updateTextOverlay(d.original.id, (t) => { Object.assign(t, structuredClone(d.original)); if (!d.original.timing) delete t.timing; });
    d.intent.dispose(); endInteraction();
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && drag.current) { e.preventDefault(); finish(true); } };
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("keydown", escape, true); finish(); };
  }, []);
  const down = (e: React.PointerEvent, mode: Drag["mode"]) => {
    if (e.button !== 0 || !e.isPrimary || drag.current || !canEditProject(useEditor.getState().project.id)) return;
    e.preventDefault(); e.stopPropagation(); selectTextTrack(track);
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, mode, original: structuredClone(track), intent: captureEditIntent((p) => !!p.textOverlays?.some((t) => t.id === track.id)) }; beginInteraction();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    e.stopPropagation();
    if (!d.intent.current()) { finish(); return; }
    const delta = (e.clientX - d.x) / pps;
    const snap = (v: number) => e.shiftKey ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10;
    useEditor.getState().updateTextOverlay(track.id, (t) => {
      const o = d.original;
      if (d.mode === "move") t.start = clamp(snap(o.start + delta), 0, 180 - o.duration);
      else if (d.mode === "start" || d.mode === "end") trimTextOverlay(t, o, d.mode, snap((d.mode === "start" ? o.start : o.start + o.duration) + delta));
      else { const fx = t[d.mode] ?? { effect: "fade", duration: 0 }; fx.duration = clamp(snap((o[d.mode]?.duration ?? 0) + delta * (d.mode === "exit" ? -1 : 1)), 0, o.duration / 2); if (fx.effect === "none") fx.effect = "fade"; t[d.mode] = fx; delete t.timing; }
    });
  };
  const end = (e: React.PointerEvent, restore = false) => { if (drag.current?.pointer !== e.pointerId) return; e.stopPropagation(); finish(restore); };
  return <div className="relative h-[30px] border-b border-line" data-text-row={track.id}>
    <div data-text-overlay={track.id} role="button" tabIndex={0} aria-label={`Text track ${track.name}`} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); selectTextTrack(track); } }} onPointerDown={(e) => down(e, "move")} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)} onLostPointerCapture={(e) => end(e)} className={cn("absolute top-1 flex h-[22px] touch-none cursor-grab items-center overflow-hidden rounded border px-3 text-[11px]", active ? "border-accent bg-accent-soft text-fg" : "border-line-2 bg-fill-2 text-fg-2", !track.enabled && "opacity-40")} style={{ left: 8 + track.start * pps, width: Math.max(12, track.duration * pps) }}>
      <span className="pointer-events-none truncate">{track.text.text || track.name}</span>
      {(["start", "end"] as const).map((edge) => <button key={edge} aria-label={`Trim text ${edge}`} onPointerDown={(e) => down(e, edge)} className={cn("absolute inset-y-0 z-10 w-2 cursor-ew-resize bg-accent/20 hover:bg-accent/50", edge === "start" ? "left-0" : "right-0")} />)}
      {(["enter", "exit"] as const).map((edge) => <button key={edge} aria-label={`Adjust text ${edge} animation`} title={`${edge === "enter" ? "Enter" : "Exit"} animation: ${(track[edge]?.duration ?? 0).toFixed(1)}s`} onPointerDown={(e) => down(e, edge)} style={{ [edge === "enter" ? "left" : "right"]: Math.max(8, (track[edge]?.duration ?? 0) * pps) }} className="absolute top-0 h-2 w-2 cursor-ew-resize bg-accent [clip-path:polygon(0_0,100%_0,50%_100%)]" />)}
    </div>
  </div>;
}
