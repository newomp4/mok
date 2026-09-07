import { createShot, shotKind } from "./defaults";
import type { MediaRef, Project, Shot } from "./types";

export type PasteMode = "ask" | "replace" | "add";
export function canReplacePastedMedia(shot: Shot | undefined, refs?: Pick<MediaRef, "kind">[]): boolean {
  if (!shot) return false;
  if (shotKind(shot) === "media") return true;
  return shotKind(shot) === "logo" && (!refs || refs.filter((r) => r.kind !== "audio").every((r) => r.kind === "image"));
}

/** One atomic project mutation; replacing keeps clip identity, timing, fit, keys and overrides. */
export function applyPastedMedia(p: Project, refs: MediaRef[], mode: Exclude<PasteMode, "ask">, targetId: string | null): string | null {
  const target = p.shots.find((s) => s.id === targetId);
  const audio = refs.find((r) => r.kind === "audio");
  if (audio) p.audio = { media: audio, start: 0, trimStart: 0, volume: 1, fadeIn: 0, fadeOut: 0 };
  const media = refs.filter((r) => r.kind !== "audio");
  if (!media.length) return null;
  let after = target ? p.shots.indexOf(target) : p.shots.length - 1;
  let first: string | null = null;
  for (const [index, ref] of media.entries()) {
    if (index === 0 && mode === "replace" && canReplacePastedMedia(target, [ref])) {
      if (target && shotKind(target) === "logo" && target.logo) target.logo.media = ref;
      else if (target) target.media = ref;
      first = target?.id ?? null;
      continue;
    }
    const shot = createShot(`Shot ${p.shots.filter((s) => shotKind(s) === "media").length + 1}`, ref.kind === "video" ? Math.max(0.1, Math.min(30, ref.duration ?? 3)) : 3);
    shot.media = ref;
    if (target && shotKind(target) === "media") {
      shot.fit = target.fit;
      for (const key of ["device", "orientation", "finish", "scene", "lighting", "blurMode", "bokeh", "notch", "screenPadding", "effects", "pose"] as const) {
        if (target[key] !== undefined) Object.assign(shot, { [key]: structuredClone(target[key]) });
      }
    }
    p.shots.splice(++after, 0, shot);
    first ??= shot.id;
  }
  return first;
}
