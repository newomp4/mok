// Actual browser-engine render/export checks. Supply MOK_QA_NODE_MODULES if Playwright is external.
// MOK_QA_ENGINES=chrome,firefox,webkit MOK_QA_URL=http://127.0.0.1:3000 node scripts/browser-matrix.mjs /tmp/mok-matrix
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium, firefox, webkit } = require('playwright');
const destination = resolve(process.argv[2] ?? 'browser-matrix');
await mkdir(destination, { recursive: true });
const url = process.env.MOK_QA_URL ?? 'http://127.0.0.1:3000';
const engines = (process.env.MOK_QA_ENGINES ?? 'chrome,firefox,webkit').split(',');
const results = [];
for (const engine of engines) {
  const report = { engine, url, checks: [], errors: [], warnings: [], failedRequests: [] }; results.push(report);
  let browser;
  try {
    const launcher = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
    browser = await launcher.launch({ headless: true, ...(engine === 'chrome' ? { channel: 'chrome' } : engine === 'software' ? { channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {}) });
    report.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(60000);
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('response', response => { if (response.status() >= 400) report.failedRequests.push({ url: response.url(), status: response.status() }); });
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
    await page.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.setItem('mok:seen-version', '0.11.0'); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__mok?.registry.state && window.__mok.registry.composer);
    report.capabilities = await page.evaluate(() => {
      const m = window.__mok, gl = m.registry.state.gl.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { userAgent: navigator.userAgent, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), extensions: gl.getSupportedExtensions(), videoEncoder: typeof VideoEncoder !== 'undefined', videoDecoder: typeof VideoDecoder !== 'undefined', opfs: !!navigator.storage?.getDirectory, appVersion: m.version };
    });
    await page.evaluate(async () => {
      const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
      m.useUI.setState({ playing: false, time: 0, modal: null, tourStep: null });
      p.name = 'Browser regression'; p.duration = .5; p.aspect = '16:9';
      p.shots = [{ id: 'matrix-shot', name: 'Matrix', duration: .5, media: null, fit: 'contain', keyframes: {}, focusAreas: [] }];
      p.mockup.device = 'flat'; p.scene.preset = 'custom'; p.scene.detailShadows = 0; p.scene.contactShadow = false;
      p.scene.background = { type: 'color', color: '#dddddd', image: null, blur: 0 };
      p.camera = { x: -16, y: 16, z: 0, fov: 30, zoom: 1.1, panX: 0, panY: 0 }; p.effects = []; p.audio = null;
      p.fade = { in: 0, out: 0, color: '#000000' }; p.blur.mode = 'off'; p.screen.padding = .08;
      m.useEditor.getState().replaceProject(p); m.useUI.getState().setActiveShot('matrix-shot');
      const c = document.createElement('canvas'); c.width = 800; c.height = 500; const g = c.getContext('2d');
      g.fillStyle = '#15b8d5'; g.fillRect(0, 0, 400, 500); g.fillStyle = '#fa8936'; g.fillRect(400, 0, 400, 500);
      g.fillStyle = '#fff'; g.font = '50px sans-serif'; g.fillText('Mok / 0123456789', 60, 400);
      const b = await new Promise(r => c.toBlob(r)); await m.actions.importFilesToShot([new File([b], 'matrix.png', { type: 'image/png' })], 'matrix-shot');
      await new Promise(r => setTimeout(r, 1200));
    });
    for (const format of ['png', 'jpg', 'webp']) {
      const supported = await page.evaluate(async format => {
        const c = document.createElement('canvas'); c.width = c.height = 1;
        const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
        return await new Promise(r => c.toBlob(b => r(b?.type === mime), mime));
      }, format);
      if (!supported) {
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await page.getByRole('button', { name: /Format/ }).click();
        const option = page.getByRole('option', { name: new RegExp(format === 'jpg' ? 'JPG' : format, 'i') });
        if (!(await option.isDisabled())) throw new Error(`Unsupported ${format} remains selectable`);
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        report.checks.push({ type: 'image-unavailable', format, disabledInUI: true }); continue;
      }
      const value = await page.evaluate(async format => {
        const m = window.__mok; const transparent = format !== 'jpg';
        const b = await m.capture.captureImage({ width: 640, height: 360, format, transparent, transparentShadows: false });
        const bitmap = await createImageBitmap(b), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        let minAlpha = 255, maxAlpha = 0, opaque = 0;
        for (let i = 3; i < pixels.length; i += 4) { minAlpha = Math.min(minAlpha, pixels[i]); maxAlpha = Math.max(maxAlpha, pixels[i]); if (pixels[i] === 255) opaque++; }
        return { bytes: [...new Uint8Array(await b.arrayBuffer())], mime: b.type, width: c.width, height: c.height, minAlpha, maxAlpha, opaque };
      }, format);
      const { bytes, ...metrics } = value; await writeFile(join(destination, `${engine}.${format}`), Buffer.from(bytes));
      if (metrics.width !== 640 || metrics.height !== 360 || metrics.maxAlpha !== 255 || metrics.opaque < 5000 || metrics.minAlpha !== (format === 'jpg' ? 255 : 0)) throw new Error(`Invalid ${format}: ${JSON.stringify(metrics)}`);
      report.checks.push({ type: format, ...metrics });
    }
    const exports = await page.evaluate(async () => {
      const m = window.__mok, outputs = [];
      for (const transparent of [false, true]) {
        try {
          const start = performance.now(); const result = await m.capture.exportVideo({ width: 320, height: 180, fps: 12, quality: 'low', samples: 4, transparent, transparentShadows: false, format: transparent ? 'webm' : 'mp4' });
          const bytes = [...new Uint8Array(await result.blob.arrayBuffer())]; await result.cleanup();
          outputs.push({ transparent, ext: result.ext, elapsedMs: performance.now() - start, bytes });
        } catch (e) { outputs.push({ transparent, error: String(e) }); }
      }
      return outputs;
    });
    for (const item of exports) {
      if (item.bytes) { await writeFile(join(destination, `${engine}.${item.ext}`), Buffer.from(item.bytes)); report.checks.push({ type: 'video', transparent: item.transparent, bytes: item.bytes.length, elapsedMs: item.elapsedMs, format: item.ext }); }
      else throw new Error(`Video export failed: ${JSON.stringify(item)}`);
    }
    if (engine === 'chrome' || engine === 'software') {
      const shadow = await page.evaluate(async () => {
        const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
        p.mockup.device = 'macbook-pro-14-glb'; p.mockup.finish = 'model'; p.mockup.lid = 110;
        p.scene.preset = 'studio'; p.scene.contactShadow = true; p.scene.shadowOpacity = .6;
        p.camera = { x: -30, y: 20, z: 0, fov: 30, zoom: .8, panX: 0, panY: 0 };
        m.useEditor.getState().replaceProject(p); await new Promise(r => setTimeout(r, 1800));
        const outputs = [], decoded = [];
        for (const transparentShadows of [false, true]) {
          const b = await m.capture.captureImage({ width: 960, height: 540, format: 'png', transparent: true, transparentShadows });
          const bitmap = await createImageBitmap(b), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
          const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); decoded.push(ctx.getImageData(0, 0, c.width, c.height).data);
          outputs.push([...new Uint8Array(await b.arrayBuffer())]);
        }
        let shadowPixels = 0, tintedShadowPixels = 0, unchangedDevice = 0, alphaCorners = 0;
        const [cutout, withShadow] = decoded;
        for (let i = 0; i < cutout.length; i += 4) {
          if (cutout[i + 3] === 0 && withShadow[i + 3] > 8) { shadowPixels++; if (withShadow[i] + withShadow[i + 1] + withShadow[i + 2] > 8) tintedShadowPixels++; }
          if (cutout[i + 3] === 255 && withShadow[i + 3] === 255) unchangedDevice++;
        }
        for (const index of [3, (959 * 4) + 3, (539 * 960 * 4) + 3, withShadow.length - 1]) alphaCorners += withShadow[index];
        return { shadowPixels, tintedShadowPixels, unchangedDevice, alphaCorners, outputs };
      });
      await writeFile(join(destination, `${engine}-cutout.png`), Buffer.from(shadow.outputs[0]));
      await writeFile(join(destination, `${engine}-shadow.png`), Buffer.from(shadow.outputs[1]));
      delete shadow.outputs; report.checks.push({ type: 'alpha-shadow', ...shadow });
      if (shadow.shadowPixels < 500 || shadow.tintedShadowPixels || shadow.alphaCorners || shadow.unchangedDevice < 5000) throw new Error(`Bad alpha shadow: ${JSON.stringify(shadow)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__mok.useUI.setState({ modal: null, timelineOpen: false }));
    await page.waitForTimeout(200);
    report.mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth, touchPoints: navigator.maxTouchPoints, controls: [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.getAttribute('aria-label') || b.textContent).slice(0, 40) }));
    await page.screenshot({ path: join(destination, `${engine}-mobile.png`) });
    if (report.mobile.scrollWidth > 392) throw new Error('Mobile page overflows horizontally');
    const activate = async locator => report.mobile.touchPoints > 0 ? locator.tap() : locator.click();
    await activate(page.getByRole('button', { name: 'Show adjustments', exact: true }));
    await page.getByRole('button', { name: 'Close adjustments', exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({ path: join(destination, `${engine}-mobile-adjustments.png`) });
    await activate(page.getByRole('button', { name: 'Close adjustments', exact: true }));
    await activate(page.getByRole('button', { name: 'Show timeline', exact: true }));
    await page.getByRole('button', { name: 'Hide timeline (T)', exact: true }).waitFor({ state: 'visible' });
    await activate(page.getByRole('button', { name: 'Hide timeline (T)', exact: true }));
    report.mobile.panelInteraction = report.mobile.touchPoints > 0 ? 'touch taps' : 'mouse at mobile viewport';
    if (engine === 'chrome') {
      const before = await page.evaluate(() => window.__mok.useEditor.getState().project.camera);
      const box = await page.getByRole('img', { name: '3D mockup preview' }).boundingBox();
      const session = await context.newCDPSession(page);
      const x = box.x + box.width * .5, y = box.y + box.height * .5;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 45, y: y + 25 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const changed = await page.evaluate(before => {
        const m = window.__mok, p = m.useEditor.getState().project, shot = p.shots.find(s => s.id === m.useUI.getState().activeShotId);
        return JSON.stringify(shot.camera ?? p.camera) !== JSON.stringify(before);
      }, before);
      await session.detach();
      if (!changed) throw new Error('Touch orbit did not change the camera');
      report.mobile.orbitGesture = 'Chromium emulated touch drag';
    }
    report.passed = report.errors.length === 0;
    if (!report.passed) throw new Error(report.errors.join('\n'));
    console.log(`${engine}: passed ${report.checks.length} checks; ${report.capabilities.renderer}`);
  } catch (error) { report.failure = String(error); report.passed = false; console.log(`${engine}: ${error}`); }
  finally { await browser?.close(); await writeFile(join(destination, 'report.json'), JSON.stringify({ results }, null, 2) + '\n'); }
}
if (results.some(r => !r.passed)) process.exitCode = 1;
