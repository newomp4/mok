"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEditor, beginInteraction, endInteraction, hasShotClipboard } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ANIM_LABELS, type AnimProp, type Shot, type Transition, type AudioTrack } from "@/lib/types";
import { EASES, formatTime, shotStart, totalDuration } from "@/lib/animation";
import { MOTION_PRESETS } from "@/lib/presets";
import { Button, IconButton, Popover, Segmented, MenuList, ContextMenu, NumberRow, ColorRow, type MenuItem } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";
import { applyMotionPreset, importFilesToShot, addAudioFile, importLogo } from "@/lib/actions";
import { pickFiles } from "./hooks";
import { ACCEPTED_AUDIO, ACCEPTED_IMAGES, ACCEPTED_TYPES, useMedia } from "@/lib/media";
import { audioLength } from "@/lib/audio";
import { shotKind } from "@/lib/defaults";
import { blip } from "@/lib/sounds";

const LEFT_W = 184;
const RULER_H = 22;
const ROW_H = 30;
const LANE_H = 24;
const SNAP_PX = 7;

/** Snap a time to half-seconds and the playhead when within a few pixels. */
function snapTime(t: number, pps: number, playhead: number): number {
  const cands = [Math.round(t * 2) / 2, playhead];
  let best = t;
  let bestD = SNAP_PX / pps;
  for (const c of cands) {
    const d = Math.abs(c - t);
    if (d < bestD) { best = c; bestD = d; }
  }
  return Math.round(best * 100) / 100;
}

const KIND_ICON: Record<string, string> = { media: "shot", text: "type", logo: "logo" };

export function Timeline() {
  const project = useEditor((s) => s.project);
  const update = useEditor((s) => s.update);
  const addShot = useEditor((s) => s.addShot);
  const removeShot = useEditor((s) => s.removeShot);
  const duplicateShot = useEditor((s) => s.duplicateShot);
  const clearTrack = useEditor((s) => s.clearTrack);
  const reverseShot = useEditor((s) => s.reverseShot);
  const copyShot = useEditor((s) => s.copyShot);
  const pasteShot = useEditor((s) => s.pasteShot);
  const splitShot = useEditor((s) => s.splitShot);
  const setAudio = useEditor((s) => s.setAudio);
  const ui = useUI();
  const total = totalDuration(project);
  const pps = 96 * ui.timelineZoom;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selected = ui.selectedKeys;
  const setSelected = ui.setSelectedKeys;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsRef = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; shotId: string } | null>(null);
  const [keyMenu, setKeyMenu] = useState<{ at: { x: number; y: number }; shotId: string; prop: AnimProp; t: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [transitionFor, setTransitionFor] = useState<string | null>(null);
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

  // pinch / ⌘-scroll zooms the tracks around the playhead
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const z = clamp(ui.timelineZoom * Math.exp(-e.deltaY * 0.01), 0.4, 8);
      const before = 8 + ui.time * 96 * ui.timelineZoom - el.scrollLeft;
      useUI.getState().setTimelineZoom(z);
      requestAnimationFrame(() => { el.scrollLeft = 8 + ui.time * 96 * z - before; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ui.timelineZoom, ui.time]);

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

  const addTrack = async (kind: "media" | "text" | "logo" | "audio") => {
    setAddOpen(false);
    if (kind === "audio") {
      const [f] = await pickFiles(ACCEPTED_AUDIO);
      if (f) await addAudioFile(f);
      return;
    }
    if (kind === "logo") {
      const id = addShot("logo", ui.activeShotId ?? undefined);
      const [f] = await pickFiles(ACCEPTED_IMAGES);
      if (f) await importLogo(f, id);
      return;
    }
    addShot(kind, ui.activeShotId ?? undefined);
  };

  const menuItems = (shotId: string): MenuItem[] => {
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return [];
    const start = shotStart(project, shotId);
    const inside = ui.time > start + 0.2 && ui.time < start + shot.duration - 0.2;
    const kind = shotKind(shot);
    return [
      { label: "Rename", icon: "text-cursor", onSelect: () => setRenaming(shotId) },
      ...(kind === "media" ? [{ label: "Upload media…", icon: "upload", onSelect: () => void pickFiles(ACCEPTED_TYPES).then((f) => importFilesToShot(f, shotId)) }] : []),
      ...(kind === "logo" ? [{ label: "Replace logo…", icon: "image", onSelect: () => void pickFiles(ACCEPTED_IMAGES).then(([f]) => f && importLogo(f, shotId)) }] : []),
      { label: "Duplicate", icon: "copy", shortcut: "⌘D", onSelect: () => duplicateShot(shotId) },
      { label: "Split at playhead", icon: "split", shortcut: "⇧⌘D", disabled: !inside, onSelect: () => splitShot(shotId, ui.time - start) },
      { label: "Reverse", icon: "rewind", onSelect: () => reverseShot(shotId) },
      { divider: true, label: "" },
      { label: "Copy", icon: "clipboard", shortcut: "⌘C", onSelect: () => copyShot(shotId) },
      { label: "Paste after", icon: "clipboard", shortcut: "⌘V", disabled: !hasShotClipboard(), onSelect: () => pasteShot(shotId) },
      { divider: true, label: "" },
      { label: "Add text shot", icon: "type", onSelect: () => addShot("text", shotId) },
      { label: "Add logo shot", icon: "logo", onSelect: () => void (async () => { const id = addShot("logo", shotId); const [f] = await pickFiles(ACCEPTED_IMAGES); if (f) await importLogo(f, id); })() },
      { label: "Set transition-out…", icon: "transition", disabled: project.shots[project.shots.length - 1]?.id === shotId, onSelect: () => setTransitionFor(shotId) },
      { divider: true, label: "" },
      { label: "Delete", icon: "trash", danger: true, disabled: project.shots.length <= 1, onSelect: () => removeShot(shotId) },
    ];
  };

  // resizable height
  const heightDrag = useRef<{ y: number; h: number } | null>(null);

  return (
    <div className="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel" style={{ height: ui.timelineHeight }} data-tour="timeline">
      <div
        className="absolute inset-x-0 top-0 z-30 h-1.5 cursor-ns-resize"
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); heightDrag.current = { y: e.clientY, h: ui.timelineHeight }; }}
        onPointerMove={(e) => { if (heightDrag.current) ui.setTimelineHeight(clamp(heightDrag.current.h - (e.clientY - heightDrag.current.y), 150, 520)); }}
        onPointerUp={() => { heightDrag.current = null; }}
      />
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-2">
        <Segmented size="sm" value={ui.timelineMode} onChange={ui.setTimelineMode} options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Advanced" }]} />
        <Button ref={presetsRef} variant="outline" size="sm" iconRight="chevron-down" onClick={() => setPresetsOpen((o) => !o)}>Presets</Button>
        <Popover open={presetsOpen} onClose={() => setPresetsOpen(false)} anchor={presetsRef} side="top" className="w-[340px] p-2">
          <div className="label px-1 pb-2 pt-1 text-muted">Animation presets · applies to the selected shot</div>
          <div className="scroll grid max-h-[50vh] grid-cols-2 gap-1.5 overflow-auto pr-1">
            {MOTION_PRESETS.map((m) => (
              <button key={m.id} type="button" onClick={() => { applyMotionPreset(m.id); setPresetsOpen(false); }} className="group flex flex-col gap-1.5 rounded-md border border-line bg-panel-2 p-2 text-left transition-colors hover:border-line-2">
                <PresetThumb id={m.id} />
                <div className="flex items-center justify-between"><span className="label text-fg">{m.name}</span><span className="label-sm text-muted">{m.duration}s</span></div>
              </button>
            ))}
          </div>
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
        <IconButton icon={ui.playing ? "pause" : "play"} label="Play / pause (Space)" onClick={() => { if (ui.recording && !ui.playing) { blip(); ui.showToast("Stop recording before playing"); return; } ui.setPlaying(!ui.playing); }} className="h-6 w-6" />
        <IconButton icon="repeat" label="Loop (L)" onClick={ui.toggleLoop} active={ui.loop} className={cn("h-6 w-6", ui.loop && "text-accent")} />
        <IconButton icon="target" label="Centre guides" onClick={() => ui.setGuides(!ui.guides)} active={ui.guides} className={cn("h-6 w-6", ui.guides && "text-accent")} />
        <div className="flex-1" />
        <Button ref={addRef} variant="outline" size="sm" icon="plus" onClick={() => setAddOpen((o) => !o)} data-tour="add">Add</Button>
        <Popover open={addOpen} onClose={() => setAddOpen(false)} anchor={addRef} side="top" align="end" className="w-64">
          <div className="label-sm px-2 pb-1 pt-1.5 text-muted">Add to timeline</div>
          <MenuList
            items={[
              { label: "Media", sub: "New shot from image or video", icon: "image", onSelect: () => void addTrack("media") },
              { label: "Text", sub: "Title or caption shot", icon: "type", onSelect: () => void addTrack("text") },
              { label: "Logo", sub: "Brand mark shot", icon: "logo", onSelect: () => void addTrack("logo") },
              { label: "Audio", sub: project.audio ? "Replace the music or voiceover" : "Music or voiceover track", icon: "audio", onSelect: () => void addTrack("audio") },
            ]}
            onClose={() => setAddOpen(false)}
          />
        </Popover>
        <div className="flex items-center gap-1 pl-1">
          <Icon name="zoom-in" size={12} className="text-muted" />
          <input type="range" min={0.4} max={8} step={0.05} value={ui.timelineZoom} onChange={(e) => ui.setTimelineZoom(Number(e.target.value))} className="h-1 w-20 accent-[var(--accent)]" />
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
                  <div
                    className={cn("group flex items-center gap-1 border-b border-line px-1.5", active && "bg-accent-soft/60")}
                    style={{ height: ROW_H }}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ at: { x: e.clientX, y: e.clientY }, shotId: shot.id }); }}
                    onClick={() => ui.setActiveShot(shot.id)}
                  >
                    <IconButton icon={expanded[shot.id] ? "chevron-down" : "chevron-right"} size={11} label="Expand" onClick={(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [shot.id]: !x[shot.id] })); }} className="h-5 w-5" disabled={!advanced} />
                    <Icon name={KIND_ICON[shotKind(shot)]} size={11} className="text-muted" />
                    <ShotName shot={shot} editing={renaming === shot.id} onEditEnd={() => setRenaming(null)} onEditStart={() => setRenaming(shot.id)} />
                    <span className="num ml-auto text-[10px] text-muted">{shot.duration.toFixed(1)}s</span>
                    <IconButton icon="menu" size={11} label="Shot menu" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ at: { x: r.left, y: r.bottom + 4 }, shotId: shot.id }); }} className="hidden h-5 w-5 group-hover:flex" />
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
            {project.audio && <AudioLabel track={project.audio} onRemove={() => setAudio(null)} />}
            <button type="button" onClick={() => setAddOpen(true)} className="label flex h-8 w-full items-center gap-1.5 px-3 text-muted hover:text-fg">
              <Icon name="plus" size={11} />Add track
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
              {rows.map(({ shot, start, lanes }, i) => (
                <div key={shot.id}>
                  <div className="relative border-b border-line" style={{ height: ROW_H }} onContextMenu={(e) => { e.preventDefault(); setMenu({ at: { x: e.clientX, y: e.clientY }, shotId: shot.id }); }}>
                    <ShotBlock
                      shot={shot}
                      index={i}
                      start={start}
                      pps={pps}
                      active={ui.activeShotId === shot.id}
                      playhead={ui.time}
                      onSelect={() => { ui.setActiveShot(shot.id); ui.setTime(start + 0.0001); }}
                      onExpand={() => setExpanded((x) => ({ ...x, [shot.id]: !x[shot.id] }))}
                    />
                    {i < rows.length - 1 && (
                      <TransitionMarker shot={shot} x={8 + (start + shot.duration) * pps} open={transitionFor === shot.id} onOpen={() => setTransitionFor(shot.id)} onClose={() => setTransitionFor(null)} />
                    )}
                  </div>
                  {lanes.map((prop) => (
                    <div key={prop} className="relative border-b border-line" style={{ height: LANE_H }}
                      onDoubleClick={(e) => {
                        // double-click a lane to drop a keyframe there
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const t = clamp(((e.clientX - r.left) - 8) / pps - start, 0, shot.duration);
                        ui.setTime(start + t);
                        requestAnimationFrame(() => useEditor.getState().stampKeyframes([prop]));
                      }}
                    >
                      {(shot.keyframes[prop] ?? []).map((k) => {
                        const isSel = selected.some((s) => s.shotId === shot.id && s.prop === prop && Math.abs(s.t - k.t) < 0.0005);
                        return (
                          <KeyframeDiamond
                            key={k.t}
                            x={8 + (start + k.t) * pps}
                            selected={isSel}
                            onContextMenu={(at) => { setSelected([{ shotId: shot.id, prop, t: k.t }]); setKeyMenu({ at, shotId: shot.id, prop, t: k.t }); }}
                            onSelect={(additive) => {
                              const key = { shotId: shot.id, prop, t: k.t };
                              setSelected(additive ? (isSel ? selected.filter((s) => !(s.shotId === shot.id && s.prop === prop && Math.abs(s.t - k.t) < 0.0005)) : [...selected, key]) : [key]);
                              ui.setTime(start + k.t);
                            }}
                            onMove={(dt) => {
                              const nt = clamp(snapTime(k.t + dt, pps, ui.time - start), 0, shot.duration);
                              update((p) => {
                                const s = p.shots.find((x) => x.id === shot.id);
                                if (!s) return;
                                const list = (s.keyframes[prop] ?? []).filter((kk) => Math.abs(kk.t - k.t) > 0.0005 && Math.abs(kk.t - nt) > 0.0005);
                                list.push({ ...k, t: nt });
                                list.sort((a, b) => a.t - b.t);
                                s.keyframes[prop] = list;
                              });
                              setSelected([{ shotId: shot.id, prop, t: nt }]);
                            }}
                            pps={pps}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
              {project.audio && <AudioBlock track={project.audio} pps={pps} total={total} />}
            </div>
            {/* playhead */}
            <div className="pointer-events-none absolute top-0 z-20 h-full" style={{ left: 8 + ui.time * pps }}>
              <div className="num -translate-x-1/2 rounded-sm bg-fg px-1 text-[9px] text-inverse-fg">{ui.time.toFixed(2)}</div>
              <div className="h-full w-px bg-fg" />
            </div>
          </div>
        </div>
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu ? menuItems(menu.shotId) : []} onClose={() => setMenu(null)} />
      <ContextMenu
        at={keyMenu?.at ?? null}
        onClose={() => setKeyMenu(null)}
        items={keyMenu ? [
          { label: "Easing", disabled: true },
          ...EASES.map((e) => ({ label: e.label, checked: project.shots.find((s) => s.id === keyMenu.shotId)?.keyframes[keyMenu.prop]?.find((k) => Math.abs(k.t - keyMenu.t) < 0.0005)?.ease === e.id, onSelect: () => update((p) => { const s = p.shots.find((x) => x.id === keyMenu.shotId); const k = s?.keyframes[keyMenu.prop]?.find((kk) => Math.abs(kk.t - keyMenu.t) < 0.0005); if (k) k.ease = e.id; }) })),
          { divider: true, label: "" },
          { label: "Apply easing to whole track", icon: "diamond", onSelect: () => update((p) => { const s = p.shots.find((x) => x.id === keyMenu.shotId); const list = s?.keyframes[keyMenu.prop]; const cur = list?.find((kk) => Math.abs(kk.t - keyMenu.t) < 0.0005)?.ease; if (list && cur) for (const kk of list) kk.ease = cur; }) },
          { label: "Copy keyframe", icon: "clipboard", shortcut: "⌘C", onSelect: () => useEditor.getState().copyKeyframes([{ shotId: keyMenu.shotId, prop: keyMenu.prop, t: keyMenu.t }]) },
          { label: "Delete keyframe", icon: "trash", danger: true, onSelect: () => update((p) => { const s = p.shots.find((x) => x.id === keyMenu.shotId); if (!s) return; const list = (s.keyframes[keyMenu.prop] ?? []).filter((kk) => Math.abs(kk.t - keyMenu.t) > 0.0005); if (list.length) s.keyframes[keyMenu.prop] = list; else delete s.keyframes[keyMenu.prop]; }) },
        ] : []}
      />
    </div>
  );
}

/** Tiny CSS mock of the camera move: a "screen" that pans / zooms the way the preset does. */
function PresetThumb({ id }: { id: string }) {
  const motion: Record<string, string> = {
    "scan-lr": "mok-scan-lr", "scan-tb": "mok-scan-tb", "low-pan-up": "mok-pan-up", "slow-zoom-out": "mok-zoom-out",
    "overhead-pan": "mok-overhead", "out-and-back": "mok-out-back", "fold-up": "mok-fold", "flat-truck": "mok-truck",
    "orbit": "mok-orbit", "flip": "mok-flip", "drift": "mok-drift", "push-in": "mok-push",
  };
  return (
    <div className="relative h-16 w-full overflow-hidden rounded bg-fill" style={{ perspective: 220 }}>
      <div className="absolute left-1/2 top-1/2 h-12 w-24 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-panel shadow-sm" style={{ animation: `${motion[id] ?? "mok-drift"} 3s ease-in-out infinite alternate`, transformOrigin: "50% 50%" }}>
        <div className="absolute left-2 top-2 h-1 w-8 rounded bg-accent/80" />
        <div className="absolute left-2 top-4 h-1 w-14 rounded bg-line-2" />
        <div className="absolute left-2 top-6 h-1 w-10 rounded bg-line-2" />
        <div className="absolute left-2 top-8 h-2 w-16 rounded bg-fill-2" />
      </div>
    </div>
  );
}

function ShotName({ shot, editing, onEditStart, onEditEnd }: { shot: Shot; editing: boolean; onEditStart: () => void; onEditEnd: () => void }) {
  const update = useEditor((s) => s.update);
  const [text, setText] = useState(shot.name);
  useEffect(() => setText(shot.name), [shot.name]);
  if (editing) {
    return (
      <input
        autoFocus
        className="label h-5 w-20 rounded bg-panel px-1 text-fg outline-none ring-1 ring-accent"
        value={text}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { onEditEnd(); if (text.trim()) update((p) => { const s = p.shots.find((x) => x.id === shot.id); if (s) s.name = text.trim(); }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") onEditEnd(); }}
      />
    );
  }
  return <button type="button" onDoubleClick={onEditStart} className="label truncate text-fg" title="Double-click to rename">{shot.name}</button>;
}

function ShotBlock({ shot, index, start, pps, active, playhead, onSelect, onExpand }: { shot: Shot; index: number; start: number; pps: number; active: boolean; playhead: number; onSelect: () => void; onExpand: () => void }) {
  const update = useEditor((s) => s.update);
  const reorderShot = useEditor((s) => s.reorderShot);
  const resize = useRef<{ x: number; d: number } | null>(null);
  const move = useRef<{ x: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const hasKeys = Object.values(shot.keyframes).some((k) => k && k.length > 0);
  const kind = shotKind(shot);
  const tr = shot.transitionOut;
  return (
    <div
      className={cn("absolute top-1 flex h-[22px] cursor-pointer select-none items-center gap-1.5 overflow-hidden rounded-md border px-2 transition-colors", active ? "border-accent bg-accent text-white" : kind === "media" ? "border-line-2 bg-fill text-fg-2 hover:bg-fill-2" : "border-line-2 bg-panel-2 text-fg-2 hover:bg-fill", dx !== 0 && "z-30 opacity-90 shadow-lg")}
      style={{ left: 8 + start * pps, width: Math.max(24, shot.duration * pps), transform: dx ? `translateX(${dx}px)` : undefined }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("[data-resize]")) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        move.current = { x: e.clientX, moved: false };
      }}
      onPointerMove={(e) => {
        if (!move.current) return;
        const d = e.clientX - move.current.x;
        if (!move.current.moved && Math.abs(d) < 4) return;
        move.current.moved = true;
        setDx(d);
      }}
      onPointerUp={(e) => {
        const m = move.current;
        move.current = null;
        if (!m) return;
        if (!m.moved) { onSelect(); return; }
        // drop: find which shot the block's centre now sits over
        const p = useEditor.getState().project;
        const center = start + shot.duration / 2 + (e.clientX - m.x) / pps;
        let acc = 0, target = 0;
        for (let i = 0; i < p.shots.length; i++) { const s = p.shots[i]; if (center > acc + s.duration / 2) target = i + (i > index ? 0 : 1); acc += s.duration; }
        target = clamp(center < 0 ? 0 : target, 0, p.shots.length - 1);
        if (center < p.shots[0].duration / 2) target = 0;
        setDx(0);
        if (target !== index) reorderShot(shot.id, target);
      }}
      onDoubleClick={onExpand}
    >
      {hasKeys && <Icon name="diamond" size={8} />}
      {kind !== "media" && <Icon name={KIND_ICON[kind]} size={10} />}
      <span className="label truncate">{shot.name}</span>
      {shot.media?.kind === "video" && kind === "media" && <Icon name="video" size={10} className="ml-auto opacity-70" />}
      {(shot.speed ?? 1) !== 1 && <span className="num text-[9px] opacity-80">{shot.speed}×</span>}
      {tr && tr.type !== "cut" && <span className="ml-auto h-3 w-3 rounded-sm" style={{ background: `linear-gradient(90deg, transparent, ${tr.color})` }} title={`Fade ${tr.duration}s`} />}
      {playhead > start && playhead < start + shot.duration && null}
      <div
        data-resize=""
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-black/20"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); resize.current = { x: e.clientX, d: shot.duration }; beginInteraction(); }}
        onPointerMove={(e) => {
          if (!resize.current) return;
          const raw = resize.current.d + (e.clientX - resize.current.x) / pps;
          const end = snapTime(start + raw, pps, playhead);
          const d = clamp(Math.round((end - start) * 100) / 100, 0.5, 180);
          update((p) => { const s = p.shots.find((x) => x.id === shot.id); if (s) s.duration = d; });
        }}
        onPointerUp={() => { resize.current = null; endInteraction(); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function TransitionMarker({ shot, x, open, onOpen, onClose }: { shot: Shot; x: number; open: boolean; onOpen: () => void; onClose: () => void }) {
  const setTransition = useEditor((s) => s.setTransition);
  const ref = useRef<HTMLButtonElement>(null);
  const tr: Transition = shot.transitionOut ?? { type: "cut", duration: 0.6, color: "#000000" };
  const fade = tr.type === "fade";
  return (
    <>
      <button
        ref={ref}
        type="button"
        title={fade ? `Fade · ${tr.duration}s` : "Cut · click to add a fade"}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("absolute top-1/2 z-20 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-colors", fade ? "border-accent bg-accent text-white" : "border-line-2 bg-panel text-muted hover:border-fg-2 hover:text-fg")}
        style={{ left: x }}
      >
        <Icon name={fade ? "fade" : "transition"} size={9} />
      </button>
      <Popover open={open} onClose={onClose} anchor={ref} side="top" align="center" className="w-60 p-2">
        <div className="label px-1 pb-2 pt-1 text-fg">Transition out</div>
        <div className="flex flex-col gap-1">
          <Segmented size="sm" value={tr.type} onChange={(v) => setTransition(shot.id, v === "cut" ? null : { ...tr, type: "fade" })} options={[{ value: "cut", label: "Cut" }, { value: "fade", label: "Fade" }]} />
          {fade && (
            <>
              <NumberRow label="Duration" value={tr.duration} min={0.1} max={3} step={0.05} unit="s" onChange={(v) => setTransition(shot.id, { ...tr, duration: v })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
              <ColorRow label="Colour" value={tr.color} onChange={(v) => setTransition(shot.id, { ...tr, color: v })} />
            </>
          )}
        </div>
      </Popover>
    </>
  );
}

function AudioLabel({ track, onRemove }: { track: AudioTrack; onRemove: () => void }) {
  const setAudio = useEditor((s) => s.setAudio);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="group flex items-center gap-1.5 border-b border-line px-2" style={{ height: ROW_H }}>
      <Icon name="speaker" size={11} className="text-muted" />
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} className="label min-w-0 flex-1 truncate text-left text-fg" title={track.media.name}>{track.media.name}</button>
      <span className="num text-[10px] text-muted">{audioLength(track).toFixed(1)}s</span>
      <IconButton icon="trash" size={10} label="Remove audio" onClick={onRemove} className="hidden h-5 w-5 group-hover:flex" />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="w-64 p-2">
        <div className="label px-1 pb-2 pt-1 text-fg">Audio</div>
        <div className="flex flex-col gap-1">
          <NumberRow label="Volume" value={track.volume} min={0} max={1} step={0.01} onChange={(v) => setAudio({ ...track, volume: v })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
          <NumberRow label="Fade in" value={track.fadeIn} min={0} max={5} step={0.1} unit="s" onChange={(v) => setAudio({ ...track, fadeIn: v })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
          <NumberRow label="Fade out" value={track.fadeOut} min={0} max={5} step={0.1} unit="s" onChange={(v) => setAudio({ ...track, fadeOut: v })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
          <NumberRow label="Trim start" value={track.trimStart} min={0} max={Math.max(0, (track.media.duration ?? 0) - 0.5)} step={0.1} unit="s" onChange={(v) => setAudio({ ...track, trimStart: v })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
          <Button variant="ghost" size="sm" icon="upload" onClick={() => void pickFiles(ACCEPTED_AUDIO).then(([f]) => f && addAudioFile(f))} className="justify-start text-muted">Replace file…</Button>
        </div>
      </Popover>
    </div>
  );
}

function AudioBlock({ track, pps, total }: { track: AudioTrack; pps: number; total: number }) {
  const setAudio = useEditor((s) => s.setAudio);
  const loaded = useMedia(track.media);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const len = audioLength(track);
  const clipped = Math.min(len, Math.max(0, total - track.start));
  return (
    <div className="relative border-b border-line" style={{ height: ROW_H }}>
      <div
        className="absolute top-1 flex h-[22px] cursor-grab items-center gap-1.5 overflow-hidden rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 text-emerald-700 dark:text-emerald-300"
        style={{ left: 8 + track.start * pps, width: Math.max(24, len * pps) }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, start: track.start }; beginInteraction(); }}
        onPointerMove={(e) => { if (!drag.current) return; const s = clamp(snapTime(drag.current.start + (e.clientX - drag.current.x) / pps, pps, useUI.getState().time), 0, Math.max(0, total - 0.5)); setAudio({ ...track, start: s }); }}
        onPointerUp={() => { drag.current = null; endInteraction(); }}
      >
        <Waveform loaded={loaded} />
        <Icon name="audio" size={10} className="relative" />
        <span className="label relative truncate">{track.media.name}</span>
        {clipped < len && <span className="label-sm relative ml-auto opacity-70">trimmed to end</span>}
      </div>
    </div>
  );
}

/** Lightweight waveform: decoded once per file, drawn as vertical bars behind the clip label. */
function Waveform({ loaded }: { loaded: ReturnType<typeof useMedia> }) {
  const [bars, setBars] = useState<number[] | null>(null);
  useEffect(() => {
    if (!loaded || loaded.kind !== "audio") return;
    let cancelled = false;
    void (async () => {
      try {
        const buf = await loaded.blob.arrayBuffer();
        const ac = new OfflineAudioContext(1, 1, 22050);
        const decoded = await ac.decodeAudioData(buf);
        const data = decoded.getChannelData(0);
        const n = 160;
        const step = Math.max(1, Math.floor(data.length / n));
        const out: number[] = [];
        for (let i = 0; i < n; i++) {
          let peak = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 8) peak = Math.max(peak, Math.abs(data[j]));
          out.push(peak);
        }
        if (!cancelled) setBars(out);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [loaded]);
  if (!bars) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center gap-px px-1 opacity-60">
      {bars.map((b, i) => <div key={i} className="w-full rounded-sm bg-emerald-500" style={{ height: `${Math.max(8, b * 100)}%` }} />)}
    </div>
  );
}

function KeyframeDiamond({ x, selected, onSelect, onMove, pps, onContextMenu }: { x: number; selected: boolean; onSelect: (additive: boolean) => void; onMove: (dt: number) => void; pps: number; onContextMenu?: (at: { x: number; y: number }) => void }) {
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  return (
    <button
      type="button"
      className={cn("absolute top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm", selected ? "text-fg" : "text-accent")}
      style={{ left: x }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, moved: false }; onSelect(e.shiftKey); }}
      onPointerMove={(e) => { if (!drag.current) return; if (Math.abs(e.clientX - drag.current.x) > 3) drag.current.moved = true; }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        if (drag.current.moved) onMove((e.clientX - drag.current.x) / pps);
        drag.current = null;
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke={selected ? "var(--accent)" : "none"} strokeWidth="3"><path d="M12 3l9 9-9 9-9-9z" /></svg>
    </button>
  );
}

export function TimelineHint({ children }: { children: ReactNode }) {
  return <span className="label-sm text-muted">{children}</span>;
}
