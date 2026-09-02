import type { BgPreset } from "@/lib/presets";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** Paint a soft mesh-gradient background preset. */
export function paintPreset(ctx: CanvasRenderingContext2D, w: number, h: number, preset: BgPreset, blur: number) {
  const [c0, c1, c2, c3] = preset.colors;
  ctx.filter = "none";
  ctx.fillStyle = c0;
  ctx.fillRect(0, 0, w, h);
  if (preset.style === "linear") {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, c2);
    g.addColorStop(0.55, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (preset.style === "radial") {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
    g.addColorStop(0, c3);
    g.addColorStop(0.5, c1);
    g.addColorStop(1, c0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    const blobs: [number, number, number, string][] = [
      [0.15, 0.2, 0.75, c1],
      [0.85, 0.3, 0.7, c2],
      [0.5, 0.9, 0.8, c3],
      [0.9, 0.85, 0.5, c1],
      [0.2, 0.75, 0.55, c2],
    ];
    ctx.filter = `blur(${Math.round(Math.max(w, h) * (0.06 + blur * 0.08))}px)`;
    for (const [x, y, r, c] of blobs) {
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
      g.addColorStop(0, rgba(c, 0.95));
      g.addColorStop(0.55, rgba(c, 0.45));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-w * 0.2, -h * 0.2, w * 1.4, h * 1.4);
    }
    ctx.filter = "none";
  }
  // subtle vignette to ground the device
  const v = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.3, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** Paint a user image (cover-fit) with optional blur. */
export function paintImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, w: number, h: number, blur: number) {
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  const px = Math.round(blur * Math.max(w, h) * 0.05);
  ctx.filter = px > 0 ? `blur(${px}px)` : "none";
  // draw slightly oversized so the blur does not show transparent edges
  const pad = px * 2;
  ctx.drawImage(img, (w - dw) / 2 - pad, (h - dh) / 2 - pad, dw + pad * 2, dh + pad * 2);
  ctx.filter = "none";
}
