"use client";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { temporal } from "zundo";
import type { AnimProp, AudioTrack, Keyframe, Project, Shot, ShotKind, Transition } from "@/lib/types";
import { createLogoShot, createProject, createShot, createTextShot, normalizeProject } from "@/lib/defaults";
import { getBase, hasKeyframeAt, locate, removeKeyframe, reverseTrack, sampleTrack, splitTrack, upsertKeyframe, shotStart } from "@/lib/animation";
import { uid } from "@/lib/ids";
import { useUI } from "./ui";
import { getDevice } from "@/lib/devices";
import { getScene } from "@/lib/presets";

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
}

let shotClipboard: Shot | null = null;
let keyClipboard: { prop: AnimProp; k: Keyframe }[] = [];
export const hasShotClipboard = () => shotClipboard !== null;
export const hasKeyClipboard = () => keyClipboard.length > 0;

function clone<T>(v: T): T {
  return structuredClone(v);
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
        replaceProject: (project) => set({ project: normalizeProject(project) }),
        update: (mut) => {
          const p = clone(get().project);
          mut(p);
          p.updatedAt = Date.now();
          set({ project: p });
        },
        setValue: (prop, v) => get().setValues({ [prop]: v }),
        setValues: (values) => {
          // structural sharing: only the touched groups / shot are copied, so timeline rows and
          // unrelated inspector rows keep their references during drags
          const ui = useUI.getState();
          const prev = get().project;
          const { shot, localT } = currentShot(prev);
          let p: Project = { ...prev, updatedAt: Date.now() };
          const nextShot: Shot | null = shot ? { ...shot, keyframes: { ...shot.keyframes } } : null;
          let shotTouched = false;
          for (const [prop, v] of Object.entries(values) as [AnimProp, number][]) {
            if (v === undefined || Number.isNaN(v)) continue;
            const track = nextShot?.keyframes[prop];
            if (nextShot && (ui.recording || (track && track.length > 0))) {
              nextShot.keyframes[prop] = upsertKeyframe(track, localT, v);
              shotTouched = true;
              if (!track || track.length === 0) p = withBase(p, prop, v);
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
            const v = track && track.length ? sampleTrack(track, localT) : getBase(p, prop);
            shot.keyframes[prop] = upsertKeyframe(track, localT, v);
          }
          set({ project: p });
        },
        clearTrack: (prop, shotId) => {
          const p = clone(get().project);
          const shot = shotId ? p.shots.find((s) => s.id === shotId) : currentShot(p).shot;
          if (!shot) return;
          delete shot.keyframes[prop];
          set({ project: p });
        },
        setDevice: (id) => {
          const p = clone(get().project);
          const spec = getDevice(id);
          p.mockup.device = spec.id;
          if (!spec.finishes.some((f) => f.id === p.mockup.finish)) p.mockup.finish = spec.finishes[0].id;
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
          if (id !== "custom") p.scene.background = { ...s.background };
          set({ project: p });
        },
        addShot: (kind = "media", afterId) => {
          const p = clone(get().project);
          const n = p.shots.filter((s) => (s.kind ?? "media") === kind).length + 1;
          const shot = kind === "text" ? createTextShot(`Text ${n}`) : kind === "logo" ? createLogoShot(`Logo ${n}`) : createShot(`Shot ${n}`, 3);
          if (kind === "media") {
            const last = [...p.shots].reverse().find((s) => s.media && (s.kind ?? "media") === "media");
            if (last?.media) shot.media = last.media;
          }
          const idx = afterId ? p.shots.findIndex((s) => s.id === afterId) : -1;
          if (idx >= 0) p.shots.splice(idx + 1, 0, shot); else p.shots.push(shot);
          set({ project: p });
          const ui = useUI.getState();
          ui.setActiveShot(shot.id);
          ui.setTime(shotStart(p, shot.id) + 0.0001);
          return shot.id;
        },
        reorderShot: (id, toIndex) => {
          const p = clone(get().project);
          const idx = p.shots.findIndex((s) => s.id === id);
          const j = Math.max(0, Math.min(p.shots.length - 1, toIndex));
          if (idx < 0 || j === idx) return;
          const [s] = p.shots.splice(idx, 1);
          p.shots.splice(j, 0, s);
          set({ project: p });
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
          for (const prop of Object.keys(a.keyframes) as AnimProp[]) {
            const kfs = a.keyframes[prop];
            if (!kfs || !kfs.length) continue;
            const [ka, kb] = splitTrack(kfs, t);
            a.keyframes[prop] = ka;
            b.keyframes[prop] = kb;
          }
          p.shots.splice(idx + 1, 0, b);
          set({ project: p });
        },
        reverseShot: (id) => {
          const p = clone(get().project);
          const s = p.shots.find((x) => x.id === id);
          if (!s) return;
          for (const prop of Object.keys(s.keyframes) as AnimProp[]) {
            const kfs = s.keyframes[prop];
            if (kfs && kfs.length) s.keyframes[prop] = reverseTrack(kfs, s.duration);
          }
          set({ project: p });
        },
        copyShot: (id) => {
          const s = get().project.shots.find((x) => x.id === id);
          if (s) shotClipboard = clone(s);
        },
        pasteShot: (afterId) => {
          if (!shotClipboard) return;
          const p = clone(get().project);
          const copy = clone(shotClipboard);
          copy.id = uid();
          const idx = afterId ? p.shots.findIndex((s) => s.id === afterId) : -1;
          if (idx >= 0) p.shots.splice(idx + 1, 0, copy); else p.shots.push(copy);
          set({ project: p });
          useUI.getState().setActiveShot(copy.id);
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
            const v = track && track.length ? sampleTrack(track, localT) : getBase(p, prop);
            shot.keyframes[prop] = upsertKeyframe(track, localT, v);
          }
          set({ project: p });
        },
        copyKeyframes: (keys) => {
          const p = get().project;
          keyClipboard = [];
          for (const key of keys) {
            const s = p.shots.find((x) => x.id === key.shotId);
            const k = s?.keyframes[key.prop]?.find((kk) => Math.abs(kk.t - key.t) < 0.0005);
            if (k) keyClipboard.push({ prop: key.prop, k: { ...k } });
          }
        },
        pasteKeyframes: () => {
          if (!keyClipboard.length) return;
          const p = clone(get().project);
          const { shot, localT } = currentShot(p);
          if (!shot) return;
          for (const { prop, k } of keyClipboard) shot.keyframes[prop] = upsertKeyframe(shot.keyframes[prop], localT, k.v, k.ease);
          set({ project: p });
        },
        removeShot: (id) => {
          const p = clone(get().project);
          if (p.shots.length <= 1) return;
          p.shots = p.shots.filter((s) => s.id !== id);
          set({ project: p });
          const ui = useUI.getState();
          if (ui.activeShotId === id) ui.setActiveShot(p.shots[0].id);
        },
        duplicateShot: (id) => {
          const p = clone(get().project);
          const idx = p.shots.findIndex((s) => s.id === id);
          if (idx < 0) return;
          const copy = clone(p.shots[idx]);
          copy.id = createShot("x").id;
          copy.name = `${p.shots[idx].name} copy`;
          p.shots.splice(idx + 1, 0, copy);
          set({ project: p });
        },
        moveShot: (id, dir) => {
          const p = clone(get().project);
          const idx = p.shots.findIndex((s) => s.id === id);
          const j = idx + dir;
          if (idx < 0 || j < 0 || j >= p.shots.length) return;
          const [s] = p.shots.splice(idx, 1);
          p.shots.splice(j, 0, s);
          set({ project: p });
        },
      }),
      {
        partialize: (s) => ({ project: s.project }),
        limit: 200,
        equality: (a, b) => a.project === b.project,
      },
    ),
  ),
);

/** Record the pre-interaction state once, then suspend history until endInteraction(). */
export const beginInteraction = () => {
  const s = useEditor.getState();
  useEditor.setState({ project: { ...s.project } });
  useEditor.temporal.getState().pause();
};
export const endInteraction = () => useEditor.temporal.getState().resume();
export const undo = () => useEditor.temporal.getState().undo();
export const redo = () => useEditor.temporal.getState().redo();
export const pauseHistory = () => useEditor.temporal.getState().pause();
export const resumeHistory = () => useEditor.temporal.getState().resume();
