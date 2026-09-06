"use client";
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type VideoCodec, type AudioCodec } from "mediabunny";
import { useProgress } from "@react-three/drei";
import { renderAudioMix } from "@/lib/audio";
import { anim } from "@/three/anim";
import { nextFrame, useRenderFlags, viewport } from "@/three/registry";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { locate, totalDuration, MAX_PROJECT_DURATION } from "@/lib/animation";
import { resolveShotView } from "@/lib/shotView";
import { getMedia, ensureMedia } from "@/lib/media";
import { ensureFont } from "@/lib/fonts";
import { exportAssets, exportSampleTime, type ExportScope } from "@/export/assets";

export interface ExportSessionOptions {
  width: number;
  height: number;
  transparent: boolean;
  /** Which timeline pixels/sound this capture needs; omitted sessions cover the video endpoint. */
  scope?: ExportScope;
  /** Lets a long wait inside a frame — a video seek above all — give up as soon as the export is cancelled. */
  signal?: AbortSignal;
}

export interface ExportSession {
  canvas: HTMLCanvasElement;
  /** `clockTime` is what the frame clock advances to; motion-blur samples pass the time of the frame they belong to. */
  renderAt: (t: number, clockTime?: number) => Promise<void>;
}

/** Shot boundaries settle React-owned geometry and effects, even when the device/look stays the same. */
function shotViewAt(t: number): string {
  const p = useEditor.getState().project;
  const shot = locate(p, t).shot;
  const v = resolveShotView(p, shot);
  return `${shot?.id ?? ""}|${v.device}|${v.orientation}|${v.finish}|${v.scene}|${v.lighting}|${v.blurMode}|${v.bokeh}|${v.notch}`;
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
    if (signal?.aborted) { finish(false); return; }
    try { v.currentTime = target; } catch { finish(false); }
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
  if ((loc.shot?.kind ?? "media") !== "media") return;
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
  if (landed() && !v.seeking && v.readyState >= 2) return;
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
    checkCancelled(signal);
    await nextFrame();
  }
  checkCancelled(signal);
  if (useProgress.getState().active) throw new Error("Scene assets are still loading. Wait for the preview to finish loading and export again.");
}

/**
 * Temporarily switches the live viewport to an exact pixel size, renders frames
 * deterministically at requested times and restores everything afterwards.
 */
let exportActive = false;
function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError"); }

/** Abort a wait promptly even when a font or media decoder cannot itself be cancelled. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException("Export cancelled", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

export async function withExportSession<T>(opts: ExportSessionOptions, fn: (s: ExportSession) => Promise<T>): Promise<T> {
  checkCancelled(opts.signal);
  if (exportActive) throw new Error("Another capture is already running");
  if (![opts.width, opts.height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error("Choose whole-pixel export dimensions between 1 and 8192");
  const st = viewport.state;
  if (!st) throw new Error("Viewport is not ready");
  const maxSize = st.gl.capabilities.maxTextureSize;
  if (opts.width > maxSize || opts.height > maxSize) throw new Error(`This device supports exports up to ${maxSize} pixels per side`);
  exportActive = true;
  const ui = useUI.getState();
  const prevTime = ui.time;
  const wasPlaying = ui.playing;
  const prev = { w: st.size.width, h: st.size.height, dpr: st.viewport.dpr, frameloop: st.frameloop, transparent: useRenderFlags.getState().transparent, exportQuality: useRenderFlags.getState().exporting, exportTime: anim.exportTime, exporting: anim.exporting };
  let resized = false;
  try {
    if (wasPlaying) ui.setPlaying(false);
    const project = useEditor.getState().project;
    const assets = exportAssets(project, opts.scope ?? { type: "video", start: 0, end: totalDuration(project) }, opts.transparent);
    await abortable(Promise.all(assets.fonts.map((font) => ensureFont(font.font, font.weight))), opts.signal);
    const media = assets.media;
    const loaded = await abortable(Promise.all(media.map(ensureMedia)), opts.signal);
    const missing = media.filter((_, i) => !loaded[i]);
    if (missing.length) throw new Error(`Missing media: ${missing.slice(0, 3).map((m) => m.name).join(", ")}. Re-add the files before exporting.`);
    await waitForAssets(opts.signal);
    anim.exporting = true;
    useRenderFlags.getState().setExporting(true);
    resized = true;
    st.setFrameloop("never");
    st.setDpr(1);
    st.setSize(opts.width, opts.height);
    useRenderFlags.getState().setTransparent(opts.transparent);
    await waitForAssets(opts.signal);
    await nextFrame();
    await nextFrame();
    checkCancelled(opts.signal);
    viewport.composer?.setSize(opts.width, opts.height);
    let mounted = shotViewAt(prevTime);
    const renderAt = async (t: number, clockTime = t) => {
      checkCancelled(opts.signal);
      anim.exportTime = t;
      const view = shotViewAt(t);
      const changed = view !== mounted;
      if (useUI.getState().time !== t) useUI.setState({ time: t });
      if (changed) {
        mounted = view;
        await nextFrame(); await nextFrame(); await nextFrame();
        await waitForAssets(opts.signal);
        await nextFrame(); await nextFrame();
      }
      await seekVideoForTime(t, opts.signal);
      checkCancelled(opts.signal);
      st.advance(clockTime);
    };
    return await fn({ canvas: st.gl.domElement, renderAt });
  } finally {
    // Setup is covered too: a rejected font, decoder, resize or asset wait must leave the editor
    // exactly as it was before capture, including playback and an existing transparency preview.
    anim.exportTime = prev.exportTime;
    anim.exporting = prev.exporting;
    useRenderFlags.getState().setExporting(prev.exportQuality);
    useUI.setState({ time: prevTime });
    useRenderFlags.getState().setTransparent(prev.transparent);
    try {
      if (resized) {
        st.setDpr(prev.dpr);
        st.setSize(prev.w, prev.h);
        viewport.composer?.setSize(prev.w, prev.h);
      }
    } finally {
      st.setFrameloop(prev.frameloop);
      st.invalidate();
      exportActive = false;
      if (wasPlaying) useUI.getState().setPlaying(true);
    }
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

export async function captureImage(opts: { width: number; height: number; format: ImageFormat; quality?: number; transparent: boolean; time?: number; signal?: AbortSignal }): Promise<Blob> {
  const time = opts.time ?? useUI.getState().time;
  const transparent = opts.transparent && opts.format !== "jpg";
  return withExportSession({ width: opts.width, height: opts.height, transparent, scope: { type: "still", time }, signal: opts.signal }, async ({ canvas, renderAt }) => {
    await renderAt(time);
    // a second pass lets lazily-created effect targets settle at the new size
    await renderAt(time);
    const mime = opts.format === "png" ? "image/png" : opts.format === "webp" ? "image/webp" : "image/jpeg";
    // a scene background set to transparent clears the frame with alpha 0 whatever the export asked
    // for, so an image meant to be opaque has to be flattened instead of shipping with holes in it
    const holes = !transparent && useEditor.getState().project.scene.background.type === "transparent";
    const src = holes ? flatten(canvas, opts.width, opts.height) : canvas;
    const blob = await abortable(new Promise<Blob | null>((r) => src.toBlob(r, mime, opts.quality ?? 0.92)), opts.signal);
    checkCancelled(opts.signal);
    if (!blob) throw new Error("Could not encode image");
    if (blob.type !== mime) throw new Error(`This browser cannot encode ${opts.format.toUpperCase()} images. Choose PNG instead.`);
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
      checkCancelled(opts.signal);
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
          if (!acodec) throw new Error("This browser cannot encode the soundtrack in this video format. Choose another format.");
          if (acodec) {
            audioSource = new AudioBufferSource({ codec: acodec, bitrate: 160_000 });
            output.addAudioTrack(audioSource);
          }
        }
        checkCancelled(opts.signal);
        await abortable(output.start(), opts.signal);
        if (audioSource && mix) { await abortable(audioSource.add(mix), opts.signal); audioSource.close(); }
        await abortable(source.add(timestamp, duration), opts.signal);
        checkCancelled(opts.signal);
        // a downgrade explains a smaller file than the dialog promised, so it rides along with progress
        const note = codec === codecs[0] && quality === opts.quality ? null : `${CODEC_LABEL[codec] ?? codec.toUpperCase()} · ${QUALITY_LABEL[quality]} quality`;
        return { output, source, useWebm, note };
      } catch (e) {
        lastError = e;
        try { await output.cancel(); } catch {}
        checkCancelled(opts.signal);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("This browser could not start a video encoder");
}

export async function exportVideo(opts: VideoExportOptions): Promise<{ blob: Blob; ext: string }> {
  const project = useEditor.getState().project;
  const total = totalDuration(project);
  checkCancelled(opts.signal);
  if (!Number.isFinite(opts.fps) || opts.fps < 1 || opts.fps > 120) throw new Error("Choose a frame rate between 1 and 120 fps");
  if (!Number.isFinite(total) || total <= 0) throw new Error("Add a shot before exporting video");
  if (total > MAX_PROJECT_DURATION) throw new Error(`Set the video duration to ${MAX_PROJECT_DURATION} seconds or less before exporting.`);
  const frames = Math.max(1, Math.ceil(total * opts.fps - 1e-7));
  const wantWebm = opts.format === "webm" || opts.transparent;
  const codecPrefs: VideoCodec[] = wantWebm ? ["vp9", "av1", "vp8"] : ["avc", "hevc", "av1", "vp9"];
  const codecs = await abortable(encodableCodecs(codecPrefs, opts.width, opts.height), opts.signal);
  if (!codecs.length) throw new Error("This browser cannot encode video (WebCodecs unavailable)");

  const scope: ExportScope = { type: "video", start: 0, end: total };
  return withExportSession({ width: opts.width, height: opts.height, transparent: opts.transparent, scope, signal: opts.signal }, async ({ canvas, renderAt }) => {
    const accum = document.createElement("canvas");
    accum.width = opts.width;
    accum.height = opts.height;
    const ctx = accum.getContext("2d", { alpha: opts.transparent })!;

    // music / voiceover lane
    let mix: AudioBuffer | null = null;
    if (exportAssets(project, scope, opts.transparent).audio) {
      opts.onProgress?.(0, "Mixing audio…");
      mix = await abortable(renderAudioMix(total), opts.signal);
      if (!mix) throw new Error("The soundtrack could not be loaded. Re-add the audio file before exporting.");
    }

    const shutter = 0.5; // 180° shutter
    const samples = Number.isFinite(opts.samples) ? Math.max(1, Math.min(32, Math.round(opts.samples))) : 1;
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
          await renderAt(exportSampleTime(sampleT, total), t);
          ctx.drawImage(canvas, 0, 0, opts.width, opts.height);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        const frameDuration = Math.min(1 / opts.fps, total - t);
        if (!enc) enc = await startEncoder(accum, opts, mix, codecs, t, frameDuration);
        else await abortable(enc.source.add(t, frameDuration), opts.signal);
        opts.onProgress?.((i + 1) / frames, `Rendering frame ${i + 1} / ${frames}${enc.note ? ` · ${enc.note}` : ""}`);
      }
      checkCancelled(opts.signal);
      opts.onProgress?.(1, "Encoding…");
      if (!enc) throw new Error("Encoder produced no data");
      enc.source.close();
      await abortable(enc.output.finalize(), opts.signal);
      checkCancelled(opts.signal);
      const buffer = enc.output.target.buffer;
      if (!buffer) throw new Error("Encoder produced no data");
      return { blob: new Blob([buffer], { type: enc.useWebm ? "video/webm" : "video/mp4" }), ext: enc.useWebm ? "webm" : "mp4" };
    } catch (e) {
      try { await enc?.output.cancel(); } catch {}
      throw e;
    }
  });
}
