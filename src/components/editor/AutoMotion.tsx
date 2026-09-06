"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { useMedia } from "@/lib/media";
import { useActiveShot } from "@/three/Device";
import { Button, IconButton } from "@/components/ui";
import { composeAutoMotion } from "@/lib/actions";
import { uid } from "@/lib/ids";
import type { FocusArea } from "@/lib/types";

export function AutoMotionOverlay() {
  const shot = useActiveShot();
  const media = useMedia(shot?.media);
  const update = useEditor((s) => s.update);
  const setAutoMotion = useUI((s) => s.setAutoMotion);
  const toast = useUI((s) => s.showToast);
  const [draft, setDraft] = useState<FocusArea | null>(null);
  const [seed, setSeed] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ shotId: string; area: FocusArea } | null>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const areas = shot?.focusAreas ?? [];
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSpace({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const norm = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!shot || !media || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = norm(e);
    const area = { id: uid(), x: p.x, y: p.y, w: 0, h: 0 };
    drawing.current = { shotId: shot.id, area };
    setDraft(area);
  };
  const onMove = (e: React.PointerEvent) => {
    const live = drawing.current;
    if (!live) return;
    const p = norm(e);
    live.area = { ...live.area, w: p.x - live.area.x, h: p.y - live.area.y };
    setDraft(live.area);
  };
  const onUp = () => {
    const live = drawing.current;
    drawing.current = null;
    setDraft(null);
    if (!live || !shot || live.shotId !== shot.id) return;
    const a = normalize(live.area);
    if (a.w < 0.02 || a.h < 0.02) return;
    update((pp) => { const s = pp.shots.find((x) => x.id === shot.id); if (s) s.focusAreas.push(a); });
  };
  const remove = (id: string) => update((pp) => { const s = pp.shots.find((x) => x.id === shot?.id); if (s) s.focusAreas = s.focusAreas.filter((a) => a.id !== id); });
  const clear = () => update((pp) => { const s = pp.shots.find((x) => x.id === shot?.id); if (s) s.focusAreas = []; });
  const compose = (shuffle = false) => {
    if (!shot) return;
    const nextSeed = shuffle ? seed + 1 : seed;
    setSeed(nextSeed);
    composeAutoMotion(shot.id, nextSeed);
    toast(`Auto-motion composed for ${shot.name}`);
    if (!shuffle) setAutoMotion(false);
  };
  const el = media?.element;
  const src = media?.url;
  const ar = media ? media.width / media.height : 16 / 10;
  const width = Math.min(space.width, space.height * ar);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/70 p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="label text-white">Auto-motion</span>
          <span className="text-[11px] text-white/70">Drag to draw one or more focus areas on your media, then compose. The camera will glide between them in order.</span>
        </div>
        <IconButton icon="x" label="Close" onClick={() => setAutoMotion(false)} className="text-white hover:bg-white/10 hover:text-white" />
      </div>
      <div className="my-4 flex min-h-0 flex-1 items-center justify-center" ref={stage}>
        {src ? (
          <div
            ref={box}
            className="relative max-h-full max-w-full select-none overflow-hidden rounded-md shadow-2xl"
            style={{ width, height: width / ar, cursor: "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => { drawing.current = null; setDraft(null); }}
          >
            {el instanceof HTMLVideoElement ? (
              <video src={src} muted className="pointer-events-none h-full w-full object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="pointer-events-none h-full w-full object-contain" draggable={false} />
            )}
            {[...areas, ...(draft ? [normalize(draft)] : [])].map((a, i) => (
              <div key={a.id} className="absolute border-2 border-accent bg-accent/15" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}>
                <span className="absolute -left-px -top-5 rounded-t bg-accent px-1.5 text-[10px] font-semibold text-white">{i + 1}</span>
                {a.id !== draft?.id && (
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(a.id)} className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black shadow">×</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="label text-white/70">Add media to this shot first.</div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="label-sm text-white/60">{areas.length} focus area{areas.length === 1 ? "" : "s"}</span>
        <div className="flex gap-2">
          <Button variant="ghost" className="text-white hover:bg-white/10" onClick={clear} disabled={!areas.length}>Clear</Button>
          <Button variant="soft" icon="shuffle" onClick={() => compose(true)} disabled={!areas.length}>Shuffle</Button>
          <Button variant="accent" icon="sparkles" onClick={() => compose(false)} disabled={!areas.length}>Compose</Button>
        </div>
      </div>
    </div>
  );
}

function normalize(a: FocusArea): FocusArea {
  const x = a.w < 0 ? a.x + a.w : a.x;
  const y = a.h < 0 ? a.y + a.h : a.y;
  return { id: a.id, x, y, w: Math.abs(a.w), h: Math.abs(a.h) };
}
