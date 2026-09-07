import './test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createProject, defaultCaptionStyle, normalizeProject } = await import('../src/lib/defaults.ts');
const { useEditor, undo, beginInteraction, endInteraction } = await import('../src/store/editor.ts');
const { useUI } = await import('../src/store/ui.ts');
const { validLease, canEditProject, writeTicket, useProjectOwnership } = await import('../src/lib/projectOwnership.ts');
const { insertLogoFromPicker } = await import('../src/lib/logoInsertion.ts');
const { addShotFromCamera } = await import('../src/lib/actions.ts');
const { captureEditIntent } = await import('../src/lib/editIntent.ts');
const { cropScreenAspect } = await import('../src/lib/crop.ts');
const { getDevice } = await import('../src/lib/devices.ts');
const { trimShotHead } = await import('../src/lib/trimShot.ts');
const { sourceAudioGainAt } = await import('../src/lib/audioPlan.ts');
const { enterExitAt } = await import('../src/three/CardLayer.tsx');
const { previewCaption, startCaptionPosition, canPositionCaption } = await import('../src/lib/captionPosition.ts');
const reset = () => { useProjectOwnership.setState({ enabled: false }); const p = createProject(); useEditor.getState().replaceProject(p); useEditor.temporal.getState().clear(); return useEditor.getState().project; };

test('caption positioning starts at a visible frame and rejects export, another shot and read-only access', () => {
  const p=reset(),id=p.shots[0].id;p.shots[0].caption=defaultCaptionStyle();
  useUI.setState({time:0,playing:false,activeShotId:id,captionPosition:null,exporting:null,modal:null,cropShot:null,autoMotion:false});
  previewCaption(id);assert.equal(useUI.getState().time,.3);assert.equal(enterExitAt({...p.shots[0].caption,duration:p.shots[0].duration},useUI.getState().time).opacity,1);
  assert.equal(startCaptionPosition(id),true);assert.equal(canPositionCaption(),true);
  useUI.setState({activeShotId:p.shots[1].id});assert.equal(canPositionCaption(),false);
  useUI.setState({activeShotId:id,exporting:{label:'Export',progress:0}});assert.equal(canPositionCaption(),false);assert.equal(startCaptionPosition(id),false);
  useUI.setState({exporting:null});useProjectOwnership.setState({enabled:true,projectId:p.id,mode:'readonly',token:null});assert.equal(startCaptionPosition(id),false);assert.equal(canPositionCaption(),false);
  useUI.setState({captionPosition:null});reset();
});

test('leases reject other tokens and expire at their boundary', () => {
  assert.equal(validLease({ token: 'a', expires: 30 }, 'a', 29), true);
  assert.equal(validLease({ token: 'a', expires: 30 }, 'b', 29), false);
  assert.equal(validLease({ token: 'a', expires: 30 }, 'a', 30), false);
  assert.equal(validLease(undefined, 'a', 10), false);
});

test('returning a gesture to its starting values preserves undo and redo', () => {
  reset();beginInteraction();useEditor.getState().update(p=>{p.camera.panX=1;});endInteraction();undo();
  const before=structuredClone(useEditor.getState().project),t=useEditor.temporal.getState(),past=t.pastStates,future=t.futureStates;
  beginInteraction();useEditor.getState().update(p=>{p.camera.panX=.2;});useEditor.getState().update(p=>{p.camera.panX=before.camera.panX;});endInteraction();
  assert.deepEqual(useEditor.temporal.getState().pastStates,past);assert.deepEqual(useEditor.temporal.getState().futureStates,future);reset();
});

test('read-only blocks project mutations, direct writes and undo while allowing a different project to open', () => {
  const p = reset(); useEditor.getState().update((p) => { p.name = 'Before takeover'; });
  const snapshot = structuredClone(useEditor.getState().project);
  useProjectOwnership.setState({ enabled: true, projectId: p.id, mode: 'readonly', token: null, expires: 0 });
  const ed = useEditor.getState();
  ed.update((p) => { p.name = 'Overwrite'; }); ed.setValue('camera.zoom', 5); ed.addShot('logo'); ed.removeShot(p.shots[0].id); ed.duplicateShot(p.shots[0].id); ed.splitShot(p.shots[0].id, 1); undo();
  useEditor.setState({ project: { ...snapshot, name: 'Direct overwrite' } });
  ed.replaceProject({ ...snapshot, name: 'Replace overwrite' });
  assert.deepEqual(useEditor.getState().project, snapshot);
  assert.equal(writeTicket(p.id), null);
  const another = createProject(); ed.replaceProject(another);
  assert.equal(useEditor.getState().project.id, another.id);
  assert.equal(canEditProject(another.id), false, 'new project awaits its own claim');
  reset();
});

test('expired editing access cannot mutate; session-only edits have no persistent write ticket', () => {
  const p = reset();
  useProjectOwnership.setState({ enabled: true, projectId: p.id, mode: 'editing', token: 'test', expires: Date.now() - 1 });
  assert.equal(canEditProject(p.id), false); useEditor.getState().update((p) => { p.name = 'stale'; }); assert.equal(useEditor.getState().project.name, p.name);
  useProjectOwnership.setState({ mode: 'session' });
  assert.equal(canEditProject(p.id), true); assert.equal(writeTicket(p.id), null);
  reset();
});

test('column delete removes only matching keys in its shot, preserves near keys, and is one undo', () => {
  const p = reset(), id = p.shots[0].id;
  p.shots[0].keyframes = { 'camera.x': [{ t: 1, v: 1, ease: 'linear' }, { t: 1.001, v: 2, ease: 'linear' }], 'camera.y': [{ t: 1, v: 3, ease: 'linear' }], 'camera.z': [{ t: 2, v: 4, ease: 'linear' }] };
  p.shots[1].keyframes = { 'camera.x': [{ t: 1, v: 5, ease: 'linear' }] };
  const before = structuredClone(p); useUI.setState({ selectedKeys: [{ shotId: id, prop: 'camera.y', t: 1 }] });
  useEditor.getState().deleteKeyframeColumn(id, 1);
  let q = useEditor.getState().project;
  assert.deepEqual(q.shots[0].keyframes['camera.x'].map((k) => k.t), [1.001]);
  assert.equal(q.shots[0].keyframes['camera.y'], undefined);
  assert.equal(q.shots[0].keyframes['camera.z'][0].t, 2);
  assert.equal(q.shots[1].keyframes['camera.x'][0].v, 5);
  assert.deepEqual(useUI.getState().selectedKeys, []);
  assert.equal(useEditor.temporal.getState().pastStates.length, 1);
  undo(); assert.deepEqual(useEditor.getState().project, before);
});

test('cancelled logo chooser leaves project, endpoint and history untouched', async () => {
  const p = reset(), before = structuredClone(p);
  assert.equal(await insertLogoFromPicker(async () => undefined, p.shots[0].id), null);
  assert.deepEqual(useEditor.getState().project, before);
  assert.equal(useEditor.temporal.getState().pastStates.length, 0);
});

test('logo chooser cannot insert after switching away and back or deleting its insertion target', async () => {
  const p = reset(); let finish;
  const result = insertLogoFromPicker(() => new Promise((r) => { finish = r; }), p.shots[0].id);
  useEditor.getState().replaceProject(createProject()); useEditor.getState().replaceProject(p);
  finish(new File(['bad'], 'logo.png', { type: 'image/png' }));
  assert.equal(await result, null); assert.equal(useEditor.getState().project.shots.length, 2);
  let finish2; const result2 = insertLogoFromPicker(() => new Promise((r) => { finish2 = r; }), p.shots[0].id);
  useEditor.getState().removeShot(p.shots[0].id); finish2(new File(['bad'], 'logo.png', { type: 'image/png' }));
  assert.equal(await result2, null); assert.equal(useEditor.getState().project.shots.length, 1);
});

test('switching projects during a gesture cannot attach an old-project undo entry to the new project', () => {
  reset(); beginInteraction(); useEditor.getState().update((p) => { p.name = 'Gesture'; });
  const next = createProject(); useEditor.getState().replaceProject(next); useEditor.temporal.getState().clear(); endInteraction();
  assert.equal(useEditor.temporal.getState().pastStates.length, 0);
  assert.equal(useEditor.temporal.getState().isTracking, true);
  undo(); assert.equal(useEditor.getState().project.id, next.id);
});

test('read-only Shot from camera does not throw or create a misleading timeline state', () => {
  const p = reset(), before = structuredClone(p);
  useProjectOwnership.setState({ enabled: true, projectId: p.id, mode: 'readonly', token: null });
  assert.equal(addShotFromCamera(), ''); assert.deepEqual(useEditor.getState().project, before);
  assert.match(useUI.getState().toast.text, /read-only/); reset();
});

test('async edit intent stays cancelled after switching away and back or replacing and restoring a source', () => {
  const p = reset(), intent = captureEditIntent();
  useEditor.getState().replaceProject(createProject()); useEditor.getState().replaceProject(p);
  assert.equal(intent.current(), false); intent.dispose();
  const target = captureEditIntent((p) => !p.shots[0].media);
  useEditor.getState().update((p) => { p.shots[0].media = { id: 'replacement', name: 'replacement', kind: 'image', width: 100, height: 100 }; });
  useEditor.getState().update((p) => { p.shots[0].media = null; });
  assert.equal(target.current(), false); target.dispose();
});

test('new media shots inherit independent effect stacks and uniform padding', () => {
  const p = reset(), source = p.shots[0]; source.screenPadding = .18; source.effects = [{ id: 'grain', enabled: true, params: { amount: .1 } }];
  const id = useEditor.getState().addShot('media', source.id), q = useEditor.getState().project, added = q.shots.find((s) => s.id === id);
  assert.equal(added.screenPadding, .18); assert.deepEqual(added.effects, source.effects);
  assert.notEqual(added.effects, q.shots[0].effects); added.effects[0].params.amount = .5; assert.equal(q.shots[0].effects[0].params.amount, .1);
});

test('Screen crop uses upright orientation, padding and content below browser chrome', () => {
  const image = { id:'crop-source', name:'image', kind:'image', width:1200, height:800 }, phone = getDevice('iphone-17-pro-glb');
  const portrait = cropScreenAspect(phone, image, 'portrait', 0), landscape = cropScreenAspect(phone, image, 'landscape', 0);
  assert.ok(portrait < 1 && landscape > 1); assert.ok(Math.abs(portrait * landscape - 1) < 1e-10);
  assert.ok(cropScreenAspect(phone, image, 'landscape', .1) > landscape, 'uniform insets change the usable aspect');
  assert.equal(cropScreenAspect(getDevice('browser'), image, 'landscape', 0), 1.5, 'browser title bar is excluded');
  assert.equal(cropScreenAspect(getDevice('flat'), image, 'landscape', 0), 1.5);
  assert.equal(cropScreenAspect(getDevice('browser'), image, 'landscape', .1), (1200-160)/(800-160));
});

test('head trimming preserves source fade and caption animation phase from its gesture snapshot', () => {
  const p = reset(), original = p.shots[0]; original.duration = 4; original.trimStart = 1; original.speed = 1.5;
  original.audio = { enabled:true, volume:.8, fadeIn:3, fadeOut:2, envelope:{offset:1,duration:6} };
  original.caption = { ...defaultCaptionStyle(), enter:{effect:'slideUp',duration:3}, exit:{effect:'fade',duration:2}, timing:{offset:1,duration:6} };
  original.keyframes = { 'camera.x':[{t:2,v:3,ease:'linear'}] };
  const trimmed = structuredClone(original); trimShotHead(trimmed, original, .5); trimShotHead(trimmed, original, .8);
  assert.equal(trimmed.trimStart, 2.2); assert.equal(trimmed.duration, 3.2); assert.equal(trimmed.keyframes['camera.x'][0].t, 1.2);
  assert.equal(trimmed.audio.envelope.offset, 1.8); assert.equal(trimmed.caption.timing.offset, 1.8);
  for (const t of [.01,.3,1,2]) {
    assert.ok(Math.abs(sourceAudioGainAt(trimmed,t)-sourceAudioGainAt(original,t+.8))<1e-12);
    const a=enterExitAt({duration:6,enter:trimmed.caption.enter,exit:trimmed.caption.exit},1.8+t), b=enterExitAt({duration:6,enter:original.caption.enter,exit:original.caption.exit},1+t+.8);
    assert.deepEqual(a,b);
  }
});

test('captions normalize safely, remain media-only and survive split, duplicate and undo', () => {
  const p = reset(), shot = p.shots[0]; shot.duration=4; shot.caption={...defaultCaptionStyle(), layer:'behind', x:.2, y:-.15};
  const before=structuredClone(p); useEditor.getState().splitShot(shot.id,1.25); let q=useEditor.getState().project;
  assert.deepEqual(q.shots[0].caption.timing,{offset:0,duration:4}); assert.deepEqual(q.shots[1].caption.timing,{offset:1.25,duration:4});
  assert.deepEqual(normalizeProject(q).shots[1].caption,q.shots[1].caption); undo(); assert.deepEqual(useEditor.getState().project,before);
  useEditor.getState().duplicateShot(shot.id); q=useEditor.getState().project; assert.deepEqual(q.shots[0].caption,q.shots[1].caption); assert.notEqual(q.shots[0].caption,q.shots[1].caption);
  q.shots[0].caption.x=Infinity; q.shots[0].caption.text.size=NaN; q.shots[0].caption.layer='invalid'; q.shots[1].kind='text';
  const safe=normalizeProject(q); assert.equal(safe.shots[0].caption.x,0); assert.equal(safe.shots[0].caption.text.size,.065); assert.equal(safe.shots[0].caption.layer,'front'); assert.equal(safe.shots[1].caption,undefined);
});
