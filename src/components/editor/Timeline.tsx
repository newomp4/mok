"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ANIM_LABELS, type AnimProp, type Shot } from "@/lib/types";
import { formatTime, shotStart, totalDuration } from "@/lib/animation";
import { MOTION_PRESETS } from "@/lib/presets";
import { Button, IconButton, Popover, Segmented, MenuList } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";
import { applyMotionPreset } from "@/lib/actions";

const LEFT_W = 184;
const RULER_H = 22;
const ROW_H = 30;
const LANE_H = 24;

function useSelectedKey() {
  return useState<{ shotId: string; prop: AnimProp; t: number } | null>(null);
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const update = useEditor((s) => s.update);
  const addShot = useEditor((s) => s.addShot);
  const removeShot = useEditor((s) => s.removeShot);
  const duplicateShot = useEditor((s) => s.duplicateShot);
  const moveShot = useEditor((s) => s.moveShot);
  const clearTrack = useEditor((s) => s.clearTrack);
  const ui = useUI();
  const total = totalDuration(project);
  const pps = 96 * ui.timelineZoom;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useSelectedKey();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsRef = useRef<HTMLButtonElement>(null);
  const advanced = ui.timelineMode === "advanced";

  const seekFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left + el.scrollLeft - 8;
    ui.setTime(clamp(x / pps, 0, total));
  };
  const scrubbing = useRef(false);
  const onRulerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubbing.current = true;
    if (ui.playing) ui.setPlaying(false);
    seekFromEvent(e);
  };
  const onRulerMove = (e: React.PointerEvent) => { if (scrubbing.current) seekFromEvent(e); };
  const onRulerUp = () => { scrubbing.current = false; };

  // delete selected keyframe
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        update((p) => {
          const s = p.shots.find((x) => x.id === selected.shotId);
          if (!s) return;
          const list = (s.keyframes[selected.prop] ?? []).filter((k) => Math.abs(k.t - selected.t) > 0.0005);
          if (list.length) s.keyframes[selected.prop] = list; else delete s.keyframes[selected.prop];
        });
        setSelected(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, update, setSelected]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const end = Math.max(total, 12) + 2;
    const step = pps < 50 ? 2 : pps < 90 ? 1 : 0.5;
    for (let t = 0; t <= end; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }, [total, pps]);
  const innerW = Math.max(total, 12) * pps + 240;

  const rows: { shot: Shot; start: number; lanes: AnimProp[] }[] = project.shots.map((shot) => ({
    shot,
    start: shotStart(project, shot.id),
    lanes: advanced && expanded[shot.id] ? (Object.keys(shot.keyframes) as AnimProp[]).filter((k) => (shot.keyframes[k]?.length ?? 0) > 0) : [],
  }));

  const cycleFps = () => update((p) => { p.fps = p.fps === 24 ? 30 : p.fps === 30 ? 60 : 24; });

  return (
    <div className="flex h-[216px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-2">
        <Segmented size="sm" value={ui.timelineMode} onChange={ui.setTimelineMode} options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Advanced" }]} />
        <Button ref={presetsRef} variant="outline" size="sm" iconRight="chevron-down" onClick={() => setPresetsOpen((o) => !o)}>Presets</Button>
        <Popover open={presetsOpen} onClose={() => setPresetsOpen(false)} anchor={presetsRef} side="top" className="w-60">
          <MenuList items={MOTION_PRESETS.map((m) => ({ label: m.name, right: <span className="label-sm text-muted">{m.duration}s</span>, onSelect: () => applyMotionPreset(m.id) }))} onClose={() => setPresetsOpen(false)} />
        </Popover>
        <Button variant="outline" size="sm" icon="sparkles" onClick={() => ui.setAutoMotion(true)} active={ui.autoMotion}>Auto-motion</Button>
        <div className="flex-1" />
        <button type="button" onClick={() => ui.setRecording(!ui.recording)} className={cn("label flex h-6 items-center gap-1.5 rounded-md px-2 transition-colors", ui.recording ? "bg-accent-soft text-accent" : "bg-fill text-fg-2 hover:text-fg")} title="Record keyframes (R)">
          <Icon name="record" size={8} className={ui.recording ? "text-accent" : "text-muted"} />Record keyframes
        </button>
        <div className="num flex h-6 items-center gap-1 rounded-md bg-fill px-2 text-[11px]">
          <span className="text-fg">{formatTime(ui.time)}</span>
          <span className="text-muted">/</span>
          <span className="text-muted">{formatTime(total)}</span>
        </div>
        <button type="button" onClick={cycleFps} className="label flex h-6 items-center gap-1 rounded-md bg-fill px-2 text-fg-2 hover:text-fg" title="Timeline frame rate">
          <Icon name="clock" size={11} />{project.fps} fps
        </button>
        <IconButton icon="skip-back" label="Go to start (Home)" onClick={() => ui.setTime(0)} className="h-6 w-6" />
        <IconButton icon={ui.playing ? "pause" : "play"} label="Play / pause (Space)" onClick={() => ui.setPlaying(!ui.playing)} className="h-6 w-6" />
        <IconButton icon="repeat" label="Loop (L)" onClick={ui.toggleLoop} active={ui.loop} className={cn("h-6 w-6", ui.loop && "text-accent")} />
        <div className="flex-1" />
        <Button variant="outline" size="sm" icon="plus" onClick={addShot}>Add shot</Button>
        <div className="flex items-center gap-1 pl-1">
          <Icon name="zoom-in" size={12} className="text-muted" />
          <input type="range" min={0.4} max={4} step={0.05} value={ui.timelineZoom} onChange={(e) => ui.setTimelineZoom(Number(e.target.value))} className="h-1 w-20 accent-[var(--accent)]" />
        </div>
        <IconButton icon="minimize" label="Hide timeline (T)" onClick={() => ui.setTimelineOpen(false)} className="h-6 w-6" />
      </div>
      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* left column */}
        <div className="scroll flex shrink-0 flex-col overflow-hidden border-r border-line" style={{ width: LEFT_W }}>
          <div className="shrink-0 border-b border-line" style={{ height: RULER_H }} />
          <div className="scroll min-h-0 flex-1 overflow-y-auto">
            {rows.map(({ shot, lanes }) => {
              const active = ui.activeShotId === shot.id;
              return (
                <div key={shot.id}>
                  <div className={cn("group flex items-center gap-1 border-b border-line px-1.5", active && "bg-accent-soft/60")} style={{ height: ROW_H }}>
                    <IconButton icon={expanded[shot.id] ? "chevron-down" : "chevron-right"} size={11} label="Expand" onClick={() => setExpanded((x) => ({ ...x, [shot.id]: !x[shot.id] }))} className="h-5 w-5" disabled={!advanced} />
                    <Icon name="grip" size={11} className="text-muted" />
                    <ShotName shot={shot} />
                    <span className="num ml-auto text-[10px] text-muted">{shot.duration.toFixed(1)}s</span>
                    <div className="hidden items-center group-hover:flex">
                      <IconButton icon="arrow-up" size={10} label="Move up" onClick={() => moveShot(shot.id, -1)} className="h-5 w-5" />
                      <IconButton icon="arrow-down" size={10} label="Move down" onClick={() => moveShot(shot.id, 1)} className="h-5 w-5" />
                      <IconButton icon="copy" size={10} label="Duplicate" onClick={() => duplicateShot(shot.id)} className="h-5 w-5" />
                      <IconButton icon="trash" size={10} label="Delete" onClick={() => removeShot(shot.id)} className="h-5 w-5" disabled={project.shots.length <= 1} />
                    </div>
                  </div>
                  {lanes.map((prop) => (
                    <div key={prop} className="group flex items-center gap-1.5 border-b border-line pl-8 pr-1.5" style={{ height: LANE_H }}>
                      <Icon name="diamond" size={8} className="text-accent" />
                      <span className="label-sm text-fg-2">{ANIM_LABELS[prop]}</span>
                      <IconButton icon="x" size={10} label="Clear track" onClick={() => clearTrack(prop, shot.id)} className="ml-auto hidden h-5 w-5 group-hover:flex" />
                    </div>
                  ))}
                </div>
              );
            })}
            <button type="button" onClick={addShot} className="label flex h-8 w-full items-center gap-1.5 px-3 text-muted hover:text-fg">
              <Icon name="plus" size={11} />Add shot
            </button>
          </div>
        </div>
        {/* tracks */}
        <div ref={scrollRef} className="scroll relative min-w-0 flex-1 overflow-auto">
          <div className="relative" style={{ width: innerW, minHeight: "100%" }}>
            {/* ruler */}
            <div className="sticky top-0 z-10 cursor-pointer border-b border-line bg-panel" style={{ height: RULER_H }} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 flex h-full flex-col justify-end" style={{ left: 8 + t * pps }}>
                  <span className={cn("num -translate-x-1/2 text-[9px]", Number.isInteger(t) ? "text-muted" : "text-transparent")}>{Number.isInteger(t) ? `${t}s` : ""}</span>
                  <div className={cn("w-px bg-line-2", Number.isInteger(t) ? "h-2" : "h-1")} />
                </div>
              ))}
            </div>
            {/* rows */}
            <div>
              {rows.map(({ shot, start, lanes }) => (
                <div key={shot.id}>
                  <div className="relative border-b border-line" style={{ height: ROW_H }}>
                    <ShotBlock shot={shot} start={start} pps={pps} active={ui.activeShotId === shot.id} onSelect={() => { ui.setActiveShot(shot.id); ui.setTime(start + 0.0001); }} />
                  </div>
                  {lanes.map((prop) => (
                    <div key={prop} className="relative border-b border-line" style={{ height: LANE_H }}>
                      {(shot.keyframes[prop] ?? []).map((k) => {
                        const isSel = selected?.shotId === shot.id && selected.prop === prop && Math.abs(selected.t - k.t) < 0.0005;
                        return (
                          <KeyframeDiamond
                            key={k.t}
                            x={8 + (start + k.t) * pps}
                            selected={isSel}
                            onSelect={() => { setSelected({ shotId: shot.id, prop, t: k.t }); ui.setTime(start + k.t); }}
                            onMove={(dt) => {
                              const nt = clamp(Math.round((k.t + dt) * 100) / 100, 0, shot.duration);
                              update((p) => {
                                const s = p.shots.find((x) => x.id === shot.id);
                                if (!s) return;
                                const list = (s.keyframes[prop] ?? []).filter((kk) => Math.abs(kk.t - k.t) > 0.0005 && Math.abs(kk.t - nt) > 0.0005);
                                list.push({ ...k, t: nt });
                                list.sort((a, b) => a.t - b.t);
                                s.keyframes[prop] = list;
                              });
                              setSelected({ shotId: shot.id, prop, t: nt });
                            }}
                            pps={pps}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {/* playhead */}
            <div className="pointer-events-none absolute top-0 z-20 h-full" style={{ left: 8 + ui.time * pps }}>
              <div className="num -translate-x-1/2 rounded-sm bg-fg px-1 text-[9px] text-inverse-fg">{ui.time.toFixed(2)}</div>
              <div className="h-full w-px bg-fg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShotName({ shot }: { shot: Shot }) {
  const update = useEditor((s) => s.update);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(shot.name);
  useEffect(() => setText(shot.name), [shot.name]);
  if (editing) {
    return (
      <input
        autoFocus
        className="label h-5 w-20 rounded bg-panel px-1 text-fg outline-none ring-1 ring-accent"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setEditing(false); if (text.trim()) update((p) => { const s = p.shots.find((x) => x.id === shot.id); if (s) s.name = text.trim(); }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      />
    );
  }
  return <button type="button" onDoubleClick={() => setEditing(true)} className="label truncate text-fg" title="Double-click to rename">{shot.name}</button>;
}

function ShotBlock({ shot, start, pps, active, onSelect }: { shot: Shot; start: number; pps: number; active: boolean; onSelect: () => void }) {
  const update = useEditor((s) => s.update);
  const resize = useRef<{ x: number; d: number } | null>(null);
  const hasKeys = Object.values(shot.keyframes).some((k) => k && k.length > 0);
  return (
    <div
      className={cn("absolute top-1 flex h-[22px] cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border px-2 transition-colors", active ? "border-accent bg-accent text-white" : "border-line-2 bg-fill text-fg-2 hover:bg-fill-2")}
      style={{ left: 8 + start * pps, width: Math.max(24, shot.duration * pps) }}
      onClick={onSelect}
    >
      {hasKeys && <Icon name="diamond" size={8} />}
      <span className="label truncate">{shot.name}</span>
      {shot.media?.kind === "video" && <Icon name="video" size={10} className="ml-auto opacity-70" />}
      <div
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-black/20"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); resize.current = { x: e.clientX, d: shot.duration }; beginInteraction(); }}
        onPointerMove={(e) => {
          if (!resize.current) return;
          const d = clamp(Math.round((resize.current.d + (e.clientX - resize.current.x) / pps) * 10) / 10, 0.5, 60);
          update((p) => { const s = p.shots.find((x) => x.id === shot.id); if (s) s.duration = d; });
        }}
        onPointerUp={() => { resize.current = null; endInteraction(); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function KeyframeDiamond({ x, selected, onSelect, onMove, pps }: { x: number; selected: boolean; onSelect: () => void; onMove: (dt: number) => void; pps: number }) {
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  return (
    <button
      type="button"
      className={cn("absolute top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm", selected ? "text-fg" : "text-accent")}
      style={{ left: x }}
      onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, moved: false }; onSelect(); }}
      onPointerMove={(e) => { if (!drag.current) return; if (Math.abs(e.clientX - drag.current.x) > 3) drag.current.moved = true; }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        if (drag.current.moved) onMove((e.clientX - drag.current.x) / pps);
        drag.current = null;
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke={selected ? "var(--accent)" : "none"} strokeWidth="3"><path d="M12 3l9 9-9 9-9-9z" /></svg>
    </button>
  );
}
