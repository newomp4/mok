"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { useMedia } from "@/lib/media";
import { useRenderShot } from "@/three/Device";
import { Button, IconButton } from "@/components/ui";
import { autoMotionMediaTime, composeAutoMotion } from "@/lib/actions";
import { shotStart } from "@/lib/animation";
import { uid } from "@/lib/ids";
import type { FocusArea } from "@/lib/types";

export function AutoMotionOverlay() {
  const shot = useRenderShot();
  const media = useMedia(shot?.media);
  const project = useEditor((s) => s.project);
  const time = useUI((s) => s.time);
  const update = useEditor((s) => s.update);
  const setAutoMotion = useUI((s) => s.setAutoMotion);
  const toast = useUI((s) => s.showToast);
  const [draft, setDraft] = useState<FocusArea | null>(null);
  const [seed, setSeed] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ shotId: string; area: FocusArea } | null>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const areas = shot?.focusAreas ?? [];
  useEffect(() => { useUI.getState().setPlaying(false); }, []);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => focused?.focus();
  }, []);
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
  const add = () => {
    if (!shot || !media) return;
    const id = uid();
    update((pp) => { const s = pp.shots.find((x) => x.id === shot.id); if (s) s.focusAreas.push({ id, x: .25, y: .25, w: .5, h: .5 }); });
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`[data-focus-area="${id}"]`)?.focus());
  };
  const adjust = (e: React.KeyboardEvent, id: string) => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(id); panel.current?.focus(); return; }
    if (!direction) return;
    e.preventDefault();
    update((pp) => {
      const a = pp.shots.find((x) => x.id === shot?.id)?.focusAreas.find((area) => area.id === id);
      if (!a) return;
      const [dx, dy] = direction;
      if (e.shiftKey) { a.w = Math.max(.02, Math.min(1 - a.x, a.w + dx * .01)); a.h = Math.max(.02, Math.min(1 - a.y, a.h + dy * .01)); }
      else { a.x = Math.max(0, Math.min(1 - a.w, a.x + dx * .01)); a.y = Math.max(0, Math.min(1 - a.h, a.y + dy * .01)); }
    });
  };
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setAutoMotion(false); return; }
    if (e.key !== "Tab") return;
    const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])];
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first?.focus(); }
  };
  const compose = (shuffle = false) => {
    if (!shot) return;
    const nextSeed = shuffle ? seed + 1 : seed;
    setSeed(nextSeed);
    const count = composeAutoMotion(shot.id, nextSeed);
    if (!count) { toast("These focus areas are cropped out. Choose a visible area or switch the media fit to Contain."); return; }
    toast(`Auto-motion composed for ${shot.name}${count < areas.length ? ` · ${areas.length - count} cropped-out area${areas.length - count === 1 ? "" : "s"} skipped` : ""}`);
    if (!shuffle) setAutoMotion(false);
  };
  const src = media?.url;
  const previewTime = shot ? autoMotionMediaTime(shot, time - shotStart(project, shot.id)) : 0;
  const ar = media ? media.width / media.height : 16 / 10;
  const width = Math.min(space.width, space.height * ar);

  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Auto-motion focus areas" tabIndex={-1} onKeyDown={onPanelKey} className="absolute inset-0 z-40 flex flex-col bg-black/70 p-6 outline-none backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="label text-white">Auto-motion</span>
          <span className="text-[11px] text-white/70">Draw focus areas or add one below. With an area focused, arrows move it and Shift + arrows resize it. Compose to visit them in order.</span>
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
            {media?.kind === "video" ? (
              <AutoMotionVideo src={src} time={previewTime} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="pointer-events-none h-full w-full object-contain" draggable={false} />
            )}
            {[...areas, ...(draft ? [normalize(draft)] : [])].map((a, i) => (
              <div key={a.id} data-focus-area={a.id} role="group" tabIndex={a.id === draft?.id ? undefined : 0} aria-label={`Focus area ${i + 1}: ${Math.round(a.x * 100)}%, ${Math.round(a.y * 100)}%; ${Math.round(a.w * 100)}% wide, ${Math.round(a.h * 100)}% high`} onKeyDown={(e) => adjust(e, a.id)} className="absolute border-2 border-accent bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}>
                <span className="absolute -left-px -top-5 rounded-t bg-accent px-1.5 text-[10px] font-semibold text-white">{i + 1}</span>
                {a.id !== draft?.id && (
                  <button type="button" aria-label={`Remove focus area ${i + 1}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(a.id)} className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-black shadow">×</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="label text-white/70">Add media to this shot first.</div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label-sm text-white/60">{areas.length} focus area{areas.length === 1 ? "" : "s"}</span>
        <div className="flex gap-2">
          <Button variant="soft" onClick={add} disabled={!media}>Add focus area</Button>
          <Button variant="ghost" className="text-white hover:bg-white/10" onClick={clear} disabled={!areas.length}>Clear</Button>
          <Button variant="soft" icon="shuffle" onClick={() => compose(true)} disabled={!areas.length}>Shuffle</Button>
          <Button variant="accent" icon="sparkles" onClick={() => compose(false)} disabled={!areas.length}>Compose</Button>
        </div>
      </div>
    </div>
  );
}

/** Keep the region picker on the frame currently visible in the editor, including trimmed clips. */
function AutoMotionVideo({ src, time }: { src: string; time: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const sync = () => {
      if (video.readyState < 1 || video.seeking) return;
      if (Math.abs(video.currentTime - time) > 1 / 240) video.currentTime = time;
    };
    video.pause();
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("seeked", sync);
    sync();
    return () => { video.removeEventListener("loadedmetadata", sync); video.removeEventListener("seeked", sync); };
  }, [src, time]);
  return <video ref={ref} src={src} muted playsInline preload="auto" className="pointer-events-none h-full w-full object-contain" />;
}

function normalize(a: FocusArea): FocusArea {
  const x = a.w < 0 ? a.x + a.w : a.x;
  const y = a.h < 0 ? a.y + a.h : a.y;
  return { id: a.id, x, y, w: Math.abs(a.w), h: Math.abs(a.h) };
}
