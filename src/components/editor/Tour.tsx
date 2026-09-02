"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui";
import { clamp } from "@/lib/cn";

interface Step {
  target: string | null;
  title: string;
  body: string;
  /** where the card sits relative to the target */
  side?: "left" | "right" | "top" | "bottom";
}

const STEPS: Step[] = [
  { target: null, title: "Welcome to mok", body: "A thirty-second tour of the editor. Drop a screenshot or a screen recording onto a device, frame it, animate it and export stills or video. Everything renders in your browser." },
  { target: "source", title: "Source", body: "Click to upload, drag and drop, or paste. Each shot can carry its own image or video; crop, fit and playback speed live here too.", side: "left" },
  { target: "mockup", title: "Mockup", body: "Change the device, its finish and body gloss, rotate it, open a laptop lid, toggle the Dynamic Island or tint a watch band.", side: "left" },
  { target: "viewport", title: "Frame it", body: "Drag to orbit, scroll to zoom and hold space to pan. Alt-click sets the blur focal point. Presets under Camera give you the classic angles in one click.", side: "bottom" },
  { target: "scene", title: "Scene", body: "Pick a studio environment or build your own: lighting rig, light rotation, background colour, gradient or image.", side: "left" },
  { target: "timeline", title: "Timeline", body: "Shots play back to back. Record keyframes, apply an animation preset, draw focus areas for Auto-motion, right-click a shot for more, and click the marker between shots for a fade.", side: "top" },
  { target: "add", title: "Text, logos and audio", body: "Add a title card, a logo outro or a music track from here. Text and logo shots fill the frame with enter and exit animations.", side: "top" },
  { target: "export", title: "Export", body: "Stills up to 8K (PNG, WebP, JPG, transparent) or frame-exact MP4 / WebM video with motion blur and your audio. Press ? any time for the shortcuts.", side: "bottom" },
];

/** Coach-mark tour: dims everything except the current target and explains it. */
export function Tour() {
  const step = useUI((s) => s.tourStep);
  const setStep = useUI((s) => s.setTourStep);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const current = step === null ? null : STEPS[step];

  useLayoutEffect(() => {
    if (!current) { setRect(null); return; }
    const compute = () => {
      if (!current.target) { setRect(null); return; }
      const el = document.querySelector(`[data-tour="${current.target}"]`) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      el.scrollIntoView({ block: "nearest" });
      setRect(el.getBoundingClientRect());
    };
    compute();
    const t = window.setTimeout(compute, 60);
    window.addEventListener("resize", compute);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", compute); };
  }, [current]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") setStep(Math.max(0, (step ?? 0) - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (step === null || !current) return null;
  const finish = () => { setStep(null); try { localStorage.setItem("mok:toured", "1"); } catch {} };
  const next = () => { if (step >= STEPS.length - 1) finish(); else setStep(step + 1); };

  const pad = 6;
  const hole = rect ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 } : null;
  const W = 300, H = 170;
  let card: React.CSSProperties = { left: window.innerWidth / 2 - W / 2, top: window.innerHeight / 2 - H / 2 };
  if (hole) {
    const side = current.side ?? "left";
    const gap = 12;
    let left = hole.x + hole.w / 2 - W / 2, top = hole.y + hole.h + gap;
    if (side === "left") { left = hole.x - W - gap; top = hole.y; }
    if (side === "right") { left = hole.x + hole.w + gap; top = hole.y; }
    if (side === "top") { top = hole.y - H - gap; }
    card = { left: clamp(left, 8, window.innerWidth - W - 8), top: clamp(top, 8, window.innerHeight - H - 8) };
  }

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <svg className="absolute inset-0 h-full w-full" onClick={finish}>
        <defs>
          <mask id="mok-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#mok-tour-mask)" />
        {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
      </svg>
      <div className="fade-in absolute flex flex-col gap-2 rounded-xl border border-line bg-panel p-4 shadow-2xl" style={{ ...card, width: W }}>
        <div className="flex items-center justify-between">
          <span className="label text-fg">{current.title}</span>
          <span className="num text-[10px] text-muted">{step + 1} / {STEPS.length}</span>
        </div>
        <p className="text-[12px] leading-relaxed text-fg-2">{current.body}</p>
        <div className="mt-1 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={finish}>Skip tour</Button>
          <div className="flex gap-1.5">
            {step > 0 && <Button variant="soft" size="sm" onClick={() => setStep(step - 1)}>Back</Button>}
            <Button variant="solid" size="sm" onClick={next}>{step >= STEPS.length - 1 ? "Done" : "Next"}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
