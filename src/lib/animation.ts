import type { AnimProp, EaseId, Keyframe, Project, Shot } from "./types";

export const EASES: { id: EaseId; label: string }[] = [
  { id: "smooth", label: "Smooth" },
  { id: "linear", label: "Linear" },
  { id: "easeIn", label: "Ease in" },
  { id: "easeOut", label: "Ease out" },
  { id: "easeInOut", label: "Ease in-out" },
  { id: "expoOut", label: "Expo out" },
  { id: "expoInOut", label: "Expo in-out" },
  { id: "backOut", label: "Back out" },
  { id: "hold", label: "Hold" },
];

export function ease(id: EaseId, t: number): number {
  t = Math.min(1, Math.max(0, t));
  switch (id) {
    case "linear": return t;
    case "easeIn": return t * t * t;
    case "easeOut": return 1 - Math.pow(1 - t, 3);
    case "easeInOut": return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "expoOut": return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case "expoInOut":
      if (t === 0 || t === 1) return t;
      return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
    case "backOut": {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case "hold": return t >= 1 ? 1 : 0;
    case "smooth":
    default: return t * t * (3 - 2 * t);
  }
}

export function sampleTrack(kfs: Keyframe[], t: number): number {
  if (kfs.length === 0) return 0;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t <= t) i++;
  const a = kfs[i], b = kfs[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const u = ease(a.ease, (t - a.t) / span);
  return a.v + (b.v - a.v) * u;
}

export function getBase(p: Project, prop: AnimProp): number {
  const [g, k] = prop.split(".") as [keyof Project, string];
  return (p[g] as unknown as Record<string, number>)[k];
}

export function setBase(p: Project, prop: AnimProp, v: number) {
  const [g, k] = prop.split(".") as [keyof Project, string];
  (p[g] as unknown as Record<string, number>)[k] = v;
}

export type AnimValues = Record<AnimProp, number>;

export function evaluate(p: Project, shot: Shot | null, localT: number): AnimValues {
  const out = {} as AnimValues;
  const props = Object.keys(ANIM_DEFAULT_KEYS) as AnimProp[];
  for (const prop of props) {
    const kfs = shot?.keyframes[prop];
    out[prop] = kfs && kfs.length ? sampleTrack(kfs, localT) : getBase(p, prop);
  }
  return out;
}

export const ANIM_DEFAULT_KEYS: Record<AnimProp, true> = {
  "camera.x": true, "camera.y": true, "camera.z": true, "camera.fov": true, "camera.zoom": true,
  "camera.panX": true, "camera.panY": true, "mockup.rotX": true, "mockup.rotY": true, "mockup.rotZ": true,
  "scene.lightRotX": true, "scene.lightRotY": true, "scene.lightIntensity": true,
  "blur.strength": true, "blur.focusSize": true, "blur.falloff": true, "blur.focusX": true, "blur.focusY": true,
  "screen.brightness": true,
};

export function totalDuration(p: Project): number {
  return p.shots.reduce((a, s) => a + s.duration, 0);
}

export interface Location {
  shot: Shot | null;
  index: number;
  localT: number;
  start: number;
}

export function locate(p: Project, t: number): Location {
  let start = 0;
  for (let i = 0; i < p.shots.length; i++) {
    const s = p.shots[i];
    if (t < start + s.duration || i === p.shots.length - 1) {
      return { shot: s, index: i, localT: Math.min(Math.max(0, t - start), s.duration), start };
    }
    start += s.duration;
  }
  return { shot: null, index: -1, localT: 0, start: 0 };
}

export function shotStart(p: Project, shotId: string): number {
  let start = 0;
  for (const s of p.shots) {
    if (s.id === shotId) return start;
    start += s.duration;
  }
  return 0;
}

/** Insert or replace a keyframe at time t (snapped to 1/1000s). */
export function upsertKeyframe(kfs: Keyframe[] | undefined, t: number, v: number, easeId: EaseId = "smooth"): Keyframe[] {
  const list = kfs ? [...kfs] : [];
  const tt = Math.round(t * 1000) / 1000;
  const idx = list.findIndex((k) => Math.abs(k.t - tt) < 0.0005);
  if (idx >= 0) list[idx] = { ...list[idx], v };
  else list.push({ t: tt, v, ease: easeId });
  list.sort((a, b) => a.t - b.t);
  return list;
}

export function removeKeyframe(kfs: Keyframe[] | undefined, t: number): Keyframe[] {
  if (!kfs) return [];
  return kfs.filter((k) => Math.abs(k.t - t) >= 0.0005);
}

export function hasKeyframeAt(kfs: Keyframe[] | undefined, t: number): boolean {
  return !!kfs && kfs.some((k) => Math.abs(k.t - t) < 0.0005);
}

/** Full-frame fade alpha + colour at time t: project fade in/out plus dip-to-colour transitions between shots. */
export function fadeAt(p: Project, t: number): { alpha: number; color: string } {
  let alpha = 0;
  let color = p.fade?.color ?? "#000000";
  const total = totalDuration(p);
  const fi = p.fade?.in ?? 0, fo = p.fade?.out ?? 0;
  if (fi > 0 && t < fi) alpha = Math.max(alpha, 1 - t / fi);
  if (fo > 0 && t > total - fo) alpha = Math.max(alpha, (t - (total - fo)) / fo);
  let start = 0;
  for (let i = 0; i < p.shots.length - 1; i++) {
    const s = p.shots[i];
    const end = start + s.duration;
    const tr = s.transitionOut;
    if (tr && tr.type === "fade" && tr.duration > 0) {
      const h = tr.duration / 2;
      if (t >= end - h && t <= end + h) {
        const a = 1 - Math.abs(t - end) / h;
        if (a > alpha) { alpha = a; color = tr.color; }
      }
    }
    start = end;
  }
  return { alpha: Math.min(1, Math.max(0, alpha)), color };
}

/** Mirror a track in time so the motion plays backwards. */
export function reverseTrack(kfs: Keyframe[], duration: number): Keyframe[] {
  return kfs.map((k) => ({ ...k, t: Math.round((duration - k.t) * 1000) / 1000 })).sort((a, b) => a.t - b.t);
}

/** Split a track at time t: everything before stays (ending on the sampled value), the rest restarts at 0. */
export function splitTrack(kfs: Keyframe[], t: number): [Keyframe[], Keyframe[]] {
  const v = sampleTrack(kfs, t);
  const a = kfs.filter((k) => k.t < t - 0.0005);
  a.push({ t: Math.round(t * 1000) / 1000, v, ease: "smooth" });
  const b: Keyframe[] = [{ t: 0, v, ease: kfs.find((k) => k.t <= t)?.ease ?? "smooth" }];
  for (const k of kfs) if (k.t > t + 0.0005) b.push({ ...k, t: Math.round((k.t - t) * 1000) / 1000 });
  return [a, b];
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
