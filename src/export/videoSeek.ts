import { checkExportCancelled } from "./abort";

function readyAt(video: HTMLVideoElement, target: number) {
  return !video.error && !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) < 1e-5;
}

/** A rejected seek is not a completed frame, even if an earlier frame is still available. */
function seekAttempt(video: HTMLVideoElement, target: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (ok: boolean) => { cleanup(); resolve(ok); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    // A nonseekable/truncated source can report seeked after clamping back to an old position.
    // Allow millisecond timestamp rounding without accepting a different source frame.
    const onSeeked = () => finish(!video.error && !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) < .0021);
    const onError = () => fail(new Error("The video could not decode the requested frame. Re-add or convert the source file."));
    const onAbort = () => fail(new DOMException("Export cancelled", "AbortError"));
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => finish(readyAt(video, target)), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    if (video.error) { onError(); return; }
    try { video.currentTime = target; }
    catch { fail(new Error("The video could not seek to the requested frame. Re-add or convert the source file.")); }
  });
}

/** DOM fallback for codecs unsupported by timestamp decoding; bounded waits and complete cleanup. */
export async function seekVideoElement(video: HTMLVideoElement, target: number, signal?: AbortSignal, timeoutMs = 1500): Promise<void> {
  checkExportCancelled(signal);
  if (!Number.isFinite(target) || target < 0) throw new Error("The video has an invalid source timestamp");
  if (readyAt(video, target)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await seekAttempt(video, target, timeoutMs, signal)) return;
    checkExportCancelled(signal);
  }
  throw new Error("A video shot took too long to seek. Try exporting again.");
}
