"use client";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { temporal } from "zundo";
import type { AnimProp, AudioTrack, Keyframe, Project, Shot, ShotKind, Transition } from "@/lib/types";
import { createLogoShot, createProject, createShot, createTextShot, normalizeProject } from "@/lib/defaults";
import { hasKeyframeAt, inHandleOf, locate, removeKeyframe, reverseTrack, sampleTrack, setInHandle, shotBase, splitTrack, totalDuration, upsertKeyframe, shotStart } from "@/lib/animation";
import { uid } from "@/lib/ids";
import { useUI } from "./ui";
import { getDevice } from "@/lib/devices";
import { getLighting, getScene } from "@/lib/presets";

interface EditorState {
  project: Project;
  replaceProject: (p: Project) => void;
  /** Mutate a cloned copy of the project. */
  update: (mut: (p: Project) => void) => void;
  /** Set an animatable value, writing a keyframe when recording or when the track already exists. */
  setValue: (prop: AnimProp, v: number) => void;
  setValues: (values: Partial<Record<AnimProp, number>>) => void;
  toggleKeyframe: (prop: AnimProp) => void;
  clearTrack: (prop: AnimProp, shotId?: string) => void;
  setDevice: (id: string) => void;
  setScenePreset: (id: Project["scene"]["preset"]) => void;
  /** append (or insert after `afterId`) a media, text or logo shot */
  addShot: (kind?: ShotKind, afterId?: string) => string;
  removeShot: (id: string) => void;
  duplicateShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
  reorderShot: (id: string, toIndex: number) => void;
  updateShot: (id: string, mut: (s: Shot) => void) => void;
  splitShot: (id: string, localT: number) => void;
  reverseShot: (id: string) => void;
  copyShot: (id: string) => void;
  pasteShot: (afterId?: string) => void;
  setTransition: (id: string, tr: Transition | null) => void;
  setAudio: (track: AudioTrack | null) => void;
  /** write keyframes for these props at the playhead with their current values */
  stampKeyframes: (props: AnimProp[]) => void;
  copyKeyframes: (keys: { shotId: string; prop: AnimProp; t: number }[]) => void;
  pasteKeyframes: () => void;
  /** move every selected keyframe; proportional scales the selection around its first keyframe */
  moveSelectedKeyframes: (dt: number, proportional?: boolean) => void;
  deleteSelectedKeyframes: () => void;
  /** push the shot under the playhead's framing / lens onto every other shot */
  applyPoseToAllShots: (props: AnimProp[]) => void;
  /** clear a shot's own value for these props so it follows the project again */
  clearPose: (shotId: string, props: AnimProp[]) => void;
  /** empty seconds before a shot on the ruler */
  setShotGap: (id: string, gap: number) => void;
  /** pull this shot and everything after it back so the gap before it closes */
  closeGap: (id: string) => void;
}

/** Where a shot leaves a property when it ends — its last keyframe, or the value it holds. */
function closingValue(p: Project, shot: Shot, prop: AnimProp): number {
  const track = shot.keyframes[prop];
  return track?.length ? sampleTrack(track, shot.duration) : shotBase(p, shot, prop);
}

/**
 * The properties a shot owns rather than the project: its framing, its lens and how the mockup is
 * turned. Lighting and screen brightness stay project-wide, since they belong to the set.
 */
const SHOT_SCOPED = new Set<AnimProp>([
  "camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY",
  "mockup.rotX", "mockup.rotY", "mockup.rotZ", "mockup.lid",
  "blur.strength", "blur.focusSize", "blur.falloff", "blur.focusX", "blur.focusY", "blur.focusDistance", "blur.angle",
]);
export const isShotScoped = (prop: AnimProp) => SHOT_SCOPED.has(prop);

let shotClipboard: Shot | null = null;
let keyClipboard: { prop: AnimProp; k: Keyframe; offset?: number }[] = [];
let keyframesCopiedLast = false;
export const hasShotClipboard = () => shotClipboard !== null;
export const hasKeyClipboard = () => keyClipboard.length > 0;
export const lastCopyWasKeyframes = () => keyframesCopiedLast;

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Discrete commands each get an undo step, even when clicked within a typing/drag burst. */
function commitProject(p: Project, set: (state: { project: Project }) => void) {
  beginInteraction();
  try { p.updatedAt = Date.now(); set({ project: p }); }
  finally { endInteraction(); }
}

function selectAt(p: Project, shot: Shot, localT = 0) {
  useUI.setState({ activeShotId: shot.id, selectedShots: [shot.id], selectedKeys: [], playing: false, time: shotStart(p, shot.id) + Math.max(0, Math.min(shot.duration, localT)) });
}

/** Keep the same shot and local playhead position when a reorder changes its absolute time. */
function preservePlayhead(before: Project, after: Project) {
  const loc = locate(before, useUI.getState().time);
  const shot = after.shots.find((s) => s.id === loc.shot?.id);
  if (shot) useUI.getState().setTime(shotStart(after, shot.id) + Math.min(shot.duration, loc.localT));
}

/** Keyframes may live outside their shot (motion carries through a cut), within a sane margin. */
/** Drops selected keys whose shot, track or time no longer exists in the project. */
function pruneSelectedKeys(p: Project) {
  const ui = useUI.getState();
  if (!ui.selectedKeys.length) return;
  const live = ui.selectedKeys.filter((k) => {
    const shot = p.shots.find((s) => s.id === k.shotId);
    return !!shot?.keyframes[k.prop]?.some((x) => Math.abs(x.t - k.t) < 0.0005);
  });
  if (live.length !== ui.selectedKeys.length) ui.setSelectedKeys(live);
}

export function clampKeyTime(t: number, duration: number): number {
  const margin = Math.max(2, duration);
  return Math.min(Math.max(t, -margin), duration + margin);
}

/** Immutable base-value write: copies only the group that changes. */
function withBase(p: Project, prop: AnimProp, v: number): Project {
  const [g, k] = prop.split(".") as [keyof Project, string];
  const group = p[g] as unknown as Record<string, number>;
  if (group[k] === v) return p;
  return { ...p, [g]: { ...group, [k]: v } };
}

export function currentShot(p: Project): { shot: Shot | null; localT: number } {
  const loc = locate(p, useUI.getState().time);
  return { shot: loc.shot, localT: loc.localT };
}

export const useEditor = create<EditorState>()(
  subscribeWithSelector(
    temporal(
      (set, get) => ({
        project: createProject(),
        replaceProject: (project) => {
          const p = normalizeProject(project);
          set({ project: p });
          pruneSelectedKeys(p);
        },
        update: (mut) => {
          const p = clone(get().project);
          mut(p);
          p.updatedAt = Date.now();
          set({ project: p });
        },
        setValue: (prop, v) => get().setValues({ [prop]: v }),
        setValues: (values) => {
          if (!Object.values(values).some((v) => typeof v === "number" && Number.isFinite(v))) return;
          // structural sharing: only the touched groups / shot are copied, so timeline rows and
          // unrelated inspector rows keep their references during drags
          const ui = useUI.getState();
          const prev = get().project;
          const { shot, localT } = currentShot(prev);
          let p: Project = { ...prev, updatedAt: Date.now() };
          const nextShot: Shot | null = shot ? { ...shot, keyframes: { ...shot.keyframes }, pose: { ...shot.pose } } : null;
          let shotTouched = false;
          // A framing or a lens belongs to the shot you are parked on, not to the whole sequence,
          // so an un-animated property writes the shot's own value and leaves every other shot as
          // it was. A single-shot project has nothing to diverge from, so it writes the project.
          const perShot = prev.shots.length > 1;
          const simple = ui.timelineMode === "simple" && prev.shots.length > 1 && !ui.recording;
          for (const [prop, v] of Object.entries(values) as [AnimProp, number][]) {
            if (v === undefined || !Number.isFinite(v)) continue;
            const track = nextShot?.keyframes[prop];
            const animated = !!track && track.length > 0;
            if (nextShot && (ui.recording || (animated && hasKeyframeAt(track!, localT)))) {
              // recording stamps as you go, and landing on an existing keyframe edits that keyframe
              nextShot.keyframes[prop] = upsertKeyframe(track, localT, v);
              shotTouched = true;
            } else if (nextShot && animated) {
              // the property is animated but the playhead is between keys: move the whole move
              // rather than dropping a keyframe nobody asked for, so the motion keeps its shape
              const delta = v - sampleTrack(track!, localT);
              nextShot.keyframes[prop] = track!.map((k) => ({ ...k, v: k.v + delta }));
              shotTouched = true;
            } else if (nextShot && simple && SHOT_SCOPED.has(prop)) {
              // In the simple timeline a shot IS a camera position: moving the camera sets where the
              // shot ends, and the shot opens on whatever the one before it closed on, so the
              // sequence animates between the framings instead of cutting between them.
              const idx = p.shots.findIndex((x) => x.id === nextShot.id);
              const from = idx > 0 ? closingValue(p, p.shots[idx - 1], prop) : shotBase(p, nextShot, prop);
              nextShot.keyframes[prop] = [
                { t: 0, v: from, ease: "smooth" },
                { t: nextShot.duration, v, ease: "smooth" },
              ];
              shotTouched = true;
            } else if (nextShot && SHOT_SCOPED.has(prop) && (perShot || shot?.pose?.[prop] !== undefined)) {
              nextShot.pose![prop] = v;
              shotTouched = true;
            } else {
              p = withBase(p, prop, v);
            }
          }
          if (shotTouched && nextShot) {
            const id = nextShot.id;
            p = { ...p, shots: p.shots.map((s) => (s.id === id ? nextShot! : s)) };
          }
          set({ project: p });
        },
        toggleKeyframe: (prop) => {
          const p = clone(get().project);
          const { shot, localT } = currentShot(p);
          if (!shot) return;
          const track = shot.keyframes[prop];
          if (hasKeyframeAt(track, localT)) {
            const next = removeKeyframe(track, localT);
            if (next.length === 0) delete shot.keyframes[prop];
            else shot.keyframes[prop] = next;
          } else {
            const v = track && track.length ? sampleTrack(track, localT) : shotBase(p, shot, prop);
            shot.keyframes[prop] = upsertKeyframe(track, localT, v);
          }
          commitProject(p, set);
          pruneSelectedKeys(p);
        },
        clearTrack: (prop, shotId) => {
          const p = clone(get().project);
          const shot = shotId ? p.shots.find((s) => s.id === shotId) : currentShot(p).shot;
          if (!shot) return;
          delete shot.keyframes[prop];
          commitProject(p, set);
          pruneSelectedKeys(p);
        },
        setDevice: (id) => {
          const p = clone(get().project);
          const spec = getDevice(id);
          const wasModel = !!getDevice(p.mockup.device).model;
          p.mockup.device = spec.id;
          if (!spec.finishes.some((f) => f.id === p.mockup.finish)) p.mockup.finish = spec.finishes[0].id;
          // a photoscanned device only reads properly under a real softbox, so the first time one is
          // picked it brings its own rig with it — any other lighting stays if you choose it after
          if (spec.model && !wasModel) {
            p.scene.lighting = "lightbox";
            p.scene.lightRotY = getLighting("lightbox").rotY;
          }
          set({ project: p });
        },
        setScenePreset: (id) => {
          const p = clone(get().project);
          const s = getScene(id);
          p.scene.preset = id;
          p.scene.lighting = s.lighting;
          p.scene.lightRotY = s.lightRotY;
          p.scene.lightRotX = 0;
          p.scene.lightIntensity = s.lightIntensity;
          p.scene.contactShadow = s.contactShadow;
          // a lit scene only shows a flat colour behind it, so take the preset's colour but keep the
          // gradient or image the user picked — they get it back the moment they return to Custom
          if (id !== "custom") p.scene.background = { ...p.scene.background, color: s.background.color };
          set({ project: p });
        },
        addShot: (kind = "media", afterId) => {
          const p = clone(get().project);
          const n = p.shots.filter((s) => (s.kind ?? "media") === kind).length + 1;
          const shot = kind === "text" ? createTextShot(`Text ${n}`) : kind === "logo" ? createLogoShot(`Logo ${n}`) : createShot(`Shot ${n}`, 3);
          const idx = afterId ? p.shots.findIndex((s) => s.id === afterId) : -1;
          if (kind === "media") {
            const previous = p.shots[idx >= 0 ? idx : p.shots.length - 1];
            const source = previous && (previous.kind ?? "media") === "media" ? previous : [...p.shots.slice(0, idx >= 0 ? idx + 1 : undefined)].reverse().find((s) => (s.kind ?? "media") === "media");
            if (source) {
              shot.media = source.media;
              shot.fit = source.fit;
              for (const key of ["device", "finish", "scene", "lighting", "blurMode", "bokeh", "notch"] as const) Object.assign(shot, { [key]: source[key] });
              shot.pose = Object.fromEntries([...SHOT_SCOPED].map((prop) => [prop, closingValue(p, source, prop)]));
            }
          }
          if (idx >= 0) p.shots.splice(idx + 1, 0, shot); else p.shots.push(shot);
          commitProject(p, set);
          // A new card starts fully transparent during its entrance. Preview the settled content
          // so adding text or a logo immediately shows what the user is about to edit.
          const enterDuration = shot.enter?.effect === "none" ? 0 : shot.enter?.duration ?? 0;
          const previewT = kind === "media" ? 0 : Math.min(shot.duration / 2, enterDuration + 1 / p.fps);
          selectAt(p, shot, previewT);
          return shot.id;
        },
        reorderShot: (id, toIndex) => {
          if (!Number.isFinite(toIndex)) return;
          const before = get().project;
          const p = clone(before);
          const idx = p.shots.findIndex((s) => s.id === id);
          const j = Math.max(0, Math.min(p.shots.length - 1, Math.round(toIndex)));
          if (idx < 0 || j === idx) return;
          const [s] = p.shots.splice(idx, 1);
          p.shots.splice(j, 0, s);
          commitProject(p, set);
          preservePlayhead(before, p);
        },
        updateShot: (id, mut) => {
          const p = clone(get().project);
          const s = p.shots.find((x) => x.id === id);
          if (!s) return;
          mut(s);
          p.updatedAt = Date.now();
          set({ project: p });
        },
        splitShot: (id, localT) => {
          if (!Number.isFinite(localT)) return;
          const p = clone(get().project);
          const idx = p.shots.findIndex((x) => x.id === id);
          if (idx < 0) return;
          const a = p.shots[idx];
          const t = Math.round(localT * 100) / 100;
          if (t < 0.2 || t > a.duration - 0.2) return;
          const b = clone(a);
          b.id = uid();
          b.name = `${a.name} b`;
          b.duration = Math.round((a.duration - t) * 100) / 100;
          a.duration = t;
          b.trimStart = (a.trimStart ?? 0) + t * (a.speed ?? 1);
          b.transitionOut = a.transitionOut;
          a.transitionOut = undefined;
          b.enter = undefined;
          a.exit = undefined;
          // the gap sits before the shot being cut, so it stays with the first half rather than
          // opening a second empty stretch in the middle of the split
          delete b.gap;
          for (const prop of Object.keys(a.keyframes) as AnimProp[]) {
            const kfs = a.keyframes[prop];
            if (!kfs || !kfs.length) continue;
            const [ka, kb] = splitTrack(kfs, t);
            a.keyframes[prop] = ka;
            b.keyframes[prop] = kb;
          }
          p.shots.splice(idx + 1, 0, b);
          commitProject(p, set);
          selectAt(p, b);
        },
        reverseShot: (id) => {
          const p = clone(get().project);
          const s = p.shots.find((x) => x.id === id);
          if (!s) return;
          for (const prop of Object.keys(s.keyframes) as AnimProp[]) {
            const kfs = s.keyframes[prop];
            if (kfs && kfs.length) s.keyframes[prop] = reverseTrack(kfs, s.duration);
          }
          commitProject(p, set);
          pruneSelectedKeys(p);
        },
        copyShot: (id) => {
          const s = get().project.shots.find((x) => x.id === id);
          if (s) { shotClipboard = clone(s); keyframesCopiedLast = false; }
        },
        pasteShot: (afterId) => {
          if (!shotClipboard) return;
          const p = clone(get().project);
          const copy = clone(shotClipboard);
          copy.id = uid();
          const idx = afterId ? p.shots.findIndex((s) => s.id === afterId) : -1;
          if (idx >= 0) p.shots.splice(idx + 1, 0, copy); else p.shots.push(copy);
          commitProject(p, set);
          selectAt(p, copy);
        },
        setTransition: (id, tr) => {
          const p = clone(get().project);
          const s = p.shots.find((x) => x.id === id);
          if (!s) return;
          s.transitionOut = tr ?? undefined;
          set({ project: p });
        },
        setAudio: (track) => {
          const p = clone(get().project);
          p.audio = track;
          set({ project: p });
        },
        stampKeyframes: (props) => {
          const p = clone(get().project);
          const { shot, localT } = currentShot(p);
          if (!shot) return;
          for (const prop of props) {
            const track = shot.keyframes[prop];
            const v = track && track.length ? sampleTrack(track, localT) : shotBase(p, shot, prop);
            shot.keyframes[prop] = upsertKeyframe(track, localT, v);
          }
          commitProject(p, set);
        },
        copyKeyframes: (keys) => {
          const p = get().project;
          keyframesCopiedLast = true;
          keyClipboard = [];
          // remember each keyframe's offset from the earliest one, so a paste keeps the shape
          const starts = new Map(p.shots.map((s) => [s.id, shotStart(p, s.id)]));
          const abs = keys.map((k) => (starts.get(k.shotId) ?? 0) + k.t);
          const origin = abs.length ? Math.min(...abs) : 0;
          keys.forEach((key, i) => {
            const s = p.shots.find((x) => x.id === key.shotId);
            const k = s?.keyframes[key.prop]?.find((kk) => Math.abs(kk.t - key.t) < 0.0005);
            if (k) keyClipboard.push({ prop: key.prop, k: { ...k }, offset: Math.round((abs[i] - origin) * 1000) / 1000 });
          });
        },
        moveSelectedKeyframes: (dtIn, proportional = false) => {
          let dt = dtIn;
          const ui = useUI.getState();
          const keys = ui.selectedKeys;
          if (!keys.length || Math.abs(dt) < 1e-6) return;
          const p = clone(get().project);
          const starts = new Map(p.shots.map((s) => [s.id, shotStart(p, s.id)]));
          const abs = keys.map((k) => (starts.get(k.shotId) ?? 0) + k.t);
          const pivot = Math.min(...abs);
          const span = Math.max(...abs) - pivot;
          // a keyframe before the start of the project is drawn off the left edge of its lane and
          // can never be picked up again, so the whole group stops there rather than passing it
          if (!proportional && pivot + dt < 0) dt = -pivot;
          const next: typeof keys = [];
          // group the moves per track so a shifted keyframe never lands on one we have not moved yet
          const byTrack = new Map<string, { shotId: string; prop: AnimProp; times: { from: number; to: number }[] }>();
          keys.forEach((k, i) => {
            const start = starts.get(k.shotId) ?? 0;
            const shot = p.shots.find((s) => s.id === k.shotId);
            if (!shot) return;
            // the scale factor is clamped positive: at dt = -span it would collapse the whole
            // selection onto the pivot, and past that it would mirror and reverse it
            const factor = Math.max(0.02, (span + dt) / span);
            const scaled = proportional && span > 1e-6
              ? pivot + (abs[i] - pivot) * factor
              : abs[i] + dt;
            // a keyframe may sit before a shot starts or after it ends, so a move can carry through a cut
            const to = Math.round(clampKeyTime(scaled - start, shot.duration) * 1000) / 1000;
            const id = `${k.shotId}|${k.prop}`;
            if (!byTrack.has(id)) byTrack.set(id, { shotId: k.shotId, prop: k.prop, times: [] });
            byTrack.get(id)!.times.push({ from: k.t, to });
          });
          for (const { shotId, prop, times } of byTrack.values()) {
            const shot = p.shots.find((s) => s.id === shotId);
            const list = shot?.keyframes[prop];
            if (!shot || !list) continue;
            // Squeezing a selection can round two of its keyframes onto the same frame. Rather than
            // let the later one overwrite the earlier, hold them a frame apart so nothing is lost.
            times.sort((a, b) => a.to - b.to || a.from - b.from);
            const STEP = 0.001;
            for (let i = 1; i < times.length; i++) {
              if (times[i].to - times[i - 1].to < STEP - 1e-9) times[i].to = Math.round((times[i - 1].to + STEP) * 1000) / 1000;
            }
            // and if that pushed the tail past the end, walk the whole run back down from the last one
            const last = times[times.length - 1];
            const ceil = clampKeyTime(Number.POSITIVE_INFINITY, shot.duration);
            if (last && last.to > ceil) {
              for (let i = times.length - 1; i >= 0; i--) {
                const cap = i === times.length - 1 ? ceil : Math.round((times[i + 1].to - STEP) * 1000) / 1000;
                if (times[i].to > cap) times[i].to = cap;
              }
            }
            const moved = times.map((x) => x.from);
            const rest = list.filter((k) => !moved.some((t) => Math.abs(k.t - t) < 0.0005));
            // A keyframe dropped on top of one that is not moving keeps its own place rather than
            // taking the other one's: the two are held a frame apart, the same way two moving
            // keyframes are, so no drag can ever silently delete a keyframe.
            const occupied = rest.map((k) => k.t).sort((a, b) => a - b);
            let cursor = -Infinity;
            for (const entry of times) {
              let to = Math.max(entry.to, cursor + STEP);
              for (let guard = 0; guard < 200; guard++) {
                const hit = occupied.find((o) => Math.abs(o - to) < STEP - 1e-9);
                if (hit === undefined) break;
                to = hit + STEP;
              }
              entry.to = Math.round(to * 1000) / 1000;
              cursor = entry.to;
            }
            const out = [...rest];
            for (const { from, to } of times) {
              const src = list.find((k) => Math.abs(k.t - from) < 0.0005);
              if (!src) continue;
              out.push({ ...src, t: to });
              next.push({ shotId, prop, t: to });
            }
            out.sort((a, b) => a.t - b.t);
            shot.keyframes[prop] = out;
          }
          set({ project: p });
          ui.setSelectedKeys(next);
        },
        applyPoseToAllShots: (props) => {
          const p = clone(get().project);
          const { shot, localT } = currentShot(p);
          if (!shot) return;
          for (const s of p.shots) {
            if (s.id === shot.id) continue;
            s.pose = { ...s.pose };
            for (const prop of props) {
              const track = shot.keyframes[prop];
              s.pose[prop] = track?.length ? sampleTrack(track, localT) : shotBase(p, shot, prop);
              // a shot that animates the property would ignore the pose, so the track goes too
              delete s.keyframes[prop];
            }
          }
          commitProject(p, set);
          pruneSelectedKeys(p);
        },
        clearPose: (shotId, props) => {
          const p = clone(get().project);
          const shot = p.shots.find((s) => s.id === shotId);
          if (!shot?.pose) return;
          for (const prop of props) delete shot.pose[prop];
          if (!Object.keys(shot.pose).length) delete shot.pose;
          set({ project: p });
        },
        setShotGap: (id, gap) => {
          if (!Number.isFinite(gap)) return;
          const p = clone(get().project);
          const shot = p.shots.find((s) => s.id === id);
          if (!shot) return;
          const next = Math.max(0, Math.round(gap * 100) / 100);
          if (next === (shot.gap ?? 0)) return;
          if (next === 0) delete shot.gap; else shot.gap = next;
          set({ project: p });
        },
        closeGap: (id) => {
          const p = clone(get().project);
          const shot = p.shots.find((s) => s.id === id);
          if (!shot?.gap) return;
          delete shot.gap;
          set({ project: p });
        },
        deleteSelectedKeyframes: () => {
          const ui = useUI.getState();
          const keys = ui.selectedKeys;
          if (!keys.length) return;
          const p = clone(get().project);
          let removed = 0;
          for (const key of keys) {
            const shot = p.shots.find((x) => x.id === key.shotId);
            if (!shot) continue;
            const before = shot.keyframes[key.prop] ?? [];
            const list = before.filter((k) => Math.abs(k.t - key.t) > 0.0005);
            if (list.length === before.length) continue;
            removed++;
            if (list.length) shot.keyframes[key.prop] = list; else delete shot.keyframes[key.prop];
          }
          // a stale selection matches nothing; committing anyway would push an empty undo step
          if (!removed) { ui.setSelectedKeys([]); return; }
          set({ project: p });
          ui.setSelectedKeys([]);
        },
        pasteKeyframes: () => {
          if (!keyClipboard.length) return;
          const p = clone(get().project);
          const { shot, localT } = currentShot(p);
          if (!shot) return;
          for (const { prop, k, offset } of keyClipboard) {
            const t = Math.round((localT + (offset ?? 0)) * 1000) / 1000;
            const list = upsertKeyframe(shot.keyframes[prop], t, k.v, k.ease);
            // carry the custom curve across too, not just the named ease
            const placed = list.find((x) => Math.abs(x.t - t) < 0.0005);
            if (placed) {
              placed.ease = k.ease;
              if (k.cp) placed.cp = [...k.cp] as typeof k.cp; else delete placed.cp;
              // the arrival curve belongs to the keyframe just as much as the one it leaves on
              setInHandle(placed, inHandleOf(k) ?? null);
            }
            shot.keyframes[prop] = list;
          }
          commitProject(p, set);
        },
        removeShot: (id) => {
          const before = get().project;
          const p = clone(before);
          if (p.shots.length <= 1) return;
          const index = p.shots.findIndex((s) => s.id === id);
          if (index < 0) return;
          p.shots = p.shots.filter((s) => s.id !== id);
          commitProject(p, set);
          const ui = useUI.getState();
          if (ui.activeShotId === id || locate(before, ui.time).shot?.id === id) selectAt(p, p.shots[Math.min(index, p.shots.length - 1)]);
          else preservePlayhead(before, p);
          // the project just got shorter; a playhead left past the end sits on a fully faded frame
          const total = totalDuration(p);
          if (useUI.getState().time > total) ui.setTime(total);
          pruneSelectedKeys(p);
          ui.setSelectedShots(useUI.getState().selectedShots.filter((shotId) => shotId !== id));
        },
        duplicateShot: (id) => {
          const p = clone(get().project);
          const idx = p.shots.findIndex((s) => s.id === id);
          if (idx < 0) return;
          const copy = clone(p.shots[idx]);
          copy.id = createShot("x").id;
          copy.name = `${p.shots[idx].name} copy`;
          p.shots.splice(idx + 1, 0, copy);
          commitProject(p, set);
          selectAt(p, copy);
        },
        moveShot: (id, dir) => {
          const idx = get().project.shots.findIndex((s) => s.id === id);
          const j = idx + dir;
          if (idx < 0 || j < 0 || j >= get().project.shots.length) return;
          get().reorderShot(id, j);
        },
      }),
      {
        partialize: (s) => ({ project: s.project }),
        limit: 200,
        equality: (a, b) => a.project === b.project,
        // Typing in a text field and dragging the OS colour picker both write continuously without
        // an interaction wrapper. Without coalescing, each event is its own undo step and 200 of
        // them evict everything older, so a burst of keystrokes wipes the real history behind it.
        // A leading-edge throttle keeps the state from just before the burst and drops the rest.
        handleSet: (save) => {
          let last = 0;
          return (pastState, replace, currentState, deltaState) => {
            const now = Date.now();
            if (now - last < 350) return;
            last = now;
            (save as (...a: unknown[]) => void)(pastState, replace, currentState, deltaState);
          };
        },
      },
    ),
  ),
);

/**
 * Suspends history for the duration of a drag and records ONE undo step for it, only if something
 * actually changed. Reference-counted, because overlapping interactions (a wheel-zoom timer running
 * while a pointer drag starts) used to resume history mid-drag and flood the undo stack.
 */
let interactionDepth = 0;
let interactionSnapshot: Project | null = null;

export const beginInteraction = () => {
  if (interactionDepth++ > 0) return;
  interactionSnapshot = useEditor.getState().project;
  useEditor.temporal.getState().pause();
};

export const endInteraction = () => {
  if (interactionDepth === 0) return;
  if (--interactionDepth > 0) return;
  const t = useEditor.temporal.getState();
  t.resume();
  const before = interactionSnapshot;
  interactionSnapshot = null;
  // a click that changed nothing must not push a step, and must not wipe redo
  if (!before || before === useEditor.getState().project) return;
  const past = [...t.pastStates, { project: before }];
  useEditor.temporal.setState({ pastStates: past.slice(-200), futureStates: [] });
};

/** Drags can end outside the window; without this the history would stay paused forever. */
if (typeof window !== "undefined") {
  const release = () => { while (interactionDepth > 0) endInteraction(); };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
}
function restoreHistory(direction: "undo" | "redo") {
  const before = useEditor.getState().project;
  useEditor.temporal.getState()[direction]();
  const p = useEditor.getState().project;
  if (p === before) return;
  preservePlayhead(before, p);
  const ui = useUI.getState();
  const time = Math.max(0, Math.min(totalDuration(p), ui.time));
  useUI.setState({
    time, playing: false,
    activeShotId: p.shots.some((s) => s.id === ui.activeShotId) ? ui.activeShotId : locate(p, time).shot?.id ?? null,
    selectedShots: ui.selectedShots.filter((id) => p.shots.some((s) => s.id === id)),
  });
  pruneSelectedKeys(p);
}
export const undo = () => restoreHistory("undo");
export const redo = () => restoreHistory("redo");
export const pauseHistory = () => useEditor.temporal.getState().pause();
export const resumeHistory = () => useEditor.temporal.getState().resume();
