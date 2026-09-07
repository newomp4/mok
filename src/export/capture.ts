"use client";
import { Output, Mp4OutputFormat, WebMOutputFormat, CanvasSource, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type VideoCodec, type AudioCodec } from "mediabunny";
import { useProgress } from "@react-three/drei";
import { renderAudioMix } from "@/lib/audio";
import { correctMp4AudioTiming } from "./mp4Timing";
import { prepareAudioTrack } from "./audioEncode";
import { hasAudio } from "@/lib/audioPlan";
import { waitForGpuPreparation } from "@/three/gpuPreparation";
import { ExportVideoDecoder } from "./videoDecoder";
import { seekVideoElement } from "./videoSeek";
import { createExportOutput, type ExportOutput } from "./output";
import { availableSampleCounts, deviceMemoryGB, planRenderQuality } from "@/three/qualityPlan";
import { anim } from "@/three/anim";
import { nextFrame, useRenderFlags, viewport } from "@/three/registry";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { locate, totalDuration, MAX_PROJECT_DURATION } from "@/lib/animation";
import { resolveShotView } from "@/lib/shotView";
import { exportQualityRequirements } from "./quality";
import { getMedia, ensureMedia } from "@/lib/media";
import { ensureFont } from "@/lib/fonts";
import { exportAssets, exportSampleTime, type ExportScope } from "@/export/assets";

export interface ExportSessionOptions {
  width: number;
  height: number;
  transparent: boolean;
  transparentShadows?: boolean;
  motionSamples?: number;
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

async function seekVideoForTime(t: number, decoder: ExportVideoDecoder, signal?: AbortSignal) {
  const p = useEditor.getState().project;
  const loc = locate(p, t);
  if ((loc.shot?.kind ?? "media") !== "media") { decoder.clear(); return; }
  const m = loc.shot?.media;
  if (!m || m.kind !== "video") { decoder.clear(); return; }
  const lm = getMedia(m.id);
  if (!lm) { decoder.clear(); throw new Error(`Missing video source: ${m.name}. Re-add the file before exporting.`); }
  const v = lm.element as HTMLVideoElement;
  if (!v.paused) v.pause();
  const target = ((loc.shot?.trimStart ?? 0) + loc.localT * (loc.shot?.speed ?? 1)) % (v.duration || 1);
  if (await decoder.prepare(lm, target, signal)) return;
  await seekVideoElement(v, target, signal);
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
  await abortable(waitForGpuPreparation(signal), signal);
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
  const project = useEditor.getState().project;
  const scope = opts.scope ?? { type: "video", start: 0, end: totalDuration(project) };
  const assets = exportAssets(project, scope, opts.transparent);
  const qualityPlan = planRenderQuality({ ...exportQualityRequirements(project, scope), width: opts.width, height: opts.height, maxTextureSize: maxSize, maxSamples: st.gl.capabilities.maxSamples, supportedSamples: st.gl.getContext ? availableSampleCounts(st.gl.getContext() as WebGL2RenderingContext) : undefined, deviceMemoryGB: deviceMemoryGB(), motionSamples: opts.motionSamples });
  if (!qualityPlan.supported) throw new Error(qualityPlan.reason);
  exportActive = true;
  const decoder = new ExportVideoDecoder({ onFallback: (name) => useUI.getState().showToast(`Using browser video seeking for ${name}; timestamp decoding is unavailable for this source.`) });
  const ui = useUI.getState();
  const prevTime = ui.time;
  const wasPlaying = ui.playing;
  const prev = { w: st.size.width, h: st.size.height, dpr: st.viewport.dpr, frameloop: st.frameloop, transparent: useRenderFlags.getState().transparent, transparentShadows: useRenderFlags.getState().transparentShadows, exportQuality: useRenderFlags.getState().exporting, exportTime: anim.exportTime, exporting: anim.exporting, qualityPlan: useRenderFlags.getState().qualityPlan };
  let resized = false;
  try {
    if (wasPlaying) ui.setPlaying(false);
    await abortable(Promise.all(assets.fonts.map((font) => ensureFont(font.font, font.weight))), opts.signal);
    const media = assets.media;
    const loaded = await abortable(Promise.all(media.map(ensureMedia)), opts.signal);
    const missing = media.filter((_, i) => !loaded[i]);
    if (missing.length) throw new Error(`Missing media: ${missing.slice(0, 3).map((m) => m.name).join(", ")}. Re-add the files before exporting.`);
    await waitForAssets(opts.signal);
    useRenderFlags.getState().setQualityPlan(qualityPlan);
    if (qualityPlan.note) useUI.getState().showToast(qualityPlan.note);
    anim.exporting = true;
    useRenderFlags.getState().setExporting(true);
    resized = true;
    st.setFrameloop("never");
    st.setDpr(1);
    st.setSize(opts.width, opts.height);
    useRenderFlags.setState({ transparent: opts.transparent, transparentShadows: opts.transparentShadows ?? true });
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
      await seekVideoForTime(t, decoder, opts.signal);
      checkCancelled(opts.signal);
      // React/Canvas commits can reapply its preview configuration during a seek or shot change.
      // Capture owns the exact raster and clock; reassert them after all asynchronous work.
      const current = viewport.state ?? st;
      if (current.viewport.dpr !== 1) st.setDpr(1);
      if (current.size.width !== opts.width || current.size.height !== opts.height) {
        st.setSize(opts.width, opts.height);
        viewport.composer?.setSize(opts.width, opts.height);
      }
      if (current.frameloop !== "never") st.setFrameloop("never");
      viewport.linearCapture?.beginSample();
      st.advance(clockTime);
    };
    return await fn({ canvas: st.gl.domElement, renderAt });
  } finally {
    // Setup is covered too: a rejected font, decoder, resize or asset wait must leave the editor
    // exactly as it was before capture, including playback and an existing transparency preview.
    decoder.dispose();
    viewport.linearCapture?.cancel();
    useRenderFlags.getState().setQualityPlan(prev.qualityPlan);
    anim.exportTime = prev.exportTime;
    anim.exporting = prev.exporting;
    useRenderFlags.getState().setExporting(prev.exportQuality);
    useUI.setState({ time: prevTime });
    useRenderFlags.setState({ transparent: prev.transparent, transparentShadows: prev.transparentShadows });
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

export async function captureImage(opts: { width: number; height: number; format: ImageFormat; quality?: number; transparent: boolean; transparentShadows?: boolean; time?: number; signal?: AbortSignal }): Promise<Blob> {
  const time = opts.time ?? useUI.getState().time;
  const transparent = opts.transparent && opts.format !== "jpg";
  return withExportSession({ width: opts.width, height: opts.height, transparent, transparentShadows: opts.transparentShadows, scope: { type: "still", time }, signal: opts.signal }, async ({ canvas, renderAt }) => {
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
  transparentShadows?: boolean;
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
      let storage: ExportOutput | null = null;
      let output: Output | null = null;
      let movie: { data: Uint8Array; position: number } | null = null;
      try {
        const estimated = (estimateBitrate(opts.width, opts.height, opts.fps, quality) + (mix ? 160_000 : 0)) * totalDuration(useEditor.getState().project) / 8 * 1.25 + 4 * 1024 * 1024;
        storage = await createExportOutput(estimated, opts.signal);
        output = new Output({ format: useWebm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false, onMoov: (data, position) => { movie = { data, position }; } }), target: storage.target });
        // building the tracks belongs inside the retry: a container that refuses this codec throws
        // from addVideoTrack, and that has to step to the next candidate like any other refusal
        const source = new CanvasSource(accum, {
          codec,
          bitrate: estimateBitrate(opts.width, opts.height, opts.fps, quality),
          alpha: opts.transparent ? "keep" : "discard",
        });
        const lengthInFrames = totalDuration(useEditor.getState().project) * opts.fps;
        // A fractional final frame must keep its shorter duration. Frame-rate metadata asks the
        // muxer to round every duration to whole frames, which would extend a trimmed endpoint.
        output.addVideoTrack(source, Math.abs(lengthInFrames - Math.round(lengthInFrames)) < 1e-7 ? { frameRate: opts.fps } : {});
        let audio: Awaited<ReturnType<typeof prepareAudioTrack>> | null = null;
        if (mix) {
          const prefs: AudioCodec[] = useWebm ? ["opus", "vorbis"] : ["aac", "opus"];
          const acodec = await getFirstEncodableAudioCodec(prefs, { numberOfChannels: 2, sampleRate: mix.sampleRate });
          if (!acodec) throw new Error("This browser cannot encode the soundtrack in this video format. Choose another format.");
          if (acodec) {
            audio = await prepareAudioTrack(mix, acodec, useWebm, opts.signal);
            output.addAudioTrack(audio.source);
          }
        }
        checkCancelled(opts.signal);
        await abortable(output.start(), opts.signal);
        if (audio) await audio.write();
        await abortable(source.add(timestamp, duration), opts.signal);
        checkCancelled(opts.signal);
        // a downgrade explains a smaller file than the dialog promised, so it rides along with progress
        const note = codec === codecs[0] && quality === opts.quality ? null : `${CODEC_LABEL[codec] ?? codec.toUpperCase()} · ${QUALITY_LABEL[quality]} quality`;
        return { output, storage, source, useWebm, note, audioDelay: audio?.delay, get movie() { return movie; } };
      } catch (e) {
        lastError = e;
        try { await output?.cancel(); } catch {}
        await storage?.cleanup();
        checkCancelled(opts.signal);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("This browser could not start a video encoder");
}

export async function exportVideo(opts: VideoExportOptions): Promise<{ blob: Blob; ext: string; cleanup: () => Promise<void> }> {
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
  return withExportSession({ width: opts.width, height: opts.height, transparent: opts.transparent, transparentShadows: opts.transparentShadows, motionSamples: opts.samples, scope, signal: opts.signal }, async ({ canvas, renderAt }) => {
    const accum = document.createElement("canvas");
    accum.width = opts.width;
    accum.height = opts.height;
    const ctx = accum.getContext("2d", { alpha: opts.transparent })!;

    // Embedded clip audio and the independent music / voiceover lane
    let mix: AudioBuffer | null = null;
    if (hasAudio(project, total)) {
      opts.onProgress?.(0, "Mixing audio…");
      mix = await abortable(renderAudioMix(total, 48000, opts.signal), opts.signal);
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
        const linearCapture = viewport.linearCapture;
        if (samples > 1 && !linearCapture) throw new Error("Linear motion blur is not ready. Wait for the preview or choose one sample.");
        if (samples > 1) linearCapture!.beginFrame(samples);
        for (let k = 0; k < samples; k++) {
          checkCancelled(opts.signal);
          const sampleT = samples > 1 ? t + (k / samples) * (shutter / opts.fps) : t;
          await renderAt(exportSampleTime(sampleT, total), t);
        }
        // The final canvas already contains the linear HDR sum followed by one tone/output transform.
        ctx.drawImage(canvas, 0, 0, opts.width, opts.height);
        if (samples > 1) linearCapture!.endFrame();
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
      let blob = await enc.storage.finish(enc.useWebm ? "video/webm" : "video/mp4");
      if (!enc.useWebm && enc.audioDelay !== undefined && enc.movie) blob = correctMp4AudioTiming(blob, enc.movie, enc.audioDelay, total);
      if (!blob.size) throw new Error("Encoder produced no data");
      return { blob, ext: enc.useWebm ? "webm" : "mp4", cleanup: enc.storage.cleanup };

    } catch (e) {
      try { await enc?.output.cancel(); } catch {}
      await enc?.storage.cleanup();
      throw e;
    } finally {
      accum.width = accum.height = 1;
    }
  });
}
