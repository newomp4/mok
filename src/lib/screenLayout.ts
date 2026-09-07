import type { FitMode, FocusArea } from "./types";

export interface ScreenBounds { width: number; height: number; chromeHeight?: number; padding?: number }
export interface ScreenRect { x: number; y: number; width: number; height: number }

/** Padding is the same number of pixels on each side, below any browser chrome. */
export function screenContentRect(screen: ScreenBounds): ScreenRect {
  const width = Math.max(1, screen.width), height = Math.max(1, screen.height);
  const top = Math.max(0, Math.min(height - 1, screen.chromeHeight ?? 0));
  const amount = Number.isFinite(screen.padding) ? Math.max(0, Math.min(0.45, screen.padding ?? 0)) : 0;
  const inset = Math.min(width, height - top) * amount;
  return { x: inset, y: top + inset, width: width - inset * 2, height: height - top - inset * 2 };
}

/** Cover keeps tall screenshot headers visible; contain is centered; stretch fills the inset. */
export function fitScreenMedia(media: { width: number; height: number }, screen: ScreenBounds, fit: FitMode): { clip: ScreenRect; draw: ScreenRect } {
  const clip = screenContentRect(screen);
  if (fit === "stretch") return { clip, draw: { ...clip } };
  const scale = (fit === "contain" ? Math.min : Math.max)(clip.width / Math.max(1, media.width), clip.height / Math.max(1, media.height));
  const width = Math.max(1, media.width) * scale, height = Math.max(1, media.height) * scale;
  return { clip, draw: { x: clip.x + (clip.width - width) / 2, y: clip.y + (fit === "contain" ? (clip.height - height) / 2 : 0), width, height } };
}

/** Shared source-to-display geometry for rendered pixels and Auto-motion focus rectangles. */
export function mapScreenFocusArea(area: FocusArea, media: { width: number; height: number }, screen: ScreenBounds, fit: FitMode): FocusArea | null {
  const { width: W, height: H } = screen, top = screen.chromeHeight ?? 0;
  if (![area.x, area.y, area.w, area.h, media.width, media.height, W, H, top].every(Number.isFinite) || area.w <= 0 || area.h <= 0 || media.width <= 0 || media.height <= 0 || W <= 0 || H <= top || top < 0) return null;
  const { clip, draw } = fitScreenMedia(media, screen, fit);
  const left = Math.max(clip.x, draw.x + Math.max(0, area.x) * draw.width);
  const right = Math.min(clip.x + clip.width, draw.x + Math.min(1, area.x + area.w) * draw.width);
  const upper = Math.max(clip.y, draw.y + Math.max(0, area.y) * draw.height);
  const lower = Math.min(clip.y + clip.height, draw.y + Math.min(1, area.y + area.h) * draw.height);
  if (right <= left || lower <= upper) return null;
  return { id: area.id, x: left / W, y: upper / H, w: (right - left) / W, h: (lower - upper) / H };
}
