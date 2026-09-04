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
 * An out-of-focus point of light: a soft disc that is brightest just inside its edge, which is how
 * a fast lens renders a highlight sitting outside the focal plane.
 */
function orb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, rim: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha * 0.58));
  g.addColorStop(0.5, rgba(color, alpha * 0.66));
  g.addColorStop(0.78, rgba(color, alpha * 0.82));
  g.addColorStop(0.91, rgba(color, alpha * rim));
  g.addColorStop(0.98, rgba(color, alpha * 0.3));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * One raking band of light: a stroke that bends twice on its way across the frame and fades out
 * before either end, so a run of them reads as folded fabric rather than as stripes.
 */
function ribbon(
  ctx: CanvasRenderingContext2D, w: number, h: number, long: number,
  angle: number, offset: number, amp: number, freq: number, phase: number,
  width: number, color: string, alpha: number,
) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  const span = long * 0.85;
  const g = ctx.createLinearGradient(-span, 0, span, 0);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.24, rgba(color, alpha));
  g.addColorStop(0.62, rgba(color, alpha * 0.75));
  g.addColorStop(1, rgba(color, 0));
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = -span + t * span * 2;
    const y = offset + Math.sin(t * freq * Math.PI * 2 + phase) * amp + Math.sin(t * freq * 0.37 * Math.PI * 2 + phase * 1.7) * amp * 0.55;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Paints a preset as a photographic wallpaper rather than a gradient: a colour field pushed far
 * out of focus, raking bands of light across it, a leak, out-of-focus highlights at two depths and
 * film grain over the lot. Every placement comes from the preset id, so the picture is the same in
 * the viewport, in a thumbnail and in an export, and every size is a fraction of the long edge, so
 * it holds together from a 132px chip to a 4K frame.
 */
function paintWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number, preset: BgPreset, blur: number) {
  const [c0, c1, c2, c3] = preset.colors;
  const long = Math.max(w, h);
  const rand = rng(seedOf(preset.id));
  const light = lightness(c0) > 0.5;
  // light presets take added light through soft-light, which lifts them without blowing out
  const add = light ? "soft-light" : "screen";
  // the background defocus setting only nudges these layers: the picture is already out of focus by
  // design, and a heavy pass would leave nothing of the bokeh that makes it a wallpaper
  const soft = (f: number) => `blur(${Math.max(1, Math.round(long * (f + blur * 0.006)))}px)`;
  // each preset draws its own balance of fabric, glare and angle, so the recipe never repeats
  const silk = 0.8 + rand() * 0.7;
  const glare = 0.7 + rand() * 0.7;
  const tilt = -1 + rand() * 1.4;

  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";

  // the ground, a wide ramp through three of the four colours so nothing reads as one flat hue
  const base = ctx.createLinearGradient(w * 0.1, 0, w * 0.9, h);
  base.addColorStop(0, mix(c0, c2, 0.45));
  base.addColorStop(0.45, c0);
  base.addColorStop(0.8, mix(c0, c1, 0.4));
  base.addColorStop(1, mix(c0, c3, light ? 0.2 : 0.12));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // far colour: masses blurred until only their hue survives, which is what everything drawn
  // afterwards sits in front of
  ctx.save();
  ctx.filter = soft(0.1);
  const masses = [c1, c3, c2, c1, c3];
  for (let i = 0; i < masses.length; i++) {
    const a = (i / masses.length) * Math.PI * 2 + rand() * 1.4;
    const dist = 0.26 + rand() * 0.36;
    const rx = long * (0.26 + rand() * 0.3);
    blob(ctx, w * (0.5 + Math.cos(a) * dist), h * (0.5 + Math.sin(a) * dist * 0.92), rx, rx * (0.6 + rand() * 0.55), rand() * Math.PI, masses[i], light ? 0.72 : 0.8);
  }
  ctx.restore();

  // a thin haze over the colour field, the aerial perspective that sets it behind the near layers
  ctx.save();
  ctx.globalAlpha = light ? 0.1 : 0.2;
  ctx.fillStyle = mix(c0, light ? c2 : c1, 0.45);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // fabric: bands raking across at a shared angle, each at its own depth and softness
  ctx.save();
  ctx.globalCompositeOperation = add;
  for (let i = 0; i < 9; i++) {
    const depth = rand();
    ctx.filter = soft(0.004 + depth * depth * 0.05);
    const color = rand() < 0.45 ? c3 : "#ffffff";
    const alpha = Math.min(0.8, (light ? 0.26 + rand() * 0.34 : 0.1 + rand() * 0.2) * silk);
    ribbon(
      ctx, w, h, long,
      tilt + (rand() - 0.5) * 0.55, (rand() - 0.5) * long * 1.05,
      long * (0.02 + rand() * 0.12), 0.4 + rand() * 1.4, rand() * Math.PI * 2,
      long * (0.005 + depth * 0.055), color, alpha,
    );
  }
  ctx.restore();

  // one broad shaft leaking in from off frame
  ctx.save();
  ctx.globalCompositeOperation = add;
  ctx.filter = soft(0.045);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(tilt + 0.65 + rand() * 0.4);
  const bw = long * (0.1 + rand() * 0.15) * glare;
  const boff = (rand() - 0.5) * long * 0.55;
  const leak = ctx.createLinearGradient(0, boff - bw, 0, boff + bw);
  leak.addColorStop(0, rgba(c3, 0));
  leak.addColorStop(0.34, rgba(c3, light ? 0.36 : 0.2));
  leak.addColorStop(0.52, `rgba(255,255,255,${light ? 0.5 : 0.26})`);
  leak.addColorStop(0.72, rgba(c3, light ? 0.3 : 0.16));
  leak.addColorStop(1, rgba(c3, 0));
  ctx.fillStyle = leak;
  ctx.fillRect(-long, boff - bw, long * 2, bw * 2);
  ctx.restore();

  // far bokeh: large, dim and soft enough to stay behind the near highlights. On a pale preset the
  // discs have to carry colour rather than light, or they disappear into the ground.
  ctx.save();
  ctx.globalCompositeOperation = light ? "source-over" : "screen";
  ctx.filter = soft(0.016);
  for (let i = 0; i < 8; i++) {
    const r = long * (0.05 + rand() * 0.13);
    const c = rand() < 0.5 ? c3 : c1;
    orb(ctx, w * (-0.05 + rand() * 1.1), h * (-0.05 + rand() * 1.1), r, c, (light ? 0.13 : 0.22) * glare, 1.1);
  }
  ctx.restore();

  // near bokeh, all but sharp so the frame has a plane in focus, then a scatter of small sparkles
  ctx.save();
  ctx.globalCompositeOperation = light ? "source-over" : "lighter";
  ctx.filter = soft(0.002);
  for (let i = 0; i < 12; i++) {
    const r = long * (0.016 + rand() * 0.055);
    const tinted = rand() < 0.55;
    const a = light ? (tinted ? 0.16 : 0.24) : (tinted ? 0.15 : 0.09);
    orb(ctx, w * (-0.05 + rand() * 1.1), h * (-0.05 + rand() * 1.1), r, tinted ? c3 : "#ffffff", a * glare, 1.25);
  }
  // the smallest highlights are clamped to a pixel or two so they stay dots on a thumbnail
  for (let i = 0; i < 10; i++) {
    const r = Math.max(1.8, long * (0.004 + rand() * 0.008));
    orb(ctx, w * rand(), h * rand(), r, "#ffffff", light ? 0.28 : 0.45, 1.4);
  }
  ctx.restore();

  // the key: a wide highlight where the light enters, which anchors all of the above
  ctx.save();
  ctx.globalCompositeOperation = light ? "soft-light" : "screen";
  const key = ctx.createRadialGradient(w * 0.32, h * 0.24, 0, w * 0.32, h * 0.24, long * 0.62);
  key.addColorStop(0, `rgba(255,255,255,${light ? 0.28 : 0.16})`);
  key.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const v = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.22, w * 0.5, h * 0.5, long * 0.76);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${light ? 0.16 : 0.42})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  grain(ctx, w, h, light ? 0.022 : 0.036, seedOf(preset.id));
}

/**
 * Paints a background preset as a layered mesh gradient: a base ramp, several rotated colour
 * sources, a raking sheen, a fine grain and a vignette. Everything is derived from the preset id,
 * so the same preset always paints the same picture at any resolution.
 */
export function paintPreset(ctx: CanvasRenderingContext2D, w: number, h: number, preset: BgPreset, blur: number) {
  if (preset.style === "wallpaper") {
    paintWallpaper(ctx, w, h, preset, blur);
    return;
  }
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
