// Real alpha/effect and failed-source checks against an isolated running editor.
// MOK_QA_URL=http://127.0.0.1:3000 MOK_QA_NODE_MODULES=... node scripts/export-robustness.mjs /tmp/mok-robustness
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const destination = resolve(process.argv[2] ?? '../export-0.12-robustness'); await mkdir(destination, { recursive: true });
const url = process.env.MOK_QA_URL ?? 'http://127.0.0.1:3000', errors = [], report = { url, cases: [], errors };
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.removeItem('mok:seen-version'); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mok?.registry.composer);
  await page.evaluate(async () => {
    const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
    m.useUI.setState({ time: .15, playing: false, modal: null, tourStep: null });
    p.id = 'export-robustness'; p.duration = .25; p.aspect = '16:9'; p.audio = null;
    p.shots = [{ id: 'subject', name: 'Subject', duration: 1, media: null, fit: 'contain', keyframes: {}, focusAreas: [] }];
    p.mockup.device = 'macbook-pro-14-glb'; p.mockup.finish = 'model'; p.mockup.lid = 110;
    p.scene.preset = 'studio'; p.scene.contactShadow = true; p.scene.shadowOpacity = .6; p.scene.detailShadows = 0;
    p.camera = { x: -25, y: 20, z: 0, fov: 30, zoom: .8, panX: 0, panY: 0 };
    p.effects = []; p.fade = { in: 0, out: 0, color: '#000000' }; p.blur.mode = 'off';
    m.useEditor.getState().replaceProject(p); if (!await m.ownership.ready(p.id)) throw new Error('No fixture ownership');
    m.useUI.getState().setActiveShot('subject');
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#15b8d5'; ctx.fillRect(0, 0, 400, 500); ctx.fillStyle = '#fa8936'; ctx.fillRect(400, 0, 400, 500);
    ctx.fillStyle = 'white'; ctx.font = '50px sans-serif'; ctx.fillText('Mok / 0123456789', 60, 400);
    const blob = await new Promise(r => canvas.toBlob(r));
    if (!await m.actions.importFilesToShot([new File([blob], 'source.png', { type: 'image/png' })], 'subject')) throw new Error('Fixture source import failed');
  });
  const names = ['plain', 'sharpen', 'ghost', 'liquidGlass', 'bloom', 'chromatic', 'full', 'without-sharpen', 'without-ghost', 'without-bloom'];
  for (const name of names) {
    const result = await page.evaluate(async name => {
      const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
      const all = m.effectDefs.filter(d => !['screenFade'].includes(d.id)).map(d => ({ id: d.id, enabled: true, params: Object.fromEntries(d.params.map(p => [p.key, p.default])) }));
      p.effects = name === 'plain' ? [] : name.startsWith('without-') ? all.filter(e => e.id !== name.slice(8)) : name === 'full' ? all : all.filter(e => e.id === name);
      m.useEditor.getState().replaceProject(p); await new Promise(r => setTimeout(r, 100));
      const blob = await m.capture.captureImage({ width: 640, height: 360, format: 'png', transparent: true, transparentShadows: true, time: .15 });
      const image = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close(); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minAlpha = 255, maxAlpha = 0, whitePartial = 0;
      for (let i = 0; i < pixels.length; i += 4) { minAlpha = Math.min(minAlpha, pixels[i + 3]); maxAlpha = Math.max(maxAlpha, pixels[i + 3]); if (pixels[i + 3] > 16 && pixels[i + 3] < 240 && pixels[i] + pixels[i + 1] + pixels[i + 2] > 700) whitePartial++; }
      return { bytes: [...new Uint8Array(await blob.arrayBuffer())], minAlpha, maxAlpha, whitePartial };
    }, name);
    const { bytes, ...metrics } = result; await writeFile(join(destination, `${name}.png`), Buffer.from(bytes)); report.cases.push({ name, ...metrics });
  }
  report.failures = await page.evaluate(async () => {
    const m = window.__mok, original = structuredClone(m.useEditor.getState().project), state = () => ({ time: m.useUI.getState().time, size: { ...m.registry.state.size }, dpr: m.registry.state.viewport.dpr, exporting: m.anim.exporting });
    const before = state(), wrong = structuredClone(original);
    const invalid = await m.actions.importFilesToShot([new File(['invalid media bytes'], 'broken.png', { type: 'image/png' })], 'subject');
    if (invalid || m.useEditor.getState().project.shots[0].media.id !== original.shots[0].media.id) throw new Error('Broken media replaced the usable source');
    wrong.shots[0].media = { id: 'missing-file', name: 'missing.png', kind: 'image', width: 100, height: 100 };
    m.useEditor.getState().replaceProject(wrong); let missing = '';
    try { await m.capture.captureImage({ width: 640, height: 360, format: 'png', transparent: true }); } catch (e) { missing = String(e); }
    if (!missing.includes('Missing media: missing.png')) throw new Error(`Missing source did not fail explicitly: ${missing}`);
    if (JSON.stringify(state()) !== JSON.stringify(before)) throw new Error('Failed image did not restore preview state');
    const trimmed = structuredClone(original); trimmed.duration = .25; trimmed.effects = []; trimmed.shots.push({ ...wrong.shots[0], id: 'unrelated', duration: 1 });
    m.useEditor.getState().replaceProject(trimmed);
    const video = await m.capture.exportVideo({ width: 320, height: 180, fps: 8, samples: 2, quality: 'low', transparent: true, transparentShadows: true, format: 'webm' });
    const videoBytes = [...new Uint8Array(await video.blob.arrayBuffer())]; await video.cleanup();
    m.useEditor.getState().replaceProject(original);
    const after = await m.capture.captureImage({ width: 320, height: 180, format: 'png', transparent: true });
    return { invalidImportPreservedSource: true, missing, stateRestored: true, trimmedVideo: videoBytes, recovery: [...new Uint8Array(await after.arrayBuffer())] };
  });
  await writeFile(join(destination, 'trimmed-missing.webm'), Buffer.from(report.failures.trimmedVideo)); delete report.failures.trimmedVideo;
  await writeFile(join(destination, 'failure-recovery.png'), Buffer.from(report.failures.recovery)); delete report.failures.recovery;
  if (errors.length) throw new Error(errors.join('\n'));
  report.passed = true; console.log(JSON.stringify(report, null, 2));
} finally { await writeFile(join(destination, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
