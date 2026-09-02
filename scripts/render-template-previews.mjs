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
const ids = await page.evaluate(() => __mok.templates.filter((t) => t.motion || t.sequence).map((t) => t.id));
for (const id of ids) {
  const dataUrl = await page.evaluate(async (id) => {
    __mok.actions.applyTemplate(id);
    // keep the clip short: the first shot only, capped at 3 s
    __mok.useEditor.getState().update((p) => { p.shots = p.shots.slice(0, 1); p.shots[0].duration = Math.min(p.shots[0].duration, 3); p.shots[0].transitionOut = undefined; p.fade = { in: 0, out: 0, color: "#000" }; });
    await new Promise((r) => setTimeout(r, 5000));
    const { blob } = await __mok.capture.exportVideo({ width: 480, height: 300, fps: 15, quality: "low", samples: 1, transparent: false, format: "webm" });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }, id);
  writeFileSync(`public/templates/${id}.webm`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("✓", id);
}
await browser.close();
