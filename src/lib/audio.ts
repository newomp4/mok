"use client";
import { useEffect } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { MAX_PROJECT_DURATION, totalDuration } from "./animation";
import { ensureMedia, getMedia, useMedia, useMediaStore } from "./media";
import { audioGainAt, audioHeadroom, audioSegments, mixAudioChunk, sourceAudioAt, sourceAudioGainAt } from "./audioPlan";
import { openAudioChunks, type AudioChunks } from "@/export/audioDecode";
import { checkExportCancelled, exportAbortable } from "@/export/abort";
export { audioGainAt, audioLength } from "./audioPlan";

/** The same clip range, loop, gain and envelope rules drive native preview and PCM export. */
export function useAudioPlayback() {
  const track = useEditor((s) => s.project.audio ?? null);
  const loaded = useMedia(track?.media ?? null);
  useEffect(() => {
    if (!track || !loaded || loaded.kind !== "audio") return;
    const el = loaded.element as HTMLAudioElement;
    const sync = () => {
      const ui = useUI.getState(), project = useEditor.getState().project, tr = project.audio, total = totalDuration(project);
      if (!tr || tr.media.id !== loaded.ref.id) { el.pause(); return; }
      const gain = audioGainAt(tr, ui.time, total);
      el.volume = gain * audioHeadroom(project, ui.time, total);
      if (ui.playing && gain > 0 && !ui.exporting) {
        const target = tr.trimStart + ui.time - tr.start;
        if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) el.pause();
    };
    const unsubs = [useUI.subscribe((s) => s.playing, sync), useUI.subscribe((s) => s.time, sync), useUI.subscribe((s) => s.exporting, sync), useEditor.subscribe((s) => s.project, sync)];
    sync(); return () => { unsubs.forEach((u) => u()); el.pause(); };
  }, [track, loaded]);
  useEffect(() => {
    let previous: HTMLVideoElement | null = null;
    const sync = () => {
      const ui = useUI.getState(), project = useEditor.getState().project, total = totalDuration(project);
      const active = ui.playing && !ui.exporting ? sourceAudioAt(project, ui.time, total) : null;
      const media = active ? getMedia(active.media.id) : null;
      const video = media?.kind === "video" ? media.element as HTMLVideoElement : null;
      if (previous && previous !== video) previous.muted = true;
      previous = video;
      if (video && active) {
        video.preservesPitch = false;
        video.volume = active.gain * audioHeadroom(project, ui.time, total);
        video.muted = false;
        // Device owns the visual clock/playbackRate, avoiding a competing audio seek loop.
      }
    };
    const unsubs = [useUI.subscribe((s) => s.playing, sync), useUI.subscribe((s) => s.time, sync), useUI.subscribe((s) => s.exporting, sync), useEditor.subscribe((s) => s.project, sync), useMediaStore.subscribe(sync)];
    sync(); return () => { unsubs.forEach((u) => u()); if (previous) previous.muted = true; };
  }, []);
}

/** At most one decoded source queue plus a stereo buffer bounded to the 180-second project limit. */
export async function renderAudioMix(total: number, sampleRate = 48000, signal?: AbortSignal): Promise<AudioBuffer | null> {
  if (!Number.isFinite(total) || total <= 0 || total > MAX_PROJECT_DURATION || sampleRate < 8000 || sampleRate > 96000) throw new Error("Invalid audio export duration or sample rate");
  const project = useEditor.getState().project, segments = audioSegments(project, total);
  if (!segments.length) return null;
  const output = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(total * sampleRate), sampleRate });
  let source: AudioChunks | null = null, id = "", audible = false;
  try {
    for (const segment of segments) {
      checkExportCancelled(signal);
      if (id !== segment.media.id) {
        source?.dispose(); source = null; id = segment.media.id;
        const loaded = getMedia(id) ?? await exportAbortable(ensureMedia(segment.media), signal);
        if (!loaded) throw new Error(`Missing audio source: ${segment.media.name}. Re-add the file before exporting.`);
        source = await openAudioChunks(loaded, signal);
        if (!source && segment.track) throw new Error("The soundtrack has no decodable audio track");
      }
      if (!source) continue; // Video clips without an embedded audio track are legitimately silent.
      const end = segment.sourceStart + (segment.end - segment.start) * segment.rate;
      for await (const chunk of source.chunks(segment.sourceStart, end)) {
        checkExportCancelled(signal); mixAudioChunk(output, chunk.buffer, chunk.timestamp, segment, total); audible = true;
      }
    }
    if (!audible) return null;
    // Normalize overlapping lanes with the exact same time-varying headroom used in preview.
    const left = output.getChannelData(0), right = output.getChannelData(1);
    let cursor = 0;
    const intervals = project.shots.map((shot) => { const start = cursor + Math.max(0, shot.gap ?? 0); cursor = start + shot.duration; return { shot, start, end: cursor }; });
    let current = 0;
    for (let i = 0; i < output.length; i++) {
      if (i % 48000 === 0) checkExportCancelled(signal);
      const time = i / sampleRate;
      while (current < intervals.length && time >= intervals[current].end) current++;
      const active = intervals[current];
      const sourceGain = active && time >= active.start && (active.shot.kind ?? "media") === "media" && active.shot.media?.kind === "video" ? sourceAudioGainAt(active.shot, time - active.start, Math.max(0, total - active.start)) : 0;
      const gain = 1 / Math.max(1, sourceGain + (project.audio ? audioGainAt(project.audio, time, total) : 0));
      left[i] = Math.max(-1, Math.min(1, left[i] * gain)); right[i] = Math.max(-1, Math.min(1, right[i] * gain));
    }
    return output;
  } finally { source?.dispose(); }
}
