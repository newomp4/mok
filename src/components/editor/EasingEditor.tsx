"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { EASE_CURVES, bezierEase, curveOf, segmentCurve, setInHandle, type EaseHandle, inHandleOf } from "@/lib/animation";
import { ANIM_LABELS, type EaseCurve, type Keyframe } from "@/lib/types";
import { Button, Popover, Segmented } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";

const SIZE = 168;
/** the curve can overshoot, so the graph shows a little headroom above and below */
const PAD = 34;
/** the tracing dot runs the curve, then rests a moment so the end of the timing reads clearly */
const RUN = 1400, CYCLE = 1950;

/** Which of the two segments touching a keyframe is being shaped. */
type Side = "in" | "out";

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
 * Both segments that meet at the selected keyframe, drawn in one unit box: the curve the motion
 * arrives on ends at the top right, the curve it leaves on starts at the bottom left. The keyframe
 * owns one handle of each — the other end belongs to its neighbour — and a dot traces the active
 * curve so the timing can be read rather than guessed.
 */
function EaseGraph({ out, incoming, hasNext, nextHasIn, side, onSide, onHandle }: {
  out: EaseCurve | null;
  incoming: EaseCurve | null;
  hasNext: boolean;
  /** the far handle on the out side belongs to the next keyframe only when it carries one of its own */
  nextHasIn: boolean;
  side: Side;
  onSide: (s: Side) => void;
  onHandle: (s: Side, h: EaseHandle) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Side | null>(null);
  const dot = useRef<SVGCircleElement>(null);
  const timeDot = useRef<SVGCircleElement>(null);
  const valueDot = useRef<SVGCircleElement>(null);
  const active: EaseCurve = (side === "in" ? incoming ?? out : out ?? incoming) ?? [0, 0, 1, 1];
  // the tracing dot reads the curve from a ref so reshaping it never restarts the run
  const live = useRef<EaseCurve>(active);
  live.current = active;

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const x = clamp(((now - t0) % CYCLE) / RUN, 0, 1);
      const y = bezierEase(live.current, x);
      const cx = x * SIZE, cy = PAD + (1 - y) * SIZE;
      dot.current?.setAttribute("cx", String(cx));
      dot.current?.setAttribute("cy", String(cy));
      timeDot.current?.setAttribute("cx", String(cx));
      valueDot.current?.setAttribute("cy", String(cy));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const at = (e: React.PointerEvent): EaseHandle => {
    const r = box.current!.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / SIZE, 0, 1);
    // y is inverted and allows overshoot into the padding
    const y = 1 - (e.clientY - r.top - PAD) / SIZE;
    return [Math.round(x * 1000) / 1000, Math.round(clamp(y, -0.4, 1.4) * 1000) / 1000];
  };

  const stop = () => { if (drag.current) { drag.current = null; endInteraction(); } };

  const handle = (s: Side, hx: number, hy: number) => {
    const on = s === side;
    const ax = s === "out" ? 0 : SIZE, ay = s === "out" ? PAD + SIZE : PAD;
    return (
      <g>
        <line x1={ax} y1={ay} x2={hx * SIZE} y2={PAD + (1 - hy) * SIZE} stroke={on ? "var(--accent)" : "var(--muted)"} strokeWidth="1" opacity={on ? 0.6 : 0.35} />
        <circle
          data-handle={s}
          cx={hx * SIZE}
          cy={PAD + (1 - hy) * SIZE}
          r="6"
          fill={on ? "var(--accent)" : "var(--panel-2)"}
          stroke={on ? "#fff" : "var(--muted)"}
          strokeWidth="1.5"
          className="cursor-grab"
          onPointerDown={(e) => { e.stopPropagation(); box.current?.setPointerCapture(e.pointerId); drag.current = s; onSide(s); beginInteraction(); }}
        />
      </g>
    );
  };

  const far: { x: number; y: number; hint: string } | null =
    side === "in" && incoming ? { x: incoming[0], y: incoming[1], hint: "Set on the previous keyframe" }
    : side === "out" && out && hasNext ? { x: out[2], y: out[3], hint: nextHasIn ? "Set on the next keyframe" : "This keyframe's far handle" }
    : null;

  const curve = (cp: EaseCurve, s: Side) => (
    <path
      d={path(cp, SIZE, SIZE)}
      stroke={s === side ? "var(--fg)" : "var(--muted)"}
      strokeWidth={s === side ? 2 : 1.25}
      opacity={s === side ? 1 : 0.5}
      fill="none"
      strokeLinecap="round"
    />
  );

  return (
    <div
      ref={box}
      className="relative shrink-0 rounded-md bg-panel-2"
      style={{ width: SIZE, height: SIZE + PAD * 2 }}
      onPointerMove={(e) => { if (drag.current) onHandle(drag.current, at(e)); }}
      onPointerUp={stop}
      onPointerLeave={stop}
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
          {incoming && curve(incoming, "in")}
          {out && curve(out, "out")}
        </g>
        {far && (
          <circle cx={far.x * SIZE} cy={PAD + (1 - far.y) * SIZE} r="2.5" fill="var(--muted)" opacity="0.8">
            <title>{far.hint}</title>
          </circle>
        )}
        {incoming && handle("in", incoming[2], incoming[3])}
        {out && handle("out", out[0], out[1])}
        {/* the dot and its two markers run over the handles, so they must never take the pointer */}
        <g pointerEvents="none">
          <circle ref={timeDot} cx="0" cy={PAD + SIZE + 9} r="2.5" fill="var(--muted)" />
          <circle ref={valueDot} cx="-9" cy={PAD + SIZE} r="2.5" fill="var(--accent)" />
          <circle ref={dot} data-trace="dot" cx="0" cy={PAD + SIZE} r="4" fill="var(--accent)" stroke="var(--panel-2)" strokeWidth="1.5" />
          {out && <text x="5" y={PAD + SIZE - 6} fill="var(--muted)" fontSize="8">out</text>}
          {incoming && <text x={SIZE - 5} y={PAD + 12} textAnchor="end" fill="var(--muted)" fontSize="8">in</text>}
        </g>
      </svg>
    </div>
  );
}

/**
 * Easing graph for the selected keyframe. A segment is shaped by two keyframes — the one it leaves
 * and the one it arrives at — so the keyframe owns an out curve and an in curve, and the editor
 * shapes whichever of its two neighbouring segments is picked.
 */
export function EasingEditor({ anchor, open, onClose }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void }) {
  const selected = useUI((s) => s.selectedKeys);
  const update = useEditor((s) => s.update);
  const key = selected[0] ?? null;
  const track = useEditor((s) => {
    if (!key) return null;
    return s.project.shots.find((x) => x.id === key.shotId)?.keyframes[key.prop] ?? null;
  });
  const [hint, setHint] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("out");

  const i = track && key ? track.findIndex((k) => Math.abs(k.t - key.t) < 0.0005) : -1;
  const kf = i >= 0 && track ? track[i] : null;
  const prev = i > 0 && track ? track[i - 1] : null;
  const next = i >= 0 && track ? track[i + 1] ?? null : null;
  // the first keyframe has nothing arriving at it and the last nothing leaving, so the side follows the track
  const active: Side = !prev ? "out" : !next ? "in" : side;

  if (!open || !key || !kf) return null;

  // the last keyframe of a run has no segment leaving it, so only the curve it is arrived on is shown
  const outCurve = prev && !next ? null : segmentCurve(kf, next);
  const inCurve = prev ? segmentCurve(prev, kf) : null;
  const cp = (active === "in" ? inCurve ?? outCurve : outCurve ?? inCurve) ?? curveOf(kf);

  /** Shape every selected keyframe, so a whole run of them can be eased at once. */
  const editKeys = (mut: (k: Keyframe, list: Keyframe[], at: number) => void) => {
    update((p) => {
      for (const sel of selected) {
        const shot = p.shots.find((x) => x.id === sel.shotId);
        const list = shot?.keyframes[sel.prop];
        const at = list?.findIndex((x) => Math.abs(x.t - sel.t) < 0.0005) ?? -1;
        if (list && at >= 0) mut(list[at], list, at);
      }
    });
  };

  const onHandle = (s: Side, h: EaseHandle) => editKeys((k) => {
    if (s === "in") { setInHandle(k, h); return; }
    const c = curveOf(k);
    k.cp = [h[0], h[1], c[2], c[3]];
    k.ease = "linear"; // the curve takes over from the named ease
  });

  /** A preset describes a whole segment, so it sets the near keyframe's curve and clears the far end's own arrival. */
  const applyPreset = (preset: EaseCurve) => editKeys((k, list, at) => {
    const start = active === "in" ? list[at - 1] : k;
    const end = active === "in" ? k : list[at + 1];
    if (!start) return;
    start.cp = [...preset] as EaseCurve;
    start.ease = "linear";
    if (end) setInHandle(end, null);
  });

  const activePreset = EASE_CURVES.find((c) => c.cp.every((v, n) => Math.abs(v - cp[n]) < 0.005));

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} side="top" align="start" className="w-[420px] p-3">
      <div className="flex items-center justify-between pb-2">
        <span className="label text-fg">Easing · {ANIM_LABELS[key.prop]}</span>
        <span className="label-sm text-muted">{selected.length > 1 ? `${selected.length} keyframes` : `at ${key.t.toFixed(2)}s`}</span>
      </div>
      <div className="flex gap-3">
        <EaseGraph out={outCurve} incoming={inCurve} hasNext={!!next} nextHasIn={!!inHandleOf(next)} side={active} onSide={setSide} onHandle={onHandle} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Segmented
            size="sm"
            value={active}
            onChange={setSide}
            options={[
              { value: "in" as Side, label: "In", disabled: !prev },
              { value: "out" as Side, label: "Out", disabled: !!prev && !next },
            ]}
          />
          <div className="grid grid-cols-4 gap-1.5">
            {EASE_CURVES.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onMouseEnter={() => setHint(c.label)}
                onMouseLeave={() => setHint(null)}
                onClick={() => applyPreset(c.cp)}
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
                // one curve for the whole track means every segment is shaped from its start alone
                if (list) for (const k of list) { k.cp = [...cp] as EaseCurve; k.ease = "linear"; setInHandle(k, null); }
              });
            }}>Apply to track</Button>
            <Button variant="ghost" size="sm" onClick={() => editKeys((k, list, at) => {
              if (side === "in") {
                // the incoming segment is this keyframe's arrival curve plus the one before it leaves on
                setInHandle(k, null);
                const prev = list[at - 1];
                if (prev) { delete prev.cp; prev.ease = "smooth"; }
                return;
              }
              delete k.cp;
              k.ease = "smooth";
            })}>Reset</Button>
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
