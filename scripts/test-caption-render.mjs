// Pixel checks of actual caption exports in front of and behind devices, including lit rooms.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] ?? '../caption-render'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const report = { cases: [], errors };
try {
  await page.goto(process.env.MOK_QA_URL ?? 'http://127.0.0.1:35362');
  await page.waitForFunction(() => window.__mok?.registry.composer);
  await page.evaluate(detail => {
    const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
    m.useUI.setState({ playing: false, time: .5, modal: null, tourStep: null });
    p.duration = 1; p.aspect = '16:9'; p.effects = []; p.audio = null; p.fade = { in: 0, out: 0, color: '#000000' }; p.blur.mode = 'off';
    p.mockup.device = 'flat'; p.mockup.reflection = .2; p.mockup.lid = 110;
    p.camera = { x: -15, y: 10, z: 0, fov: 30, zoom: .5, panX: 0, panY: 0 };
    p.scene.preset = 'custom'; p.scene.background = { type: 'color', color: '#dddddd', blur: 0 }; p.scene.contactShadow = true; p.scene.detailShadows = detail;
    p.shots = [{ id: 'caption', duration: 1, media: null, fit: 'cover', keyframes: {}, caption: { enabled: true, text: { text: 'CREATE', font: 'Geist', weight: 700, size: .25, color: '#f0186b', background: '#000000', align: 'center', lineHeight: 1.1, letterSpacing: 0 }, x: 0, y: 0, layer: 'front', enter: { effect: 'none', duration: 0 }, exit: { effect: 'none', duration: 0 } } }];
    m.useEditor.getState().replaceProject(p); m.useUI.getState().setActiveShot('caption');
  }, Number(process.env.MOK_QA_DETAIL ?? .6));
  await page.waitForTimeout(1200);
  for (const room of (process.env.MOK_QA_ROOMS ?? 'custom,studio,concrete,darkroom').split(',')) {
    for (const layer of ['front', 'behind']) {
      const result = await page.evaluate(async ({ room, layer }) => {
        const m = window.__mok;
        m.useEditor.getState().update(p => { p.scene.preset = room; p.mockup.device = room === 'custom' ? 'flat' : 'macbook-pro-14-glb'; p.shots[0].caption.layer = layer; });
        await new Promise(r => setTimeout(r, 600));
        const blob = await m.capture.captureImage({ width: 960, height: 540, format: 'png', transparent: room === 'custom', transparentShadows: true, time: .5 });
        const bitmap = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        let magenta = 0, alpha = 0, minX = 960, maxX = 0, minY = 540, maxY = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] === 0) alpha++;
          if (pixels[i] > 120 && pixels[i + 1] < 100 && pixels[i + 2] > 45 && pixels[i + 3] > 128) { magenta++; const x = (i / 4) % 960, y = Math.floor(i / 4 / 960); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        }
        return { version: m.version, magenta, transparentPixels: alpha, bounds: [minX, minY, maxX, maxY], bytes: [...new Uint8Array(await blob.arrayBuffer())] };
      }, { room, layer });
      await writeFile(join(out, `${room}-${layer}.png`), Buffer.from(result.bytes)); delete result.bytes;
      report.cases.push({ room, layer, ...result });
      if (result.magenta < 100) throw new Error(`Caption missing above ${room} floor (${layer})`);
      if (room === 'custom' && result.transparentPixels < 1000) throw new Error('Transparent caption capture lost alpha');
    }
    const [front, behind] = report.cases.slice(-2);
    if (behind.magenta >= front.magenta * .95) throw new Error(`${room}: device does not occlude behind caption`);
    console.log(`${room}: front ${front.magenta}, behind ${behind.magenta} colored glyph pixels`);
  }
  // A two-shot clip verifies that the new overlay is included in the actual video pipeline too.
  const video = await page.evaluate(async () => {
    const m = window.__mok;
    m.useEditor.getState().update(p => {
      p.scene.preset = 'custom'; p.mockup.device = 'flat'; p.duration = .5; p.scene.detailShadows = 0;
      const s = p.shots[0]; s.duration = .25; s.caption.layer = 'front';
      p.shots.push({ ...structuredClone(s), id: 'caption-behind', caption: { ...structuredClone(s.caption), layer: 'behind' } });
    });
    const result = await m.capture.exportVideo({ width: 480, height: 270, fps: 12, format: 'mp4', quality: 'high', samples: 1, transparent: false });
    try { return [...new Uint8Array(await result.blob.arrayBuffer())]; } finally { await result.cleanup(); }
  });
  await writeFile(join(out, 'caption-layers.mp4'), Buffer.from(video));
  report.videoBytes = video.length; if (video.length < 1000) throw new Error('Caption clip is empty');
  if (errors.length) throw new Error(errors.join('\n'));
  report.passed = true;
} finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
