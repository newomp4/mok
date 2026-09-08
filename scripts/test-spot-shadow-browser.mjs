// Actual shipped MacBook spotlight regression: low-precision legacy camera, calibrated camera, and shadows disabled.
// MOK_QA_URL=http://127.0.0.1:35362 MOK_QA_NODE_MODULES=... node scripts/test-spot-shadow-browser.mjs [output-dir]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] ?? '../spot-shadow-check'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const report = { url: process.env.MOK_QA_URL ?? 'http://127.0.0.1:35362', cases: [], errors };
const cases = ['darkroom', 'concrete'].flatMap(scene => ['current', 'legacy', 'disabled'].map(mode => ({ id: `${scene}-${mode}`, scene, mode, device: 'macbook-pro-14-glb' })));

try {
  await page.goto(report.url); await page.waitForFunction(() => window.__mok?.registry.composer);
  const selected = process.env.MOK_QA_CASES?.split(','); const pixels = new Map();
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
      const gl = m.registry.state.gl, originalRender = gl.render; const materials=new Set();m.registry.state.scene.traverse(o=>{for(const mat of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(mat);});for(const mat of materials)mat.needsUpdate=true;
      let activeMaps = false, near = 0;
      gl.render = function(scene, camera) {
        if(fixture.mode==='disabled') gl.shadowMap.enabled=false;
        scene.traverse(o=>{if(o.isSpotLight&&o.castShadow){
          if(fixture.mode==='legacy'){o.shadow.camera.near=.5;o.shadow.camera.updateProjectionMatrix();}
          near=o.shadow.camera.near;activeMaps ||= gl.shadowMap.enabled && !!o.shadow.map;
        }});
        return originalRender.call(this,scene,camera);
      };
      const started = performance.now();
      const blob = await m.capture.captureImage({ width: 1600, height: 900, format: 'png', transparent: false, time: 0 });
      gl.render=originalRender;gl.shadowMap.enabled=true;for(const mat of materials)mat.needsUpdate=true; const elapsedMs = performance.now() - started;
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let min = 255, max = 0, minAlpha = 255, clipped = 0;
      for (let i = 0; i < data.length; i += 4) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; min = Math.min(min, l); max = Math.max(max, l); minAlpha = Math.min(minAlpha, data[i + 3]); if (l > 254) clipped++; }
      const lights = [];
      m.registry.state.scene.traverseVisible(o => { if (o.isLight) lights.push({ type: o.type, intensity: o.intensity, position: o.position.toArray(), quaternion: o.quaternion.toArray() }); });
      let steps = 0;
      for(let y=703;y<744;y++)for(let x=560;x<1110;x++){
        const i=(y*canvas.width+x)*4,j=i+4;
        if(Math.abs((data[i]+data[i+1]+data[i+2]-data[j]-data[j+1]-data[j+2])/3)>4)steps++;
      }
      // Compare the visible subject as well as checking the calibrated shadow camera; the controlled GPU fixture supplies the positive shadow case.
      const subject=ctx.getImageData(400,140,850,690).data;
      return { subject:[...subject], steps, activeMaps, near, bytes: [...new Uint8Array(await blob.arrayBuffer())], version: m.version, width: canvas.width, height: canvas.height, elapsedMs, luminance: [min, max], minAlpha, clipped, draws: m.registry.state.gl.info.render.calls, lights, environmentIntensity: m.registry.state.scene.environmentIntensity };
    }, fixture);
    await writeFile(join(out, `${fixture.id}.png`), Buffer.from(result.bytes)); delete result.bytes;
    pixels.set(fixture.id,result.subject); delete result.subject; report.cases.push({ ...fixture, ...result });
    if (result.width !== 1600 || result.height !== 900 || result.minAlpha !== 255 || result.luminance[1] - result.luminance[0] < 20) throw new Error(`${fixture.id}: invalid or blank output`);
    if (result.lights.some(light => ![light.intensity, ...light.position, ...light.quaternion].every(Number.isFinite))) throw new Error(`${fixture.id}: invalid light transform`);
    if (fixture.intensity === 0 && (result.environmentIntensity !== 0 || result.lights.some(light => light.intensity !== 0))) throw new Error('The lighting control does not reach zero');
    console.log(`${fixture.id}: ${Math.round(result.elapsedMs)}ms, ${result.draws} draws`);
  }
  for(const scene of ['darkroom','concrete']) {
    const current=report.cases.find(c=>c.id===scene+'-current'), legacy=report.cases.find(c=>c.id===scene+'-legacy');
    if(!current || !legacy)continue;
    if(!current.activeMaps || current.near<=.5)throw new Error('Calibrated spotlight shadow was disabled or not applied');
    if(scene==='darkroom' && current.steps>=legacy.steps*.8)throw new Error(`Stepped palm-rest regression: ${current.steps} current vs ${legacy.steps} legacy`);
    const a=pixels.get(scene+'-current'), b=pixels.get(scene+'-disabled');
    if(b){let changed=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>2)changed++;
      current.retainedShadowPixels=changed;
      if(changed<100)throw new Error('Useful keyboard/lid shadow pixels disappeared');
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  report.passed = true;
} finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
