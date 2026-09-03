"use client";
import { useEffect } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { totalDuration } from "./animation";
import { ensureMedia, getMedia, useMedia } from "./media";
import type { AudioTrack } from "./types";

/** Clip length on the timeline (seconds). */
export function audioLength(track: AudioTrack): number {
  return Math.max(0, (track.media.duration ?? 0) - track.trimStart);
}

/**
 * The audible span of the track and its two ramps, both clamped to the video: a clip that runs
 * past the end of the timeline fades out at the end instead of somewhere nobody hears, and fades
 * that together outlast the clip shrink in proportion so they meet at one peak rather than overlap.
 */
function audioEnvelope(track: AudioTrack, total: number) {
  const len = Math.min(audioLength(track), Math.max(0, total - track.start));
  let fadeIn = Math.max(0, Math.min(track.fadeIn, len));
  let fadeOut = Math.max(0, Math.min(track.fadeOut, len));
  if (fadeIn + fadeOut > len) {
    const k = len / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  return { len, end: track.start + len, fadeIn, fadeOut };
}

/** Gain (0..1) of the track at timeline second t, including fades and range. */
export function audioGainAt(track: AudioTrack, t: number, total: number): number {
  const { end, fadeIn, fadeOut } = audioEnvelope(track, total);
  if (t < track.start || t > end) return 0;
  let g = track.volume;
  if (fadeIn > 0) g *= Math.min(1, (t - track.start) / fadeIn);
  if (fadeOut > 0) g *= Math.min(1, (end - t) / fadeOut);
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
      const project = useEditor.getState().project;
      const tr = project.audio;
      if (!tr) return;
      const total = totalDuration(project);
      const inRange = t >= tr.start && t < audioEnvelope(tr, total).end;
      el.volume = audioGainAt(tr, t, total);
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
  const { len, end, fadeIn, fadeOut } = audioEnvelope(track, total);
  const g = gain.gain;
  g.setValueAtTime(fadeIn > 0 ? 0 : track.volume, Math.max(0, track.start));
  const peak = track.start + fadeIn;
  if (fadeIn > 0) g.linearRampToValueAtTime(track.volume, peak);
  if (fadeOut > 0) {
    // When the fades were shrunk to fit, rounding can put end - fadeOut an ulp before the peak.
    // The automation list is sorted by time, so an anchor scheduled ahead of the ramp's end would
    // swallow the fade-in and jump the gain straight to full volume.
    g.setValueAtTime(track.volume, Math.max(peak, end - fadeOut));
    g.linearRampToValueAtTime(0, end);
  }
  src.connect(gain).connect(off.destination);
  src.start(Math.max(0, track.start), track.trimStart, len);
  return off.startRendering();
}
