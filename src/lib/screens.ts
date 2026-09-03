"use client";

/**
 * Built-in sample screens. Each one is drawn procedurally at any resolution, so a mockup looks
 * finished before you upload anything and the starter templates ship with real-looking content.
 */
export type ScreenShape = "portrait" | "landscape";

export interface SampleScreen {
  id: string;
  name: string;
  shape: ScreenShape;
  dark: boolean;
  /** dominant colour, used for the picker chip */
  tint: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/* ---------- drawing helpers ---------- */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

const SANS = 'ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';

interface Pen {
  ctx: CanvasRenderingContext2D;
  u: number;
  text: (s: string, x: number, y: number, size: number, color: string, weight?: number, align?: CanvasTextAlign) => void;
  /** draw at the largest size that still fits maxW */
  fitText: (s: string, x: number, y: number, size: number, maxW: number, color: string, weight?: number, align?: CanvasTextAlign) => number;
  card: (x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) => void;
  fill: (x: number, y: number, w: number, h: number, color: string) => void;
}

function pen(ctx: CanvasRenderingContext2D, u: number): Pen {
  return {
    ctx,
    u,
    text(s, x, y, size, color, weight = 500, align = "left") {
      ctx.font = `${weight} ${Math.round(size)}px ${SANS}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillText(s, x, y);
      ctx.textAlign = "left";
    },
    fitText(str, x, y, size, maxW, color, weight = 700, align = "left") {
      let px = size;
      for (let i = 0; i < 24; i++) {
        ctx.font = `${weight} ${Math.round(px)}px ${SANS}`;
        if (ctx.measureText(str).width <= maxW || px < 6) break;
        px *= 0.94;
      }
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillText(str, x, y);
      ctx.textAlign = "left";
      return px;
    },
    card(x, y, w, h, r, fill, stroke) {
      ctx.fillStyle = fill;
      rr(ctx, x, y, w, h, r);
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, u * 0.035); ctx.stroke(); }
    },
    fill(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); },
  };
}

/** Smooth line chart through the given 0..1 samples. */
function chart(ctx: CanvasRenderingContext2D, pts: number[], x: number, y: number, w: number, h: number, color: string, fillTo?: string, lw = 3) {
  const px = (i: number) => x + (i / (pts.length - 1)) * w;
  const py = (v: number) => y + h - v * h;
  ctx.beginPath();
  ctx.moveTo(px(0), py(pts[0]));
  for (let i = 1; i < pts.length; i++) {
    const cx = (px(i - 1) + px(i)) / 2;
    ctx.bezierCurveTo(cx, py(pts[i - 1]), cx, py(pts[i]), px(i), py(pts[i]));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  if (fillTo) {
    ctx.lineTo(px(pts.length - 1), y + h);
    ctx.lineTo(px(0), y + h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, fillTo);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fill();
  }
}

function bars(ctx: CanvasRenderingContext2D, vals: number[], x: number, y: number, w: number, h: number, color: string, accent: string, hot = -1) {
  const gap = w / vals.length * 0.32;
  const bw = (w - gap * (vals.length - 1)) / vals.length;
  vals.forEach((v, i) => {
    const bh = Math.max(h * 0.06, v * h);
    ctx.fillStyle = i === hot ? accent : color;
    rr(ctx, x + i * (bw + gap), y + h - bh, bw, bh, bw * 0.3);
    ctx.fill();
  });
}

function statusBar(p: Pen, w: number, h: number, ink: string) {
  const y = h * 0.028;
  p.text("9:41", w * 0.09, y, w * 0.038, ink, 600);
  const { ctx } = p;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 4; i++) {
    const bh = w * (0.006 + i * 0.0032);
    rr(ctx, w * 0.79 + i * w * 0.008, y + w * 0.008 - bh, w * 0.0035, bh, w * 0.001);
    ctx.fill();
  }
  rr(ctx, w * 0.845, y - w * 0.008, w * 0.034, w * 0.016, w * 0.005);
  ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 0.9;
  rr(ctx, w * 0.847, y - w * 0.006, w * 0.026, w * 0.012, w * 0.004);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function homeIndicator(p: Pen, w: number, h: number, ink: string) {
  p.ctx.globalAlpha = 0.35;
  p.card(w * 0.33, h - h * 0.014, w * 0.34, h * 0.005, h * 0.003, ink);
  p.ctx.globalAlpha = 1;
}

function tabBar(p: Pen, w: number, h: number, labels: string[], bg: string, ink: string, accent: string) {
  const barH = h * 0.085;
  p.fill(0, h - barH, w, barH, bg);
  labels.forEach((t, i) => {
    const x = (w / labels.length) * (i + 0.5);
    const on = i === 0;
    p.ctx.fillStyle = on ? accent : ink;
    p.ctx.globalAlpha = on ? 1 : 0.35;
    rr(p.ctx, x - w * 0.026, h - barH + h * 0.016, w * 0.052, w * 0.052, w * 0.016);
    p.ctx.fill();
    p.ctx.globalAlpha = 1;
    p.text(t, x, h - barH + h * 0.062, w * 0.027, on ? accent : ink + "80", 500, "center");
  });
  homeIndicator(p, w, h, ink);
}

/* ---------- the screens ---------- */
export const SAMPLE_SCREENS: SampleScreen[] = [
  {
    id: "finance-dark", name: "Finance", shape: "portrait", dark: true, tint: "#f26a2e",
    draw(ctx, w, h) {
      const p = pen(ctx, w / 24);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#16161a"); bg.addColorStop(1, "#0a0a0c");
      p.fill(0, 0, w, h, "#0b0b0d");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w * 0.2, h * 0.12, 0, w * 0.2, h * 0.12, Math.max(w, h) * 0.55);
      glow.addColorStop(0, "rgba(242,106,46,0.20)"); glow.addColorStop(1, "rgba(242,106,46,0)");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      statusBar(p, w, h, "#ffffff");
      const pad = w * 0.075;
      p.text("Good morning", pad, h * 0.095, w * 0.037, "rgba(255,255,255,0.5)");
      p.text("Overview", pad, h * 0.135, w * 0.075, "#ffffff", 700);
      p.card(pad, h * 0.175, w - pad * 2, h * 0.135, w * 0.05, "#f26a2e");
      p.text("Total balance", pad + w * 0.055, h * 0.212, w * 0.034, "rgba(255,255,255,0.85)");
      p.text("$24,930.00", pad + w * 0.055, h * 0.255, w * 0.082, "#ffffff", 700);
      p.text("+12.4% this month", pad + w * 0.055, h * 0.293, w * 0.032, "rgba(255,255,255,0.9)");
      const cw = (w - pad * 2 - w * 0.04) / 2;
      [["Income", "$8,120"], ["Spent", "$3,460"]].forEach(([l, v], i) => {
        const x = pad + i * (cw + w * 0.04);
        p.card(x, h * 0.325, cw, h * 0.085, w * 0.04, "rgba(255,255,255,0.055)", "rgba(255,255,255,0.07)");
        p.text(l, x + w * 0.04, h * 0.35, w * 0.032, "rgba(255,255,255,0.5)");
        p.text(v, x + w * 0.04, h * 0.385, w * 0.055, "#ffffff", 700);
      });
      p.card(pad, h * 0.425, w - pad * 2, h * 0.145, w * 0.045, "rgba(255,255,255,0.05)", "rgba(255,255,255,0.07)");
      p.text("Activity", pad + w * 0.045, h * 0.45, w * 0.036, "#ffffff", 600);
      chart(ctx, [0.25, 0.4, 0.32, 0.55, 0.45, 0.7, 0.6, 0.85, 0.78, 0.95], pad + w * 0.045, h * 0.475, w - pad * 2 - w * 0.09, h * 0.075, "#f26a2e", "rgba(242,106,46,0.35)", w * 0.011);
      p.text("Recent", pad, h * 0.605, w * 0.042, "#ffffff", 600);
      const rows: [string, string, string][] = [["Figma", "-$15.00", "#f26a2e"], ["Vercel", "-$20.00", "#7ed99a"], ["Salary", "+$4,200", "#4f9ef8"], ["Apple", "-$9.99", "#b98cf0"]];
      rows.forEach(([n, v, c], i) => {
        const y = h * 0.645 + i * h * 0.062;
        p.card(pad, y, w * 0.085, w * 0.085, w * 0.026, c);
        p.text(n, pad + w * 0.115, y + w * 0.042, w * 0.036, "#ffffff", 600);
        p.text(v, w - pad, y + w * 0.042, w * 0.036, v.startsWith("+") ? "#7ed99a" : "rgba(255,255,255,0.75)", 600, "right");
      });
      tabBar(p, w, h, ["Home", "Cards", "Stats", "Profile"], "rgba(16,16,19,0.96)", "#ffffff", "#f26a2e");
    },
  },
  {
    id: "finance-light", name: "Finance light", shape: "portrait", dark: false, tint: "#1f6feb",
    draw(ctx, w, h) {
      const p = pen(ctx, w / 24);
      p.fill(0, 0, w, h, "#f6f7f9");
      statusBar(p, w, h, "#111111");
      const pad = w * 0.075;
      p.text("Portfolio", pad, h * 0.105, w * 0.072, "#0d0d0f", 700);
      p.text("Updated just now", pad, h * 0.142, w * 0.033, "rgba(0,0,0,0.45)");
      p.card(pad, h * 0.175, w - pad * 2, h * 0.19, w * 0.05, "#ffffff", "rgba(0,0,0,0.06)");
      p.text("$128,420.55", pad + w * 0.05, h * 0.215, w * 0.078, "#0d0d0f", 700);
      p.text("+ $2,104 (1.7%) today", pad + w * 0.05, h * 0.25, w * 0.033, "#12a150", 600);
      chart(ctx, [0.3, 0.42, 0.36, 0.52, 0.48, 0.66, 0.58, 0.8, 0.74, 0.92], pad + w * 0.05, h * 0.275, w - pad * 2 - w * 0.1, h * 0.075, "#1f6feb", "rgba(31,111,235,0.18)", w * 0.01);
      ["1D", "1W", "1M", "1Y", "All"].forEach((t, i) => {
        const bw = (w - pad * 2) / 5;
        const on = i === 2;
        if (on) { p.card(pad + i * bw + w * 0.01, h * 0.385, bw - w * 0.02, h * 0.032, h * 0.016, "#0d0d0f"); }
        p.text(t, pad + i * bw + bw / 2, h * 0.401, w * 0.03, on ? "#ffffff" : "rgba(0,0,0,0.5)", 600, "center");
      });
      p.text("Holdings", pad, h * 0.45, w * 0.042, "#0d0d0f", 600);
      const rows: [string, string, string, string][] = [["AAPL", "Apple Inc.", "+2.4%", "#111111"], ["NVDA", "NVIDIA", "+5.1%", "#76b900"], ["TSLA", "Tesla", "-1.2%", "#e82127"], ["MSFT", "Microsoft", "+0.8%", "#0078d4"]];
      rows.forEach(([sym, name, ch, c], i) => {
        const y = h * 0.485 + i * h * 0.075;
        p.card(pad, y, w - pad * 2, h * 0.062, w * 0.035, "#ffffff", "rgba(0,0,0,0.05)");
        p.card(pad + w * 0.03, y + h * 0.012, w * 0.08, w * 0.08, w * 0.026, c);
        p.text(sym, pad + w * 0.135, y + h * 0.022, w * 0.036, "#0d0d0f", 700);
        p.text(name, pad + w * 0.135, y + h * 0.043, w * 0.03, "rgba(0,0,0,0.45)");
        p.text(ch, w - pad - w * 0.04, y + h * 0.031, w * 0.036, ch.startsWith("+") ? "#12a150" : "#e5484d", 600, "right");
      });
      tabBar(p, w, h, ["Home", "Markets", "Trade", "You"], "rgba(255,255,255,0.97)", "#111111", "#1f6feb");
    },
  },
  {
    id: "music", name: "Music", shape: "portrait", dark: true, tint: "#8b5cf6",
    draw(ctx, w, h) {
      const p = pen(ctx, w / 24);
      p.fill(0, 0, w, h, "#0d0b14");
      const g = ctx.createLinearGradient(0, 0, w, h * 0.6);
      g.addColorStop(0, "rgba(139,92,246,0.55)"); g.addColorStop(1, "rgba(13,11,20,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.65);
      statusBar(p, w, h, "#ffffff");
      const pad = w * 0.09;
      p.text("Now playing", w / 2, h * 0.09, w * 0.033, "rgba(255,255,255,0.6)", 500, "center");
      const art = w - pad * 2;
      const ag = ctx.createLinearGradient(pad, h * 0.13, pad + art, h * 0.13 + art);
      ag.addColorStop(0, "#8b5cf6"); ag.addColorStop(0.5, "#ec4899"); ag.addColorStop(1, "#f59e0b");
      p.card(pad, h * 0.13, art, art, w * 0.06, "#000");
      ctx.save(); rr(ctx, pad, h * 0.13, art, art, w * 0.06); ctx.clip();
      ctx.fillStyle = ag; ctx.fillRect(pad, h * 0.13, art, art);
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(pad + art * 0.5, h * 0.13 + art * 0.5, art * (0.12 + i * 0.09), 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = w * 0.006; ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.restore();
      const ty = h * 0.13 + art + h * 0.05;
      p.text("Midnight Drive", pad, ty, w * 0.062, "#ffffff", 700);
      p.text("Neon Fields", pad, ty + h * 0.035, w * 0.036, "rgba(255,255,255,0.55)");
      const barY = ty + h * 0.08;
      p.card(pad, barY, w - pad * 2, h * 0.005, h * 0.003, "rgba(255,255,255,0.2)");
      p.card(pad, barY, (w - pad * 2) * 0.42, h * 0.005, h * 0.003, "#ffffff");
      ctx.beginPath(); ctx.arc(pad + (w - pad * 2) * 0.42, barY + h * 0.0025, w * 0.012, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
      p.text("1:47", pad, barY + h * 0.028, w * 0.028, "rgba(255,255,255,0.5)");
      p.text("-2:31", w - pad, barY + h * 0.028, w * 0.028, "rgba(255,255,255,0.5)", 500, "right");
      // transport
      const cy = barY + h * 0.09;
      ctx.fillStyle = "#ffffff";
      const tri = (x: number, s: number, dir: number) => { ctx.beginPath(); ctx.moveTo(x - s * dir, cy - s); ctx.lineTo(x - s * dir, cy + s); ctx.lineTo(x + s * dir, cy); ctx.closePath(); ctx.fill(); };
      tri(w * 0.28, w * 0.032, -1); tri(w * 0.245, w * 0.032, -1);
      ctx.beginPath(); ctx.arc(w / 2, cy, w * 0.085, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0d0b14"; rr(ctx, w / 2 - w * 0.026, cy - w * 0.03, w * 0.018, w * 0.06, w * 0.006); ctx.fill();
      rr(ctx, w / 2 + w * 0.008, cy - w * 0.03, w * 0.018, w * 0.06, w * 0.006); ctx.fill();
      ctx.fillStyle = "#ffffff"; tri(w * 0.72, w * 0.032, 1); tri(w * 0.755, w * 0.032, 1);
      homeIndicator(p, w, h, "#ffffff");
    },
  },
  {
    id: "chat", name: "Messages", shape: "portrait", dark: false, tint: "#25d366",
    draw(ctx, w, h) {
      const p = pen(ctx, w / 24);
      p.fill(0, 0, w, h, "#ffffff");
      statusBar(p, w, h, "#111111");
      p.fill(0, h * 0.055, w, h * 0.07, "#f7f7f8");
      p.card(w * 0.075, h * 0.068, w * 0.09, w * 0.09, w * 0.045, "#25d366");
      p.text("Design team", w * 0.19, h * 0.088, w * 0.042, "#0d0d0f", 700);
      p.text("4 members · online", w * 0.19, h * 0.112, w * 0.028, "rgba(0,0,0,0.45)");
      const msgs: [string, boolean][] = [
        ["Shipped the new mockup editor 🎉", false],
        ["The 3D device looks unreal", true],
        ["Try the lens blur on the corner shot", false],
        ["Exporting a 4K clip now", true],
        ["Perfect. Ship it.", false],
      ];
      let y = h * 0.17;
      msgs.forEach(([m, mine]) => {
        ctx.font = `500 ${Math.round(w * 0.036)}px ${SANS}`;
        const tw = Math.min(ctx.measureText(m).width + w * 0.09, w * 0.72);
        const bh = h * 0.055 + (tw >= w * 0.72 ? h * 0.03 : 0);
        const x = mine ? w - w * 0.06 - tw : w * 0.06;
        p.card(x, y, tw, bh, w * 0.045, mine ? "#25d366" : "#f0f0f2");
        const lines = tw >= w * 0.72 ? [m.slice(0, Math.ceil(m.length / 2)), m.slice(Math.ceil(m.length / 2))] : [m];
        lines.forEach((ln, li) => p.text(ln.trim(), x + w * 0.045, y + bh / 2 + (li - (lines.length - 1) / 2) * h * 0.028, w * 0.036, mine ? "#ffffff" : "#0d0d0f"));
        y += bh + h * 0.018;
      });
      const inputY = h - h * 0.13;
      p.card(w * 0.06, inputY, w * 0.72, h * 0.058, h * 0.029, "#f0f0f2");
      p.text("Message", w * 0.11, inputY + h * 0.029, w * 0.036, "rgba(0,0,0,0.35)");
      p.card(w * 0.82, inputY, h * 0.058, h * 0.058, h * 0.029, "#25d366");
      homeIndicator(p, w, h, "#111111");
    },
  },
  {
    id: "analytics", name: "Analytics", shape: "landscape", dark: true, tint: "#f26a2e",
    draw(ctx, w, h) {
      const p = pen(ctx, w / 40);
      p.fill(0, 0, w, h, "#0b0b0e");
      const sb = w * 0.17;
      p.fill(0, 0, sb, h, "#0f0f13");
      p.card(w * 0.028, h * 0.055, w * 0.026, w * 0.026, w * 0.008, "#f26a2e");
      p.text("mok", w * 0.066, h * 0.068, w * 0.021, "#ffffff", 700);
      ["Overview", "Projects", "Analytics", "Customers", "Billing", "Settings"].forEach((t, i) => {
        const y = h * 0.17 + i * h * 0.072;
        if (i === 0) p.card(w * 0.018, y - h * 0.026, sb - w * 0.036, h * 0.052, w * 0.008, "rgba(255,255,255,0.07)");
        p.card(w * 0.03, y - w * 0.008, w * 0.016, w * 0.016, w * 0.005, i === 0 ? "#f26a2e" : "rgba(255,255,255,0.3)");
        p.text(t, w * 0.058, y, w * 0.017, i === 0 ? "#ffffff" : "rgba(255,255,255,0.55)");
      });
      const x0 = sb + w * 0.035;
      p.text("Overview", x0, h * 0.075, w * 0.03, "#ffffff", 700);
      p.text("Last 30 days", w - w * 0.035, h * 0.075, w * 0.016, "rgba(255,255,255,0.45)", 500, "right");
      const cardW = (w - x0 - w * 0.035 - w * 0.04) / 3;
      ([["Revenue", "$128,420", "+18%"], ["Active users", "24,981", "+6.2%"], ["Conversion", "3.9%", "+0.4"]] as [string, string, string][]).forEach(([l, v, d], i) => {
        const x = x0 + i * (cardW + w * 0.02);
        p.card(x, h * 0.11, cardW, h * 0.155, w * 0.012, "rgba(255,255,255,0.045)", "rgba(255,255,255,0.06)");
        p.text(l, x + w * 0.018, h * 0.15, w * 0.016, "rgba(255,255,255,0.5)");
        p.text(v, x + w * 0.018, h * 0.205, w * 0.031, "#ffffff", 700);
        p.text(d, x + cardW - w * 0.018, h * 0.205, w * 0.016, "#7ed99a", 600, "right");
      });
      const cy = h * 0.30, chH = h * 0.55;
      const chartW = (w - x0 - w * 0.035) * 0.63;
      p.card(x0, cy, chartW, chH, w * 0.012, "rgba(255,255,255,0.045)", "rgba(255,255,255,0.06)");
      p.text("Revenue", x0 + w * 0.018, cy + h * 0.05, w * 0.018, "#ffffff", 600);
      const vals = Array.from({ length: 16 }, (_, i) => 0.25 + 0.7 * Math.abs(Math.sin(i * 1.7 + 1)));
      bars(ctx, vals, x0 + w * 0.018, cy + h * 0.1, chartW - w * 0.036, chH - h * 0.16, "rgba(255,255,255,0.14)", "#f26a2e", 14);
      const lx = x0 + chartW + w * 0.02;
      p.card(lx, cy, w - lx - w * 0.035, chH, w * 0.012, "rgba(255,255,255,0.045)", "rgba(255,255,255,0.06)");
      p.text("Top customers", lx + w * 0.018, cy + h * 0.05, w * 0.018, "#ffffff", 600);
      ["Acme Inc", "Globex", "Initech", "Umbrella", "Hooli"].forEach((n, i) => {
        const y = cy + h * 0.12 + i * h * 0.082;
        p.card(lx + w * 0.018, y - w * 0.01, w * 0.02, w * 0.02, w * 0.006, `hsl(${(i * 65 + 20) % 360} 55% 55%)`);
        p.text(n, lx + w * 0.048, y, w * 0.016, "rgba(255,255,255,0.85)");
        p.text(`$${(9 - i) * 1.7}k`, w - w * 0.05, y, w * 0.016, "rgba(255,255,255,0.5)", 500, "right");
      });
    },
  },
  {
    id: "landing", name: "Landing page", shape: "landscape", dark: false, tint: "#6d5efc",
    draw(ctx, w, h) {
      const p = pen(ctx, w / 40);
      p.fill(0, 0, w, h, "#ffffff");
      // nav
      p.card(w * 0.06, h * 0.055, w * 0.022, w * 0.022, w * 0.007, "#6d5efc");
      p.text("Northwind", w * 0.095, h * 0.066, w * 0.019, "#0d0d0f", 700);
      ["Product", "Solutions", "Pricing", "Docs"].forEach((t, i) => p.text(t, w * 0.34 + i * w * 0.09, h * 0.066, w * 0.016, "rgba(0,0,0,0.6)"));
      p.card(w * 0.86, h * 0.045, w * 0.08, h * 0.042, h * 0.021, "#0d0d0f");
      p.text("Sign up", w * 0.9, h * 0.066, w * 0.015, "#ffffff", 600, "center");
      // hero
      p.card(w * 0.06, h * 0.17, w * 0.19, h * 0.05, h * 0.025, "#efecff");
      p.text("New · Version 3.0", w * 0.155, h * 0.195, w * 0.015, "#6d5efc", 600, "center");
      // the headline is measured to the column so it never runs into the hero art
      const col = w * 0.40;
      const head = p.fitText("Ship product", w * 0.06, h * 0.30, w * 0.052, col, "#0d0d0f", 700);
      p.fitText("visuals in minutes", w * 0.06, h * 0.30 + head * 1.18, head, col, "#6d5efc", 700);
      p.fitText("Drop a screenshot onto a real 3D device,", w * 0.06, h * 0.47, w * 0.018, col, "rgba(0,0,0,0.55)", 500);
      p.fitText("light it, animate it and export in 4K.", w * 0.06, h * 0.515, w * 0.018, col, "rgba(0,0,0,0.55)", 500);
      p.card(w * 0.06, h * 0.58, w * 0.135, h * 0.075, h * 0.014, "#0d0d0f");
      p.text("Start free", w * 0.1275, h * 0.617, w * 0.017, "#ffffff", 600, "center");
      p.card(w * 0.21, h * 0.58, w * 0.135, h * 0.075, h * 0.014, "#ffffff", "rgba(0,0,0,0.12)");
      p.text("Book a demo", w * 0.2775, h * 0.617, w * 0.017, "#0d0d0f", 600, "center");
      p.text("Trusted by 12,000+ teams", w * 0.06, h * 0.74, w * 0.015, "rgba(0,0,0,0.4)", 600);
      ["ACME", "GLOBEX", "INITECH", "HOOLI"].forEach((t, i) => p.text(t, w * 0.06 + i * w * 0.085, h * 0.79, w * 0.018, "rgba(0,0,0,0.25)", 700));
      // hero art
      const ax = w * 0.5, ay = h * 0.15, aw = w * 0.44, ah = h * 0.7;
      const g = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
      g.addColorStop(0, "#6d5efc"); g.addColorStop(1, "#c4b5fd");
      p.card(ax, ay, aw, ah, w * 0.02, "#000");
      ctx.save(); rr(ctx, ax, ay, aw, ah, w * 0.02); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(ax, ay, aw, ah);
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = "#fff";
        const r = aw * (0.03 + (i % 5) * 0.02);
        ctx.beginPath();
        ctx.arc(ax + ((i * 137) % 100) / 100 * aw, ay + ((i * 71) % 100) / 100 * ah, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      p.card(ax + aw * 0.1, ay + ah * 0.2, aw * 0.8, ah * 0.58, w * 0.014, "rgba(255,255,255,0.92)");
      p.text("Revenue", ax + aw * 0.16, ay + ah * 0.29, w * 0.016, "rgba(0,0,0,0.5)", 600);
      p.text("$48,210", ax + aw * 0.16, ay + ah * 0.36, w * 0.03, "#0d0d0f", 700);
      chart(ctx, [0.2, 0.45, 0.35, 0.6, 0.5, 0.8, 0.72, 0.95], ax + aw * 0.16, ay + ah * 0.44, aw * 0.6, ah * 0.24, "#6d5efc", "rgba(109,94,252,0.25)", w * 0.005);
      ctx.restore();
    },
  },
];

export function getSampleScreen(id: string): SampleScreen | null {
  return SAMPLE_SCREENS.find((s) => s.id === id) ?? null;
}

/** Render a sample screen to a canvas at the given size. */
export function drawSampleScreen(id: string, canvas: HTMLCanvasElement, w: number, h: number): boolean {
  const s = getSampleScreen(id);
  if (!s) return false;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.clearRect(0, 0, w, h);
  s.draw(ctx, w, h);
  return true;
}

/** Render a sample screen to a PNG blob at the requested pixel size. */
export async function sampleScreenBlob(id: string, w: number, h: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  if (!drawSampleScreen(id, canvas, w, h)) return null;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
