"use client";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { temporal } from "zundo";
import type { AnimProp, Project, Shot } from "@/lib/types";
import { createProject, createShot } from "@/lib/defaults";
import { getBase, hasKeyframeAt, locate, removeKeyframe, sampleTrack, upsertKeyframe } from "@/lib/animation";
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
  addShot: () => void;
  removeShot: (id: string) => void;
  duplicateShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
}

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
        replaceProject: (project) => set({ project }),
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
          let nextShot: Shot | null = shot ? { ...shot, keyframes: { ...shot.keyframes } } : null;
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
        addShot: () => {
          const p = clone(get().project);
          const shot = createShot(`Shot ${p.shots.length + 1}`, 3);
          const last = p.shots[p.shots.length - 1];
          if (last?.media) shot.media = last.media;
          p.shots.push(shot);
          set({ project: p });
          useUI.getState().setActiveShot(shot.id);
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
