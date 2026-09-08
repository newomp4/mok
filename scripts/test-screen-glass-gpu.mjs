// Actual physical glass shader: local occlusion, premultiplied AA coverage, coating and zero-reflection endpoints.
// MOK_QA_NODE_MODULES=... MOK_QA_CHANNEL=chrome node scripts/test-screen-glass-gpu.mjs [report.json]
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
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Mok display glass GPU regression</title>'); return; }
    if (req.url === '/three.js' || req.url === '/three.core.js') source = await readFile(join(threeDir, req.url === '/three.js' ? 'three.module.js' : 'three.core.js'), 'utf8');
    else if (['/materials.js', '/screenGlass.js', '/screenGrid.js', '/surfaceDetail.js', '/environmentGain.js'].includes(req.url)) {
      source = ts.transpileModule(await readFile(new URL(`../src/three${req.url.replace('.js', '.ts')}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('"three"', '"/three.js"').replace(/"@\/three\/([a-zA-Z]+)"/g, '"/$1.js"');
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
    const { createScreenMaterial, applyScreenGlassProfile } = await import('/materials.js');
    const gl = new T.WebGLRenderer({ antialias: false }); gl.setSize(16, 16); document.body.append(gl.domElement);
    gl.toneMapping = T.NoToneMapping; gl.outputColorSpace = T.LinearSRGBColorSpace;
    const context = gl.getContext(), ext = context.getExtension('WEBGL_debug_renderer_info');
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 3;
    const texture = rgba => { const t = new T.DataTexture(new Float32Array(rgba), 1, 1, T.RGBAFormat, T.FloatType); t.needsUpdate = true; return t; };
    const black = texture([0, 0, 0, 1]);
    const envSource = new T.DataTexture(new Float32Array(512 * 256 * 4).fill(1), 512, 256, T.RGBAFormat, T.FloatType);
    envSource.mapping = T.EquirectangularReflectionMapping; envSource.needsUpdate = true;
    const pmrem = new T.PMREMGenerator(gl), env = pmrem.fromEquirectangular(envSource);
    const mat = createScreenMaterial(black); mat.envMap = env.texture;
    const panel = new T.Mesh(new T.PlaneGeometry(2, 2), mat); scene.add(panel);
    const target = new T.WebGLRenderTarget(16, 16, { type: T.HalfFloatType });
    mat.reflection.matrix.value.set(0,0,0,.5, 0,0,0,.5, 0,0,0,0, 0,0,0,1);
    const maps = [];
    const draw = (rgba, amount = 1) => {
      if (rgba) { const t = texture(rgba); maps.push(t); mat.reflection.map.value = t; }
      mat.reflection.amount.value = amount;
      gl.setRenderTarget(target); gl.render(scene, camera);
      const bits = new Uint16Array(4); gl.readRenderTargetPixels(target, 8, 8, 1, 1, bits);
      return [...bits].map(T.DataUtils.fromHalfFloat);
    };
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const near = (a, b, message, tolerance = .001) => assert(Math.abs(a - b) < tolerance, `${message}: ${a} != ${b}`);
    const environment = draw([0,0,0,0], 0), sameLocal = draw([1,1,1,1]), halfCovered = draw([.5,.5,.5,.5]), blackOccluder = draw([0,0,0,1]);
    assert(environment[0] > .03 && environment[0] < .05, `ordinary glass should have its physical 4% interface: ${environment}, local ${sameLocal}`);
    for(let i=0;i<3;i++) {
      near(sameLocal[i], environment[i], 'same radiance doubles the reflected environment');
      near(halfCovered[i], environment[i], 'partially covered premultiplied reflection has a dark seam');
      near(blackOccluder[i], 0, 'opaque local surface failed to occlude the environment');
    }
    // The old additive implementation returns the BRDF plus its separate 3.5% mirror gain.
    const legacyCompile = mat.onBeforeCompile, legacyKey = mat.customProgramCacheKey();
    mat.onBeforeCompile = (shader, renderer) => {
      legacyCompile.call(mat, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('radiance = radiance * (1.0 - coverage) + localRadiance;', '')
        .replace('clearcoatRadiance = clearcoatRadiance * (1.0 - coverage) + localRadiance;', '')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectSpecular += texture2D(reflectMap, vec2(.5)).rgb * .035;\n#include <aomap_fragment>');
    };
    mat.customProgramCacheKey = () => legacyKey + ':legacy'; mat.needsUpdate = true;
    const oldDoubled = draw([1,1,1,1]); assert(oldDoubled[0] > sameLocal[0] * 1.6, 'fixture does not expose additive energy defect');
    mat.onBeforeCompile = legacyCompile; mat.customProgramCacheKey = () => legacyKey; mat.needsUpdate = true;
    const uniform = mat.glassF0; applyScreenGlassProfile(mat, 'pro-display-xdr-glb');
    const xdr = draw([1,1,1,1]); near(xdr[0] / sameLocal[0], .0165 / .04, 'XDR profile does not lower normal-incidence glass reflection', .015);
    assert(mat.glassF0 === uniform, 'profile replaced live shader uniform');
    applyScreenGlassProfile(mat, 'iphone-17-pro-glb'); const restored = draw([1,1,1,1]); near(restored[0], sameLocal[0], 'device switch retained the previous coating');
    // A null environment still permits local scene reflection; the non-env shader variant must compile.
    mat.envMap = null; mat.needsUpdate = true; const localOnly = draw([1,1,1,1]); near(localOnly[0], sameLocal[0], 'mirror depends on an environment map');
    mat.clearcoat = 0; mat.needsUpdate = true; const disabled = draw([0,0,0,0], 0); near(disabled[0], 0, 'reflection zero retains a second glass highlight');
    // UV padding is a black part of the glass sheet, not a hole to the backing.
    const red = texture([1,0,0,1]); maps.push(red); mat.emissiveMap = red; mat.needsUpdate = true;
    gl.setClearColor(0x00ff00, 0);
    const uv = panel.geometry.getAttribute('uv'), samples = [];
    for (const point of [[.5,.5],[-.001,.5],[1.001,.5],[.5,-.001],[.5,1.001]]) {
      for(let i=0;i<uv.count;i++) uv.setXY(i,...point); uv.needsUpdate = true;
      const pixel = draw(null,0); samples.push(pixel); near(pixel[3],1,'glass boundary lost opaque coverage');
      near(pixel[1],0,'green background leaked through the glass'); near(pixel[0],point[0]===.5&&point[1]===.5?1:0,'media emission escaped its original UV window');
    }
    const gpuError = context.getError(); assert(gpuError === 0, `GPU error ${gpuError}`);
    const result = { renderer: ext ? context.getParameter(ext.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER), environment, sameLocal, halfCovered, blackOccluder, oldDoubled, xdr, restored, localOnly, disabled, boundaryCoverage: samples, gpuError };
    for(const t of maps) t.dispose(); black.dispose(); env.dispose(); envSource.dispose(); pmrem.dispose(); target.dispose(); mat.dispose(); panel.geometry.dispose(); gl.dispose(); return result;
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
