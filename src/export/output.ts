import { StreamTarget, type StreamTargetChunk } from "mediabunny";
import { checkExportCancelled } from "@/export/abort";

export const MEMORY_OUTPUT_LIMIT = 128 * 1024 * 1024;
export const STREAM_OUTPUT_LIMIT = 4 * 1024 * 1024 * 1024;
const PAGE = 1024 * 1024;

/** Seek-positioned writes without repeatedly copying an ever-growing contiguous ArrayBuffer. */
export class MemoryOutputFile {
  private pages = new Map<number, Uint8Array<ArrayBuffer>>();
  size = 0;
  constructor(readonly limit = MEMORY_OUTPUT_LIMIT) {}
  write(data: Uint8Array, position: number) {
    const end = position + data.byteLength;
    if (!Number.isSafeInteger(position) || position < 0 || end > this.limit) throw new Error("The video exceeds this browser's in-memory export limit. Use a browser with local export storage, or lower the duration, size or quality.");
    for (let offset = 0; offset < data.length;) {
      const at = position + offset, index = Math.floor(at / PAGE), within = at % PAGE;
      let page = this.pages.get(index);
      if (!page) { page = new Uint8Array(PAGE); this.pages.set(index, page); }
      const count = Math.min(data.length - offset, PAGE - within);
      page.set(data.subarray(offset, offset + count), within); offset += count;
    }
    this.size = Math.max(this.size, end);
  }
  blob(type: string) {
    const parts: BlobPart[] = [];
    for (let start = 0; start < this.size; start += PAGE) parts.push((this.pages.get(start / PAGE) ?? new Uint8Array(PAGE)).subarray(0, Math.min(PAGE, this.size - start)));
    return new Blob(parts, { type });
  }
  clear() { this.pages.clear(); this.size = 0; }
}

export interface ExportOutput {
  target: StreamTarget;
  streamed: boolean;
  finish(type: string): Promise<Blob>;
  /** Call after a successful download has released its Blob URL, or immediately after failure. */
  cleanup(): Promise<void>;
}

/** OPFS keeps the encoded payload out of JS RAM; the fallback has a hard byte ceiling. */
export async function createExportOutput(estimatedBytes: number, signal?: AbortSignal): Promise<ExportOutput> {
  checkExportCancelled(signal);
  if (!Number.isFinite(estimatedBytes) || estimatedBytes < 0 || estimatedBytes > STREAM_OUTPUT_LIMIT) throw new Error("This export exceeds the 4 GiB output budget. Lower the duration, size or quality.");
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (storage?.getDirectory) {
    let directory: FileSystemDirectoryHandle | null = null;
    let name = "";
    let writable: FileSystemWritableFileStream | null = null;
    try {
      const quota = await storage.estimate().catch(() => ({} as StorageEstimate));
      const available = quota.quota === undefined ? STREAM_OUTPUT_LIMIT : Math.max(0, quota.quota - (quota.usage ?? 0));
      const limit = Math.min(STREAM_OUTPUT_LIMIT, available * 0.8);
      if (estimatedBytes > limit) throw new Error("This video needs more temporary storage than is available. Lower its duration, size or quality, or free browser storage.");
      directory = await (await storage.getDirectory()).getDirectoryHandle("mok-export-temp", { create: true });
      // A tab/browser crash can bypass finally. Reap only our abandoned day-old temporary files.
      for await (const [oldName] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
        const created = /^export-(\d+)-[a-f0-9-]+\.tmp$/.exec(oldName)?.[1];
        if (created && Date.now() - Number(created) > 24 * 60 * 60 * 1000) await directory.removeEntry(oldName).catch(() => {});
      }
      name = `export-${Date.now()}-${crypto.randomUUID()}.tmp`;
      const handle = await directory.getFileHandle(name, { create: true });
      writable = await handle.createWritable();
      checkExportCancelled(signal);
      const file = writable, dir = directory;
      let closed = false, cleaned = false;
      const target = new StreamTarget(new WritableStream<StreamTargetChunk>({
        async write(chunk) {
          checkExportCancelled(signal);
          if (chunk.position + chunk.data.byteLength > limit) throw new Error("The encoded video filled its temporary storage budget. Lower export duration or quality.");
          // MP4/WebM may revisit headers. Do not concatenate chunks or discard their positions.
          await file.write({ type: "write", position: chunk.position, data: chunk.data as Uint8Array<ArrayBuffer> });
        },
        async close() { if (!closed) { await file.close(); closed = true; } },
        async abort() { if (!closed) { closed = true; await file.abort().catch(() => {}); } },
      }), { chunked: true, chunkSize: PAGE });
      return {
        target, streamed: true,
        async finish(type) {
          checkExportCancelled(signal);
          if (!closed) throw new Error("Export output has not finished writing");
          const result = await handle.getFile();
          // File.slice preserves a disk-backed Blob; cleanup belongs to the download owner.
          return result.slice(0, result.size, type);
        },
        async cleanup() {
          if (cleaned) return; cleaned = true;
          if (!closed) { closed = true; await file.abort().catch(() => {}); }
          await dir.removeEntry(name).catch(() => {});
        },
      };
    } catch (error) {
      await writable?.abort().catch(() => {});
      if (directory && name) await directory.removeEntry(name).catch(() => {});
      checkExportCancelled(signal);
      if (estimatedBytes > MEMORY_OUTPUT_LIMIT) throw error instanceof Error ? error : new Error("Temporary export storage is unavailable");
    }
  }
  if (!Number.isFinite(estimatedBytes) || estimatedBytes < 0 || estimatedBytes > MEMORY_OUTPUT_LIMIT) throw new Error("This browser cannot stream large exports to temporary storage. Lower the duration, size or quality to keep this video below 128 MiB.");
  const memory = new MemoryOutputFile();
  const target = new StreamTarget(new WritableStream<StreamTargetChunk>({
    write(chunk) { checkExportCancelled(signal); memory.write(chunk.data, chunk.position); },
    abort() { memory.clear(); },
  }), { chunked: true, chunkSize: PAGE });
  return { target, streamed: false, async finish(type) { checkExportCancelled(signal); const blob = memory.blob(type); memory.clear(); return blob; }, async cleanup() { memory.clear(); } };
}
