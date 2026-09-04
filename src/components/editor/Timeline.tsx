"use client";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEditor, beginInteraction, endInteraction, hasShotClipboard, clampKeyTime } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ANIM_LABELS, type AnimProp, type Keyframe, type Shot, type Transition, type AudioTrack } from "@/lib/types";
import { EASES, formatTime, shotStart, totalDuration, inHandleOf, setInHandle } from "@/lib/animation";
import { MOTION_PRESETS } from "@/lib/presets";
import { Button, IconButton, Popover, Segmented, MenuList, ContextMenu, NumberRow, ColorRow, type MenuItem } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn, clamp } from "@/lib/cn";
import { useShallow } from "zustand/react/shallow";
import { applyMotionPreset, importFilesToShot, addAudioFile, importLogo, addShotFromCamera } from "@/lib/actions";
import { pickFiles } from "./hooks";
import { ACCEPTED_AUDIO, ACCEPTED_IMAGES, ACCEPTED_TYPES, useMedia } from "@/lib/media";
import { audioLength } from "@/lib/audio";
import { shotKind } from "@/lib/defaults";
import { blip } from "@/lib/sounds";
import { EasingButton, SelectionCount } from "./EasingEditor";

const LEFT_W = 184;
const RULER_H = 22;
const ROW_H = 30;
const LANE_H = 24;
const SNAP_PX = 7;

/** Snap a time to half-seconds and the playhead, reporting what it locked on to. */
function snapDetail(t: number, pps: number, playhead: number): { t: number; snapped: number | null } {
  let best = t;
  let bestD = SNAP_PX / pps;
  let snapped: number | null = null;
  for (const c of [Math.round(t * 2) / 2, playhead]) {
    const d = Math.abs(c - t);
    if (d < bestD) { best = c; bestD = d; snapped = c; }
  }
  // a snapped time has to land exactly on its target: the coarse rounding would leave it a few
  // milliseconds off the playhead, far more than the tolerance keyframe lookups use
  return { t: snapped ?? Math.round(best * 100) / 100, snapped };
}

function snapTime(t: number, pps: number, playhead: number): number {
  return snapDetail(t, pps, playhead).t;
}

/** A keyframe may lead in from before its shot, but never from before zero: the lane clips
 *  anything at a negative x, and a diamond you cannot scroll to is a diamond you cannot pick up. */
function keepInView(t: number, start: number): number {
  return Math.max(t, -start);
}

/** The distance a track keeps between two keyframes that would otherwise share a frame. */
const KEY_STEP = 0.001;

/** Where a dragged keyframe can land without sitting on top of another one. Dropping a diamond on
 *  a neighbour has to push past it in the direction of travel, never swallow it. */
function freeSlot(t: number, others: number[], dir: number, duration: number): number {
  const taken = (x: number) => others.some((o) => Math.abs(o - x) < KEY_STEP - 1e-9);
  const walk = (step: number) => {
    let out = t;
    for (let i = 0; i <= others.length && taken(out); i++) out = Math.round((out + step) * 1000) / 1000;
    return out;
  };
  const step = dir < 0 ? -KEY_STEP : KEY_STEP;
  // clamping to the shot's margin can land the nudge back on the neighbour, so the other side is
  // the fallback rather than an overwrite
  const out = clampKeyTime(walk(step), duration);
  return taken(out) ? clampKeyTime(walk(-step), duration) : out;
}

/** Where a proportional (alt) group drag puts one keyframe — the pivot and scale the store uses. */
function scaledKeyTime(abs: number[], t: number, dt: number): number {
  const pivot = Math.min(...abs);
  const span = Math.max(...abs) - pivot;
  if (span <= 1e-6) return t + dt;
  return pivot + (t - pivot) * Math.max(0.02, (span + dt) / span);
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
  // subscribing to the whole UI store re-rendered the timeline on every playback frame; the
  // playhead is left out of the selection and read in leaves (or from getState in handlers),
  // so a 60 Hz tick never reconciles the shot and keyframe tree
  const ui = useUI(useShallow((s) => ({
    playing: s.playing, loop: s.loop, recording: s.recording, activeShotId: s.activeShotId,
    timelineMode: s.timelineMode, timelineZoom: s.timelineZoom, timelineHeight: s.timelineHeight,
    autoMotion: s.autoMotion, guides: s.guides, selectedKeys: s.selectedKeys, selectedShots: s.selectedShots,
    setTime: s.setTime, setPlaying: s.setPlaying, toggleLoop: s.toggleLoop, setRecording: s.setRecording,
    setActiveShot: s.setActiveShot, setTimelineMode: s.setTimelineMode, setTimelineZoom: s.setTimelineZoom,
    setTimelineHeight: s.setTimelineHeight, setAutoMotion: s.setAutoMotion, setGuides: s.setGuides,
    setSelectedKeys: s.setSelectedKeys, setSelectedShots: s.setSelectedShots, setTimelineOpen: s.setTimelineOpen, showToast: s.showToast,
  })));
  const total = totalDuration(project);
  const pps = 96 * ui.timelineZoom;
  const selectedShots = ui.selectedShots;
  const setSelectedShots = (next: string[] | ((cur: string[]) => string[])) =>
    ui.setSelectedShots(typeof next === "function" ? next(useUI.getState().selectedShots) : next);
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
  const [trackMenu, setTrackMenu] = useState<{ at: { x: number; y: number }; shotId: string; prop: AnimProp } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [transitionFor, setTransitionFor] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const marqueeRef = useRef<{ x0: number; y0: number; additive: boolean; base: typeof selected; baseShots: string[] } | null>(null);
  const advanced = ui.timelineMode === "advanced";
  const reorderShot = useEditor((s) => s.reorderShot);
  // whole shots picked out on the ruler. The UI store carries the keyframe selection but not this
  // one, so it lives with the timeline and is pruned whenever a shot goes away.

  const [shotDrag, setShotDrag] = useState<{ ids: string[]; dx: number } | null>(null);
  const [gapMenu, setGapMenu] = useState<{ at: { x: number; y: number }; shotId: string } | null>(null);

  // Simple mode packs the sequence — a gap neither shows nor offsets anything — so the blocks, the
  // keyframes and the playhead all share one mapping between project time and where it is drawn.
  const packed = useMemo(() => {
    const starts = new Map<string, { real: number; disp: number }>();
    let real = 0, disp = 0;
    for (const s of project.shots) {
      real += Math.max(0, s.gap ?? 0);
      starts.set(s.id, { real, disp });
      real += s.duration;
      disp += s.duration;
    }
    return { starts, total: disp };
  }, [project.shots]);
  const dispTotal = advanced ? total : packed.total;
  const toDisplayTime = (t: number) => {
    if (advanced) return t;
    for (const s of project.shots) {
      const st = packed.starts.get(s.id)!;
      if (t < st.real) return st.disp;
      if (t < st.real + s.duration) return st.disp + (t - st.real);
    }
    return packed.total;
  };
  const toRealTime = (d: number) => {
    if (advanced) return d;
    for (const s of project.shots) {
      const st = packed.starts.get(s.id)!;
      if (d < st.disp + s.duration) return st.real + Math.max(0, d - st.disp);
    }
    const last = project.shots[project.shots.length - 1];
    const st = last && packed.starts.get(last.id);
    return st ? st.real + last.duration : 0;
  };

  const seekFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left + el.scrollLeft - 8;
    ui.setTime(clamp(toRealTime(clamp(x / pps, 0, dispTotal)), 0, total));
  };
  const scrubbing = useRef(false);
  const onRulerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubbing.current = true;
    if (ui.playing) ui.setPlaying(false);
    // scrubbing is the other natural way to say "nothing in particular", so it drops the selection
    // rather than leaving a group of shots armed for the next drag or the next Delete
    if (useUI.getState().selectedShots.length) ui.setSelectedShots([]);
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
      // reading the zoom and the playhead here keeps the listener out of the dependency array,
      // so a playing timeline does not re-register it once a frame
      const { time, timelineZoom, setTimelineZoom } = useUI.getState();
      const z = clamp(timelineZoom * Math.exp(-e.deltaY * 0.01), 0.4, 8);
      const before = 8 + time * 96 * timelineZoom - el.scrollLeft;
      setTimelineZoom(z);
      requestAnimationFrame(() => { el.scrollLeft = 8 + time * 96 * z - before; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const end = Math.max(dispTotal, 12) + 2;
    const step = pps < 50 ? 2 : pps < 90 ? 1 : 0.5;
    for (let t = 0; t <= end; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }, [dispTotal, pps]);
  const innerW = Math.max(dispTotal, 12) * pps + 240;

  const rows: { shot: Shot; start: number; lanes: AnimProp[]; open: boolean }[] = project.shots.map((shot) => {
    const tracks = (Object.keys(shot.keyframes) as AnimProp[]).filter((k) => (shot.keyframes[k]?.length ?? 0) > 0);
    // a shot with keyframes shows its lanes unless you collapse it, so a new keyframe is never hidden
    const open = expanded[shot.id] ?? tracks.length > 0;
    const st = packed.starts.get(shot.id) ?? { real: 0, disp: 0 };
    return { shot, start: advanced ? st.real : st.disp, lanes: advanced && open ? tracks : [], open };
  });

  // Simple mode has one lane for the whole sequence, so every keyframe a shot holds at the same
  // time is drawn as a single diamond carrying all of its tracks together.
  const stacks = useMemo(() => {
    if (advanced) return [];
    const out: { shot: Shot; start: number; realStart: number; t: number; props: AnimProp[]; custom: boolean }[] = [];
    for (const shot of project.shots) {
      const st = packed.starts.get(shot.id) ?? { real: 0, disp: 0 };
      const at = new Map<number, { t: number; props: AnimProp[]; custom: boolean }>();
      for (const [prop, list] of Object.entries(shot.keyframes) as [AnimProp, Keyframe[] | undefined][]) {
        for (const k of list ?? []) {
          const slot = at.get(Math.round(k.t * 1000)) ?? { t: k.t, props: [], custom: false };
          slot.props.push(prop);
          if (k.cp || inHandleOf(k)) slot.custom = true;
          at.set(Math.round(k.t * 1000), slot);
        }
      }
      for (const slot of at.values()) out.push({ shot, start: st.disp, realStart: st.real, ...slot });
    }
    return out;
  }, [advanced, project.shots, packed]);

  const groupIds = (id: string) => (selectedShots.length > 1 && selectedShots.includes(id) ? selectedShots : [id]);

  const selectShot = (id: string, additive: boolean) => {
    ui.setActiveShot(id);
    if (additive) { setSelectedShots((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); return; }
    setSelectedShots([id]);
    ui.setTime(clamp((packed.starts.get(id)?.real ?? 0) + 0.0001, 0, total));
  };

  // a shot the sequence no longer holds must not linger in the selection and be deleted twice
  useEffect(() => {
    const cur = useUI.getState().selectedShots;
    const live = cur.filter((id) => project.shots.some((s) => s.id === id));
    if (live.length !== cur.length) useUI.getState().setSelectedShots(live);
  }, [project.shots]);

  // Delete clears a shot selection made on the ruler. The keyframe selection owns the key first —


  /** Move a run of shots along the ruler by growing the empty stretch in front of it. The shot
   *  after a run gives the same time back, so nothing downstream drifts unless the space runs out. */
  const shiftGaps = (ids: string[], dt: number) => {
    const p = useEditor.getState().project;
    const sel = new Set(ids);
    const runs: { first: Shot; after: Shot | undefined }[] = [];
    p.shots.forEach((s, i) => {
      if (!sel.has(s.id) || (i > 0 && sel.has(p.shots[i - 1].id))) return;
      let j = i;
      while (j + 1 < p.shots.length && sel.has(p.shots[j + 1].id)) j++;
      runs.push({ first: s, after: p.shots[j + 1] });
    });
    if (!runs.length) return;
    // the selection stays rigid, so the whole group stops as soon as one of its gaps would go under zero
    const d = Math.max(dt, ...runs.map((r) => -(r.first.gap ?? 0)));
    if (Math.abs(d) < 0.005) return;
    const setGap = useEditor.getState().setShotGap;
    beginInteraction();
    for (const r of runs) {
      setGap(r.first.id, (r.first.gap ?? 0) + d);
      if (r.after && !sel.has(r.after.id)) setGap(r.after.id, Math.max(0, (r.after.gap ?? 0) - d));
    }
    endInteraction();
  };

  const dropShot = (shot: Shot, index: number, dxPx: number) => {
    setShotDrag(null);
    const dt = dxPx / pps;
    const ids = groupIds(shot.id);
    // carrying a block past another shot's midpoint still reorders the sequence; a drag that stays
    // inside its own slot moves the shot in time instead
    const center = (rows[index]?.start ?? 0) + shot.duration / 2 + dt;
    let target = index;
    if (ids.length === 1) {
      for (let i = 0; i < rows.length; i++) {
        if (i === index) continue;
        const c = rows[i].start + rows[i].shot.duration / 2;
        if (i < index && center < c) target = Math.min(target, i);
        if (i > index && center > c) target = Math.max(target, i);
      }
    }
    if (target !== index) { reorderShot(shot.id, target); return; }
    // simple mode packs the sequence, so a shot there has nowhere to go but another slot
    if (advanced) shiftGaps(ids, dt);
  };

  const gapLabel = (shotId: string) => {
    const i = project.shots.findIndex((s) => s.id === shotId);
    const shot = project.shots[i], prev = project.shots[i - 1];
    if (!shot) return "";
    const gap = Math.max(0, shot.gap ?? 0);
    return prev ? `${gap.toFixed(2)}s between ${prev.name} and ${shot.name}` : `${gap.toFixed(2)}s before ${shot.name}`;
  };

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

  // whether the playhead is far enough inside the shot the open menu belongs to for a split to
  // take. It has to follow the playhead while the menu stands, but the timeline stays off the
  // playback tick by subscribing to the boolean rather than the time, and only while a menu is open
  const splitInside = useUI((s) => {
    if (!menu) return false;
    const shot = project.shots.find((x) => x.id === menu.shotId);
    if (!shot) return false;
    const start = shotStart(project, menu.shotId);
    return s.time > start + 0.2 && s.time < start + shot.duration - 0.2;
  });

  const menuItems = (shotId: string): MenuItem[] => {
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return [];
    const start = shotStart(project, shotId);
    const kind = shotKind(shot);
    return [
      { label: "Duration", icon: "clock", right: <ShotDuration shot={shot} /> },
      { divider: true, label: "" },
      { label: "Rename", icon: "text-cursor", onSelect: () => setRenaming(shotId) },
      ...(kind === "media" ? [{ label: "Upload media…", icon: "upload", onSelect: () => void pickFiles(ACCEPTED_TYPES, true).then((f) => importFilesToShot(f, shotId)) }] : []),
      ...(kind === "logo" ? [{ label: "Replace logo…", icon: "image", onSelect: () => void pickFiles(ACCEPTED_IMAGES).then(([f]) => f && importLogo(f, shotId)) }] : []),
      { label: "Duplicate", icon: "copy", shortcut: "⌘D", onSelect: () => duplicateShot(shotId) },
      // a playing playhead can cross the shot's edge between the render that enabled this item and
      // the click, so the cut lands at the nearest point that still leaves two halves to keep
      { label: "Split at playhead", icon: "split-clip", shortcut: "⇧⌘D", disabled: !splitInside, onSelect: () => splitShot(shotId, clamp(useUI.getState().time - start, 0.2, shot.duration - 0.2)) },
      { label: "Reverse", icon: "rewind", onSelect: () => reverseShot(shotId) },
      ...((shot.device || shot.finish || shot.scene || shot.lighting)
        ? [{ label: "Use the project look", icon: "rotate-ccw", onSelect: () => useEditor.getState().updateShot(shotId, (s) => { delete s.device; delete s.finish; delete s.scene; delete s.lighting; }) }]
        : []),
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

  const keyMenuKf = keyMenu
    ? project.shots.find((s) => s.id === keyMenu.shotId)?.keyframes[keyMenu.prop]?.find((k) => Math.abs(k.t - keyMenu.t) < 0.0005)
    : undefined;

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
        <EasingButton />
        <SelectionCount />
        <div className="flex-1" />
        <button type="button" onClick={() => ui.setRecording(!ui.recording)} className={cn("label flex h-6 items-center gap-1.5 rounded-md px-2 transition-colors", ui.recording ? "bg-accent-soft text-accent" : "bg-fill text-fg-2 hover:text-fg")} title="Record keyframes (R)">
          <Icon name="record" size={8} className={ui.recording ? "text-accent" : "text-muted"} />Record keyframes
        </button>
        <div className="num flex h-6 items-center gap-1 rounded-md bg-fill px-2 text-[11px]">
          <TimeReadout />
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
              { label: "Shot from camera", sub: "Animates from where the sequence ends", icon: "camera", onSelect: () => { addShotFromCamera(); setAddOpen(false); } },
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
            {!advanced && (
              <>
                <div className="flex items-center gap-1.5 border-b border-line px-2" style={{ height: ROW_H }}>
                  <Icon name="film" size={11} className="text-muted" />
                  <span className="label text-fg">Shots</span>
                  <span className="num ml-auto text-[10px] text-muted">{project.shots.length}</span>
                </div>
                <div className="flex items-center gap-1.5 border-b border-line pl-8 pr-2" style={{ height: LANE_H }}>
                  <Icon name="diamond" size={8} className="text-accent" />
                  <span className="label-sm text-fg-2">Keyframes</span>
                </div>
              </>
            )}
            {advanced && rows.map(({ shot, lanes, open }) => {
              const active = ui.activeShotId === shot.id;
              return (
                <div key={shot.id}>
                  <div
                    className={cn("group flex items-center gap-1 border-b border-line px-1.5", active && "bg-accent-soft/60")}
                    style={{ height: ROW_H }}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ at: { x: e.clientX, y: e.clientY }, shotId: shot.id }); }}
                    onClick={() => ui.setActiveShot(shot.id)}
                  >
                    <IconButton icon={open ? "chevron-down" : "chevron-right"} size={11} label={open ? "Hide keyframes" : "Show keyframes"} onClick={(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [shot.id]: !open })); }} className="h-5 w-5" disabled={!advanced} />
                    <Icon name={KIND_ICON[shotKind(shot)]} size={11} className="text-muted" />
                    {(shot.device || shot.scene || shot.lighting || shot.finish) && <Icon name="pin" size={9} className="text-accent" />}
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
        <div
          ref={scrollRef}
          className="scroll relative min-w-0 flex-1 overflow-auto"
          onPointerDown={(e) => {
            // a drag starting on empty track space marquee-selects keyframes and whole shots
            const t = e.target as HTMLElement;
            if (e.button !== 0 || t.closest("[data-kf]") || t.closest("[data-shot]") || t.closest("[data-ruler]") || t.closest("[data-clip]")) return;
            const el = scrollRef.current!;
            const r = el.getBoundingClientRect();
            const x = e.clientX - r.left + el.scrollLeft, y = e.clientY - r.top + el.scrollTop;
            marqueeRef.current = { x0: x, y0: y, additive: e.shiftKey, base: e.shiftKey ? selected : [], baseShots: e.shiftKey ? selectedShots : [] };
            if (!e.shiftKey) { setSelected([]); setSelectedShots([]); }
            el.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const m = marqueeRef.current;
            if (!m) return;
            const el = scrollRef.current!;
            const r = el.getBoundingClientRect();
            const x = e.clientX - r.left + el.scrollLeft, y = e.clientY - r.top + el.scrollTop;
            if (!marquee && Math.abs(x - m.x0) < 4 && Math.abs(y - m.y0) < 4) return;
            const rect = { x0: Math.min(m.x0, x), y0: Math.min(m.y0, y), x1: Math.max(m.x0, x), y1: Math.max(m.y0, y) };
            setMarquee(rect);
            const hits: typeof selected = [];
            el.querySelectorAll("[data-kf]").forEach((node) => {
              const b = (node as HTMLElement).getBoundingClientRect();
              const nx = b.left + b.width / 2 - r.left + el.scrollLeft;
              const ny = b.top + b.height / 2 - r.top + el.scrollTop;
              if (nx >= rect.x0 && nx <= rect.x1 && ny >= rect.y0 && ny <= rect.y1) {
                const [shotId, prop, t] = (node as HTMLElement).dataset.kf!.split("|");
                // one diamond stands for several tracks in the shared lane, so it carries them all
                for (const p2 of prop.split(",")) hits.push({ shotId, prop: p2 as AnimProp, t: Number(t) });
              }
            });
            const merged = m.additive ? [...m.base, ...hits.filter((h) => !m.base.some((b2) => b2.shotId === h.shotId && b2.prop === h.prop && Math.abs(b2.t - h.t) < 0.0005))] : hits;
            setSelected(merged);
            // a shot block is a wide target, so it joins the selection on any overlap rather than
            // only when its centre falls inside the marquee
            const shotHits: string[] = [];
            el.querySelectorAll("[data-shot]").forEach((node) => {
              const b = (node as HTMLElement).getBoundingClientRect();
              const bx0 = b.left - r.left + el.scrollLeft, by0 = b.top - r.top + el.scrollTop;
              if (bx0 + b.width >= rect.x0 && bx0 <= rect.x1 && by0 + b.height >= rect.y0 && by0 <= rect.y1) shotHits.push((node as HTMLElement).dataset.shot!);
            });
            setSelectedShots(m.additive ? [...m.baseShots, ...shotHits.filter((id) => !m.baseShots.includes(id))] : shotHits);
          }}
          onPointerUp={(e) => { marqueeRef.current = null; setMarquee(null); try { scrollRef.current?.releasePointerCapture(e.pointerId); } catch {} }}
        >
          <div className="relative" style={{ width: innerW, minHeight: "100%" }}>
            {/* ruler */}
            <div data-ruler="" className="sticky top-0 z-10 cursor-pointer border-b border-line bg-panel" style={{ height: RULER_H }} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp}>
              {advanced && rows.map(({ shot, start }) => (shot.gap ?? 0) > 0 && (
                <div key={shot.id} className="pointer-events-none absolute inset-y-0" style={{ left: 8 + (start - (shot.gap ?? 0)) * pps, width: Math.max(2, (shot.gap ?? 0) * pps), background: "color-mix(in srgb, var(--accent) 13%, transparent)" }} />
              ))}
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 flex h-full flex-col justify-end" style={{ left: 8 + t * pps }}>
                  <span className={cn("num -translate-x-1/2 text-[9px]", Number.isInteger(t) ? "text-muted" : "text-transparent")}>{Number.isInteger(t) ? `${t}s` : ""}</span>
                  <div className={cn("w-px bg-line-2", Number.isInteger(t) ? "h-2" : "h-1")} />
                </div>
              ))}
            </div>
            {/* rows */}
            <div>
              {!advanced && (
                <>
                  <div className="relative border-b border-line" style={{ height: ROW_H }}>
                    {rows.map(({ shot, start }, i) => (
                      <Fragment key={shot.id}>
                        <ShotBlock
                          shot={shot}
                          start={start}
                          pps={pps}
                          active={ui.activeShotId === shot.id}
                          selected={selectedShots.includes(shot.id)}
                          renaming={renaming === shot.id}
                          onRenameEnd={() => setRenaming(null)}
                          dx={shotDrag?.ids.includes(shot.id) ? shotDrag.dx : 0}
                          onSelect={(additive) => selectShot(shot.id, additive)}
                          onExpand={() => ui.setTimelineMode("advanced")}
                          onDragMove={(dx) => setShotDrag({ ids: groupIds(shot.id), dx })}
                          onDragEnd={(dx) => dropShot(shot, i, dx)}
                          onMenu={(at) => setMenu({ at, shotId: shot.id })}
                        />
                        {i < rows.length - 1 && (
                          <TransitionMarker shot={shot} x={8 + (start + shot.duration) * pps} open={transitionFor === shot.id} onOpen={() => setTransitionFor(shot.id)} onClose={() => setTransitionFor(null)} />
                        )}
                      </Fragment>
                    ))}
                  </div>
                  <div className="relative border-b border-line" style={{ height: LANE_H }}>
                    {stacks.map(({ shot, start, realStart, t, props, custom }) => {
                      const keys = props.map((prop) => ({ shotId: shot.id, prop, t }));
                      const isSel = keys.every((key) => selected.some((s) => s.shotId === key.shotId && s.prop === key.prop && Math.abs(s.t - key.t) < 0.0005));
                      return (
                        <KeyframeDiamond
                          key={`${shot.id}|${t}`}
                          id={`${shot.id}|${props.join(",")}|${t}`}
                          x={8 + (start + t) * pps}
                          t={t}
                          start={start}
                          selected={isSel}
                          custom={custom}
                          pps={pps}
                          onContextMenu={(at) => { if (!isSel) setSelected(keys); setKeyMenu({ at, shotId: shot.id, prop: props[0], t }); }}
                          onSelect={(additive) => {
                            if (additive) setSelected(isSel ? selected.filter((s) => !(s.shotId === shot.id && props.includes(s.prop) && Math.abs(s.t - t) < 0.0005)) : [...selected, ...keys]);
                            else if (!isSel) setSelected(keys);
                            ui.setTime(clamp(realStart + t, 0, total));
                          }}
                          preview={(dt) => {
                            const d = snapDetail(t + dt, pps, useUI.getState().time - realStart);
                            const nt = keepInView(clampKeyTime(d.t, shot.duration), start);
                            setSnapAt(d.snapped !== null && Math.abs(nt - d.snapped) < 0.0005 ? start + d.snapped : null);
                            return nt;
                          }}
                          onMove={(dt, alt) => {
                            setSnapAt(null);
                            // the whole stack is already in the selection, and the store holds two
                            // keyframes that would share a frame apart rather than dropping one
                            const nt = keepInView(clampKeyTime(snapTime(t + dt, pps, useUI.getState().time - realStart), shot.duration), start);
                            useEditor.getState().moveSelectedKeyframes(nt - t, alt);
                          }}
                        />
                      );
                    })}
                  </div>
                </>
              )}
              {advanced && rows.map(({ shot, start, lanes, open }, i) => (
                <div key={shot.id}>
                  <div className="relative border-b border-line" style={{ height: ROW_H }} onContextMenu={(e) => { e.preventDefault(); setMenu({ at: { x: e.clientX, y: e.clientY }, shotId: shot.id }); }}>
                    {(shot.gap ?? 0) > 0 && (
                      <GapBand shot={shot} start={start} pps={pps} label={gapLabel(shot.id)} onMenu={(at) => setGapMenu({ at, shotId: shot.id })} />
                    )}
                    <ShotBlock
                      shot={shot}
                      start={start}
                      pps={pps}
                      active={ui.activeShotId === shot.id}
                      selected={selectedShots.includes(shot.id)}
                      renaming={renaming === shot.id}
                      onRenameEnd={() => setRenaming(null)}
                      dx={shotDrag?.ids.includes(shot.id) ? shotDrag.dx : 0}
                      onSelect={(additive) => selectShot(shot.id, additive)}
                      onExpand={() => setExpanded((x) => ({ ...x, [shot.id]: !open }))}
                      onDragMove={(dx) => setShotDrag({ ids: groupIds(shot.id), dx })}
                      onDragEnd={(dx) => dropShot(shot, i, dx)}
                      onMenu={(at) => setMenu({ at, shotId: shot.id })}
                    />
                    {i < rows.length - 1 && (
                      <TransitionMarker shot={shot} x={8 + (start + shot.duration) * pps} open={transitionFor === shot.id} onOpen={() => setTransitionFor(shot.id)} onClose={() => setTransitionFor(null)} />
                    )}
                  </div>
                  {lanes.map((prop) => (
                    <div key={prop} className="relative border-b border-line" style={{ height: LANE_H }}
                      onContextMenu={(e) => {
                        if ((e.target as HTMLElement).closest("[data-kf]")) return;
                        e.preventDefault();
                        setTrackMenu({ at: { x: e.clientX, y: e.clientY }, shotId: shot.id, prop });
                      }}
                      onDoubleClick={(e) => {
                        // double-click a lane to drop a keyframe there; the stamp lands in whichever
                        // shot the playhead resolves to, and the very end of a shot already reads as
                        // the next one, so the seek has to stay just inside this shot
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const t = clamp(((e.clientX - r.left) - 8) / pps - start, 0, shot.duration - 0.0001);
                        ui.setTime(start + t);
                        requestAnimationFrame(() => useEditor.getState().stampKeyframes([prop]));
                      }}
                    >
                      {(shot.keyframes[prop] ?? []).map((k) => {
                        const isSel = selected.some((s) => s.shotId === shot.id && s.prop === prop && Math.abs(s.t - k.t) < 0.0005);
                        return (
                          <KeyframeDiamond
                            key={k.t}
                            id={`${shot.id}|${prop}|${k.t}`}
                            x={8 + (start + k.t) * pps}
                            t={k.t}
                            start={start}
                            selected={isSel}
                            custom={!!k.cp || !!inHandleOf(k)}
                            onContextMenu={(at) => { if (!isSel) setSelected([{ shotId: shot.id, prop, t: k.t }]); setKeyMenu({ at, shotId: shot.id, prop, t: k.t }); }}
                            onSelect={(additive) => {
                              const key = { shotId: shot.id, prop, t: k.t };
                              if (additive) setSelected(isSel ? selected.filter((s) => !(s.shotId === shot.id && s.prop === prop && Math.abs(s.t - k.t) < 0.0005)) : [...selected, key]);
                              else if (!isSel) setSelected([key]);
                              // a keyframe can sit outside the sequence, and the playhead cannot
                              ui.setTime(clamp(start + k.t, 0, total));
                            }}
                            preview={(dt, alt) => {
                              // a group drag moves everything by the raw delta, alt scales it around
                              // the earliest keyframe the way the store does; a single one snaps
                              if (selected.length > 1 && isSel) {
                                setSnapAt(null);
                                const abs = selected.map((s) => shotStart(project, s.shotId) + s.t);
                                // the store holds a plain group drag at the start of the project and
                                // clamps every keyframe to its shot's margin, so the ghost does too
                                const at = alt ? scaledKeyTime(abs, start + k.t, dt) : start + k.t + Math.max(dt, -Math.min(...abs));
                                return clampKeyTime(at - start, shot.duration);
                              }
                              const others = (shot.keyframes[prop] ?? []).filter((kk) => Math.abs(kk.t - k.t) > 0.0005).map((kk) => kk.t);
                              const d = snapDetail(k.t + dt, pps, useUI.getState().time - start);
                              const nt = freeSlot(keepInView(clampKeyTime(d.t, shot.duration), start), others, dt, shot.duration);
                              // the guide promises where the diamond will land, so a snap the clamps
                              // pull back off its target has nothing left to point at
                              setSnapAt(d.snapped !== null && Math.abs(nt - d.snapped) < 0.0005 ? start + d.snapped : null);
                              return nt;
                            }}
                            onMove={(dt, alt) => {
                              setSnapAt(null);
                              const many = selected.length > 1 && isSel;
                              if (many) { useEditor.getState().moveSelectedKeyframes(dt, alt); return; }
                              // a diamond dropped on another one used to overwrite it; hold the two
                              // a frame apart instead, the way a group move does
                              const others = (shot.keyframes[prop] ?? []).filter((kk) => Math.abs(kk.t - k.t) > 0.0005).map((kk) => kk.t);
                              const nt = freeSlot(keepInView(clampKeyTime(snapTime(k.t + dt, pps, useUI.getState().time - start), shot.duration), start), others, dt, shot.duration);
                              if (others.some((o) => Math.abs(o - nt) < 0.0005)) return;
                              update((p) => {
                                const s = p.shots.find((x) => x.id === shot.id);
                                if (!s) return;
                                const list = (s.keyframes[prop] ?? []).filter((kk) => Math.abs(kk.t - k.t) > 0.0005);
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
              {project.audio && <AudioBlock track={project.audio} pps={pps} total={total} toDisplay={toDisplayTime} toReal={toRealTime} />}
            </div>
            {snapAt !== null && (
              <div className="pointer-events-none absolute top-0 z-30 h-full w-px bg-accent/70" style={{ left: 8 + snapAt * pps }} />
            )}
            {marquee && (
              <div className="pointer-events-none absolute z-30 rounded-sm border border-accent bg-accent/15" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />
            )}
            {/* playhead */}
            <Playhead pps={pps} toDisplay={toDisplayTime} />
          </div>
        </div>
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu ? menuItems(menu.shotId) : []} onClose={() => setMenu(null)} />
      <ContextMenu
        at={gapMenu?.at ?? null}
        onClose={() => setGapMenu(null)}
        items={gapMenu ? [
          { label: `Gap · ${gapLabel(gapMenu.shotId)}`, disabled: true },
          { label: "Close gap", icon: "magnet", onSelect: () => { beginInteraction(); useEditor.getState().closeGap(gapMenu.shotId); endInteraction(); } },
        ] : []}
      />
      <ContextMenu
        at={trackMenu?.at ?? null}
        onClose={() => setTrackMenu(null)}
        items={trackMenu ? [
          { label: ANIM_LABELS[trackMenu.prop], disabled: true },
          { label: "Select whole track", icon: "diamond", onSelect: () => { const s2 = project.shots.find((x) => x.id === trackMenu.shotId); const list = s2?.keyframes[trackMenu.prop] ?? []; setSelected(list.map((k) => ({ shotId: trackMenu.shotId, prop: trackMenu.prop, t: k.t }))); } },
          { label: "Add keyframe here", icon: "plus", onSelect: () => useEditor.getState().stampKeyframes([trackMenu.prop]) },
          { divider: true, label: "" },
          { label: "Clear track", icon: "trash", danger: true, onSelect: () => clearTrack(trackMenu.prop, trackMenu.shotId) },
        ] : []}
      />
      <ContextMenu
        at={keyMenu?.at ?? null}
        onClose={() => setKeyMenu(null)}
        items={keyMenu ? [
          { label: "Easing", disabled: true },
          // a keyframe carrying a custom curve is on no named ease, so no preset may read as checked
          ...EASES.map((e) => ({ label: e.label, checked: !keyMenuKf?.cp && !inHandleOf(keyMenuKf) && keyMenuKf?.ease === e.id, onSelect: () => update((p) => { const s = p.shots.find((x) => x.id === keyMenu.shotId); const k = s?.keyframes[keyMenu.prop]?.find((kk) => Math.abs(kk.t - keyMenu.t) < 0.0005); if (k) { k.ease = e.id; delete k.cp; setInHandle(k, null); } }) })),
          { divider: true, label: "" },
          { label: "Apply easing to whole track", icon: "diamond", onSelect: () => update((p) => { const s = p.shots.find((x) => x.id === keyMenu.shotId); const list = s?.keyframes[keyMenu.prop]; const src = list?.find((kk) => Math.abs(kk.t - keyMenu.t) < 0.0005); if (list && src) for (const kk of list) { kk.ease = src.ease; if (src.cp) kk.cp = [...src.cp] as typeof src.cp; else delete kk.cp; setInHandle(kk, inHandleOf(src) ?? null); } }) },
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

/** The playhead moves every frame, so its readouts subscribe on their own. */
function TimeReadout() {
  const time = useUI((s) => s.time);
  return <span className="text-fg">{formatTime(time)}</span>;
}

function Playhead({ pps, toDisplay }: { pps: number; toDisplay: (t: number) => number }) {
  const time = useUI((s) => s.time);
  return (
    <div className="pointer-events-none absolute top-0 z-20 h-full" style={{ left: 8 + toDisplay(time) * pps }}>
      <div className="num -translate-x-1/2 rounded-sm bg-fg px-1 text-[9px] text-inverse-fg">{time.toFixed(2)}</div>
      <div className="h-full w-px bg-fg" />
    </div>
  );
}

/** Type a shot's length in seconds instead of dragging its right edge out on the block. */
function ShotDuration({ shot }: { shot: Shot }) {
  const [text, setText] = useState(shot.duration.toFixed(2));
  // only a field the user actually typed into may write back; otherwise closing the menu, or a
  // Split landing while the menu is open, would push this field's stale text over the new length
  const typed = useRef(false);
  useEffect(() => { typed.current = false; setText(shot.duration.toFixed(2)); }, [shot.duration]);
  const commit = () => {
    if (!typed.current) return;
    typed.current = false;
    // the length is read back from the store rather than the prop: a commit can run from the
    // teardown below, where the prop is one render behind a length this field has already written
    const cur = useEditor.getState().project.shots.find((s) => s.id === shot.id)?.duration ?? shot.duration;
    const v = Number(text.trim());
    const valid = text.trim() !== "" && Number.isFinite(v);
    const d = valid ? Math.round(clamp(v, 0.5, 180) * 100) / 100 : cur;
    setText(d.toFixed(2));
    if (d === cur) return;
    beginInteraction();
    useEditor.getState().updateShot(shot.id, (s) => { s.duration = d; });
    endInteraction();
  };
  // the menu closes on pointerdown, which tears the field out of the DOM before it can blur, so
  // the typed value is committed as the input goes away rather than lost with it
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => () => latest.current(), []);
  return (
    <span className="num flex items-center gap-1 text-[11px] text-muted">
      <input
        className="h-5 w-11 rounded bg-fill px-1 text-right text-fg outline-none focus:ring-1 focus:ring-accent"
        value={text}
        // the menu row is itself a button, so the field takes focus by hand and swallows the click
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); e.currentTarget.focus(); e.currentTarget.select(); }}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { typed.current = true; setText(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { typed.current = false; setText(shot.duration.toFixed(2)); e.currentTarget.blur(); } }}
      />
      s
    </span>
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

/** The empty stretch a shot keeps in front of it, drawn where that time sits on the ruler. */
function GapBand({ shot, start, pps, label, onMenu }: { shot: Shot; start: number; pps: number; label: string; onMenu: (at: { x: number; y: number }) => void }) {
  const gap = Math.max(0, shot.gap ?? 0);
  const w = Math.max(2, gap * pps);
  return (
    <div
      data-gap=""
      title={label}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY }); }}
      className="absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-md border border-dashed border-accent/40"
      style={{ left: 8 + (start - gap) * pps, width: w, background: "repeating-linear-gradient(45deg, color-mix(in srgb, var(--accent) 22%, transparent) 0 4px, color-mix(in srgb, var(--accent) 8%, transparent) 4px 9px)" }}
    >
      {w > 34 && <span className="num text-[9px] text-accent">{gap.toFixed(1)}s</span>}
    </div>
  );
}

function ShotBlock({ shot, start, pps, active, selected, dx, onSelect, onExpand, onDragMove, onDragEnd, onMenu, renaming, onRenameEnd }: {
  shot: Shot; start: number; pps: number; active: boolean; selected: boolean; dx: number;
  onSelect: (additive: boolean) => void; onExpand: () => void; onDragMove: (dx: number) => void; onDragEnd: (dx: number) => void; onMenu: (at: { x: number; y: number }) => void;
  /** true while this shot's name is being edited, which in simple mode happens on the block itself */
  renaming?: boolean; onRenameEnd?: () => void;
}) {
  const update = useEditor((s) => s.update);
  const media = useMedia(shot.media);
  const resize = useRef<{ x: number; d: number } | null>(null);
  const trimLeft = useRef<{ x: number; d: number; trim: number; keys: Shot["keyframes"] } | null>(null);
  const move = useRef<{ x: number; moved: boolean } | null>(null);
  const hasKeys = Object.values(shot.keyframes).some((k) => k && k.length > 0);
  const kind = shotKind(shot);
  const tr = shot.transitionOut;
  return (
    <div
      data-shot={shot.id}
      className={cn("absolute top-1 flex h-[22px] cursor-pointer select-none items-center gap-1.5 overflow-hidden rounded-md border px-2 transition-colors", active ? "border-accent bg-accent text-white" : kind === "media" ? "border-line-2 bg-fill text-fg-2 hover:bg-fill-2" : "border-line-2 bg-panel-2 text-fg-2 hover:bg-fill", selected && "ring-1 ring-fg", dx !== 0 && "z-30 opacity-90 shadow-lg")}
      style={{ left: 8 + start * pps, width: Math.max(24, shot.duration * pps), transform: dx ? `translateX(${dx}px)` : undefined }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY }); }}
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
        onDragMove(d);
      }}
      onPointerUp={(e) => {
        const m = move.current;
        move.current = null;
        if (!m) return;
        if (!m.moved) { onSelect(e.shiftKey); return; }
        onDragEnd(e.clientX - m.x);
      }}
      onDoubleClick={onExpand}
    >
      {media && kind === "media" && (
        // a single frame at the head of the clip, the way a clip reads in an NLE
        <span className="pointer-events-none absolute inset-y-0 left-0 w-6 rounded-l-md opacity-80" style={{ backgroundImage: `url(${media.url})`, backgroundSize: "cover", backgroundPosition: "center top" }} />
      )}
      <span className="shrink-0" style={{ width: media && kind === "media" ? 20 : 0 }} />
      {hasKeys && <Icon name="diamond" size={8} className="relative" />}
      {kind !== "media" && <Icon name={KIND_ICON[kind]} size={10} className="relative" />}
      {renaming
        ? <ShotName shot={shot} editing onEditEnd={() => onRenameEnd?.()} onEditStart={() => {}} />
        : <span className="label relative truncate">{shot.name}</span>}
      {shot.media?.kind === "video" && kind === "media" && <Icon name="video" size={10} className="relative ml-auto opacity-70" />}
      {(shot.speed ?? 1) !== 1 && <span className="num text-[9px] opacity-80">{shot.speed}×</span>}
      {tr && tr.type !== "cut" && <span className="ml-auto h-3 w-3 rounded-sm" style={{ background: `linear-gradient(90deg, transparent, ${tr.color})` }} title={`Fade ${tr.duration}s`} />}
      <div
        data-resize=""
        title="Trim the start"
        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-black/20"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); trimLeft.current = { x: e.clientX, d: shot.duration, trim: shot.trimStart ?? 0, keys: JSON.parse(JSON.stringify(shot.keyframes)) }; beginInteraction(); }}
        onPointerMove={(e) => {
          const t = trimLeft.current;
          if (!t) return;
          // trimming from the head shortens the shot and pulls its content and keyframes with it
          const dt = clamp(Math.round(((e.clientX - t.x) / pps) * 100) / 100, -t.trim / (shot.speed ?? 1), t.d - 0.5);
          update((p) => {
            const sh = p.shots.find((x) => x.id === shot.id);
            if (!sh) return;
            sh.duration = Math.round((t.d - dt) * 100) / 100;
            sh.trimStart = Math.max(0, Math.round((t.trim + dt * (sh.speed ?? 1)) * 100) / 100);
            for (const [prop, list] of Object.entries(t.keys) as [AnimProp, { t: number }[]][]) {
              if (!list?.length) continue;
              sh.keyframes[prop] = list.map((k) => ({ ...k, t: Math.round((k.t - dt) * 100) / 100 })) as never;
            }
          });
        }}
        onPointerUp={() => { trimLeft.current = null; endInteraction(); }}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        data-resize=""
        title="Trim the end"
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-black/20"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); resize.current = { x: e.clientX, d: shot.duration }; beginInteraction(); }}
        onPointerMove={(e) => {
          if (!resize.current) return;
          const raw = resize.current.d + (e.clientX - resize.current.x) / pps;
          const end = snapTime(start + raw, pps, useUI.getState().time);
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
      <Icon name="headphones" size={11} className="text-muted" />
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

function AudioBlock({ track, pps, total, toDisplay, toReal }: { track: AudioTrack; pps: number; total: number; toDisplay: (t: number) => number; toReal: (t: number) => number }) {
  const setAudio = useEditor((s) => s.setAudio);
  const loaded = useMedia(track.media);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const len = audioLength(track);
  const clipped = Math.min(len, Math.max(0, total - track.start));
  return (
    <div className="relative border-b border-line" style={{ height: ROW_H }}>
      <div
        data-clip=""
        className="absolute top-1 flex h-[22px] cursor-grab items-center gap-1.5 overflow-hidden rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 text-emerald-700 dark:text-emerald-300"
        style={{ left: 8 + toDisplay(track.start) * pps, width: Math.max(24, len * pps) }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, start: track.start }; beginInteraction(); }}
        // the clip is dragged where it is drawn, so the delta is read off the ruler and mapped back
        onPointerMove={(e) => { if (!drag.current) return; const raw = toReal(toDisplay(drag.current.start) + (e.clientX - drag.current.x) / pps); const s = clamp(snapTime(raw, pps, useUI.getState().time), 0, Math.max(0, total - 0.5)); setAudio({ ...track, start: s }); }}
        onPointerUp={() => { drag.current = null; endInteraction(); }}
      >
        <Waveform loaded={loaded} />
        <Icon name="volume" size={10} className="relative" />
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

function KeyframeDiamond({ id, x, t, start, selected, custom, onSelect, onMove, preview, pps, onContextMenu }: { id: string; x: number; t: number; start: number; selected: boolean; custom?: boolean; onSelect: (additive: boolean) => void; onMove: (dt: number, alt: boolean) => void; preview?: (dt: number, alt: boolean) => number; pps: number; onContextMenu?: (at: { x: number; y: number }) => void }) {
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  return (
    <button
      type="button"
      data-kf={id}
      title={custom ? "Custom easing curve" : undefined}
      className={cn("absolute top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm", selected ? "text-fg" : "text-accent", ghost !== null && "z-20")}
      style={{ left: ghost === null ? x : 8 + (start + ghost) * pps }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, moved: false }; onSelect(e.shiftKey); }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        if (Math.abs(e.clientX - drag.current.x) > 3) drag.current.moved = true;
        // the diamond follows the cursor so you can see where it will land
        if (drag.current.moved && preview) setGhost(preview((e.clientX - drag.current.x) / pps, e.altKey));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        setGhost(null);
        if (d.moved) onMove((e.clientX - d.x) / pps, e.altKey);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke={selected ? "var(--accent)" : "none"} strokeWidth="3"><path d="M12 3l9 9-9 9-9-9z" /></svg>
      {custom && <span className="absolute -top-0.5 right-0 h-1 w-1 rounded-full bg-accent" />}
    </button>
  );
}

export function TimelineHint({ children }: { children: ReactNode }) {
  return <span className="label-sm text-muted">{children}</span>;
}
