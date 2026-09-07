// Numerical checks of the actual WebGL passes, using our local editor's debug harness.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(process.env.MOK_QA_URL ?? 'http://127.0.0.1:3000', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mok?.registry.composer?.passes.some(p => p.name === "Dithered output"), { timeout: 30000 });
  const report = await page.evaluate(async () => {
    const m = window.__mok, st = m.registry.state, gl = st.gl, composer = m.registry.composer;
    m.useUI.setState({ playing: false }); st.setFrameloop('never');
    const accumulate = m.registry.linearCapture;
    const straight = composer.passes.find(p => p.name === 'Straight color for tone mapping');
    const output = composer.passes.find(p => p.name === 'Dithered output');
    if (!straight || !output) throw new Error('New output passes missing: ' + composer.passes.map(p => p.name).join(','));
    const input = composer.inputBuffer.clone(), sum = composer.inputBuffer.clone(), unassociated = composer.inputBuffer.clone();
    for (const target of [input, sum, unassociated]) { target.samples = 0; target.depthBuffer = false; target.setSize(4, 4); }
    const color = gl.getClearColor({ copy: c => c.clone() }), alpha = gl.getClearAlpha(), target = gl.getRenderTarget();
    const context = gl.getContext(), beforeSize = [composer.inputBuffer.width, composer.inputBuffer.height];
    const beforeOutput = output.renderToScreen;
    function half(value) { const sign = value & 0x8000 ? -1 : 1, exponent = (value >> 10) & 31, mantissa = value & 1023; return sign * (exponent ? Math.pow(2, exponent - 15) * (1 + mantissa / 1024) : Math.pow(2, -14) * mantissa / 1024); }
    function clear(r, g, b, a) { gl.setRenderTarget(input); context.clearColor(r, g, b, a); context.clear(context.COLOR_BUFFER_BIT); }
    function readLinear() { const pixels = new Uint16Array(4); gl.readRenderTargetPixels(sum, 0, 0, 1, 1, pixels); return [...pixels].map(half); }
    function present() { straight.render(gl, sum, unassociated); output.renderToScreen = true; output.render(gl, unassociated, sum); const pixels = new Uint8Array(4); context.readPixels(20, 20, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixels); return [...pixels]; }
    const results = [];
    try {
      accumulate.setSize(4, 4);
      for (const fixture of [
        { name: 'linear black/white mean', frames: [[0, 0, 0, 1], [1, 1, 1, 1]], expectedLinear: [.5, .5, .5, 1], expectedDisplay: [188, 188, 188, 255] },
        { name: 'half-coverage gray retains its color', frames: [[0, 0, 0, 0], [.5, .5, .5, 1]], expectedLinear: [.25, .25, .25, .5], expectedDisplay: [94, 94, 94, 128] },
        { name: 'sharpen undershoot cannot become negative light', frames: [[-.5, -.1, .25, 1]], expectedLinear: [-.5, -.1, .25, 1], expectedDisplay: [0, 0, 137, 255] },
        { name: 'bright radiance survives temporal integration', frames: [[0, 0, 0, 1], [4, 2, 1, 1]], expectedLinear: [2, 1, .5, 1], expectedDisplay: [255, 255, 188, 255] },
      ]) {
        accumulate.beginFrame(fixture.frames.length);
        for (const values of fixture.frames) { clear(...values); accumulate.beginSample(); accumulate.render(gl, input, sum); clear(10, 10, 10, 1); accumulate.render(gl, input, sum); }
        accumulate.endFrame();
        const linear = readLinear(), display = present();
        if (linear.some((v, i) => Math.abs(v - fixture.expectedLinear[i]) > .004)) throw new Error(`${fixture.name}: radiance ${linear}`);
        if (display.some((v, i) => Math.abs(v - fixture.expectedDisplay[i]) > 2)) throw new Error(`${fixture.name}: display ${display}`);
        results.push({ name: fixture.name, linear, display });
      }
      return { results, renderer: context.getParameter(context.RENDERER), errors: context.getError() };
    } finally {
      accumulate.cancel(); accumulate.setSize(...beforeSize); output.renderToScreen = beforeOutput;
      for (const rt of [input, sum, unassociated]) rt.dispose();
      gl.setRenderTarget(target); gl.setClearColor(color, alpha); st.setFrameloop('demand'); st.invalidate();
    }
  });
  if (report.errors || errors.length) throw new Error(JSON.stringify({ report, errors }));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
