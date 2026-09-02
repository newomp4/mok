"use client";
import { useEffect } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ensureMedia, getMedia, useMedia } from "./media";
import type { AudioTrack } from "./types";

/** Clip length on the timeline (seconds). */
export function audioLength(track: AudioTrack): number {
  return Math.max(0, (track.media.duration ?? 0) - track.trimStart);
}

/** Gain (0..1) of the track at timeline second t, including fades and range. */
export function audioGainAt(track: AudioTrack, t: number): number {
  const len = audioLength(track);
  const end = track.start + len;
  if (t < track.start || t > end) return 0;
  let g = track.volume;
  if (track.fadeIn > 0) g *= Math.min(1, (t - track.start) / track.fadeIn);
  if (track.fadeOut > 0) g *= Math.min(1, (end - t) / track.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/**
 * Keeps an <audio> element in step with the timeline: plays while the transport runs,
 * seeks when the playhead moves, applies volume fades. Silent while scrubbing.
 */
export function useAudioPlayback() {
  const track = useEditor((s) => s.project.audio ?? null);
  const loaded = useMedia(track?.media ?? null);
  useEffect(() => {
    if (!track || !loaded || loaded.kind !== "audio") return;
    const el = loaded.element as HTMLAudioElement;
    const sync = () => {
      const ui = useUI.getState();
      const t = ui.time;
      const tr = useEditor.getState().project.audio;
      if (!tr) return;
      const len = audioLength(tr);
      const inRange = t >= tr.start && t < tr.start + len;
      el.volume = audioGainAt(tr, t);
      if (ui.playing && inRange && !ui.exporting) {
        const target = tr.trimStart + (t - tr.start);
        if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    };
    const unsubs = [
      useUI.subscribe((s) => s.playing, sync),
      useUI.subscribe((s) => s.time, sync),
      useEditor.subscribe((s) => s.project.audio, sync),
    ];
    sync();
    return () => { unsubs.forEach((u) => u()); el.pause(); };
  }, [track, loaded]);
}

/**
 * Renders the project's audio into a stereo AudioBuffer covering the whole video (for export).
 * Returns null when the project has no audio.
 */
export async function renderAudioMix(total: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  const track = useEditor.getState().project.audio;
  if (!track || total <= 0) return null;
  const loaded = getMedia(track.media.id) ?? (await ensureMedia(track.media));
  if (!loaded) return null;
  const frames = Math.max(1, Math.ceil(total * sampleRate));
  const off = new OfflineAudioContext(2, frames, sampleRate);
  const data = await loaded.blob.arrayBuffer();
  const decoded = await off.decodeAudioData(data.slice(0));
  const src = off.createBufferSource();
  src.buffer = decoded;
  const gain = off.createGain();
  const len = Math.min(audioLength(track), Math.max(0, total - track.start));
  const end = track.start + len;
  const g = gain.gain;
  g.setValueAtTime(track.fadeIn > 0 ? 0 : track.volume, Math.max(0, track.start));
  if (track.fadeIn > 0) g.linearRampToValueAtTime(track.volume, track.start + Math.min(track.fadeIn, len));
  if (track.fadeOut > 0) {
    g.setValueAtTime(track.volume, Math.max(track.start, end - Math.min(track.fadeOut, len)));
    g.linearRampToValueAtTime(0, end);
  }
  src.connect(gain).connect(off.destination);
  src.start(Math.max(0, track.start), track.trimStart, len);
  return off.startRendering();
}
