import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from "mediabunny";
import type { LoadedMedia } from "@/lib/media";
import { clearVideoFrame, publishVideoFrame } from "@/lib/videoFrames";
import { rasterSize } from "@/three/raster";
import { checkExportCancelled, exportAbortable } from "@/export/abort";

export interface DecodedSource {
  firstTimestamp: number;
  getSample(time: number): Promise<VideoSample | null>;
  dispose(): void;
}

export async function openVideoSource(media: LoadedMedia, signal?: AbortSignal): Promise<DecodedSource> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(media.blob) });
  const abort = () => input.dispose();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    checkExportCancelled(signal);
    const track = await exportAbortable(input.getPrimaryVideoTrack(), signal);
    if (!track || !await exportAbortable(track.canDecode(), signal)) throw new Error("This source needs the browser video decoder");
    const firstTimestamp = await exportAbortable(track.getFirstTimestamp(), signal);
    const sink = new VideoSampleSink(track);
    return { firstTimestamp, getSample: (time) => sink.getSample(time), dispose: () => input.dispose() };
  } catch (error) { input.dispose(); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
}

/** One input, one raster, one decoded sample at a time; no whole-source frame cache. */
export class ExportVideoDecoder {
  private source: DecodedSource | null = null;
  private media: LoadedMedia | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frameStart = -Infinity;
  private frameEnd = -Infinity;
  private fallback = new WeakSet<LoadedMedia>();
  constructor(private options: {
    open?: typeof openVideoSource;
    canvas?: () => HTMLCanvasElement;
    onFallback?: (name: string) => void;
    timeoutMs?: number;
  } = {}) {}

  async prepare(media: LoadedMedia, time: number, signal?: AbortSignal): Promise<boolean> {
    checkExportCancelled(signal);
    if (this.media !== media) { this.release(); this.media = media; }
    if (this.fallback.has(media)) return false;
    const deadline = new AbortController(), abort = () => deadline.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.options.timeoutMs ?? 15_000);
    const operationSignal = deadline.signal;
    try {
      if (!this.source) this.source = await exportAbortable((this.options.open ?? openVideoSource)(media, operationSignal), operationSignal, (source) => source.dispose());
      // A late first packet may legitimately leave a brief initial gap. Showing its first frame
      // matches the browser's initial poster, while all later requests use original presentation time.
      const target = Math.max(time, this.source.firstTimestamp, 0);
      if (target >= this.frameStart && target < this.frameEnd) return true;
      const sample = await exportAbortable(this.source.getSample(target), operationSignal, (late) => late?.close());
      if (!sample) throw new Error("No decoded frame at this source timestamp");
      try {
        checkExportCancelled(signal);
        const [width, height] = rasterSize(sample.displayWidth, sample.displayHeight, 4096, 12_000_000);
        const canvas = this.canvas ??= (this.options.canvas ?? (() => document.createElement("canvas")))();
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Could not create a source-frame canvas");
        ctx.clearRect(0, 0, width, height);
        // VideoSample.draw applies the track's rotation and pixel aspect ratio exactly once.
        sample.draw(ctx, 0, 0, width, height);
        publishVideoFrame(media.ref.id, canvas, sample.displayWidth, sample.displayHeight);
        this.frameStart = sample.timestamp;
        this.frameEnd = sample.timestamp + Math.max(0, sample.duration);
      } finally { sample.close(); }
      return true;
    } catch {
      this.release();
      checkExportCancelled(signal);
      // Unsupported codecs retain the proven DOM-seek path; the caller makes this downgrade visible.
      this.fallback.add(media);
      this.options.onFallback?.(media.ref.name);
      return false;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }

  clear() { clearVideoFrame(); this.frameStart = this.frameEnd = -Infinity; }
  private release() {
    clearVideoFrame(); this.source?.dispose(); this.source = null;
    this.frameStart = this.frameEnd = -Infinity;
  }
  dispose() {
    this.release(); this.media = null;
    if (this.canvas) { this.canvas.width = this.canvas.height = 1; this.canvas = null; }
  }
}
