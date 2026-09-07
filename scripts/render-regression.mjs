// Real browser fixtures. Run a production server, then:
// MOK_QA_URL=http://127.0.0.1:3000 node scripts/render-regression.mjs /tmp/mok-render-check
// Optional MOK_QA_NODE_MODULES points to an existing Playwright installation.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, "package.json") : import.meta.url);
const { chromium } = require("playwright");
const destination = resolve(process.argv[2] ?? "render-check");
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.MOK_QA_CHANNEL ? { channel: process.env.MOK_QA_CHANNEL } : { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => { localStorage.setItem("mok:toured", "1"); localStorage.setItem("mok:seen-version", "0.9.0"); });
const cases = [
  { id: "mac-keyboard", device: "macbook-pro-14-glb", camera: { x: -24, y: 18, z: 0, fov: 30, zoom: 1.15, panX: 0, panY: 0 }, lid: 110, scene: "studio", alpha: false },
  { id: "mac-closed", device: "macbook-pro-14-glb", camera: { x: -30, y: 20, z: 0, fov: 30, zoom: 1.15, panX: 0, panY: 0 }, lid: 5, scene: "studio", alpha: false },
  { id: "phone-metal", device: "iphone-17-pro-glb", camera: { x: -14, y: -25, z: 0, fov: 30, zoom: 1.1, panX: 0, panY: 0 }, lid: 110, scene: "concrete", alpha: false },
  { id: "flat-alpha", device: "flat", camera: { x: -16, y: 15, z: -4, fov: 30, zoom: 1.1, panX: 0, panY: 0 }, lid: 110, scene: "custom", alpha: true },
  { id: "ipad-lens", device: "ipad-pro-13-glb", camera: { x: -20, y: 28, z: 0, fov: 30, zoom: 1.1, panX: 0, panY: 0 }, lid: 110, scene: "studio", alpha: false, depth: true },
];
if (process.env.MOK_QA_EXTENDED) cases.push(
  { id: "mac-detail-off", device: "macbook-pro-14-glb", camera: { x: -35, y: 20, z: 0, fov: 30, zoom: 1.15, panX: 0, panY: 0 }, lid: 110, scene: "darkroom", alpha: false, detail: 0 },
  { id: "mac-detail-on", device: "macbook-pro-14-glb", camera: { x: -35, y: 20, z: 0, fov: 30, zoom: 1.15, panX: 0, panY: 0 }, lid: 110, scene: "darkroom", alpha: false, detail: .7 },
  { id: "flat-alpha-effects", device: "flat", camera: { x: -16, y: 15, z: -4, fov: 30, zoom: 1.1, panX: 0, panY: 0 }, lid: 110, scene: "custom", alpha: true, effects: true, padding: .1 },
  { id: "large-screen", device: "browser", camera: { x: -8, y: 12, z: 0, fov: 30, zoom: 1, panX: 0, panY: 0 }, lid: 110, scene: "custom", alpha: true, width: 6000, height: 1800 },
);
if (process.env.MOK_QA_CONTACT) {
  const camera = { x: -24, y: 18, z: 0, fov: 30, zoom: .82, panX: 0, panY: 0 };
  for (const scene of ["custom", "studio", "gallery", "concrete", "darkroom"]) cases.push({ id: `contact-${scene}`, device: "macbook-pro-14-glb", camera, lid: 110, scene, alpha: false, shadow: .5 });
  cases.push({ id: "shadow-zero", device: "macbook-pro-14-glb", camera, lid: 110, scene: "studio", alpha: false, shadow: 0 });
  cases.push({ id: "shadow-soft", device: "macbook-pro-14-glb", camera, lid: 110, scene: "custom", alpha: false, shadow: .5, soft: 1 });
  cases.push({ id: "watch-contact", device: "apple-watch-ultra-glb", camera, lid: 110, scene: "studio", alpha: false, shadow: .5 });
}
if (process.env.MOK_QA_DEVICES) {
  const camera = { x: -25, y: 28, z: 0, fov: 30, zoom: .95, panX: 0, panY: 0 };
  cases.push({ id: "watch9-display", device: "apple-watch-9-glb", camera, lid: 110, scene: "custom", alpha: false, sensorCheck: "front" });
  cases.push({ id: "watch9-sensors", device: "apple-watch-9-glb", camera: { ...camera, x: 155 }, lid: 110, scene: "custom", alpha: false, sensorCheck: "back" });
}
const report = { url: process.env.MOK_QA_URL ?? "http://127.0.0.1:3000", browser: browser.version(), cases: [], errors };
const selected = process.env.MOK_QA_CASES?.split(",");
try {
  await page.goto(report.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__mok?.registry.state && window.__mok?.registry.composer);
  const base = await page.evaluate(() => structuredClone(window.__mok.useEditor.getState().project));
  for (const fixture of cases.filter((item) => !selected || selected.includes(item.id))) {
    const result = await page.evaluate(async ({ fixture, base }) => {
      const m = window.__mok;
      m.useUI.setState({ playing: false, time: 0, modal: null, tourStep: null });
      const p = structuredClone(base);
      p.id = "render-fixture"; p.name = fixture.id; p.duration = 2; p.aspect = "16:9";
      p.shots = [{ id: "fixture-shot", name: "Fixture", duration: 2, media: null, fit: "contain", keyframes: {}, focusAreas: [] }];
      p.mockup.device = fixture.device; p.mockup.finish = "model"; p.mockup.lid = fixture.lid;
      p.mockup.reflection = 0.45; p.mockup.gloss = 1; p.mockup.caseKeyboard = false;
      p.camera = fixture.camera; p.effects = []; p.audio = null; p.fade = { in: 0, out: 0, color: "#000000" };
      p.scene.preset = fixture.scene; p.scene.lighting = "soft"; p.scene.lightIntensity = 0.85;
      p.scene.lightRotX = 0; p.scene.lightRotY = 200;
      p.scene.background = { type: "color", color: "#eeeeee", preset: "paper", image: null, blur: 0 };
      p.scene.detailShadows = fixture.detail ?? 0;
      p.scene.contactShadow = true; p.scene.shadowOpacity = fixture.shadow ?? .5; p.scene.shadowSoft = fixture.soft ?? .5;
      if (fixture.sensorCheck) {
        p.scene.lighting = "default"; p.scene.lightRotY = 120; p.scene.contactShadow = false;
        p.scene.background.color = "#303238";
      }
      if (fixture.effects) p.shots[0].effects = m.effectDefs.map(e => ({ id: e.id, enabled: true, params: Object.fromEntries(e.params.map(x => [x.key, x.default])) }));
      p.shots[0].screenPadding = fixture.padding ?? 0;
      p.screen.brightness = 1; p.screen.spill = 1; p.screen.padding = 0;
      p.blur.mode = fixture.depth ? "depth" : "off"; p.blur.strength = 5; p.blur.focusSize = 0.32;
      m.useEditor.getState().replaceProject(p); await m.ownership?.ready(p.id); m.useUI.getState().setActiveShot("fixture-shot");
      const artwork = document.createElement("canvas"); artwork.width = 1600; artwork.height = 1000;
      const ctx = artwork.getContext("2d");
      ctx.fillStyle = "#071421"; ctx.fillRect(0, 0, 1600, 1000);
      ctx.fillStyle = "#12d9ff"; ctx.fillRect(0, 0, 800, 750);
      ctx.fillStyle = "#ff7a18"; ctx.fillRect(800, 0, 800, 750);
      const ramp = ctx.createLinearGradient(0, 0, 1600, 0); ramp.addColorStop(0, "#000"); ramp.addColorStop(1, "#fff");
      ctx.fillStyle = ramp; ctx.fillRect(0, 750, 1600, 150);
      ctx.font = "600 60px sans-serif"; ctx.fillStyle = "#fff"; ctx.fillText("MOK / 0123456789", 60, 965);
      ctx.fillStyle = "#000"; for (let x = 30; x < 1570; x += 16) ctx.fillRect(x, 650, 2, 60);
      const blob = await new Promise((r) => artwork.toBlob(r, "image/png"));
      await m.actions.importFilesToShot([new File([blob], "calibration.png", { type: "image/png" })], "fixture-shot");
      await new Promise((r) => setTimeout(r, 2500));
      const gl = m.registry.state.gl;
      const previousAutoReset = gl.info.autoReset;
      if (!m.registry.metrics) { gl.info.autoReset = false; gl.info.reset(); }
      const screenRasters = [];
      let counters;
      const originalToBlob = gl.domElement.toBlob;
      gl.domElement.toBlob = function (...args) {
        m.registry.state.scene.traverse(object => {
          for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
            const image = material.emissiveMap?.image;
            if (image instanceof HTMLCanvasElement) screenRasters.push([image.width, image.height]);
          }
        });
        counters = { scope: m.registry.metrics ? "capture-final-frame" : "whole-capture", calls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries, programs: gl.info.programs?.length };
        return originalToBlob.apply(this, args);
      };
      const start = performance.now();
      let image;
      try { image = await m.capture.captureImage({ width: fixture.width ?? 1920, height: fixture.height ?? 1080, format: "png", transparent: fixture.alpha, time: fixture.effects ? 1 : 0 }); }
      finally { gl.domElement.toBlob = originalToBlob; }
      const elapsedMs = performance.now() - start;
      gl.info.autoReset = previousAutoReset;
      const bitmap = await createImageBitmap(image);
      const check = document.createElement("canvas"); check.width = bitmap.width; check.height = bitmap.height;
      const c = check.getContext("2d"); c.drawImage(bitmap, 0, 0); bitmap.close();
      const bytes = c.getImageData(0, 0, check.width, check.height).data;
      let minAlpha = 255, maxAlpha = 0, nonBlack = 0;
      for (let i = 0; i < bytes.length; i += 4) { minAlpha = Math.min(minAlpha, bytes[i + 3]); maxAlpha = Math.max(maxAlpha, bytes[i + 3]); if (bytes[i] + bytes[i + 1] + bytes[i + 2] > 16) nonBlack++; }
      let cyanPixels = 0;
      if (fixture.sensorCheck) for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i + 2] - bytes[i] > 25 && bytes[i + 1] - bytes[i] > 25 && bytes[i + 2] > 50) cyanPixels++;
      }
      const dataUrl = await new Promise((r) => { const reader = new FileReader(); reader.onload = () => r(reader.result); reader.readAsDataURL(image); });
      return { dataUrl, width: check.width, height: check.height, elapsedMs, minAlpha, maxAlpha, nonBlack, cyanPixels, screenRasters, counters, version: m.version };
    }, { fixture, base });
    const { dataUrl, ...metrics } = result;
    await writeFile(join(destination, `${fixture.id}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
    report.cases.push({ ...fixture, ...metrics });
    if (metrics.width !== (fixture.width ?? 1920) || metrics.height !== (fixture.height ?? 1080) || metrics.maxAlpha !== 255 || metrics.nonBlack < 1000) throw new Error(`${fixture.id}: invalid or empty output`);
    if (fixture.alpha ? metrics.minAlpha !== 0 : metrics.minAlpha !== 255) throw new Error(`${fixture.id}: wrong transparency`);
    if (fixture.sensorCheck === "front" && metrics.cyanPixels < 1000) throw new Error(`${fixture.id}: uploaded artwork missing from the display`);
    if (fixture.sensorCheck === "back" && metrics.cyanPixels > 10) throw new Error(`${fixture.id}: uploaded artwork leaked onto rear sensors (${metrics.cyanPixels} cyan pixels)`);
    console.log(`${fixture.id}: ${Math.round(metrics.elapsedMs)}ms, ${metrics.counters.calls} draws, alpha ${metrics.minAlpha}..${metrics.maxAlpha}`);
  }
  if (errors.length) throw new Error(`Browser reported ${errors.length} errors`);
} finally {
  await writeFile(join(destination, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
