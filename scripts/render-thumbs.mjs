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
const ids = await page.evaluate(() => __mok.templates.map((t) => t.id));
for (const id of ids) {
  const dataUrl = await page.evaluate(async (id) => {
    __mok.actions.applyTemplate(id);
    const first = __mok.useEditor.getState().project.shots[0];
    __mok.useUI.getState().setTime(Math.max(0, first.duration - 0.05));
    await new Promise((r) => setTimeout(r, 5000));
    const blob = await __mok.capture.captureImage({ width: 640, height: 400, format: "webp", quality: 0.86, transparent: false });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }, id);
  writeFileSync(`public/templates/${id}.webp`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("✓", id);
}
await browser.close();
