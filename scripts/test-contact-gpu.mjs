// Actual GPU checks of caster selection and height-dependent contact footprints.
// MOK_QA_NODE_MODULES=... MOK_QA_CHANNEL=chrome node scripts/test-contact-gpu.mjs [report.json]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const qaRequire = process.env.MOK_QA_NODE_MODULES ? createRequire(join(process.env.MOK_QA_NODE_MODULES, 'package.json')) : require;
const { chromium, firefox, webkit } = qaRequire('playwright');
const engine = process.env.MOK_QA_ENGINE ?? 'chromium';
const launcher = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
const threeDir = dirname(require.resolve('three'));
const server = createServer(async (req, res) => {
  try {
    let source;
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Mok contact GPU regression</title>'); return; }
    if (req.url === '/three.js' || req.url === '/three.core.js') source = await readFile(join(threeDir, req.url === '/three.js' ? 'three.module.js' : 'three.core.js'), 'utf8');
    else if (req.url === '/contactShadowPass.js' || req.url === '/renderPass.js') {
      source = ts.transpileModule(await readFile(new URL(`../src/three${req.url.replace('.js', '.ts')}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('"three"', '"/three.js"').replaceAll('"@/three/renderPass"', '"/renderPass.js"');
    } else { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); res.end(source);
  } catch (e) { res.writeHead(500).end(String(e)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launcher.launch({ headless: true, ...(engine !== 'chromium' ? {} : process.env.MOK_QA_CHANNEL ? { channel: process.env.MOK_QA_CHANNEL } : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const report = await page.evaluate(async () => {
    const T = await import('/three.js');
    const { createContactShadowResources, renderContactShadow } = await import('/contactShadowPass.js');
    const gl = new T.WebGLRenderer({ antialias: false }); gl.setSize(256, 256); document.body.append(gl.domElement);
    const context = gl.getContext(), ext = context.getExtension('WEBGL_debug_renderer_info');
    const scene = new T.Scene(), mainCamera = new T.PerspectiveCamera(), shadow = new T.Group(); scene.add(shadow);
    const camera = new T.OrthographicCamera(-2, 2, 2, -2, 0, 2); camera.rotation.x = Math.PI / 2; camera.updateMatrixWorld();
    const resources = createContactShadowResources(4, 256);
    const createBox = y => { const box = new T.Mesh(new T.BoxGeometry(.8, .1, .8), new T.MeshBasicMaterial()); box.position.y = y + .05; scene.add(box); return box; };
    const near = createBox(.01), far = createBox(.85);
    function render(blur = 4) {
      renderContactShadow(gl, scene, mainCamera, shadow, camera, resources, blur);
      const pixels = new Uint16Array(256 * 256 * 4); gl.readRenderTargetPixels(resources.target, 0, 0, 256, 256, pixels);
      const output = new Float32Array(256 * 256);
      for (let i = 0; i < output.length; i++) output[i] = T.DataUtils.fromHalfFloat(pixels[i * 4]) + T.DataUtils.fromHalfFloat(pixels[i * 4 + 1]) + T.DataUtils.fromHalfFloat(pixels[i * 4 + 2]);
      return output;
    }
    function footprint(values) {
      let weight = 0, moment = 0, peak = 0, tail = 0;
      for (let x = 0; x < 256; x++) { const a = values[128 * 256 + x]; weight += a; moment += a * (x - 127.5) ** 2; peak = Math.max(peak, a); if (Math.abs(x - 127.5) > 30) tail += a; }
      return { weight, variance: moment / weight, peak, tail: tail / weight };
    }
    function maxDifference(a, b) { return a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0); }
    const assert = (value, message) => { if (!value) throw new Error(message); };
    near.renderOrder = 1; far.renderOrder = 2; const first = render();
    near.renderOrder = 2; far.renderOrder = 1; const second = render();
    const orderDifference = maxDifference(first, second); assert(orderDifference < .001, `draw order changes nearest contact: ${orderDifference}`);
    // The old disabled-depth method really did depend on draw order for these overlapping surfaces.
    resources.depth.depthTest = resources.depth.depthWrite = false;
    const legacyFirst = render(); near.renderOrder = 1; far.renderOrder = 2; const legacySecond = render();
    const legacyOrderDifference = maxDifference(legacyFirst, legacySecond); assert(legacyOrderDifference > .1, 'fixture must expose disabled-depth defect');
    resources.depth.depthTest = resources.depth.depthWrite = true;
    far.visible = false; const nearShape = render(), nearFootprint = footprint(nearShape);
    near.visible = false; far.visible = true; const farFootprint = footprint(render());
    assert(farFootprint.variance > nearFootprint.variance * 1.1, 'raised caster must have a wider penumbra');
    assert(farFootprint.peak < nearFootprint.peak * .5, 'raised caster must lose contact density');
    assert(farFootprint.tail > nearFootprint.tail + .01, 'height must soften outside the silhouette');
    far.visible = false; near.visible = true;
    const helper = createBox(.001); helper.scale.set(3, 1, 3); helper.material.transparent = true; helper.material.opacity = 0;
    assert(maxDifference(nearShape, render()) < .001, 'invisible helper casts contact shadow');
    assert(helper.visible, 'temporary visibility leaked'); helper.material.transparent = false;
    assert(maxDifference(nearShape, render()) > .1, 'opaque opacity-zero material was incorrectly ignored');
    const gpuError = context.getError(); assert(gpuError === 0, `GPU error ${gpuError}`);
    const result = { renderer: ext ? context.getParameter(ext.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER), orderDifference, legacyOrderDifference, near: nearFootprint, raised: farFootprint, invisibleHelperExcluded: true, gpuError };
    for (const value of Object.values(resources)) value?.dispose?.();
    for (const box of [near, far, helper]) { box.geometry.dispose(); box.material.dispose(); }
    gl.dispose(); return result;
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
