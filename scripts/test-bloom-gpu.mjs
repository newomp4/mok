// Actual half-float shader readback: premultiplied bloom, opaque parity and empty/low-alpha pixels.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.removeItem('mok:seen-version'); });
  await page.goto(process.env.MOK_QA_URL ?? 'http://127.0.0.1:3000', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mok?.registry.composer);
  await page.evaluate(async () => {
    const m = window.__mok; m.useUI.setState({ playing: false, modal: null, tourStep: null });
    const p = structuredClone(m.useEditor.getState().project); p.effects = [{ id: 'bloom', enabled: true, params: {} }];
    for (const s of p.shots) delete s.effects;
    m.useEditor.getState().replaceProject(p);
  });
  await page.waitForFunction(() => window.__mok.registry.composer.passes.some(p => p.effects?.some(e => e.name === 'BloomEffect')));
  const results = await page.evaluate(() => {
    const m = window.__mok, st = m.registry.state, gl = st.gl, composer = m.registry.composer;
    const existing = composer.passes.find(p => p.effects?.some(e => e.name === 'BloomEffect'));
    const effect = new (existing.effects.find(e => e.name === 'BloomEffect').constructor)();
    const pass = new existing.constructor(st.camera, effect);
    const input = composer.inputBuffer.clone(), glow = input.clone(), output = input.clone();
    for (const rt of [input, glow, output]) { rt.samples = 0; rt.depthBuffer = false; rt.setSize(4, 4); }
    const mode = st.frameloop, target = gl.getRenderTarget(), color = gl.getClearColor({ copy: c => c.clone() }), alpha = gl.getClearAlpha();
    st.setFrameloop('never'); pass.initialize(gl, true, input.texture.type); pass.setSize(4, 4);
    effect.uniforms.get('map').value = glow.texture; effect.intensity = 1;
    effect.update = () => {}; // Feed known radiance; this test isolates the actual composition shader.
    const context = gl.getContext();
    const half = v => { const s = v & 32768 ? -1 : 1, e = (v >> 10) & 31, n = v & 1023; return s * (e ? 2 ** (e - 15) * (1 + n / 1024) : 2 ** -14 * n / 1024); };
    const fixtures = [
      { name: 'opaque SCREEN parity', base: [.2, .4, .8, 1], glow: [.1, .05, .2, 0], want: [.28, .43, .84, 1] },
      { name: 'glow owns coverage over transparent pixels', base: [0, 0, 0, 0], glow: [.05, .02, 0, 0], want: [.05, .02, 0, .05] },
      { name: 'thin black shadow cannot amplify tiny bloom into a white ring', base: [0, 0, 0, .001], glow: [.01, .003, 0, 0], want: [.01, .003, 0, .01099] },
      { name: 'no bloom leaves shadow and empty background intact', base: [0, 0, 0, .2], glow: [0, 0, 0, 1], want: [0, 0, 0, .2] },
      { name: 'HDR opaque SCREEN parity', base: [3, .2, .1, 1], glow: [1.2, .3, .5, 0], want: [3.2, .44, .55, 1] },
    ], results = [];
    try {
      for (const fixture of fixtures) {
        for (const [rt, rgba] of [[input, fixture.base], [glow, fixture.glow]]) { gl.setRenderTarget(rt); context.clearColor(...rgba); context.clear(context.COLOR_BUFFER_BIT); }
        pass.render(gl, input, output, 0, false);
        const bits = new Uint16Array(4); gl.readRenderTargetPixels(output, 0, 0, 1, 1, bits); const actual = [...bits].map(half);
        if (actual.some((v, i) => Math.abs(v - fixture.want[i]) > .003)) throw new Error(`${fixture.name}: ${actual} != ${fixture.want}`);
        results.push({ name: fixture.name, actual });
      }
      if (context.getError()) throw new Error('WebGL error in bloom composition');
      return results;
    } finally {
      // Restore the owned bloom map before disposal; input fixtures are separately owned below.
      effect.uniforms.get('map').value = effect.texture; pass.dispose();
      for (const rt of [input, glow, output]) rt.dispose();
      gl.setRenderTarget(target); gl.setClearColor(color, alpha); st.setFrameloop(mode); st.invalidate();
    }
  });
  if (errors.length) throw new Error(errors.join('\n'));
  const report = { results, errors }; if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
