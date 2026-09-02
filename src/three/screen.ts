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
    // GPU storage is immutable once allocated: drop it and attach a fresh Source so
    // three re-allocates at the new size (dispose alone keeps the cached source version)
    this.texture.dispose();
    this.texture.source = new THREE.Source(this.canvas);
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

  /** A tasteful fake app screen so the mockup looks finished before media is added. */
  private drawPlaceholder() {
    const { ctx, width: W, height: H } = this;
    const top = this.chromeHeight;
    const h = H - top;
    const portrait = W < h;
    const u = Math.min(W, h) / (portrait ? 24 : 40); // unit
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, top, W, h);
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, "#151518");
    g.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, h);
    const glow = ctx.createRadialGradient(W * 0.2, top + h * 0.15, 0, W * 0.2, top + h * 0.15, Math.max(W, h) * 0.6);
    glow.addColorStop(0, "rgba(242,106,46,0.22)");
    glow.addColorStop(1, "rgba(242,106,46,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, top, W, h);
    const font = (px: number, weight = 500) => `${weight} ${Math.round(px)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    const text = (s: string, x: number, y: number, px: number, color: string, weight = 500, align: CanvasTextAlign = "left") => {
      ctx.font = font(px, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(s, x, y);
    };
    const card = (x: number, y: number, w: number, hh: number, r: number, fill = "rgba(255,255,255,0.05)") => {
      ctx.fillStyle = fill; roundRect(ctx, x, y, w, hh, r); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = Math.max(1, u * 0.04); ctx.stroke();
    };
    const pad = u * 1.4;
    if (portrait) {
      // status bar
      text("9:41", pad, top + u * 1.6, u * 0.78, "#fff", 600);
      text("●●● ▲ ▮", W - pad, top + u * 1.6, u * 0.6, "#fff", 500, "right");
      // header
      text("Good morning", pad, top + u * 4.4, u * 0.75, "rgba(255,255,255,0.55)");
      text("Overview", pad, top + u * 5.9, u * 1.5, "#fff", 700);
      // hero card
      let y = top + u * 7.6;
      card(pad, y, W - pad * 2, u * 6.4, u * 0.9, "rgba(242,106,46,0.9)");
      text("Total balance", pad + u, y + u * 1.3, u * 0.7, "rgba(255,255,255,0.8)");
      text("$24,930.00", pad + u, y + u * 3.1, u * 1.7, "#fff", 700);
      text("+12.4% this month", pad + u, y + u * 5.0, u * 0.7, "rgba(255,255,255,0.85)");
      y += u * 7.6;
      // two small cards
      const cw = (W - pad * 2 - u * 0.8) / 2;
      [["Income", "$8,120"], ["Spent", "$3,460"]].forEach(([l, v], i) => {
        const x = pad + i * (cw + u * 0.8);
        card(x, y, cw, u * 4.2, u * 0.8);
        text(l, x + u * 0.8, y + u * 1.2, u * 0.68, "rgba(255,255,255,0.55)");
        text(v, x + u * 0.8, y + u * 2.9, u * 1.15, "#fff", 700);
      });
      y += u * 5.4;
      // chart card
      card(pad, y, W - pad * 2, u * 6.8, u * 0.9);
      text("Activity", pad + u * 0.8, y + u * 1.1, u * 0.75, "#fff", 600);
      const cx = pad + u * 0.8, cy = y + u * 5.8, cwid = W - pad * 2 - u * 1.6, chh = u * 3.6;
      const pts = [0.3, 0.45, 0.35, 0.6, 0.5, 0.75, 0.65, 0.9, 0.8, 0.95];
      ctx.beginPath();
      pts.forEach((p, i) => { const x = cx + (i / (pts.length - 1)) * cwid, yy = cy - p * chh; if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); });
      ctx.strokeStyle = "#f26a2e"; ctx.lineWidth = u * 0.14; ctx.lineJoin = "round"; ctx.stroke();
      ctx.lineTo(cx + cwid, cy); ctx.lineTo(cx, cy); ctx.closePath();
      const cg = ctx.createLinearGradient(0, cy - chh, 0, cy);
      cg.addColorStop(0, "rgba(242,106,46,0.35)"); cg.addColorStop(1, "rgba(242,106,46,0)");
      ctx.fillStyle = cg; ctx.fill();
      y += u * 8;
      // list rows
      text("Recent", pad, y + u * 0.3, u * 0.9, "#fff", 600);
      y += u * 1.6;
      const rows = [["Figma", "-$15.00"], ["Vercel", "-$20.00"], ["Salary", "+$4,200"], ["Apple", "-$9.99"]];
      rows.forEach(([n, v], i) => {
        const ry = y + i * u * 2.6;
        if (ry + u * 2.2 > top + h - u * 4) return;
        ctx.fillStyle = `hsl(${(i * 70 + 20) % 360} 60% 55%)`; roundRect(ctx, pad, ry, u * 1.8, u * 1.8, u * 0.5); ctx.fill();
        text(n, pad + u * 2.5, ry + u * 0.9, u * 0.8, "#fff", 600);
        text(v, W - pad, ry + u * 0.9, u * 0.8, v.startsWith("+") ? "#7ed99a" : "rgba(255,255,255,0.8)", 600, "right");
        ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(pad, ry + u * 2.3, W - pad * 2, Math.max(1, u * 0.03));
      });
      // tab bar
      ctx.fillStyle = "rgba(20,20,23,0.95)"; ctx.fillRect(0, top + h - u * 3.6, W, u * 3.6);
      ["Home", "Cards", "Stats", "Profile"].forEach((t, i) => {
        const x = (W / 4) * (i + 0.5);
        ctx.fillStyle = i === 0 ? "#f26a2e" : "rgba(255,255,255,0.35)"; roundRect(ctx, x - u * 0.5, top + h - u * 2.9, u, u, u * 0.3); ctx.fill();
        text(t, x, top + h - u * 1.1, u * 0.55, i === 0 ? "#f26a2e" : "rgba(255,255,255,0.45)", 500, "center");
      });
    } else {
      // landscape dashboard: sidebar + content
      const sb = W * 0.18;
      ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.fillRect(0, top, sb, h);
      ctx.fillStyle = "#f26a2e"; roundRect(ctx, u * 1.2, top + u * 1.2, u * 1.4, u * 1.4, u * 0.4); ctx.fill();
      text("mok", u * 3.2, top + u * 1.9, u * 0.95, "#fff", 700);
      ["Overview", "Projects", "Analytics", "Customers", "Billing", "Settings"].forEach((t, i) => {
        const yy = top + u * 4.4 + i * u * 1.9;
        if (i === 0) { ctx.fillStyle = "rgba(255,255,255,0.08)"; roundRect(ctx, u * 0.8, yy - u * 0.7, sb - u * 1.6, u * 1.4, u * 0.35); ctx.fill(); }
        ctx.fillStyle = i === 0 ? "#f26a2e" : "rgba(255,255,255,0.3)"; roundRect(ctx, u * 1.3, yy - u * 0.35, u * 0.7, u * 0.7, u * 0.2); ctx.fill();
        text(t, u * 2.6, yy, u * 0.7, i === 0 ? "#fff" : "rgba(255,255,255,0.55)");
      });
      const x0 = sb + u * 1.6;
      text("Overview", x0, top + u * 2.0, u * 1.35, "#fff", 700);
      text("Last 30 days", W - u * 1.6, top + u * 2.0, u * 0.7, "rgba(255,255,255,0.5)", 500, "right");
      const cardW = (W - x0 - u * 1.6 - u * 2) / 3;
      [["Revenue", "$128,420", "+18%"], ["Active users", "24,981", "+6.2%"], ["Conversion", "3.9%", "+0.4"]].forEach(([l, v, dlt], i) => {
        const x = x0 + i * (cardW + u);
        card(x, top + u * 3.6, cardW, u * 4.6, u * 0.6);
        text(l, x + u * 0.9, top + u * 4.8, u * 0.65, "rgba(255,255,255,0.55)");
        text(v, x + u * 0.9, top + u * 6.5, u * 1.25, "#fff", 700);
        text(dlt, x + cardW - u * 0.9, top + u * 6.5, u * 0.65, "#7ed99a", 600, "right");
      });
      const cy0 = top + u * 9.4, chH = h - u * 9.4 - u * 1.6;
      const chartW = (W - x0 - u * 1.6) * 0.64;
      card(x0, cy0, chartW, chH, u * 0.6);
      text("Revenue", x0 + u * 0.9, cy0 + u * 1.1, u * 0.75, "#fff", 600);
      const bars = 16;
      for (let i = 0; i < bars; i++) {
        const bh = (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7 + 1))) * (chH - u * 3.2);
        const bx = x0 + u * 0.9 + i * ((chartW - u * 1.8) / bars);
        ctx.fillStyle = i === bars - 2 ? "#f26a2e" : "rgba(255,255,255,0.14)";
        roundRect(ctx, bx, cy0 + chH - u * 0.9 - bh, (chartW - u * 1.8) / bars - u * 0.25, bh, u * 0.15); ctx.fill();
      }
      const lx = x0 + chartW + u;
      card(lx, cy0, W - lx - u * 1.6, chH, u * 0.6);
      text("Top customers", lx + u * 0.9, cy0 + u * 1.1, u * 0.75, "#fff", 600);
      ["Acme Inc", "Globex", "Initech", "Umbrella", "Hooli"].forEach((n, i) => {
        const yy = cy0 + u * 2.6 + i * u * 1.6;
        if (yy > cy0 + chH - u) return;
        ctx.fillStyle = `hsl(${(i * 65 + 20) % 360} 55% 55%)`; roundRect(ctx, lx + u * 0.9, yy - u * 0.5, u, u, u * 0.3); ctx.fill();
        text(n, lx + u * 2.3, yy, u * 0.65, "rgba(255,255,255,0.85)");
        text(`$${(9 - i) * 1.7}k`, W - u * 2.5, yy, u * 0.65, "rgba(255,255,255,0.5)", 500, "right");
      });
    }
    ctx.textAlign = "left";
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
