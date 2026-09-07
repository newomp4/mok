import './test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createProject } = await import('../src/lib/defaults.ts');
const { useEditor, undo, beginInteraction, endInteraction } = await import('../src/store/editor.ts');
const { useUI } = await import('../src/store/ui.ts');
const { validLease, canEditProject, writeTicket, useProjectOwnership } = await import('../src/lib/projectOwnership.ts');
const { insertLogoFromPicker } = await import('../src/lib/logoInsertion.ts');
const reset = () => { useProjectOwnership.setState({ enabled: false }); const p = createProject(); useEditor.getState().replaceProject(p); useEditor.temporal.getState().clear(); return useEditor.getState().project; };

test('leases reject other tokens and expire at their boundary', () => {
  assert.equal(validLease({ token: 'a', expires: 30 }, 'a', 29), true);
  assert.equal(validLease({ token: 'a', expires: 30 }, 'b', 29), false);
  assert.equal(validLease({ token: 'a', expires: 30 }, 'a', 30), false);
  assert.equal(validLease(undefined, 'a', 10), false);
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
