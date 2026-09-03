"use client";
import { useRef, useState } from "react";
import { useEditor, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { EASE_CURVES, bezierEase, curveOf } from "@/lib/animation";
import { ANIM_LABELS, type EaseCurve, type Keyframe } from "@/lib/types";
import { Button, Popover } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";

const SIZE = 168;
/** the curve can overshoot, so the graph shows a little headroom above and below */
const PAD = 34;

function path(cp: EaseCurve, w: number, h: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    const y = bezierEase(cp, x);
    pts.push(`${i === 0 ? "M" : "L"}${(x * w).toFixed(2)},${((1 - y) * h).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** Small static preview used by the preset tiles. */
function CurveThumb({ cp, active }: { cp: EaseCurve; active: boolean }) {
  return (
    <svg viewBox="-2 -8 36 36" className="h-8 w-full" fill="none">
      <path d={path(cp, 32, 20)} stroke={active ? "var(--accent)" : "currentColor"} strokeWidth={active ? 2.2 : 1.6} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Easing graph for the selected keyframe: drag the two handles to shape the curve, or take one of
 * the eight presets. The curve applies to the segment that starts at this keyframe.
 */
export function EasingEditor({ anchor, open, onClose }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void }) {
  const selected = useUI((s) => s.selectedKeys);
  const update = useEditor((s) => s.update);
  const key = selected[0] ?? null;
  const kf = useEditor((s) => {
    if (!key) return null;
    const shot = s.project.shots.find((x) => x.id === key.shotId);
    return shot?.keyframes[key.prop]?.find((k) => Math.abs(k.t - key.t) < 0.0005) ?? null;
  });
  const drag = useRef<{ which: 0 | 1 } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);

  if (!open || !key || !kf) return null;
  const cp = curveOf(kf);

  const setCp = (next: EaseCurve, keepPreset = false) => {
    update((p) => {
      const shot = p.shots.find((x) => x.id === key.shotId);
      const k = shot?.keyframes[key.prop]?.find((x) => Math.abs(x.t - key.t) < 0.0005);
      if (!k) return;
      k.cp = next;
      if (!keepPreset) k.ease = "linear"; // the curve takes over from the named ease
      // apply to every selected keyframe so a whole track can be shaped at once
      for (const other of selected.slice(1)) {
        const s2 = p.shots.find((x) => x.id === other.shotId);
        const k2 = s2?.keyframes[other.prop]?.find((x) => Math.abs(x.t - other.t) < 0.0005);
        if (k2) { k2.cp = next; k2.ease = "linear"; }
      }
    });
  };

  const fromEvent = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / SIZE, 0, 1);
    // y is inverted and allows overshoot into the padding
    const y = 1 - (e.clientY - r.top - PAD) / SIZE;
    return { x: Math.round(x * 1000) / 1000, y: Math.round(clamp(y, -0.4, 1.4) * 1000) / 1000 };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { x, y } = fromEvent(e);
    setCp(drag.current.which === 0 ? [x, y, cp[2], cp[3]] : [cp[0], cp[1], x, y]);
  };

  const handle = (which: 0 | 1) => {
    const hx = which === 0 ? cp[0] : cp[2];
    const hy = which === 0 ? cp[1] : cp[3];
    return (
      <g key={which}>
        <line x1={which === 0 ? 0 : SIZE} y1={which === 0 ? SIZE + PAD : PAD} x2={hx * SIZE} y2={PAD + (1 - hy) * SIZE} stroke="var(--accent)" strokeWidth="1" opacity="0.6" />
        <circle
          data-handle={which}
          cx={hx * SIZE}
          cy={PAD + (1 - hy) * SIZE}
          r="6"
          fill="var(--accent)"
          stroke="#fff"
          strokeWidth="1.5"
          className="cursor-grab"
          onPointerDown={(e) => { e.stopPropagation(); box.current?.setPointerCapture(e.pointerId); drag.current = { which }; beginInteraction(); }}
        />
      </g>
    );
  };

  const activePreset = EASE_CURVES.find((c) => c.cp.every((v, i) => Math.abs(v - cp[i]) < 0.005));

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} side="top" align="start" className="w-[420px] p-3">
      <div className="flex items-center justify-between pb-2">
        <span className="label text-fg">Easing · {ANIM_LABELS[key.prop]}</span>
        <span className="label-sm text-muted">{selected.length > 1 ? `${selected.length} keyframes` : `at ${key.t.toFixed(2)}s`}</span>
      </div>
      <div className="flex gap-3">
        <div
          ref={box}
          className="relative shrink-0 rounded-md bg-panel-2"
          style={{ width: SIZE, height: SIZE + PAD * 2 }}
          onPointerMove={onMove}
          onPointerUp={() => { if (drag.current) { drag.current = null; endInteraction(); } }}
          onPointerLeave={() => { if (drag.current) { drag.current = null; endInteraction(); } }}
        >
          <svg width={SIZE} height={SIZE + PAD * 2} className="absolute inset-0 overflow-visible">
            <rect x="0" y={PAD} width={SIZE} height={SIZE} fill="none" stroke="var(--line)" />
            {[0.25, 0.5, 0.75].map((g) => (
              <g key={g}>
                <line x1={g * SIZE} y1={PAD} x2={g * SIZE} y2={PAD + SIZE} stroke="var(--line)" strokeDasharray="2 3" />
                <line x1="0" y1={PAD + g * SIZE} x2={SIZE} y2={PAD + g * SIZE} stroke="var(--line)" strokeDasharray="2 3" />
              </g>
            ))}
            <g transform={`translate(0, ${PAD})`}>
              <path d={path(cp, SIZE, SIZE)} stroke="var(--fg)" strokeWidth="2" fill="none" strokeLinecap="round" />
            </g>
            {handle(0)}
            {handle(1)}
          </svg>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="grid grid-cols-4 gap-1.5">
            {EASE_CURVES.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onMouseEnter={() => setHint(c.label)}
                onMouseLeave={() => setHint(null)}
                onClick={() => setCp(c.cp)}
                className={cn("flex flex-col items-center rounded-md border px-1 py-1 text-muted transition-colors hover:text-fg", activePreset?.id === c.id ? "border-accent text-accent" : "border-line hover:border-line-2")}
              >
                <CurveThumb cp={c.cp} active={activePreset?.id === c.id} />
              </button>
            ))}
          </div>
          <div className="label-sm px-0.5 text-muted">{hint ?? activePreset?.label ?? "Custom curve"}</div>
          <div className="num rounded-md bg-fill px-2 py-1.5 text-[10px] text-fg-2">cubic-bezier({cp.map((n) => n.toFixed(2)).join(", ")})</div>
          <div className="flex gap-1.5">
            <Button variant="soft" size="sm" icon="diamond" onClick={() => {
              update((p) => {
                const shot = p.shots.find((x) => x.id === key.shotId);
                const list = shot?.keyframes[key.prop];
                if (list) for (const k of list) { k.cp = [...cp] as EaseCurve; k.ease = "linear"; }
              });
            }}>Apply to track</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              update((p) => {
                const shot = p.shots.find((x) => x.id === key.shotId);
                const k = shot?.keyframes[key.prop]?.find((x) => Math.abs(x.t - key.t) < 0.0005);
                if (k) { delete k.cp; k.ease = "smooth"; }
              });
            }}>Reset</Button>
          </div>
        </div>
      </div>
    </Popover>
  );
}

/** Toolbar button that opens the editor for the selected keyframe. */
export function EasingButton() {
  const selected = useUI((s) => s.selectedKeys);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const disabled = selected.length === 0;
  return (
    <>
      <Button ref={ref} variant="outline" size="sm" icon="curve" disabled={disabled} active={open} onClick={() => setOpen((o) => !o)} title="Easing graph for the selected keyframe">
        Easing
      </Button>
      <EasingEditor anchor={ref} open={open && !disabled} onClose={() => setOpen(false)} />
    </>
  );
}

export function SelectionCount() {
  const n = useUI((s) => s.selectedKeys.length);
  if (n < 2) return null;
  return (
    <span className="label-sm flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-accent">
      <Icon name="diamond" size={8} />{n} selected
    </span>
  );
}
