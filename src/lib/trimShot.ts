import type { Shot } from "./types";

/** Apply a head trim from a gesture's original snapshot, so repeated pointer moves never compound. */
export function trimShotHead(shot: Shot, original: Shot, dt: number) {
  shot.duration = Math.round((original.duration - dt) * 100) / 100;
  shot.trimStart = Math.max(0, Math.round(((original.trimStart ?? 0) + dt * (original.speed ?? 1)) * 100) / 100);
  for (const [prop, list] of Object.entries(original.keyframes)) {
    if (list?.length) Object.assign(shot.keyframes, { [prop]: list.map((key) => ({ ...key, t: Math.round((key.t - dt) * 1000) / 1000 })) });
  }
  if (original.audio) {
    const envelope = original.audio.envelope ?? { offset: 0, duration: original.duration };
    shot.audio = { ...original.audio, envelope: { ...envelope, offset: Math.max(0, envelope.offset + dt) } };
  }
  if (original.caption) {
    const timing = original.caption.timing ?? { offset: 0, duration: original.duration };
    shot.caption = { ...original.caption, timing: { ...timing, offset: Math.max(0, timing.offset + dt) } };
  }
}
