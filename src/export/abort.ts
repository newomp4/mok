export function checkExportCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

/** Abandoned decoder results still need their explicit close, even after cancellation returned. */
export function exportAbortable<T>(promise: Promise<T>, signal?: AbortSignal, discard?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const abort = () => { abandoned = true; signal.removeEventListener("abort", abort); reject(new DOMException("Export cancelled", "AbortError")); };
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      if (abandoned) discard?.(value); else resolve(value);
    }, (error) => { signal.removeEventListener("abort", abort); if (!abandoned) reject(error); });
  });
}
