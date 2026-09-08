import type { Project, TextOverlay } from "./types";

/** Independent tracks end at their own boundary, even while the last device frame is held. */
export function textOverlayAt(track: TextOverlay, time: number): boolean {
  return track.enabled && !!track.text.text.trim() && time >= track.start && time < track.start + track.duration;
}
export function textOverlaysInRange(p: Project, start: number, end = start) {
  return (p.textOverlays ?? []).filter((t) => t.enabled && !!t.text.text.trim() && (end === start ? textOverlayAt(t, start) : t.start < end && t.start + t.duration > start));
}
/** Head trimming keeps animation phase; moving the complete bar keeps all of its timing. */
export function trimTextOverlay(track: TextOverlay, original: TextOverlay, edge: "start" | "end", time: number) {
  if (edge === "start") {
    const start = Math.max(0, Math.min(original.start + original.duration - .1, time));
    const timing = original.timing ?? { offset: 0, duration: original.duration };
    track.start = start; track.duration = original.start + original.duration - start;
    const offset = timing.offset + start - original.start;
    track.timing = { duration: timing.duration - Math.min(0, offset), offset: Math.max(0, offset) };
  } else {
    track.duration = Math.max(.1, Math.min(180, time) - original.start);
    if (original.timing) track.timing = { offset: original.timing.offset, duration: original.timing.offset + track.duration };
  }
  clampTextAnimation(track);
}

/** Match portable normalization immediately after shortening an animation interval. */
export function clampTextAnimation(track: TextOverlay) {
  const duration = track.timing?.duration ?? track.duration;
  for (const edge of ["enter", "exit"] as const) if (track[edge]) track[edge].duration = Math.max(0, Math.min(duration, track[edge].duration));
}
