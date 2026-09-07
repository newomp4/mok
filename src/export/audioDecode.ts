import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type { LoadedMedia } from "@/lib/media";
import { checkExportCancelled, exportAbortable } from "./abort";

export interface AudioChunks {
  chunks(start: number, end: number): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }>;
  dispose(): void;
}

/** The sink owns a bounded decoder queue and closes each AudioSample when making its PCM chunk. */
export async function openAudioChunks(media: LoadedMedia, signal?: AbortSignal): Promise<AudioChunks | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(media.blob) });
  const abort = () => input.dispose();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    checkExportCancelled(signal);
    const track = await exportAbortable(input.getPrimaryAudioTrack(), signal);
    if (!track) { input.dispose(); signal?.removeEventListener("abort", abort); return null; }
    if (!await exportAbortable(track.canDecode(), signal)) throw new Error("Browser audio decode fallback required");
    const sink = new AudioBufferSink(track);
    return {
      async *chunks(start, end) {
        const iterator = sink.buffers(start, end);
        try {
          while (true) {
            const next = await exportAbortable(iterator.next(), signal);
            if (next.done) break;
            checkExportCancelled(signal); yield next.value;
          }
        } finally { await iterator.return(); }
      },
      dispose() { signal?.removeEventListener("abort", abort); input.dispose(); },
    };
  } catch {
    signal?.removeEventListener("abort", abort); input.dispose(); checkExportCancelled(signal);
    // Native decodeAudioData supports some container/codec combinations WebCodecs cannot decode.
    // Only small sources may use its unavoidable whole-file allocation.
    if (media.blob.size > 64 * 1024 * 1024 || (media.ref.duration ?? Infinity) * 48000 * 8 * 4 > 64 * 1024 * 1024) throw new Error(`The audio in ${media.ref.name} cannot be decoded in bounded memory. Convert it to AAC, Opus or WAV first.`);
    const context = new OfflineAudioContext(2, 1, 48000);
    let buffer: AudioBuffer | null = await exportAbortable(context.decodeAudioData(await exportAbortable(media.blob.arrayBuffer(), signal)), signal);
    return { async *chunks() { checkExportCancelled(signal); if (buffer) yield { buffer, timestamp: 0 }; }, dispose() { buffer = null; } };
  }
}
