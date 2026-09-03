import type { BgPreset } from "@/lib/presets";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
}
/** Perceived lightness 0..1, used to decide whether highlights should lift or deepen. */
function lightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Deterministic per-preset noise, so a background never changes between renders or exports. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A soft elliptical colour source, rotated, with a smooth falloff. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, color: string, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.55));
  g.addColorStop(0.78, rgba(color, alpha * 0.16));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Paints a background preset as a layered mesh gradient: a base ramp, several rotated colour
 * sources, a raking sheen, a fine grain and a vignette. Everything is derived from the preset id,
 * so the same preset always paints the same picture at any resolution.
 */
export function paintPreset(ctx: CanvasRenderingContext2D, w: number, h: number, preset: BgPreset, blur: number) {
  const [c0, c1, c2, c3] = preset.colors;
  const long = Math.max(w, h);
  const rand = rng(seedOf(preset.id));
  const light = lightness(c0) > 0.5;
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";

  // base ramp, angled so the frame is never flat
  const base = ctx.createLinearGradient(0, 0, w * 0.35, h);
  base.addColorStop(0, mix(c0, c2, 0.25));
  base.addColorStop(0.55, c0);
  base.addColorStop(1, mix(c0, c1, 0.45));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  if (preset.style === "linear") {
    const g = ctx.createLinearGradient(0, h, w, 0);
    g.addColorStop(0, rgba(c2, 0.75));
    g.addColorStop(0.5, rgba(c0, 0.15));
    g.addColorStop(1, rgba(c1, 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (preset.style === "radial") {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, long * 0.8);
    g.addColorStop(0, rgba(c3, 0.95));
    g.addColorStop(0.45, rgba(c1, 0.6));
    g.addColorStop(1, rgba(c0, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    // five rotated sources placed on a loose ring, blurred together into a mesh
    const colors = [c1, c2, c3, c1, c2];
    ctx.filter = `blur(${Math.round(long * (0.035 + blur * 0.05))}px)`;
    for (let i = 0; i < colors.length; i++) {
      const a = (i / colors.length) * Math.PI * 2 + rand() * 1.2;
      const dist = 0.28 + rand() * 0.3;
      const x = w * (0.5 + Math.cos(a) * dist);
      const y = h * (0.5 + Math.sin(a) * dist * 0.9);
      const rx = long * (0.34 + rand() * 0.26);
      blob(ctx, x, y, rx, rx * (0.62 + rand() * 0.5), rand() * Math.PI, colors[i], 0.8);
    }
    ctx.filter = "none";
  }

  // raking sheen: a wide soft band across the frame, lifting light presets and deepening dark ones
  ctx.save();
  ctx.globalCompositeOperation = light ? "soft-light" : "screen";
  const sheen = ctx.createLinearGradient(0, h, w, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.42, `rgba(255,255,255,${light ? 0.5 : 0.16})`);
  sheen.addColorStop(0.62, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // a second, tighter highlight where the light would land
  ctx.save();
  ctx.globalCompositeOperation = light ? "soft-light" : "lighter";
  const hi = ctx.createRadialGradient(w * 0.3, h * 0.22, 0, w * 0.3, h * 0.22, long * 0.55);
  hi.addColorStop(0, `rgba(255,255,255,${light ? 0.45 : 0.12})`);
  hi.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // vignette, stronger on dark presets so the device separates from the frame
  const v = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.25, w * 0.5, h * 0.5, long * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${light ? 0.14 : 0.34})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // fine grain stops large flat areas from banding
  grain(ctx, w, h, light ? 0.018 : 0.03, seedOf(preset.id));
}

/** Adds a deterministic monochrome grain over the whole frame. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  if (amount <= 0) return;
  const tile = 128;
  const img = ctx.createImageData(tile, tile);
  const rand = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rand() - 0.5) * 255 * amount * 2;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + v;
    img.data[i + 3] = 255;
  }
  const c = document.createElement("canvas");
  c.width = c.height = tile;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const pat = ctx.createPattern(c, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
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
