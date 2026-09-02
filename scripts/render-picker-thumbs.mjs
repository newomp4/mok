#!/usr/bin/env node
// Renders a thumbnail for every device in the picker (public/devices/<id>.webp, transparent) and
// every scene preset (public/scenes/<id>.webp). Needs `pnpm dev` running and Playwright's Chromium.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.MOK_URL ?? "http://localhost:3000/";
mkdirSync("public/devices", { recursive: true });
mkdirSync("public/scenes", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const toFile = (dataUrl, file) => writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
const devices = await page.evaluate(() => __mok.devices.filter((d) => !d.hidden).map((d) => d.id));
for (const id of devices) {
  const dataUrl = await page.evaluate(async (id) => {
    __mok.actions.newProject();
    __mok.useEditor.getState().setDevice(id);
    __mok.useEditor.getState().update((p) => { p.camera = { x: -24, y: 12, z: 0, fov: 22, zoom: 0.98, panX: 0, panY: 0 }; p.mockup.rotY = 0; p.scene.contactShadow = false; p.scene.background.type = "transparent"; });
    await new Promise((r) => setTimeout(r, 5000));
    const blob = await __mok.capture.captureImage({ width: 480, height: 360, format: "webp", quality: 0.9, transparent: true });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }, id);
  toFile(dataUrl, `public/devices/${id}.webp`);
  console.log("✓ device", id);
}
const scenes = await page.evaluate(() => __mok.scenes.map((s) => s.id));
for (const id of scenes) {
  const dataUrl = await page.evaluate(async (id) => {
    __mok.actions.newProject();
    __mok.useEditor.getState().setScenePreset(id);
    __mok.useEditor.getState().update((p) => { p.camera = { x: -26, y: 14, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }; });
    await new Promise((r) => setTimeout(r, 5000));
    const blob = await __mok.capture.captureImage({ width: 480, height: 300, format: "webp", quality: 0.86, transparent: false });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }, id);
  toFile(dataUrl, `public/scenes/${id}.webp`);
  console.log("✓ scene", id);
}
await browser.close();
