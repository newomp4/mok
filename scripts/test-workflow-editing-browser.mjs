// Disposable browser context; exercises the real controls and file decoders.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve('automation/package.json'));
const { chromium } = require('playwright');
const output = resolve(process.argv[2] ?? '../workflow-editing-qa'); await mkdir(output, { recursive: true });
const url = process.env.MOK_QA_URL ?? 'http://localhost:35361';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.removeItem('mok:seen-version'); });
const report = { url, checks: [], errors: [] }; const page = await context.newPage(); page.on('pageerror', (e) => report.errors.push(String(e)));
const check = (name) => { report.checks.push(name); console.log('PASS', name); };
const project = () => page.evaluate(() => window.__mok.useEditor.getState().project);
const settle = () => page.waitForFunction(() => window.__mok?.ownership.state.getState().mode === 'editing' && window.__mok?.registry.state);
const undo = async () => { await page.locator('body').click({ position: { x: 8, y: 8 } }); await page.keyboard.press('Meta+z'); };
const number = async (label, value) => { await page.getByRole('spinbutton', { name: label, exact: true }).dblclick(); const input = page.getByRole('textbox', { name: label, exact: true }); await input.fill(String(value)); await input.press('Enter'); };
try {
  await page.goto(url); await settle(); await page.evaluate(async () => {
    const m=window.__mok,p=structuredClone(m.useEditor.getState().project); p.id='editing-workflows';p.name='Editing workflows';p.mockup.device='flat';p.mockup.finish='black';p.scene.preset='custom';p.scene.background.type='color';p.scene.background.color='#121825';p.scene.shadow=0;p.effects=[];p.shots=[p.shots[0]];Object.assign(p.shots[0],{id:'editing-shot',name:'Shot 1',kind:'media',duration:4,keyframes:{}});
    m.useEditor.getState().replaceProject(p);if(!await m.ownership.ready(p.id))throw new Error('No lease');m.useUI.setState({modal:null,tourStep:null,timelineOpen:true,activeShotId:'editing-shot',time:0});m.useEditor.temporal.getState().clear();
  });
  const original=await project();
  await page.getByRole('button',{name:'Release editing',exact:true}).click();
  await page.getByRole('button',{name:'Add',exact:true}).click();await page.getByRole('button',{name:/^Shot from camera/}).click();
  assert.deepEqual(await project(),original);assert.deepEqual(report.errors,[]);check('Read-only Add → Shot from camera leaves the project intact without throwing');
  await page.getByRole('button',{name:'Edit here',exact:true}).click();await settle();
  await page.evaluate(async()=>{
    const svg=(color)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${color}"/></svg>`;
    await window.__mok.actions.importFilesToShot([new File([svg('#b84e36')],'first.svg',{type:'image/svg+xml'}),new File(['broken'],'broken.png',{type:'image/png'}),new File([svg('#3b77bb')],'last.svg',{type:'image/svg+xml'})],'editing-shot');
  });
  let p=await project();assert.equal(p.shots.length,2);assert.equal(p.shots[0].media.name,'first.svg');assert.equal(p.shots[1].media.name,'last.svg');assert.notEqual(p.shots[0].media.id,p.shots[1].media.id);assert.match(await page.evaluate(()=>window.__mok.useUI.getState().toast.text),/2 files added.*1 skipped.*broken.png/);assert.equal(await page.evaluate(()=>window.__mok.useEditor.temporal.getState().pastStates.length),1);
  const batch=structuredClone(p);await undo();assert.equal((await project()).shots.length,1);assert.equal((await project()).shots[0].media,original.shots[0].media);check('A corrupt file between two images is skipped without a ghost shot; one undo restores the batch');
  await page.evaluate(async(p)=>{const m=window.__mok;m.useEditor.getState().replaceProject(p);await m.ownership.ready(p.id);m.useEditor.getState().update(p=>{p.mockup.device='iphone-17-pro-glb';p.mockup.finish='silver';p.shots[0].orientation='landscape';});m.useUI.setState({activeShotId:'editing-shot',time:0,cropShot:'editing-shot'});},batch);
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Screen',exact:true}).click();const cropText=await dialog.innerText();assert.match(cropText,/1200 × 55[0-9]/);await page.screenshot({path:join(output,'landscape-crop.png')});
  await dialog.getByRole('button',{name:'Crop media',exact:true}).click();await page.waitForFunction(()=>!window.__mok.useUI.getState().cropShot);p=await project();assert.equal(p.shots[0].media.width,1200);assert.ok(p.shots[0].media.height>=550&&p.shots[0].media.height<=559);await undo();assert.equal((await project()).shots[0].media.height,800);check('Screen crop follows landscape phone orientation and applies an undoable crop with the correct aspect');
  await page.evaluate(()=>{const m=window.__mok;m.useEditor.getState().update(p=>{p.mockup.device='flat';p.mockup.finish='black';delete p.shots[0].orientation;p.shots=[p.shots[0]];});m.useUI.setState({activeShotId:'editing-shot',time:1});m.useEditor.temporal.getState().clear();});
  await page.getByRole('button',{name:/^Caption/}).click();await page.getByRole('switch',{name:'Show caption',exact:true}).click();await page.getByPlaceholder('Type your caption').fill('MADE FOR THIS MOMENT');await page.getByPlaceholder('Type your caption').press('Tab');
  await number('Horizontal offset',8);await number('Vertical offset',18);
  await page.waitForTimeout(400);await page.getByRole('button',{name:/^Layer /}).click();await page.getByRole('option',{name:'Behind device',exact:true}).click();
  p=await project();assert.equal(p.shots[0].caption.text.text,'MADE FOR THIS MOMENT');assert.equal(p.shots[0].caption.x,.08);assert.equal(p.shots[0].caption.y,.18);assert.equal(p.shots[0].caption.layer,'behind');
  await page.waitForFunction(()=>{const mesh=window.__mok.registry.state.scene.getObjectByName('caption-overlay');return mesh?.visible&&mesh.renderOrder===-50&&mesh.material.transparent===false&&mesh.material.uniforms.opacity.value===1;});
  await page.screenshot({path:join(output,'caption-behind.png')});await undo();assert.equal((await project()).shots[0].caption.layer,'front');
  await page.waitForFunction(()=>{const mesh=window.__mok.registry.state.scene.getObjectByName('caption-overlay');return mesh?.renderOrder===902&&mesh.material.transparent===true;});check('Caption text, placement and layer controls update the live renderer and undo correctly');
  await page.getByRole('button',{name:'Position on canvas',exact:true}).click();
  const overlay=page.getByRole('region',{name:'Position caption on canvas',exact:true}),bounds=await overlay.boundingBox();const beforeDrag=await project();
  await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.5);await page.mouse.down();
  for(const type of ['pointerdown','pointermove','pointerup'])await overlay.dispatchEvent(type,{pointerId:2,pointerType:'touch',isPrimary:false,button:0,clientX:bounds.x+10,clientY:bounds.y+10,bubbles:true});
  assert.deepEqual((await project()).shots[0].caption,beforeDrag.shots[0].caption);
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.6,{steps:6});await page.mouse.up();
  p=await project();assert.ok(Math.abs(p.shots[0].caption.x-.18)<.004);assert.ok(Math.abs(p.shots[0].caption.y-.08)<.004);assert.deepEqual(p.camera,beforeDrag.camera);assert.deepEqual(p.shots[0].pose,beforeDrag.shots[0].pose);
  await page.mouse.wheel(0,80);await page.waitForTimeout(300);assert.deepEqual((await project()).camera,beforeDrag.camera);await page.getByRole('button',{name:'Done',exact:true}).click();await undo();assert.deepEqual((await project()).shots[0].caption,beforeDrag.shots[0].caption);check('Canvas positioning moves only the caption, blocks wheel/orbit and groups the drag into one undo');
  const historyBeforeCancel=await page.evaluate(()=>window.__mok.useEditor.temporal.getState().pastStates.length);await page.getByRole('button',{name:'Position on canvas',exact:true}).click();await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.5,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await overlay.count(),0);assert.deepEqual((await project()).shots[0].caption,beforeDrag.shots[0].caption);assert.equal(await page.evaluate(()=>window.__mok.useEditor.temporal.getState().pastStates.length),historyBeforeCancel);
  await page.getByRole('button',{name:'Position on canvas',exact:true}).click();await page.evaluate(()=>window.__mok.useUI.setState({exporting:{label:'Fixture',progress:0}}));assert.equal(await overlay.count(),0);await page.evaluate(()=>window.__mok.useUI.setState({exporting:null}));
  await page.getByRole('button',{name:'Position on canvas',exact:true}).click();await page.getByRole('button',{name:'Release editing',exact:true}).click();assert.equal(await overlay.count(),0);await page.getByRole('button',{name:'Position on canvas',exact:true}).click();assert.equal(await overlay.count(),0);await page.getByRole('button',{name:'Edit here',exact:true}).click();await settle();check('Escape cancels an active drag; export and read-only ownership dismiss the positioning tool');
  const beforeReload=(await project()).shots[0].caption;await page.reload();await settle();assert.deepEqual((await project()).shots[0].caption,beforeReload);check('Immediate reload preserves the new caption and its typography/placement');
  const portable=await page.evaluate(async()=>{const m=window.__mok,p=m.useEditor.getState().project,blob=await m.persistence.exportProjectFile(p),copy=await m.persistence.importProjectFile(blob);return {original:p.shots[0].caption,copy:copy.shots[0].caption,media:copy.shots[0].media,oldMedia:p.shots[0].media};});assert.deepEqual(portable.original,portable.copy);assert.notEqual(portable.media.id,portable.oldMedia.id);assert.equal(portable.media.name,portable.oldMedia.name);check('Portable export/import retains captions while isolating uploaded media IDs');
  await page.getByRole('button',{name:/^Caption/}).click();await page.getByRole('button',{name:'Remove caption',exact:true}).click();assert.equal((await project()).shots[0].caption,undefined);await undo();assert.deepEqual((await project()).shots[0].caption,beforeReload);check('Removing a caption is reversible in one undo');
  await page.evaluate(()=>{const m=window.__mok;m.useEditor.getState().update(p=>{p.shots[0].keyframes={'camera.x':[{t:0,v:-20,ease:'linear'},{t:4,v:20,ease:'linear'}]};p.shots[0].audio={enabled:true,volume:1,fadeIn:1,fadeOut:1};});m.useUI.setState({time:2,activeShotId:'editing-shot',timelineMode:'advanced'});m.useEditor.temporal.getState().clear();});
  await page.locator('[data-shot="editing-shot"]').click({button:'right'});await page.getByRole('button',{name:/^Split at playhead/}).click();p=await project();assert.equal(p.shots.length,2);const second=p.shots[1].id;assert.equal(p.shots[1].caption.timing.offset,2);assert.equal(p.shots[1].audio.envelope.offset,2);
  await page.evaluate((id)=>window.__mok.useUI.setState({activeShotId:id,time:2}),second);await page.getByRole('button',{name:'Position on canvas',exact:true}).click();await page.locator('[data-shot="editing-shot"]').click();assert.equal(await overlay.count(),0);
  const handle=page.locator(`[data-shot="${second}"] [title="Trim the start"]`),h=await handle.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+24,h.y+h.height/2,{steps:5});await page.mouse.up();p=await project();const trimmed=p.shots[1],dt=2-trimmed.duration;assert.ok(dt>.1&&dt<.5);assert.ok(Math.abs(trimmed.caption.timing.offset-(2+dt))<1e-6);assert.ok(Math.abs(trimmed.audio.envelope.offset-(2+dt))<1e-6);assert.ok(Math.abs(trimmed.trimStart-(2+dt))<1e-6);await undo();assert.equal((await project()).shots[1].duration,2);assert.equal((await project()).shots[1].caption.timing.offset,2);check('Actual split and head-trim controls retain caption/source fade phase and undo; changing shots exits positioning');
  const beforeReverse=(await project()).shots[1].keyframes;await page.locator(`[data-shot="${second}"]`).click({button:'right'});await page.getByRole('button',{name:'Reverse',exact:true}).click();const reversed=(await project()).shots[1].keyframes;assert.equal(reversed['camera.x'][0].v,beforeReverse['camera.x'].at(-1).v);await undo();assert.deepEqual((await project()).shots[1].keyframes,beforeReverse);check('Reverse in the shot menu reverses the camera animation and is undoable');
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error) { report.failure=String(error.stack??error);await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});report.text=await page.locator('body').innerText().catch(()=>'');throw error; }
finally { await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await browser.close(); }
