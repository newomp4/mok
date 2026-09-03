"use client";
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type VideoCodec, type AudioCodec } from "mediabunny";
import { useProgress } from "@react-three/drei";
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
  /** Lets a long wait inside a frame — a video seek above all — give up as soon as the export is cancelled. */
  signal?: AbortSignal;
}

export interface ExportSession {
  canvas: HTMLCanvasElement;
  /** `clockTime` is what the frame clock advances to; motion-blur samples pass the time of the frame they belong to. */
  renderAt: (t: number, clockTime?: number) => Promise<void>;
}

/** A stable key for the look at time t, so an export only pauses when the look actually changes. */
function shotViewAt(t: number): string {
  const p = useEditor.getState().project;
  const v = resolveShotView(p, locate(p, t).shot);
  return `${v.device}|${v.finish}|${v.scene}|${v.lighting}`;
}

/** Resolves true when the element reports the seek landed, false when it ran out of time or the export was cancelled. */
function awaitSeek(v: HTMLVideoElement, target: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    let timer = 0;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      signal?.removeEventListener("abort", onAbort);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const onAbort = () => finish(false);
    v.addEventListener("seeked", onSeeked);
    signal?.addEventListener("abort", onAbort);
    timer = window.setTimeout(() => finish(false), timeoutMs);
    v.currentTime = target;
  });
}

/**
 * A landed seek reports the presentation time of the decoded source frame, not the time that was
 * asked for, so comparing the two exactly would issue a real seek for every motion-blur sample of a
 * frame that is already on screen. Any target from the displayed frame's own time up to the start of
 * the next one decodes to that same frame, and the source's frame rate is unknown, so the frame
 * length is learned from the seeks that do run — landing at `c` after asking for `target` proves a
 * frame lasts at least `target - c` — floored at one frame of 60 fps and capped at one of 24 fps so
 * a wildly inaccurate landing cannot widen the window past a single frame of ordinary footage.
 */
const sourceFrameLength = new WeakMap<HTMLVideoElement, number>();
function frameWindow(v: HTMLVideoElement): number {
  return Math.max(1 / 60, sourceFrameLength.get(v) ?? 0);
}

async function seekVideoForTime(t: number, signal?: AbortSignal) {
  const p = useEditor.getState().project;
  const loc = locate(p, t);
  const m = loc.shot?.media;
  if (!m || m.kind !== "video") return;
  const lm = getMedia(m.id);
  if (!lm) return;
  const v = lm.element as HTMLVideoElement;
  if (!v.paused) v.pause();
  const target = ((loc.shot?.trimStart ?? 0) + loc.localT * (loc.shot?.speed ?? 1)) % (v.duration || 1);
  // a hair of slack below the displayed frame's time absorbs the rounding browsers apply to currentTime
  const landed = () => target - v.currentTime >= -1e-4 && target - v.currentTime < frameWindow(v);
  const learn = () => {
    const seen = Math.min(target - v.currentTime, 1 / 24);
    if (seen > (sourceFrameLength.get(v) ?? 0)) sourceFrameLength.set(v, seen);
  };
  if (landed()) return;
  // carrying on after a seek that never lands would encode whatever frame the element still holds,
  // so try once more and then stop the export rather than let a stale frame through. The per-attempt
  // budget stays short because this runs for every motion-blur sample: an element that has wedged
  // has to surface as an error in seconds, not hold the whole export for minutes.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    if (await awaitSeek(v, target, 1500, signal)) { learn(); return; }
    // assigning currentTime moves the element's reported position immediately, so a wedged seek
    // still reads back as the target; only the element's own state says whether it finished
    if (!v.seeking && v.readyState >= 2) { learn(); return; }
  }
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  throw new Error("A video shot took too long to seek. Try exporting again.");
}

/**
 * Models, HDRIs and scene textures load through three's default manager — the same signal the
 * viewport's loading pill watches. Encoding before they land bakes an untextured floor into a frame.
 */
async function waitForAssets(signal?: AbortSignal, timeoutMs = 15000) {
  const started = performance.now();
  // one frame of grace so a load kicked off by the change we just made has registered
  await nextFrame();
  while (useProgress.getState().active && performance.now() - started < timeoutMs) {
    if (signal?.aborted) return;
    await nextFrame();
  }
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
  // a model or scene texture still in flight would otherwise export as a placeholder
  await waitForAssets(opts.signal);
  anim.exporting = true;
  st.setFrameloop("never");
  st.setDpr(1);
  st.setSize(opts.width, opts.height);
  useRenderFlags.getState().setTransparent(opts.transparent);
  await waitForAssets(opts.signal);
  await nextFrame();
  await nextFrame();
  viewport.composer?.setSize(opts.width, opts.height);
  const canvas = st.gl.domElement;
  const prevTime = useUI.getState().time;
  let mounted = shotViewAt(prevTime);
  const renderAt = async (t: number, clockTime = t) => {
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
      await waitForAssets(opts.signal);
      // the loading manager reports done as the last file decodes, which is still ahead of React
      // re-rendering the suspended subtree and R3F committing the new material to the scene
      await nextFrame();
      await nextFrame();
    }
    await seekVideoForTime(t, opts.signal);
    // with frameloop "never" R3F derives the frame delta from this timestamp, in seconds, so the
    // export's own clock has to drive it: performance.now() is milliseconds and never repeatable
    st.advance(clockTime);
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

/** Composites a frame that may carry alpha onto opaque black. */
function flatten(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const flat = document.createElement("canvas");
  flat.width = width;
  flat.height = height;
  const ctx = flat.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0, width, height);
  return flat;
}

export async function captureImage(opts: { width: number; height: number; format: ImageFormat; quality?: number; transparent: boolean; time?: number }): Promise<Blob> {
  const time = opts.time ?? useUI.getState().time;
  const transparent = opts.transparent && opts.format !== "jpg";
  return withExportSession({ width: opts.width, height: opts.height, transparent }, async ({ canvas, renderAt }) => {
    await renderAt(time);
    // a second pass lets lazily-created effect targets settle at the new size
    await renderAt(time);
    const mime = opts.format === "png" ? "image/png" : opts.format === "webp" ? "image/webp" : "image/jpeg";
    // a scene background set to transparent clears the frame with alpha 0 whatever the export asked
    // for, so an image meant to be opaque has to be flattened instead of shipping with holes in it
    const holes = !transparent && useEditor.getState().project.scene.background.type === "transparent";
    const src = holes ? flatten(canvas, opts.width, opts.height) : canvas;
    const blob = await new Promise<Blob | null>((r) => src.toBlob(r, mime, opts.quality ?? 0.92));
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

const QUALITY_ORDER: VideoQuality[] = ["ultra", "high", "med", "low"];
/** Matches the names on the export dialog's quality picker, so a downgrade note reads the way the control does. */
const QUALITY_LABEL: Record<VideoQuality, string> = { low: "Low", med: "Med", high: "High", ultra: "Ultra" };
/** The names people know these by, rather than the spec ids the encoder uses. */
const CODEC_LABEL: Partial<Record<VideoCodec, string>> = { avc: "H.264", hevc: "HEVC", vp9: "VP9", vp8: "VP8", av1: "AV1" };

export function estimateBitrate(width: number, height: number, fps: number, quality: VideoQuality): number {
  const px = width * height * fps;
  const factor = { low: 0.045, med: 0.08, high: 0.14, ultra: 0.22 }[quality];
  return Math.round(px * factor);
}

/** Every codec in `prefs` this browser claims it can encode, in order, so a refused one has somewhere to fall back to. */
async function encodableCodecs(prefs: VideoCodec[], width: number, height: number): Promise<VideoCodec[]> {
  const found: VideoCodec[] = [];
  let rest = prefs;
  while (rest.length) {
    const codec = await getFirstEncodableVideoCodec(rest, { width, height });
    if (!codec) break;
    found.push(codec);
    rest = rest.slice(rest.indexOf(codec) + 1);
  }
  return found;
}

/**
 * Builds the muxer, starts it and encodes the first frame. An encoder only validates its
 * configuration once it receives that frame — Safari in particular refuses high-bitrate ones — so
 * the whole setup steps down through the remaining codecs and quality presets before giving up.
 */
async function startEncoder(accum: HTMLCanvasElement, opts: VideoExportOptions, mix: AudioBuffer | null, codecs: VideoCodec[], timestamp: number, duration: number) {
  const qualities = QUALITY_ORDER.slice(QUALITY_ORDER.indexOf(opts.quality));
  let lastError: unknown = null;
  for (const codec of codecs) {
    const useWebm = opts.format === "webm" || opts.transparent || codec === "vp9" || codec === "vp8";
    for (const quality of qualities) {
      const output = new Output({
        format: useWebm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }),
        target: new BufferTarget(),
      });
      try {
        // building the tracks belongs inside the retry: a container that refuses this codec throws
        // from addVideoTrack, and that has to step to the next candidate like any other refusal
        const source = new CanvasSource(accum, {
          codec,
          bitrate: estimateBitrate(opts.width, opts.height, opts.fps, quality),
          alpha: opts.transparent ? "keep" : "discard",
        });
        output.addVideoTrack(source, { frameRate: opts.fps });
        let audioSource: AudioBufferSource | null = null;
        if (mix) {
          const prefs: AudioCodec[] = useWebm ? ["opus", "vorbis"] : ["aac", "opus"];
          const acodec = await getFirstEncodableAudioCodec(prefs, { numberOfChannels: 2, sampleRate: mix.sampleRate });
          if (acodec) {
            audioSource = new AudioBufferSource({ codec: acodec, bitrate: 160_000 });
            output.addAudioTrack(audioSource);
          }
        }
        await output.start();
        if (audioSource && mix) { await audioSource.add(mix); audioSource.close(); }
        await source.add(timestamp, duration);
        // a downgrade explains a smaller file than the dialog promised, so it rides along with progress
        const note = codec === codecs[0] && quality === opts.quality ? null : `${CODEC_LABEL[codec] ?? codec.toUpperCase()} · ${QUALITY_LABEL[quality]} quality`;
        return { output, source, useWebm, note };
      } catch (e) {
        lastError = e;
        try { await output.cancel(); } catch {}
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("This browser could not start a video encoder");
}

export async function exportVideo(opts: VideoExportOptions): Promise<{ blob: Blob; ext: string }> {
  const project = useEditor.getState().project;
  const total = totalDuration(project);
  const frames = Math.max(1, Math.round(total * opts.fps));
  const wantWebm = opts.format === "webm" || opts.transparent;
  const codecPrefs: VideoCodec[] = wantWebm ? ["vp9", "av1", "vp8"] : ["avc", "hevc", "av1", "vp9"];
  const codecs = await encodableCodecs(codecPrefs, opts.width, opts.height);
  if (!codecs.length) throw new Error("This browser cannot encode video (WebCodecs unavailable)");

  return withExportSession({ width: opts.width, height: opts.height, transparent: opts.transparent, signal: opts.signal }, async ({ canvas, renderAt }) => {
    const accum = document.createElement("canvas");
    accum.width = opts.width;
    accum.height = opts.height;
    const ctx = accum.getContext("2d", { alpha: opts.transparent })!;

    // music / voiceover lane
    let mix: AudioBuffer | null = null;
    if (project.audio) {
      opts.onProgress?.(0, "Mixing audio…");
      try {
        mix = await renderAudioMix(total);
      } catch (e) {
        console.warn("audio mix failed", e);
      }
    }

    const shutter = 0.5; // 180° shutter
    const samples = Math.max(1, Math.round(opts.samples));
    let enc: Awaited<ReturnType<typeof startEncoder>> | null = null;
    try {
      // warm-up render so effect buffers exist at the export size
      await renderAt(0);
      for (let i = 0; i < frames; i++) {
        if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
        const t = i / opts.fps;
        // the accumulator has to be reset every frame: a frame carries alpha whenever the scene
        // background is transparent, not only on a transparent export, and drawing that over the
        // previous frame would leave the previous frame showing through
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, opts.width, opts.height);
        if (!opts.transparent) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, opts.width, opts.height);
        }
        // samples are summed rather than averaged progressively: source-over only reaches the mean
        // when every sample is opaque, otherwise alpha ends up as the union of the silhouettes
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1 / samples;
        for (let k = 0; k < samples; k++) {
          // a sample is a full render, so a blurred export would otherwise ignore Cancel for the
          // length of a whole frame's worth of them
          if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
          const sampleT = samples > 1 ? t + (k / samples) * (shutter / opts.fps) : t;
          // every sample of one output frame shares the frame's clock, so time-driven effects
          // (grain) stay identical across them instead of being averaged away
          await renderAt(Math.min(sampleT, total), t);
          ctx.drawImage(canvas, 0, 0, opts.width, opts.height);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        if (!enc) enc = await startEncoder(accum, opts, mix, codecs, t, 1 / opts.fps);
        else await enc.source.add(t, 1 / opts.fps);
        opts.onProgress?.((i + 1) / frames, `Rendering frame ${i + 1} / ${frames}${enc.note ? ` · ${enc.note}` : ""}`);
      }
      opts.onProgress?.(1, "Encoding…");
      if (!enc) throw new Error("Encoder produced no data");
      enc.source.close();
      await enc.output.finalize();
      const buffer = enc.output.target.buffer;
      if (!buffer) throw new Error("Encoder produced no data");
      return { blob: new Blob([buffer], { type: enc.useWebm ? "video/webm" : "video/mp4" }), ext: enc.useWebm ? "webm" : "mp4" };
    } catch (e) {
      try { await enc?.output.cancel(); } catch {}
      throw e;
    }
  });
}
