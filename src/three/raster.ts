/** Preserve aspect while bounding both axes and the total allocation, including tall canvases. */
export function rasterSize(width: number, height: number, maxEdge: number, maxPixels = 12_000_000): [number, number] {
  const w = Number.isFinite(width) ? Math.max(1, width) : 1;
  const h = Number.isFinite(height) ? Math.max(1, height) : 1;
  const edge = Number.isFinite(maxEdge) ? Math.max(1, maxEdge) : 1;
  const pixels = Number.isFinite(maxPixels) ? Math.max(1, maxPixels) : 1;
  const scale = Math.min(1, edge / Math.max(w, h), Math.sqrt(pixels / (w * h)));
  return [Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale))];
}
