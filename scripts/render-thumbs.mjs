#!/usr/bin/env node
// Renders a thumbnail for every starter template with the real 3D scene (needs `pnpm dev` running
// and Playwright's Chromium: npm i -g playwright && npx playwright install chromium).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.MOK_URL ?? "http://localhost:3000/";
mkdirSync("public/templates", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const only = process.argv.slice(2);
const ids = (await page.evaluate(() => __mok.templates.map((t) => t.id))).filter((id) => !only.length || only.includes(id));
for (const id of ids) {
  const dataUrl = await page.evaluate(async (id) => {
    // a fresh project first, so each template seeds its own sample screen
    __mok.actions.newProject();
    __mok.actions.applyTemplate(id);
    const tpl = __mok.templates.find((t) => t.id === id);
    const p = __mok.useEditor.getState().project;
    // sequences open on a title card: capture the first media shot instead, half-way through its move
    const idx = tpl?.sequence ? Math.max(0, p.shots.findIndex((s) => (s.kind ?? "media") === "media")) : 0;
    const shot = p.shots[idx];
    const start = p.shots.slice(0, idx).reduce((a, s) => a + s.duration, 0);
    const at = tpl?.thumbAt ?? (tpl?.sequence ? 0.5 : 0.98);
    __mok.useUI.getState().setTime(start + Math.max(0, Math.min(shot.duration - 0.05, shot.duration * at)));
    await new Promise((r) => setTimeout(r, 5000));
    const blob = await __mok.capture.captureImage({ width: 640, height: 400, format: "webp", quality: 0.86, transparent: false });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }, id);
  writeFileSync(`public/templates/${id}.webp`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("✓", id);
}
await browser.close();
