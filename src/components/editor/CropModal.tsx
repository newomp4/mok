"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { importMedia, useMedia } from "@/lib/media";
import { getDevice } from "@/lib/devices";
import { setShotMedia } from "@/lib/actions";
import { Button, Modal, Segmented } from "@/components/ui";
import { clamp } from "@/lib/cn";

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: { id: Handle; cls: string }[] = [
  { id: "nw", cls: "-left-1.5 -top-1.5 cursor-nwse-resize" }, { id: "n", cls: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" }, { id: "ne", cls: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { id: "w", cls: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" }, { id: "e", cls: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { id: "sw", cls: "-left-1.5 -bottom-1.5 cursor-nesw-resize" }, { id: "s", cls: "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize" }, { id: "se", cls: "-right-1.5 -bottom-1.5 cursor-nwse-resize" },
];

/** Crop the selected shot's image: drag the frame or its handles, pick an aspect, apply. */
export function CropModal() {
  const cropShot = useUI((s) => s.cropShot);
  const setCropShot = useUI((s) => s.setCropShot);
  const toast = useUI((s) => s.showToast);
  const shot = useEditor((s) => s.project.shots.find((x) => x.id === cropShot) ?? null);
  const deviceId = useEditor((s) => s.project.mockup.device);
  const media = useMedia(shot?.media);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [aspect, setAspect] = useState<string>("free");
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: Rect; px: number; py: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRect({ x: 0, y: 0, w: 1, h: 1 }); setAspect("free"); }, [cropShot]);

  if (!shot || !media || media.kind !== "image") return null;
  const img = media.element as HTMLImageElement;
  const spec = getDevice(deviceId);
  const screenAspect = spec.screenPx[0] / spec.screenPx[1];
  const ratio = aspect === "free" ? null : aspect === "screen" ? screenAspect : Number(aspect);
  const imgAspect = media.width / Math.max(1, media.height);

  /** enforce the aspect (in image-normalised units) by adjusting height */
  const fit = (r: Rect, anchor: Handle): Rect => {
    let { x, y, w, h } = r;
    w = clamp(w, 0.02, 1); h = clamp(h, 0.02, 1);
    if (ratio) {
      // width/height in pixels: (w * W) / (h * H) = ratio -> h = w * W / (H * ratio)
      const hh = (w * imgAspect) / ratio;
      if (hh <= 1) { if (anchor.includes("n")) y = y + h - hh; h = hh; }
      else { h = 1; w = (h * ratio) / imgAspect; if (anchor.includes("w")) x = x + r.w - w; }
    }
    x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
    return { x, y, w, h };
  };

  const norm = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = norm(e);
    drag.current = { handle, start: rect, px: p.x, py: p.y };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = norm(e);
    const dx = p.x - d.px, dy = p.y - d.py;
    const s = d.start;
    let r: Rect = { ...s };
    switch (d.handle) {
      case "move": r = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) }; break;
      case "e": r.w = s.w + dx; break;
      case "w": r.x = s.x + dx; r.w = s.w - dx; break;
      case "s": r.h = s.h + dy; break;
      case "n": r.y = s.y + dy; r.h = s.h - dy; break;
      case "se": r.w = s.w + dx; r.h = s.h + dy; break;
      case "sw": r.x = s.x + dx; r.w = s.w - dx; r.h = s.h + dy; break;
      case "ne": r.w = s.w + dx; r.y = s.y + dy; r.h = s.h - dy; break;
      case "nw": r.x = s.x + dx; r.w = s.w - dx; r.y = s.y + dy; r.h = s.h - dy; break;
    }
    if (r.w < 0.02) { if (d.handle.includes("w")) r.x = s.x + s.w - 0.02; r.w = 0.02; }
    if (r.h < 0.02) { if (d.handle.includes("n")) r.y = s.y + s.h - 0.02; r.h = 0.02; }
    setRect(d.handle === "move" ? r : fit(r, d.handle));
  };
  const up = () => { drag.current = null; };

  const apply = async () => {
    setBusy(true);
    try {
      const sx = Math.round(rect.x * media.width), sy = Math.round(rect.y * media.height);
      const sw = Math.max(1, Math.round(rect.w * media.width)), sh = Math.max(1, Math.round(rect.h * media.height));
      const c = document.createElement("canvas");
      c.width = sw; c.height = sh;
      c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("Could not encode the crop");
      const file = new File([blob], `${media.ref.name.replace(/\.[a-z0-9]+$/i, "")}-crop.png`, { type: "image/png" });
      const ref = await importMedia(file);
      setShotMedia(shot.id, ref);
      toast(`Cropped to ${sw} × ${sh}`);
      setCropShot(null);
    } catch (e) {
      toast(`Crop failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pw = Math.round(rect.w * media.width), ph = Math.round(rect.h * media.height);
  return (
    <Modal open onClose={() => setCropShot(null)} title="Crop image" width={760}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-center rounded-md bg-panel-2 p-3">
          <div ref={box} className="relative select-none" style={{ maxHeight: "58vh", aspectRatio: `${imgAspect}`, width: imgAspect >= 1 ? "100%" : undefined, height: imgAspect < 1 ? "58vh" : undefined }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={media.url} alt="" className="block h-full w-full" draggable={false} />
            {/* mask */}
            <div className="pointer-events-none absolute inset-0 bg-black/55" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x * 100}% ${rect.y * 100}%, ${rect.x * 100}% ${(rect.y + rect.h) * 100}%, ${(rect.x + rect.w) * 100}% ${(rect.y + rect.h) * 100}%, ${(rect.x + rect.w) * 100}% ${rect.y * 100}%, ${rect.x * 100}% ${rect.y * 100}%)` }} />
            <div className="absolute cursor-move border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} onPointerDown={down("move")}>
              <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/40" />
              <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/40" />
              <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/40" />
              <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/40" />
              {HANDLES.map((h) => (
                <div key={h.id} className={`absolute h-3 w-3 rounded-sm border border-black/30 bg-white ${h.cls}`} onPointerDown={down(h.id)} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Segmented size="sm" value={aspect} onChange={(v) => { setAspect(v); setRect((r) => (v === "free" ? r : fitTo(r, v === "screen" ? screenAspect : Number(v), imgAspect))); }} options={[{ value: "free", label: "Free" }, { value: "screen", label: spec.family === "flat" ? "Card" : "Screen" }, { value: "1.7777", label: "16:9" }, { value: "1.3333", label: "4:3" }, { value: "1", label: "1:1" }, { value: "0.5625", label: "9:16" }]} className="flex-1" />
          <span className="num text-[11px] text-muted">{pw} × {ph}</span>
          <Button variant="ghost" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>Reset</Button>
          <Button variant="solid" onClick={() => void apply()} disabled={busy || (rect.w >= 0.999 && rect.h >= 0.999)}>Crop media</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Largest centred rect of the given aspect inside the current one. */
function fitTo(r: Rect, ratio: number, imgAspect: number): Rect {
  let w = r.w, h = (w * imgAspect) / ratio;
  if (h > r.h) { h = r.h; w = (h * ratio) / imgAspect; }
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}
