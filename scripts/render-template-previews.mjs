#!/usr/bin/env node
// Renders a short looping WebM preview (first shot, up to 3 s) for every template that moves.
// Needs `pnpm dev` running and Playwright's Chromium. Run from the repo root.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.MOK_URL ?? "http://localhost:3000/";
mkdirSync("public/templates", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const only = process.argv.slice(2);
const ids = (await page.evaluate(() => __mok.templates.filter((t) => t.motion || t.sequence).map((t) => t.id))).filter((id) => !only.length || only.includes(id));
for (const id of ids) {
  const dataUrl = await page.evaluate(async (id) => {
    __mok.actions.applyTemplate(id);
    // keep the clip short: the first media shot only, capped at 3 s
    __mok.useEditor.getState().update((p) => {
      const idx = Math.max(0, p.shots.findIndex((s) => (s.kind ?? "media") === "media"));
      p.shots = [p.shots[idx]];
      p.shots[0].duration = Math.min(p.shots[0].duration, 3);
      p.shots[0].transitionOut = undefined;
      p.shots[0].enter = undefined; p.shots[0].exit = undefined;
      p.fade = { in: 0, out: 0, color: "#000" };
    });
    __mok.useUI.getState().setTime(0);
    await new Promise((r) => setTimeout(r, 5000));
    const { blob } = await __mok.capture.exportVideo({ width: 480, height: 300, fps: 15, quality: "low", samples: 1, transparent: false, format: "webm" });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }, id);
  writeFileSync(`public/templates/${id}.webm`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("✓", id);
}
await browser.close();
