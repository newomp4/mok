import { locate } from "./animation";
import type { AudioTrack, MediaRef, Project, Shot } from "./types";

export function audioLength(track: AudioTrack): number {
  const duration = track.media.duration ?? 0;
  return Number.isFinite(duration) && Number.isFinite(track.trimStart) ? Math.max(0, duration - Math.max(0, track.trimStart)) : 0;
}

export function fadeGain(time: number, duration: number, fadeIn = 0, fadeOut = 0): number {
  if (!Number.isFinite(time) || time < 0 || time >= duration || duration <= 0) return 0;
  let incoming = Math.max(0, Math.min(fadeIn, duration)), outgoing = Math.max(0, Math.min(fadeOut, duration));
  if (incoming + outgoing > duration) { const scale = duration / (incoming + outgoing); incoming *= scale; outgoing *= scale; }
  return Math.min(1, incoming > 0 ? time / incoming : 1, outgoing > 0 ? (duration - time) / outgoing : 1);
}

export function audioGainAt(track: AudioTrack, time: number, total: number): number {
  return Math.max(0, Math.min(1, track.volume)) * fadeGain(time - track.start, Math.min(audioLength(track), Math.max(0, total - track.start)), track.fadeIn, track.fadeOut);
}

/** Splitting a clip preserves its original fade envelope instead of retriggering it at the cut. */
export function sourceAudioGainAt(shot: Shot, localTime: number, availableDuration = Infinity): number {
  if (!shot.audio?.enabled || localTime < 0 || localTime >= shot.duration) return 0;
  const envelope = shot.audio.envelope ?? { offset: 0, duration: shot.duration };
  return Math.max(0, Math.min(1, shot.audio.volume)) * fadeGain(envelope.offset + localTime, Math.min(envelope.duration, envelope.offset + availableDuration), shot.audio.fadeIn, shot.audio.fadeOut);
}

export function sourceAudioAt(project: Project, time: number, total: number) {
  const location = locate(project, time), shot = location.shot;
  if (time < 0 || time >= total || location.inGap || !shot || (shot.kind ?? "media") !== "media" || shot.media?.kind !== "video" || location.localT >= shot.duration) return null;
  const gain = sourceAudioGainAt(shot, location.localT, Math.max(0, total - (time - location.localT)));
  return gain > 0 ? { shot, media: shot.media, gain, localTime: location.localT } : null;
}

/** Shared headroom keeps two full-volume lanes from clipping without changing their relative mix. */
export function audioHeadroom(project: Project, time: number, total: number): number {
  const music = project.audio ? audioGainAt(project.audio, time, total) : 0;
  return 1 / Math.max(1, music + (sourceAudioAt(project, time, total)?.gain ?? 0));
}

export interface AudioSegment {
  media: MediaRef;
  start: number;
  end: number;
  sourceStart: number;
  rate: number;
  shot?: Shot;
  shotStart?: number;
  track?: AudioTrack;
}

/** Actual audible intervals, excluding visual holds in gaps and after the last clip. */
export function audioSegments(project: Project, total: number): AudioSegment[] {
  const segments: AudioSegment[] = [];
  if (project.audio && project.audio.volume > 0) {
    const track = project.audio, start = Math.max(0, track.start), end = Math.min(total, track.start + audioLength(track));
    if (end > start) segments.push({ media: track.media, start, end, sourceStart: track.trimStart + start - track.start, rate: 1, track });
  }
  let cursor = 0;
  for (const shot of project.shots) {
    const start = cursor + Math.max(0, shot.gap ?? 0); cursor = start + shot.duration;
    if (start >= total) break;
    if ((shot.kind ?? "media") !== "media" || shot.media?.kind !== "video" || !shot.audio?.enabled || shot.audio.volume <= 0) continue;
    const duration = shot.media.duration ?? 0, rate = shot.speed ?? 1, end = Math.min(cursor, total);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(rate) || rate <= 0) continue;
    let at = start;
    while (at < end - 1e-10) {
      if (segments.length >= 100_000) throw new Error("This audio clip loops too frequently to export. Use a longer source clip.");
      let sourceStart = ((shot.trimStart ?? 0) + (at - start) * rate) % duration;
      if (duration - sourceStart < 1e-8) sourceStart = 0;
      const next = Math.min(end, at + (duration - sourceStart) / rate);
      if (next <= at) break;
      segments.push({ media: shot.media, start: at, end: next, sourceStart, rate, shot, shotStart: start }); at = next;
    }
  }
  return segments;
}

/** Presence checks run in the picker too; they must not expand thousands of short source loops. */
export function hasAudio(project: Project, total: number): boolean {
  if (project.audio && project.audio.volume > 0 && Math.min(total, project.audio.start + audioLength(project.audio)) > Math.max(0, project.audio.start)) return true;
  let cursor = 0;
  for (const shot of project.shots) {
    const start = cursor + Math.max(0, shot.gap ?? 0); cursor = start + shot.duration;
    if (start >= total) break;
    const duration = shot.media?.duration ?? 0, rate = shot.speed ?? 1;
    if ((shot.kind ?? "media") === "media" && shot.media?.kind === "video" && shot.audio?.enabled && shot.audio.volume > 0 && Number.isFinite(duration) && duration > 0 && Number.isFinite(rate) && rate > 0 && Math.min(cursor, total) > start) return true;
  }
  return false;
}
export function segmentGain(segment: AudioSegment, time: number, total: number): number {
  return segment.shot ? sourceAudioGainAt(segment.shot, time - segment.shotStart!, Math.max(0, total - segment.shotStart!)) : audioGainAt(segment.track!, time, total);
}

export interface PCMBuffer { sampleRate: number; length: number; numberOfChannels: number; getChannelData(channel: number): Float32Array }

/** A decoded chunk is mixed directly into the bounded final stereo buffer; speed changes pitch. */
export function mixAudioChunk(output: PCMBuffer, chunk: PCMBuffer, timestamp: number, segment: AudioSegment, total: number) {
  const sourceEnd = timestamp + chunk.length / chunk.sampleRate;
  const first = Math.max(0, Math.ceil((segment.start + (timestamp - segment.sourceStart) / segment.rate) * output.sampleRate - 1e-7), Math.ceil(segment.start * output.sampleRate - 1e-7));
  const last = Math.min(output.length, Math.ceil(segment.end * output.sampleRate - 1e-7), Math.ceil((segment.start + (sourceEnd - segment.sourceStart) / segment.rate) * output.sampleRate - 1e-7));
  if (last <= first) return;
  const channels = Array.from({ length: chunk.numberOfChannels }, (_, i) => chunk.getChannelData(i));
  if (!channels.length) return;
  for (let channel = 0; channel < Math.min(2, output.numberOfChannels); channel++) {
    const target = output.getChannelData(channel), source = channels[Math.min(channel, channels.length - 1)];
    // Browser-style speaker downmix keeps center dialogue and surrounds; LFE is omitted.
    const extra: [Float32Array, number][] = [];
    if (channels.length === 4) extra.push([channels[channel + 2], .5]);
    else if (channels.length >= 3) {
      extra.push([channels[2], Math.SQRT1_2]);
      if (channels.length === 5) extra.push([channels[channel + 3], Math.SQRT1_2]);
      if (channels.length >= 6) extra.push([channels[channel + 4], Math.SQRT1_2]);
      if (channels.length >= 8) extra.push([channels[channel + 6], .5]);
    }
    for (let index = first; index < last; index++) {
      const time = index / output.sampleRate;
      const at = Math.max(0, (segment.sourceStart + (time - segment.start) * segment.rate - timestamp) * chunk.sampleRate);
      const low = Math.min(source.length - 1, Math.floor(at)), high = Math.min(source.length - 1, low + 1), fraction = at - Math.floor(at);
      let value = source[low] * (1 - fraction) + source[high] * fraction;
      for (const [surround, weight] of extra) value += weight * (surround[low] * (1 - fraction) + surround[high] * fraction);
      target[index] += value * segmentGain(segment, time, total);
    }
  }
}
