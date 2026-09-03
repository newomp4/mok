"use client";
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_VERY_HIGH, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type VideoCodec, type AudioCodec } from "mediabunny";
import { renderAudioMix } from "@/lib/audio";
import { anim } from "@/three/anim";
import { nextFrame, useRenderFlags, viewport } from "@/three/registry";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { locate, totalDuration } from "@/lib/animation";
import { resolveShotView } from "@/lib/shotView";
import { getMedia } from "@/lib/media";
import { ensureFont } from "@/lib/fonts";

export interface ExportSessionOptions {
  width: number;
  height: number;
  transparent: boolean;
}

export interface ExportSession {
  canvas: HTMLCanvasElement;
  renderAt: (t: number) => Promise<void>;
}

/** A stable key for the look at time t, so an export only pauses when the look actually changes. */
function shotViewAt(t: number): string {
  const p = useEditor.getState().project;
  const v = resolveShotView(p, locate(p, t).shot);
  return `${v.device}|${v.finish}|${v.scene}|${v.lighting}`;
}

async function seekVideoForTime(t: number) {
  const p = useEditor.getState().project;
  const loc = locate(p, t);
  const m = loc.shot?.media;
  if (!m || m.kind !== "video") return;
  const lm = getMedia(m.id);
  if (!lm) return;
  const v = lm.element as HTMLVideoElement;
  if (!v.paused) v.pause();
  const target = ((loc.shot?.trimStart ?? 0) + loc.localT * (loc.shot?.speed ?? 1)) % (v.duration || 1);
  if (Math.abs(v.currentTime - target) < 0.0005) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; v.removeEventListener("seeked", finish); resolve(); };
    v.addEventListener("seeked", finish);
    v.currentTime = target;
    setTimeout(finish, 1500);
  });
}

/**
 * Temporarily switches the live viewport to an exact pixel size, renders frames
 * deterministically at requested times and restores everything afterwards.
 */
export async function withExportSession<T>(opts: ExportSessionOptions, fn: (s: ExportSession) => Promise<T>): Promise<T> {
  const st = viewport.state;
  if (!st) throw new Error("Viewport is not ready");
  const ui = useUI.getState();
  const wasPlaying = ui.playing;
  if (wasPlaying) ui.setPlaying(false);
  const prev = { w: st.size.width, h: st.size.height, dpr: st.viewport.dpr, frameloop: st.frameloop };
  // a text shot on a web font would otherwise export in the fallback face
  await Promise.all(
    useEditor.getState().project.shots
      .filter((sh) => sh.kind === "text" && sh.text)
      .map((sh) => ensureFont(sh.text!.font, sh.text!.weight)),
  );
  anim.exporting = true;
  st.setFrameloop("never");
  st.setDpr(1);
  st.setSize(opts.width, opts.height);
  useRenderFlags.getState().setTransparent(opts.transparent);
  await nextFrame();
  await nextFrame();
  viewport.composer?.setSize(opts.width, opts.height);
  const canvas = st.gl.domElement;
  const prevTime = useUI.getState().time;
  let mounted = shotViewAt(prevTime);
  const renderAt = async (t: number) => {
    anim.exportTime = t;
    // keep the React tree on the same shot as the frame being rendered, so per-shot devices,
    // scenes and lighting are the ones that get exported
    const view = shotViewAt(t);
    const changed = view !== mounted;
    if (useUI.getState().time !== t) useUI.setState({ time: t });
    if (changed) {
      mounted = view;
      // give React and any newly mounted model a couple of frames to settle before capturing
      await nextFrame();
      await nextFrame();
      await nextFrame();
    }
    await seekVideoForTime(t);
    st.advance(performance.now());
  };
  try {
    return await fn({ canvas, renderAt });
  } finally {
    anim.exportTime = null;
    anim.exporting = false;
    useUI.setState({ time: prevTime });
    useRenderFlags.getState().setTransparent(false);
    st.setDpr(prev.dpr);
    st.setSize(prev.w, prev.h);
    await nextFrame();
    viewport.composer?.setSize(prev.w, prev.h);
    st.setFrameloop(prev.frameloop === "never" ? "demand" : prev.frameloop);
    st.invalidate();
    if (wasPlaying) useUI.getState().setPlaying(true);
  }
}

export type ImageFormat = "png" | "jpg" | "webp";

export async function captureImage(opts: { width: number; height: number; format: ImageFormat; quality?: number; transparent: boolean; time?: number }): Promise<Blob> {
  const time = opts.time ?? useUI.getState().time;
  return withExportSession({ width: opts.width, height: opts.height, transparent: opts.transparent && opts.format !== "jpg" }, async ({ canvas, renderAt }) => {
    await renderAt(time);
    // a second pass lets lazily-created effect targets settle at the new size
    await renderAt(time);
    const mime = opts.format === "png" ? "image/png" : opts.format === "webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, opts.quality ?? 0.92));
    if (!blob) throw new Error("Could not encode image");
    return blob;
  });
}

export type VideoQuality = "low" | "med" | "high" | "ultra";
export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
  /** motion-blur samples per frame (1 = off) */
  samples: number;
  transparent: boolean;
  format: "mp4" | "webm";
  onProgress?: (p: number, label: string) => void;
  signal?: AbortSignal;
}

const QUALITIES = { low: QUALITY_LOW, med: QUALITY_MEDIUM, high: QUALITY_HIGH, ultra: QUALITY_VERY_HIGH };

export function estimateBitrate(width: number, height: number, fps: number, quality: VideoQuality): number {
  const px = width * height * fps;
  const factor = { low: 0.045, med: 0.08, high: 0.14, ultra: 0.22 }[quality];
  return Math.round(px * factor);
}

export async function exportVideo(opts: VideoExportOptions): Promise<{ blob: Blob; ext: string }> {
  const project = useEditor.getState().project;
  const total = totalDuration(project);
  const frames = Math.max(1, Math.round(total * opts.fps));
  const wantWebm = opts.format === "webm" || opts.transparent;
  const codecPrefs: VideoCodec[] = wantWebm ? ["vp9", "av1", "vp8"] : ["avc", "hevc", "av1", "vp9"];
  const codec = await getFirstEncodableVideoCodec(codecPrefs, { width: opts.width, height: opts.height });
  if (!codec) throw new Error("This browser cannot encode video (WebCodecs unavailable)");
  const useWebm = wantWebm || codec === "vp9" || codec === "vp8" || (codec === "av1" && wantWebm);

  return withExportSession({ width: opts.width, height: opts.height, transparent: opts.transparent }, async ({ canvas, renderAt }) => {
    const accum = document.createElement("canvas");
    accum.width = opts.width;
    accum.height = opts.height;
    const ctx = accum.getContext("2d", { alpha: opts.transparent })!;

    const output = new Output({
      format: useWebm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });
    const source = new CanvasSource(accum, {
      codec,
      bitrate: QUALITIES[opts.quality],
      alpha: opts.transparent ? "keep" : "discard",
    });
    output.addVideoTrack(source, { frameRate: opts.fps });
    // music / voiceover lane
    let audioSource: AudioBufferSource | null = null;
    let mix: AudioBuffer | null = null;
    if (project.audio) {
      opts.onProgress?.(0, "Mixing audio…");
      try {
        mix = await renderAudioMix(total);
        const prefs: AudioCodec[] = useWebm ? ["opus", "vorbis"] : ["aac", "opus"];
        const acodec = mix ? await getFirstEncodableAudioCodec(prefs, { numberOfChannels: 2, sampleRate: mix.sampleRate }) : null;
        if (mix && acodec) {
          audioSource = new AudioBufferSource({ codec: acodec, bitrate: 160_000 });
          output.addAudioTrack(audioSource);
        }
      } catch (e) {
        console.warn("audio mix failed", e);
      }
    }
    await output.start();
    if (audioSource && mix) { await audioSource.add(mix); audioSource.close(); }

    const shutter = 0.5; // 180° shutter
    const samples = Math.max(1, Math.round(opts.samples));
    try {
      // warm-up render so effect buffers exist at the export size
      await renderAt(0);
      for (let i = 0; i < frames; i++) {
        if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
        const t = i / opts.fps;
        if (opts.transparent) ctx.clearRect(0, 0, opts.width, opts.height);
        for (let k = 0; k < samples; k++) {
          const st = samples > 1 ? t + (k / samples) * (shutter / opts.fps) : t;
          await renderAt(Math.min(st, total));
          ctx.globalAlpha = 1 / (k + 1);
          ctx.globalCompositeOperation = "source-over";
          ctx.drawImage(canvas, 0, 0, opts.width, opts.height);
        }
        ctx.globalAlpha = 1;
        await source.add(t, 1 / opts.fps);
        opts.onProgress?.((i + 1) / frames, `Rendering frame ${i + 1} / ${frames}`);
      }
      opts.onProgress?.(1, "Encoding…");
      source.close();
      await output.finalize();
    } catch (e) {
      try { await output.cancel(); } catch {}
      throw e;
    }
    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Encoder produced no data");
    return { blob: new Blob([buffer], { type: useWebm ? "video/webm" : "video/mp4" }), ext: useWebm ? "webm" : "mp4" };
  });
}
