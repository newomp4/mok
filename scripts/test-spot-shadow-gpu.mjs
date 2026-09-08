// Actual perspective VSM precision and useful shadow retention with controlled blockers and receivers.
// MOK_QA_NODE_MODULES=... MOK_QA_CHANNEL=chrome node scripts/test-spot-shadow-gpu.mjs [report.json]
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
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Mok spotlight GPU regression</title>'); return; }
    if (req.url === '/three.js' || req.url === '/three.core.js') source = await readFile(join(threeDir, req.url === '/three.js' ? 'three.module.js' : 'three.core.js'), 'utf8');
    else if (req.url === '/shadowCalibration.js' || req.url === '/bounds.js') {
      source = ts.transpileModule(await readFile(new URL(`../src/three${req.url.replace('.js', '.ts')}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('"three"', '"/three.js"').replaceAll('"@/three/bounds"', '"/bounds.js"');
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
    const { calibrateShadow, createReceiverOnlyShadowMaterial } = await import('/shadowCalibration.js');
    const gl=new T.WebGLRenderer();gl.setSize(256,256);gl.shadowMap.enabled=true;gl.shadowMap.type=T.VSMShadowMap;
    const scene=new T.Scene(), camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.set(4,3,6);camera.lookAt(0,0,0);
    const material=new T.MeshStandardMaterial({color:'#aaa',roughness:.8});
    const floor=new T.Mesh(new T.PlaneGeometry(12,12),material);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.customDepthMaterial=createReceiverOnlyShadowMaterial();scene.add(floor);
    const cube=new T.Mesh(new T.BoxGeometry(1,1,1),material);cube.position.y=.5;cube.castShadow=true;cube.receiveShadow=true;scene.add(cube);let subject=cube;
    const light=new T.SpotLight(0xffffff,300,44,.6,1);light.position.set(-4,7,-4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.radius=20;scene.add(light);
    scene.add(new T.HemisphereLight(0xffffff,0x222222,.1));const rt=new T.WebGLRenderTarget(256,256);
    const draw=(mode)=>{gl.shadowMap.enabled=mode!=='disabled';material.needsUpdate=true;calibrateShadow(light,subject,0,2,1024);if(mode==='legacy'){light.shadow.camera.near=.5;light.shadow.camera.updateProjectionMatrix();}gl.setRenderTarget(rt);gl.render(scene,camera);const pixels=new Uint8Array(256*256*4);gl.readRenderTargetPixels(rt,0,0,256,256,pixels);return pixels;};
    const current=draw('current'),legacy=draw('legacy'),disabled=draw('disabled');const diff=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i]);if(d>2)n++;max=Math.max(max,d);}return {n,max};};
    const shadow=diff(current,disabled), old=diff(legacy,disabled);
    if(shadow.n<100 || shadow.max<20)throw new Error('Fitted spotlight lost the visible caster shadow');
    // This is a positive shadow control, not the stepped-artifact fixture; the real Mac14 export covers that regression.
    scene.remove(cube);
    const laptop=new T.Group(), pieces=[];
    const box=(w,h,d,x,y,z)=>{const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;laptop.add(mesh);pieces.push(mesh);return mesh;};
    box(2.2,.1,1.6,0,.08,0);box(2.2,1.4,.04,0,.83,-.75);
    for(const x of [-.65,0,.65])box(.48,.08,.4,x,.17,-.2);
    subject=laptop;scene.add(laptop);const deckCurrent=draw('current'),deckDisabled=draw('disabled'),deckShadow=diff(deckCurrent,deckDisabled);
    if(deckShadow.n<100 || deckShadow.max<20)throw new Error(`Key-height and lid blockers no longer cast useful shadows: ${JSON.stringify(deckShadow)}`);
    const result={shadow,legacy:old,currentLegacy:diff(current,legacy),keyboardAndLid:deckShadow,near:light.shadow.camera.near,far:light.shadow.camera.far,bias:light.shadow.bias,normalBias:light.shadow.normalBias,gpuError:gl.getContext().getError()};
    if(result.gpuError)throw new Error('GPU error in spotlight calibration');
    for(const mesh of [cube,floor,...pieces])mesh.geometry.dispose();floor.customDepthMaterial.dispose();material.dispose();rt.dispose();light.shadow.dispose();gl.dispose();return result;
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
