// Reproduce the VSM sweep-boundary artifact and compare the same real export with its guard on/off.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] ?? '../shadow-boundary'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], report = { errors }; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(process.env.MOK_QA_URL ?? 'http://127.0.0.1:35362');
  await page.waitForFunction(() => window.__mok?.registry.composer);
  await page.evaluate(async () => {
    const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
    m.useUI.setState({ playing: false, time: .5, modal: null, tourStep: null });
    p.duration = 1; p.aspect = '16:9'; p.effects = []; p.audio = null; p.fade = { in: 0, out: 0, color: '#000000' }; p.blur.mode = 'off';
    p.mockup.device = 'macbook-pro-14-glb'; p.mockup.reflection = .2; p.mockup.lid = 110;
    p.camera = { x: -15, y: 10, z: 0, fov: 30, zoom: .5, panX: 0, panY: 0 };
    p.scene.preset = 'studio'; p.scene.contactShadow = true; p.scene.detailShadows = 0; p.scene.shadowSoft = .5; p.scene.shadowOpacity = .5;
    p.shots = [{ id: 'shadow-boundary', duration: 1, media: null, fit: 'cover', keyframes: {} }];
    m.useEditor.getState().replaceProject(p); await m.ownership.ready(p.id); m.useUI.getState().setActiveShot('shadow-boundary');
  });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(async () => {
    const m = window.__mok, options = { width: 960, height: 540, format: 'png', transparent: false, time: .5 };
    const fixed = await m.capture.captureImage(options);
    let material;
    m.registry.state.scene.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width > 100 && o.material?.isMeshStandardMaterial) material = o.material; });
    if (!material) throw new Error('Studio sweep was not found');
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
    let original;
    try {
      // This test-only mutation restores exactly Three's original VSM frustum test. The app's
      // actual floor maps, environment gain, camera, lights and all other render passes stay live.
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        const guard = /vec2 receiverKernel =[^;]+;\s*vec2 receiverEdge =[^;]+;\s*bool inFrustum = all\(greaterThanEqual\(receiverEdge, receiverKernel\)\);/;
        if (!guard.test(shader.fragmentShader)) throw new Error('VSM receiver guard is missing');
        shader.fragmentShader = shader.fragmentShader.replace(guard, 'bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;');
      };
      material.customProgramCacheKey = () => `${key.call(material)}|test-unguarded`;
      material.needsUpdate = true;
      original = await m.capture.captureImage(options);
    } finally { material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true; m.registry.state.invalidate(); }
    const pixels = async blob => {
      const bitmap = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
      const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const a = await pixels(original), b = await pixels(fixed);
    const roi = ([x0, y0, x1, y1]) => {
      let mae = 0, maxBrightening = 0, brightenedPixels = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * 960 + x) * 4, delta = (b[i] + b[i + 1] + b[i + 2] - a[i] - a[i + 1] - a[i + 2]) / 3;
        mae += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        maxBrightening = Math.max(maxBrightening, delta); if (delta > 5) brightenedPixels++;
      }
      return { meanAbsoluteDifference: mae / ((x1 - x0) * (y1 - y0)), maxBrightening, brightenedPixels };
    };
    return { line: roi([720, 370, 900, 500]), intendedShadow: roi([610, 326, 708, 370]), device: roi([350, 175, 615, 370]), original: [...new Uint8Array(await original.arrayBuffer())], fixed: [...new Uint8Array(await fixed.arrayBuffer())] };
  });
  for (const name of ['original', 'fixed']) { await writeFile(join(out, `${name}.png`), Buffer.from(result[name])); delete result[name]; }
  Object.assign(report, result);
  if (result.line.maxBrightening < 10 || result.line.brightenedPixels < 100) throw new Error('Fixture did not reproduce and remove the detached VSM boundary line');
  if (result.intendedShadow.meanAbsoluteDifference > .35 || result.device.meanAbsoluteDifference > .1) throw new Error('Boundary guard materially changes the useful shadow or device');
  if (errors.length) throw new Error(errors.join('\n'));
  report.passed = true; console.log(JSON.stringify(report, null, 2));
} finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
