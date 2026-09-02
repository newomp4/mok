import * as THREE from "three";
import type { LoadedMedia } from "@/lib/media";
import type { FitMode } from "@/lib/types";

export interface ScreenChrome {
  kind: "none" | "browser";
  dark?: boolean;
}

/**
 * Manages the canvas that is painted onto a device screen. Images are drawn
 * once; videos are re-drawn per frame. Keeps the texture at the device's native
 * resolution (capped) for crisp results at any camera distance.
 */
export class ScreenSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  width = 1206;
  height = 2622;
  media: LoadedMedia | null = null;
  fit: FitMode = "cover";
  chrome: ScreenChrome = { kind: "none" };
  private lastVideoTime = -1;
  private placeholderKey = "";

  constructor(maxAniso = 16) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = maxAniso;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.flipY = true;
  }

  setSize(w: number, h: number) {
    const max = 2560;
    const scale = Math.min(1, max / Math.max(w, h));
    const nw = Math.round(w * scale), nh = Math.round(h * scale);
    if (nw === this.width && nh === this.height) return;
    this.width = nw; this.height = nh;
    this.canvas.width = nw; this.canvas.height = nh;
    // GPU storage is immutable once allocated: drop it so three re-allocates at the new size
    this.texture.dispose();
    this.placeholderKey = "";
    this.draw(true);
  }

  setMedia(m: LoadedMedia | null, fit: FitMode, chrome: ScreenChrome) {
    const changed = m !== this.media || fit !== this.fit || chrome.kind !== this.chrome.kind || chrome.dark !== this.chrome.dark;
    this.media = m; this.fit = fit; this.chrome = chrome;
    this.lastVideoTime = -1;
    if (changed) this.draw(true);
  }

  get chromeHeight(): number {
    if (this.chrome.kind !== "browser") return 0;
    return Math.round(this.width * 0.045);
  }

  /** Draw the current source. Returns true if the texture changed. */
  draw(force = false): boolean {
    const { ctx, width, height } = this;
    const m = this.media;
    if (!m) {
      const key = `${width}x${height}:${this.chrome.kind}`;
      if (!force && key === this.placeholderKey) return false;
      this.placeholderKey = key;
      this.drawPlaceholder();
      this.drawChrome();
      this.texture.needsUpdate = true;
      return true;
    }
    const el = m.element;
    if (m.kind === "video") {
      const v = el as HTMLVideoElement;
      if (!force && v.currentTime === this.lastVideoTime) return false;
      this.lastVideoTime = v.currentTime;
    }
    const top = this.chromeHeight;
    const areaH = height - top;
    const mw = m.width, mh = m.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, top, width, areaH);
    let dw = width, dh = areaH, dx = 0, dy = top;
    if (this.fit === "cover") {
      const s = Math.max(width / mw, areaH / mh);
      dw = mw * s; dh = mh * s; dx = (width - dw) / 2; dy = top;
      // top-align tall content (screenshots) so headers stay visible
      if (dh > areaH) dy = top;
    } else if (this.fit === "contain") {
      const s = Math.min(width / mw, areaH / mh);
      dw = mw * s; dh = mh * s; dx = (width - dw) / 2; dy = top + (areaH - dh) / 2;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width, areaH);
    ctx.clip();
    ctx.drawImage(el, dx, dy, dw, dh);
    ctx.restore();
    this.drawChrome();
    this.texture.needsUpdate = true;
    return true;
  }

  private drawChrome() {
    if (this.chrome.kind !== "browser") return;
    const { ctx, width } = this;
    const h = this.chromeHeight;
    const dark = !!this.chrome.dark;
    ctx.fillStyle = dark ? "#1f1f22" : "#f3f3f4";
    ctx.fillRect(0, 0, width, h);
    ctx.fillStyle = dark ? "#2b2b2f" : "#e4e4e6";
    ctx.fillRect(0, h - 1, width, 1);
    const r = h * 0.17;
    const colors = ["#ff5f57", "#febc2e", "#28c840"];
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(h * 0.55 + i * r * 2.6, h / 2, r, 0, Math.PI * 2);
      ctx.fill();
    });
    // url pill
    const pw = width * 0.44, ph = h * 0.56;
    const px = (width - pw) / 2, py = (h - ph) / 2;
    ctx.fillStyle = dark ? "#303035" : "#ffffff";
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = dark ? "#8a8a8f" : "#a8a8ad";
    ctx.font = `${Math.round(ph * 0.42)}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("mok.app", width / 2, h / 2 + 1);
    ctx.textAlign = "left";
  }

  private drawPlaceholder() {
    const { ctx, width, height } = this;
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, "#161618");
    g.addColorStop(1, "#0a0a0b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    // subtle glow
    const rg = ctx.createRadialGradient(width * 0.5, height * 0.35, 0, width * 0.5, height * 0.35, Math.max(width, height) * 0.7);
    rg.addColorStop(0, "rgba(242,106,46,0.35)");
    rg.addColorStop(0.5, "rgba(242,106,46,0.06)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, width, height);
    // faux UI blocks
    const u = Math.min(width, height) / 20;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    const top = this.chromeHeight + u * 1.6;
    roundRect(ctx, u, top, width - 2 * u, u * 3, u * 0.5); ctx.fill();
    for (let i = 0; i < 3; i++) {
      roundRect(ctx, u, top + u * 3.8 + i * u * 2.4, width - 2 * u, u * 1.8, u * 0.4); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `600 ${Math.round(u * 1.1)}px ui-sans-serif, system-ui`;
    ctx.textBaseline = "middle";
    ctx.fillText("Drop a screenshot", u * 1.8, top + u * 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = `${Math.round(u * 0.8)}px ui-sans-serif, system-ui`;
    ctx.fillText("or paste · click to upload", u * 1.8, top + u * 3.8 + u * 0.9);
  }

  dispose() {
    this.texture.dispose();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
