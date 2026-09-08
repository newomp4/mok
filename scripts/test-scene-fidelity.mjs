// Matched scene exports. Inspect the PNGs as well as the numerical validity report.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] ?? '../scene-fidelity'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const report = { url: process.env.MOK_QA_URL ?? 'http://127.0.0.1:35362', cases: [], errors };
const cases = [
  { id: 'studio-mac', scene: 'studio', device: 'macbook-pro-14-glb' },
  { id: 'studio-mac-detail', scene: 'studio', device: 'macbook-pro-14-glb', zoom: 1.2, y: 28 },
  { id: 'gallery-mac', scene: 'gallery', device: 'macbook-pro-16-glb' },
  { id: 'concrete-mac', scene: 'concrete', device: 'macbook-pro-14-glb' },
  { id: 'darkroom-mac', scene: 'darkroom', device: 'macbook-pro-14-glb' },
  { id: 'studio-ipad', scene: 'studio', device: 'ipad-pro-13-glb', y: 26 },
  { id: 'studio-phone', scene: 'studio', device: 'iphone-17-pro-glb', x: -22, y: 12 },
  { id: 'studio-wide', scene: 'studio', device: 'macbook-pro-14-glb', zoom: .5, x: -15, y: 10 },
];
if (process.env.MOK_QA_CONTROLS) cases.push(
  { id: 'studio-light-zero', scene: 'studio', device: 'macbook-pro-14-glb', intensity: 0 },
  { id: 'studio-light-quarter', scene: 'studio', device: 'macbook-pro-14-glb', intensity: .25 },
  { id: 'studio-light-rotated', scene: 'studio', device: 'macbook-pro-14-glb', rotation: 290 },
  { id: 'studio-light-soft', scene: 'studio', device: 'macbook-pro-14-glb', softness: 1 },
);
try {
  await page.goto(report.url); await page.waitForFunction(() => window.__mok?.registry.composer);
  const selected = process.env.MOK_QA_CASES?.split(',');
  for (const fixture of cases.filter(c => !selected || selected.includes(c.id))) {
    const result = await page.evaluate(async fixture => {
      const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
      m.useUI.setState({ playing: false, time: 0, modal: null, tourStep: null });
      p.id = 'scene-fidelity'; p.aspect = '16:9'; p.duration = 1; p.effects = []; p.audio = null; p.textOverlays = [];
      p.fade = { in: 0, out: 0, color: '#000000' }; p.blur.mode = 'off';
      p.shots = [{ id: 'scene-shot', name: 'Scene', duration: 1, media: null, fit: 'contain', keyframes: {}, focusAreas: [] }];
      const scene = m.scenes.find(s => s.id === fixture.scene);
      Object.assign(p.scene, { preset: scene.id, lighting: scene.lighting, lightRotX: 0, lightRotY: scene.lightRotY, lightIntensity: scene.lightIntensity, background: structuredClone(scene.background), contactShadow: true, detailShadows: 0, shadowSoft: .65, shadowOpacity: .45 });
      if (fixture.intensity !== undefined) p.scene.lightIntensity = fixture.intensity;
      if (fixture.rotation !== undefined) p.scene.lightRotY = fixture.rotation;
      if (fixture.softness !== undefined) p.scene.shadowSoft = fixture.softness;
      Object.assign(p.mockup, { device: fixture.device, finish: 'model', lid: 110, reflection: .3, gloss: 1, rotX: 0, rotY: 0, rotZ: 0, caseKeyboard: true });
      p.camera = { x: fixture.x ?? -26, y: fixture.y ?? 18, z: 0, fov: 30, zoom: fixture.zoom ?? .9, panX: 0, panY: 0 };
      p.screen.brightness = 1; p.screen.spill = 1; p.screen.padding = 0;
      m.useEditor.getState().replaceProject(p); await m.ownership.ready(p.id); m.useUI.getState().setActiveShot('scene-shot');
      await m.actions.applySampleScreen('analytics', 'scene-shot');
      await new Promise(r => setTimeout(r, 1200));
      const started = performance.now();
      const blob = await m.capture.captureImage({ width: 1600, height: 900, format: 'png', transparent: false, time: 0 });
      const elapsedMs = performance.now() - started;
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let min = 255, max = 0, minAlpha = 255, clipped = 0;
      for (let i = 0; i < data.length; i += 4) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; min = Math.min(min, l); max = Math.max(max, l); minAlpha = Math.min(minAlpha, data[i + 3]); if (l > 254) clipped++; }
      const lights = [];
      m.registry.state.scene.traverseVisible(o => { if (o.isLight) lights.push({ type: o.type, intensity: o.intensity, position: o.position.toArray(), quaternion: o.quaternion.toArray() }); });
      return { bytes: [...new Uint8Array(await blob.arrayBuffer())], version: m.version, width: canvas.width, height: canvas.height, elapsedMs, luminance: [min, max], minAlpha, clipped, draws: m.registry.state.gl.info.render.calls, lights, environmentIntensity: m.registry.state.scene.environmentIntensity };
    }, fixture);
    await writeFile(join(out, `${fixture.id}.png`), Buffer.from(result.bytes)); delete result.bytes;
    report.cases.push({ ...fixture, ...result });
    if (result.width !== 1600 || result.height !== 900 || result.minAlpha !== 255 || result.luminance[1] - result.luminance[0] < 20) throw new Error(`${fixture.id}: invalid or blank output`);
    if (result.lights.some(light => ![light.intensity, ...light.position, ...light.quaternion].every(Number.isFinite))) throw new Error(`${fixture.id}: invalid light transform`);
    if (fixture.intensity === 0 && (result.environmentIntensity !== 0 || result.lights.some(light => light.intensity !== 0))) throw new Error('The lighting control does not reach zero');
    console.log(`${fixture.id}: ${Math.round(result.elapsedMs)}ms, ${result.draws} draws`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  report.passed = true;
} finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
