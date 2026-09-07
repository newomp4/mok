import { AudioBufferSource, BufferTarget, EncodedAudioPacketSource, Mp4OutputFormat, NullTarget, Output, WebMOutputFormat, type AudioCodec, type EncodedPacket } from "mediabunny";
import { checkExportCancelled, exportAbortable } from "./abort";

type Packet = { packet: EncodedPacket; metadata?: EncodedAudioChunkMetadata };
const delays = new Map<string, Promise<number>>();
const MAX_ENCODED_AUDIO = 16 * 1024 * 1024;

/** Container timestamps must stop at the project endpoint, including the encoder's padded tail. */
export function trimAudioPacket(packet: EncodedPacket, delay: number, duration: number): EncodedPacket | null {
  const timestamp = packet.timestamp;
  const endpoint = duration + Math.max(0, delay);
  if (timestamp >= endpoint) return null;
  // Keep priming packets; the final MP4 edit list skips these samples without losing decoder state.
  return packet.clone({ timestamp, duration: Math.min(packet.duration, endpoint - timestamp) });
}

async function encode(buffer: AudioBuffer, codec: AudioCodec, webm: boolean, target: BufferTarget | NullTarget, collect?: Packet[], signal?: AbortSignal) {
  let bytes = 0, overflow = false;
  const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false }), target });
  const source = new AudioBufferSource({ codec, bitrate: 160_000, onEncodedPacket(packet, metadata) {
    bytes += packet.byteLength;
    if (bytes > MAX_ENCODED_AUDIO) { overflow = true; return; }
    collect?.push({ packet, metadata });
  } });
  output.addAudioTrack(source);
  try { await exportAbortable(output.start(), signal); await exportAbortable(source.add(buffer), signal); source.close(); await exportAbortable(output.finalize(), signal);
    if (overflow) throw new Error("Encoded audio exceeds its memory budget. Reduce the video duration.");
  }
  catch (error) { await output.cancel().catch(() => {}); throw error; }
}

/** WebCodecs does not expose AAC priming. Measure this browser's actual codec/container delay once
 * with a small impulse, instead of assuming a platform-specific 1024/2112-frame offset. */
async function encoderDelay(codec: AudioCodec, webm: boolean, sampleRate: number, signal?: AbortSignal): Promise<number> {
  const key = `${codec}:${webm}:${sampleRate}`;
  let pending = delays.get(key);
  if (!pending) {
    pending = (async () => {
      const impulse = 2048, length = 8192;
      const probe = new AudioBuffer({ numberOfChannels: 2, sampleRate, length });
      probe.getChannelData(0)[impulse] = probe.getChannelData(1)[impulse] = .9;
      const target = new BufferTarget(); await encode(probe, codec, webm, target);
      const context = new OfflineAudioContext(2, 1, sampleRate);
      const decoded = await context.decodeAudioData(target.buffer!);
      const pcm = decoded.getChannelData(0); let peak = 0;
      for (let i = 1; i < pcm.length; i++) if (Math.abs(pcm[i]) > Math.abs(pcm[peak])) peak = i;
      const delay = (peak - impulse) / sampleRate;
      if (Math.abs(pcm[peak]) < .05 || delay < -2 / sampleRate || delay > .15) throw new Error("This browser could not verify audio synchronization. Try another video format.");
      return delay;
    })();
    delays.set(key, pending); void pending.catch(() => delays.delete(key));
  }
  return exportAbortable(pending, signal);
}

/** Encoded audio is bounded to a few MiB; the much larger video payload remains streamed. */
export async function prepareAudioTrack(buffer: AudioBuffer, codec: AudioCodec, webm: boolean, signal?: AbortSignal) {
  checkExportCancelled(signal);
  const delay = await encoderDelay(codec, webm, buffer.sampleRate, signal), packets: Packet[] = [];
  if (webm && Math.abs(delay) > 2 / buffer.sampleRate) throw new Error("This browser could not synchronize WebM audio. Choose MP4 instead.");
  await encode(buffer, codec, webm, new NullTarget(), packets, signal);
  const source = new EncodedAudioPacketSource(codec);
  return {
    source, delay: Math.max(0, delay),
    async write() {
      try {
        for (const entry of packets) {
          checkExportCancelled(signal);
          const packet = trimAudioPacket(entry.packet, delay, buffer.duration);
          if (packet) await exportAbortable(source.add(packet, entry.metadata), signal);
        }
        source.close();
      } finally { packets.length = 0; }
    },
  };
}
