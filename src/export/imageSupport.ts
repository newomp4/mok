export interface ImageExportSupport { png: boolean; jpg: boolean; webp: boolean }
let pending: Promise<ImageExportSupport> | undefined;

/** Detect actual encoding, not image decoding support. WebKit can display WebP but cannot export it. */
export function imageExportSupport(): Promise<ImageExportSupport> {
  if (typeof document === "undefined") return Promise.resolve({ png: false, jpg: false, webp: false });
  return pending ??= (async () => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const supports = (mime: string) => new Promise<boolean>((resolve) => {
      try { canvas.toBlob((blob) => resolve(blob?.type === mime), mime); } catch { resolve(false); }
    });
    const [png, jpg, webp] = await Promise.all([supports("image/png"), supports("image/jpeg"), supports("image/webp")]);
    return { png, jpg, webp };
  })();
}
