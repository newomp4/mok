import './test-loader.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const records = new Map();
let holdSamples = false;
const sampleWaiters = [];
globalThis.__ioSampleBlob = () => new Promise((resolve) => {
  const done = () => resolve(new Blob(['sample'], { type: 'image/png' }));
  if (holdSamples) sampleWaiters.push(done); else done();
});
let transaction = Promise.resolve();
const later = () => new Promise((r) => setTimeout(r, 1));
globalThis.__ioDb = {
  async get(key) { await later(); return records.has(key) ? structuredClone(records.get(key)) : undefined; },
  async set(key, value) { const copy = structuredClone(value); await later(); records.set(key, copy); },
  async del(key) { await later(); records.delete(key); },
  async keys() { return [...records.keys()]; },
  createStore() {
    return (_mode, callback) => {
      const next = transaction.then(() => {
        const staged = new Map(); let aborted = false;
        const tx = { error: null, abort() { aborted = true; queueMicrotask(() => this.onabort?.()); } };
        const store = {
          transaction: tx,
          get(key) {
            const request = {};
            setTimeout(() => {
              request.result = records.has(key) ? structuredClone(records.get(key)) : undefined;
              request.onsuccess?.();
              if (!aborted) { for (const [k, v] of staged) records.set(k, v); tx.oncomplete?.(); }
            }, 1);
            return request;
          },
          put(value, key) { staged.set(key, structuredClone(value)); },
        };
        return callback(store);
      });
      transaction = next.catch(() => {});
      return next;
    };
  },
  update(key, fn) { const next = transaction.then(async () => { await later(); records.set(key, fn(records.get(key))); }); transaction = next.catch(() => {}); return next; },
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'idb-keyval') return { url: 'data:text/javascript,export const {get,set,del,keys,update,createStore}=globalThis.__ioDb;', shortCircuit: true };
  if (specifier === './screens' && context.parentURL?.endsWith('/src/lib/actions.ts')) {
    const real = new URL('../src/lib/screens.ts', import.meta.url).href;
    return { url: `data:text/javascript,${encodeURIComponent(`export { getSampleScreen } from ${JSON.stringify(real)}; export const sampleScreenBlob = (...args) => globalThis.__ioSampleBlob(...args);`)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const urls = new Map(), revoked = new Set();
let urlIndex = 0, holdImages = false;
const imageWaiters = [];
URL.createObjectURL = (blob) => { const url = `blob:test-${++urlIndex}`; urls.set(url, blob); return url; };
URL.revokeObjectURL = (url) => { revoked.add(url); urls.delete(url); };
globalThis.Image = class {
  naturalWidth = 80; naturalHeight = 60;
  set src(value) { this._src = value; if (!value) return; const done = () => urls.get(value)?.name === 'broken.png' ? this.onerror?.() : this.onload?.(); if (holdImages) imageWaiters.push(done); else queueMicrotask(done); }
  get src() { return this._src; }
};
globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.(); }); } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.document = {
  hidden: false,
  createElement(tag) {
    assert.equal(tag, 'audio', 'this test only stubs audio decoding');
    return {
      duration: 4, pause() {}, load() {}, removeAttribute() {},
      set src(value) { this._src = value; queueMicrotask(() => this.onloadedmetadata?.()); },
      get src() { return this._src; },
    };
  },
};
const { createProject, createShot, createTextShot, createLogoShot, normalizeProject } = await import('../src/lib/defaults.ts');
const { validateMediaRef } = await import('../src/lib/validateProject.ts');
const persistence = await import('../src/lib/persistence.ts');
const media = await import('../src/lib/media.ts');
const audio = await import('../src/lib/audio.ts');
const { useEditor, undo } = await import('../src/store/editor.ts');
const { useUI } = await import('../src/store/ui.ts');
const { viewport, useRenderFlags } = await import('../src/three/registry.ts');
const { anim } = await import('../src/three/anim.ts');
const { withExportSession, captureImage, exportVideo } = await import('../src/export/capture.ts');
const { exportAssets, shotsInExport, exportSampleTime } = await import('../src/export/assets.ts');
const { locate } = await import('../src/lib/animation.ts');
const { importFilesToShot, importBackgroundImage, importScreenBackground, applySampleScreen } = await import('../src/lib/actions.ts');
const { useProjectOwnership } = await import('../src/lib/projectOwnership.ts');
const { repairMedia } = await import('../src/lib/repairMedia.ts');

const malformed = { ...createProject(), camera: { fov: NaN, zoom: 0 }, scene: null, screen: null, mockup: null, blur: null, shots: [ { id: 'same', duration: 0, keyframes: { 'camera.x': [{ t: 1, v: 3, ease: 'expoIn' }, { t: NaN, v: 4 }, { t: 0, v: 2 }, { t: 1, v: 6, ease: 'backIn' }], bad: [1] }, pose: { 'camera.x': Infinity }, media: { id: '__proto__', kind: 'image', width: 50, height: 50 } }, { id: 'same', kind: 'text', text: null } ] };
const normalized = normalizeProject(malformed);
assert.ok(normalized.camera.zoom > 0);
assert.equal(normalized.createdAt, malformed.createdAt, 'normalization must preserve real timestamps');
assert.equal(normalized.scene.background.preset, 'paper');
assert.equal(normalized.shots[0].duration, 0.1);
assert.notEqual(normalized.shots[0].id, normalized.shots[1].id);
assert.equal(normalized.shots[0].media, null);
assert.deepEqual(normalized.shots[0].keyframes['camera.x'].map((k) => [k.t, k.v, k.ease]), [[0, 2, 'smooth'], [1, 6, 'backIn']]);
assert.equal(normalized.shots[0].pose, undefined);
assert.equal(normalized.shots[1].text.font, 'Geist');
assert.equal(malformed.scene, null, 'normalization must not mutate the source');
assert.throws(() => normalizeProject({}), /shot list/);
assert.throws(() => normalizeProject({ ...createProject(), version: 2 }), /unsupported/);
assert.equal(validateMediaRef({ id: 'ok', kind: 'video', width: Infinity, height: 40 }), null);
const oriented = createProject(); oriented.mockup.orientation = 'portrait'; oriented.shots[0].orientation = 'landscape';
assert.equal(normalizeProject(oriented).mockup.orientation, 'portrait');
assert.equal(normalizeProject(oriented).shots[0].orientation, 'landscape');
assert.equal(normalizeProject(createProject()).mockup.orientation, undefined, 'legacy projects must retain the device native orientation');
oriented.mockup.orientation = 'upsideDown'; oriented.shots[0].orientation = 'upsideDown';
assert.equal(normalizeProject(oriented).mockup.orientation, undefined);
assert.equal(normalizeProject(oriented).shots[0].orientation, undefined);

const a = createProject(), b = createProject(); a.name = 'Saved A'; b.name = 'Saved B';
const saveA = persistence.saveProject(a); a.name = 'Edited after save';
await Promise.all([saveA, persistence.saveProject(b)]);
assert.equal((await persistence.listProjects()).length, 2, 'concurrent saves must preserve both index entries');
assert.equal((await persistence.loadProject(a.id)).name, 'Saved A', 'save must snapshot its caller before awaiting');
await Promise.all([persistence.saveProject(b), persistence.deleteProject(b.id)]);
assert.equal(await persistence.loadProject(b.id), null, 'save/delete must run in call order');
assert.deepEqual((await persistence.listProjects()).map((p) => p.id), [a.id]);
const queued = createProject();
const queuedSave = persistence.saveProject(queued);
assert.equal((await persistence.loadProject(queued.id)).id, queued.id, 'a load must wait for an already requested save');
await queuedSave;
const raceOld = createProject(); raceOld.name = 'older autosave';
await persistence.saveProject(raceOld);
const raceNew = structuredClone(raceOld); raceNew.name = 'newer explicit save'; raceNew.updatedAt++;
const pendingAutosave = persistence.saveProjectIfSaved(raceOld);
await persistence.saveProject(raceNew); await pendingAutosave;
assert.equal((await persistence.loadProject(raceOld.id)).name, 'newer explicit save', 'the conditional autosave must enqueue before a newer explicit save');
await Promise.all([persistence.deleteProject(raceOld.id), persistence.saveProjectIfSaved(raceNew)]);
assert.equal(await persistence.loadProject(raceOld.id), null, 'conditional autosave must not resurrect a deleted project');
const unsaved = createProject(); await persistence.saveProjectIfSaved(unsaved);
assert.equal(await persistence.loadProject(unsaved.id), null, 'conditional autosave must not add an unsaved project to the index');
const templates = await Promise.all([persistence.saveTemplate(a, 'A', ''), persistence.saveTemplate(a, 'B', '')]);
assert.equal((await persistence.listTemplates()).length, 2, 'concurrent template saves must preserve both entries');
await Promise.all(templates.map((t) => persistence.deleteTemplate(t.id)));
assert.equal((await persistence.listTemplates()).length, 0);

const originalRef = { id: 'original-media', kind: 'image', width: 999, height: 999, name: 'screen.png' };
const original = await media.registerMedia(originalRef, new Blob(['png'], { type: 'image/png' }));
assert.equal(original.width, 80, 'decoded dimensions must override stale file metadata');
const project = createProject(); project.shots[0].media = original.ref; project.shots[1].media = original.ref;
const portable = await persistence.exportProjectFile(project);
const imported = await persistence.importProjectFile(portable);
assert.notEqual(imported.shots[0].media.id, original.ref.id, 'imports must not overwrite an existing saved project media id');
assert.equal(imported.shots[0].media.id, imported.shots[1].media.id, 'shared media must stay shared inside the imported project');
assert.equal(media.getMedia(original.ref.id).url, original.url);
assert.notEqual(imported.id, project.id);
await assert.rejects(media.dataURLToBlob('https://example.com/image.png'), /local/);
await assert.rejects(persistence.importProjectFile(new Blob(['null'])), /Not a mok/);
await assert.rejects(persistence.importProjectFile(new Blob([JSON.stringify({ format: 'mok', project: { name: 'broken' } })])), /shot list/);
const fileWithoutBlob = JSON.parse(await portable.text()); fileWithoutBlob.media = {};
fileWithoutBlob.project.shots.push({ id: 'missing-logo-shot', name: 'Logo', kind: 'logo', duration: 1, media: null, keyframes: {}, logo: { media: original.ref } });
fileWithoutBlob.project.scene.background.type = 'image';
fileWithoutBlob.project.scene.background.image = original.ref;
fileWithoutBlob.project.screen.bg = { type: 'image', color: '#000000', image: original.ref };
fileWithoutBlob.project.audio = { media: { id: 'portable-missing-audio', name: 'missing-music.mp3', kind: 'audio', width: 0, height: 0, duration: 8 }, start: 0.4, trimStart: 0.5, volume: 0.7, fadeIn: 0.2, fadeOut: 0.3 };
const importWarnings = [];
persistence.setStorageErrorHandler((message) => importWarnings.push(message));
let missing;
const warn = console.warn;
try {
  console.warn = () => {}; // The missing embedded blob is intentional in this regression case.
  missing = await persistence.importProjectFile(new Blob([JSON.stringify(fileWithoutBlob)]));
} finally { console.warn = warn; }
await later();
const missingRef = missing.shots[0].media;
assert.notEqual(missingRef.id, original.ref.id, 'a missing portable source must never reuse an existing local media id');
assert.equal(missingRef.id, missing.shots[1].media.id, 'shared missing sources must stay linked for a single repair');
assert.equal(missingRef.name, original.ref.name, 'a missing source must retain its exact filename');
assert.equal(missingRef.width, original.ref.width);
assert.equal(missing.shots[2].logo.media.id, missingRef.id, 'logo metadata must survive a missing source');
assert.equal(missing.scene.background.type, 'image');
assert.equal(missing.scene.background.image.id, missingRef.id);
assert.equal(missing.screen.bg.image.id, missingRef.id);
assert.notEqual(missing.audio.media.id, 'portable-missing-audio');
assert.equal(missing.audio.media.name, 'missing-music.mp3');
assert.deepEqual({ ...missing.audio, media: null }, { ...fileWithoutBlob.project.audio, media: null }, 'missing soundtrack references must keep their timing and mix');
assert.equal(media.getMedia(missingRef.id), null, 'a portable file must not accidentally pick up local media with the same id');
assert.equal(media.getMediaStatus(missingRef), 'missing');
assert.ok(importWarnings.some((message) => message.includes('Imported with missing media') && message.includes(original.ref.name)));
assert.equal(media.getMedia(original.ref.id).url, original.url);

const exportedMissing = await persistence.exportProjectFile(missing);
const missingJSON = JSON.parse(await exportedMissing.text());
assert.equal(missingJSON.project.shots[0].media.id, missingRef.id, 'portable export must preserve an unavailable source reference');
assert.equal(missingJSON.project.shots[0].media.name, original.ref.name);
assert.equal(missingJSON.media[missingRef.id], undefined, 'missing bytes must not be replaced with unrelated cached data');
let missingAgain;
try { console.warn = () => {}; missingAgain = await persistence.importProjectFile(exportedMissing); }
finally { console.warn = warn; }
assert.notEqual(missingAgain.shots[0].media.id, missingRef.id, 'each import must isolate even a source that remains missing');
assert.equal(missingAgain.shots[0].media.name, original.ref.name);
useEditor.getState().replaceProject(missingAgain);
assert.equal(await repairMedia(new File(['png'], 'screen.png'), missingAgain.id, missingAgain.shots[0].media, { kind: 'shot', shotId: missingAgain.shots[0].id }), true, 'an unavailable portable source must remain repairable after repeated export/import');
assert.equal(media.getMediaStatus(useEditor.getState().project.shots[0].media), 'ready');
assert.equal(useEditor.getState().project.shots[0].media.id, useEditor.getState().project.shots[1].media.id);
assert.equal(useEditor.getState().project.shots[2].logo.media.id, useEditor.getState().project.shots[0].media.id);
assert.equal(useEditor.getState().project.scene.background.image.id, useEditor.getState().project.shots[0].media.id);
assert.equal(useEditor.getState().project.screen.bg.image.id, useEditor.getState().project.shots[0].media.id);
assert.equal(useEditor.getState().project.audio.media.name, 'missing-music.mp3');
assert.equal(media.getMedia(original.ref.id).url, original.url, 'repairing the imported project must leave the original source untouched');
await later();
persistence.setStorageErrorHandler(() => {});

const ref = { id: 'loading-then-deleted', kind: 'image', width: 80, height: 60, name: 'test.png' };
records.set(`media:${ref.id}`, { ref, blob: new Blob(['png'], { type: 'image/png' }) });
holdImages = true;
const loading = media.ensureMedia(ref);
while (!imageWaiters.length) await later();
assert.equal(media.getMediaStatus(ref), 'loading', 'a pending decode must never appear as an unavailable file');
await media.deleteMedia(ref.id);
imageWaiters.shift()();
assert.equal(await loading, null);
assert.equal(media.getMedia(ref.id), null, 'finishing a decode must not resurrect deleted media');
assert.equal(media.useMediaStore.getState().loading[ref.id], undefined);
assert.equal(media.getMediaStatus(ref), 'missing', 'a deleted source must not keep reporting loading after its stale decode completes');
holdImages = false;
assert.ok(media.isMediaFile(new File(['png'], 'SCREEN.PNG')), 'files without browser MIME metadata should use their extension');
const extensionRef = await media.importMedia(new File(['png'], 'SCREEN.PNG'));
assert.equal(extensionRef.kind, 'image');

const mixedImportProject = createProject();
useEditor.getState().replaceProject(mixedImportProject);
const mixedImportTarget = mixedImportProject.shots[0].id;
const mixedRef = await importFilesToShot([new File(['mp3'], 'SOUNDTRACK.MP3'), new File(['png'], 'SCREEN.PNG')], mixedImportTarget);
assert.equal(mixedRef.kind, 'image', 'an extension-only audio file must not swallow a later visual in a mixed import');
assert.equal(useEditor.getState().project.audio.media.kind, 'audio');
assert.equal(useEditor.getState().project.audio.media.name, 'SOUNDTRACK.MP3');
assert.equal(useEditor.getState().project.shots[0].media.id, mixedRef.id);
assert.equal(useEditor.getState().project.shots.length, mixedImportProject.shots.length, 'one visual in a mixed import replaces its target without an extra media shot');
const beforeAudioOnly = structuredClone(useEditor.getState().project.shots);
assert.equal(await importFilesToShot([new File(['mp3'], 'replacement.mp3')], mixedImportTarget), null);
assert.equal(useEditor.getState().project.audio.media.name, 'replacement.mp3');
assert.deepEqual(useEditor.getState().project.shots, beforeAudioOnly, 'an audio-only import must not alter or add visual shots');

const batchBefore = structuredClone(useEditor.getState().project); useEditor.temporal.getState().clear();
await importFilesToShot([new File(['a'],'first.png',{type:'image/png'}),new File(['bad'],'broken.png',{type:'image/png'}),new File(['b'],'last.png',{type:'image/png'})],mixedImportTarget);
const batch = useEditor.getState().project;
assert.equal(batch.shots.length,batchBefore.shots.length+1,'a failed decode cannot leave an extra shot');
assert.equal(batch.shots[0].media.name,'first.png'); assert.equal(batch.shots[1].media.name,'last.png'); assert.notEqual(batch.shots[0].media.id,batch.shots[1].media.id);
assert.match(useUI.getState().toast.text,/2 files added.*1 skipped.*broken.png/);
assert.equal(useEditor.temporal.getState().pastStates.length,1); undo(); assert.deepEqual(useEditor.getState().project,batchBefore);
holdImages=true;
const countBefore=Object.keys(media.useMediaStore.getState().items).length;
const staleUpload=importFilesToShot([new File(['held'],'held.png',{type:'image/png'})],mixedImportTarget);
while(!imageWaiters.length) await later();
useEditor.getState().replaceProject(createProject()); useEditor.getState().replaceProject(batchBefore); const restoredBatch = structuredClone(useEditor.getState().project); imageWaiters.shift()();
assert.equal(await staleUpload,null); holdImages=false;
assert.equal(Object.keys(media.useMediaStore.getState().items).length,countBefore,'cancelled import releases its unused media');
assert.deepEqual(useEditor.getState().project,restoredBatch);

const waitForQueue = async (queue) => { for (let n = 0; n < 1000; n++) { if (queue.length) return; await later(); } throw new Error('Deferred decoder was not reached'); };
const mediaInventory = () => ({ items: Object.keys(media.useMediaStore.getState().items).sort(), saved: [...records.keys()].filter((k) => k.startsWith('media:')).sort(), urls: [...urls.keys()].sort() });
// Exercise both background targets with real importMedia decoding and persistence mocks.
for (const [label, action, background] of [
  ['scene', importBackgroundImage, (p) => p.scene.background],
  ['screen', importScreenBackground, (p) => p.screen.bg],
]) {
  useEditor.getState().replaceProject(createProject());
  const inventory = mediaInventory();
  await action(new File(['mp3'], 'wrong-type.mp3', { type: 'audio/mpeg' }));
  assert.deepEqual(mediaInventory(), inventory, `${label}: rejected audio must release decoded media, URL and stored bytes`);
  for (const change of ['project-ABA', 'target-ABA', 'ownership']) {
    const before = structuredClone(useEditor.getState().project), inventory = mediaInventory(); holdImages = true;
    const pending = action(new File(['png'], `${label}-held.png`, { type: 'image/png' }));
    await waitForQueue(imageWaiters);
    if (change === 'project-ABA') { useEditor.getState().replaceProject(createProject()); useEditor.getState().replaceProject(before); }
    if (change === 'target-ABA') { useEditor.getState().update((p) => { background(p).color = '#fd30a8'; }); useEditor.getState().update((p) => { background(p).color = background(before).color; }); }
    if (change === 'ownership') { useProjectOwnership.setState({ enabled: true, projectId: before.id, mode: 'readonly', token: null }); useProjectOwnership.setState({ enabled: false }); }
    const restored = structuredClone(useEditor.getState().project); imageWaiters.shift()(); await pending; holdImages = false;
    assert.deepEqual(useEditor.getState().project, restored, `${label}: ${change} cannot apply a stale background`);
    assert.deepEqual(mediaInventory(), inventory, `${label}: ${change} releases all unused media resources`);
  }
  // An unrelated camera edit is not a cancellation: the target remains valid.
  holdImages = true; const pending = action(new File(['png'], `${label}-accepted.png`, { type: 'image/png' }));
  await waitForQueue(imageWaiters); useEditor.getState().update((p) => { p.camera.zoom = 1.4; }); imageWaiters.shift()(); await pending; holdImages = false;
  assert.equal(background(useEditor.getState().project).image.name, `${label}-accepted.png`); assert.equal(useEditor.getState().project.camera.zoom, 1.4);
}
// Sample generation and source decoding are separate async boundaries; test cancellation at both.
useEditor.getState().replaceProject(createProject());
let sampleProject = structuredClone(useEditor.getState().project), sampleTarget = sampleProject.shots[0].id;
holdSamples = true;
const sampleInventory = mediaInventory(), staleGeneration = applySampleScreen('analytics', sampleTarget);
await waitForQueue(sampleWaiters);
useEditor.getState().replaceProject(createProject()); useEditor.getState().replaceProject(sampleProject); sampleWaiters.shift()(); await staleGeneration; holdSamples = false;
assert.deepEqual(mediaInventory(), sampleInventory, 'a cancelled sample generation must never start source decoding');
assert.equal(useEditor.getState().project.shots[0].media, null);
for (const change of ['project-ABA', 'source-ABA', 'device', 'orientation']) {
  useEditor.getState().replaceProject(createProject());
  sampleProject = structuredClone(useEditor.getState().project); sampleTarget = sampleProject.shots[0].id; const inventory = mediaInventory(); holdImages = true;
  const pending = applySampleScreen('analytics', sampleTarget);
  await waitForQueue(imageWaiters);
  if (change === 'project-ABA') { useEditor.getState().replaceProject(createProject()); useEditor.getState().replaceProject(sampleProject); }
  if (change === 'source-ABA') { useEditor.getState().updateShot(sampleTarget, (s) => { s.media = originalRef; }); useEditor.getState().updateShot(sampleTarget, (s) => { s.media = sampleProject.shots[0].media; }); }
  if (change === 'device') useEditor.getState().update((p) => { p.mockup.device = 'browser'; });
  if (change === 'orientation') useEditor.getState().updateShot(sampleTarget, (s) => { s.orientation = 'landscape'; });
  const restored = structuredClone(useEditor.getState().project); imageWaiters.shift()(); await pending; holdImages = false;
  assert.deepEqual(useEditor.getState().project, restored, `sample ${change} cannot overwrite a later target`);
  assert.deepEqual(mediaInventory(), inventory, `sample ${change} releases decoded media and stored bytes`);
}
await applySampleScreen('analytics', sampleTarget); assert.ok(useEditor.getState().project.shots[0].media?.name.endsWith('.png'), 'a valid sample still commits its rendered source');

const unavailable = { ...originalRef, id: 'missing-for-retry' };
assert.equal(media.getMediaStatus(null), 'empty');
assert.equal(media.getMediaStatus(unavailable), 'loading', 'a referenced source must not flash missing before storage is checked');
await media.ensureMedia(unavailable);
assert.equal(media.getMediaStatus(unavailable), 'missing');
records.set(`media:${unavailable.id}`, { ref: unavailable, blob: new Blob(['png'], { type: 'image/png' }) });
assert.equal(await media.ensureMedia(unavailable), null, 'missing sources should not poll storage on every render');
await media.retryMedia(unavailable);
assert.equal(media.getMediaStatus(unavailable), 'ready', 'explicit retry must recover newly available storage');

const repairProject = createProject();
repairProject.shots[0].media = { ...originalRef, id: 'missing-repair' };
repairProject.shots[1].media = repairProject.shots[0].media;
repairProject.shots[0].duration = 2.7;
repairProject.shots[0].trimStart = 1.1;
repairProject.shots[0].speed = 1.6;
repairProject.shots[0].pose = { 'camera.x': 20 };
repairProject.shots[0].keyframes = { 'camera.zoom': [{ t: 0, v: 1.2, ease: 'smooth' }, { t: 2.7, v: 2, ease: 'smooth' }] };
useEditor.getState().replaceProject(repairProject);
const beforeRepair = structuredClone(useEditor.getState().project);
const expectedRepair = beforeRepair.shots[0].media;
assert.equal(await repairMedia(new File(['png'], 'restored.png'), repairProject.id, expectedRepair, { kind: 'shot', shotId: repairProject.shots[0].id }), true);
const afterRepair = useEditor.getState().project;
assert.notEqual(afterRepair.shots[0].media.id, expectedRepair.id);
assert.equal(afterRepair.shots[0].media.id, afterRepair.shots[1].media.id, 'repair must restore shared split/duplicate sources together');
assert.deepEqual(afterRepair.shots.map((s) => ({ ...s, media: null })), beforeRepair.shots.map((s) => ({ ...s, media: null })), 'repair must retain duration, trim, speed, pose and keyframes');
assert.deepEqual(afterRepair.camera, beforeRepair.camera);

const audioRepair = { media: { id: 'lost-audio', name: 'lost.mp3', kind: 'audio', width: 0, height: 0, duration: 4 }, start: 0.8, trimStart: 0.5, volume: 0.35, fadeIn: 0.2, fadeOut: 0.3 };
useEditor.getState().setAudio(audioRepair);
assert.equal(await repairMedia(new File(['mp3'], 'found.mp3'), repairProject.id, audioRepair.media, { kind: 'audio' }), true);
assert.deepEqual({ ...useEditor.getState().project.audio, media: null }, { ...audioRepair, media: null }, 'soundtrack repair must preserve its start, trim and mix');

useEditor.getState().replaceProject(beforeRepair);
const beforeAbandoned = new Set(urls.keys());
holdImages = true;
const abandonedRepair = repairMedia(new File(['png'], 'late.png'), beforeRepair.id, expectedRepair, { kind: 'shot', shotId: beforeRepair.shots[0].id });
while (!imageWaiters.length) await later();
useEditor.getState().replaceProject(createProject());
useEditor.getState().replaceProject(beforeRepair); // returning to the same project must not revive the old request
imageWaiters.shift()();
assert.equal(await abandonedRepair, false);
assert.equal(useEditor.getState().project.shots[0].media.id, expectedRepair.id);
assert.deepEqual(new Set(urls.keys()), beforeAbandoned, 'an abandoned repair must release its imported media');

const deletedRepair = repairMedia(new File(['png'], 'removed.png'), beforeRepair.id, expectedRepair, { kind: 'shot', shotId: beforeRepair.shots[0].id });
while (!imageWaiters.length) await later();
useEditor.getState().updateShot(beforeRepair.shots[0].id, (shot) => { shot.media = null; });
imageWaiters.shift()();
assert.equal(await deletedRepair, false);
assert.equal(useEditor.getState().project.shots[0].media, null, 'deleting a source while repair decodes must not bring it back');
assert.deepEqual(new Set(urls.keys()), beforeAbandoned);
useEditor.getState().replaceProject(beforeRepair);

const firstRepair = repairMedia(new File(['png'], 'first.png'), beforeRepair.id, expectedRepair, { kind: 'shot', shotId: beforeRepair.shots[0].id });
const lastRepair = repairMedia(new File(['png'], 'last.png'), beforeRepair.id, expectedRepair, { kind: 'shot', shotId: beforeRepair.shots[0].id });
while (imageWaiters.length < 2) await later();
imageWaiters.pop()();
assert.equal(await lastRepair, true);
imageWaiters.shift()();
assert.equal(await firstRepair, false);
assert.equal(useEditor.getState().project.shots[0].media.name, 'last.png', 'only the latest simultaneous repair may apply');
holdImages = false;
const beforeWrongKind = new Set(urls.keys());
const nowRef = useEditor.getState().project.shots[0].media;
await assert.rejects(repairMedia(new File(['mp3'], 'wrong.mp3'), beforeRepair.id, nowRef, { kind: 'shot', shotId: beforeRepair.shots[0].id }), /matching image/);
assert.deepEqual(new Set(urls.keys()), beforeWrongKind, 'a wrong media kind must not leave a decoded orphan');

const track = { media: { ...original.ref, kind: 'audio', duration: 3 }, start: 1, trimStart: 1, fadeIn: 0, fadeOut: 0, volume: 0.6 };
assert.equal(audio.audioGainAt(track, 3, 10), 0, 'audio must be silent exactly at the end');
assert.equal(audio.audioGainAt(track, 2, 10), 0.6);
assert.equal(audio.audioGainAt({ ...track, trimStart: 3 }, 1, 10), 0, 'zero-length audio must be silent');
assert.equal(audio.audioLength({ ...track, media: { ...track.media, duration: Infinity } }), 0);

useEditor.getState().replaceProject(createProject());
const state = { size: { width: 640, height: 480 }, viewport: { dpr: 2 }, frameloop: 'demand', gl: { capabilities: { maxTextureSize: 8192 }, domElement: {} }, setFrameloop(v) { this.frameloop = v; }, setDpr(v) { this.viewport.dpr = v; }, setSize(w, h) { this.size = { width: w, height: h }; }, invalidate() {}, advance() {} };
viewport.get = () => state;
useUI.setState({ time: 0.8, playing: true });
useRenderFlags.getState().setTransparent(true);
useRenderFlags.getState().setExporting(false);
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {
  assert.equal(useRenderFlags.getState().exporting, true, 'export buffers must be enabled before the encoder renders');
  throw new Error('encoder failure');
}), /encoder failure/);
assert.deepEqual(state.size, { width: 640, height: 480 });
assert.equal(state.viewport.dpr, 2); assert.equal(state.frameloop, 'demand');
assert.equal(useUI.getState().time, 0.8); assert.equal(useUI.getState().playing, true);
assert.equal(useRenderFlags.getState().transparent, true); assert.equal(anim.exporting, false);
assert.equal(useRenderFlags.getState().exporting, false, 'encoder failure restores preview buffer quality');
const originalSetSize = state.setSize; let failed = false;
state.setSize = function(w, h) { if (w === 100 && !failed) { failed = true; throw new Error('resize failure'); } originalSetSize.call(this, w, h); };
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {}), /resize failure/);
assert.deepEqual(state.size, { width: 640, height: 480 }); assert.equal(state.frameloop, 'demand'); assert.equal(useUI.getState().playing, true);
assert.equal(useRenderFlags.getState().exporting, false, 'resize failure restores preview buffer quality');
const brokenSource = createProject(); brokenSource.shots[0].media = { ...originalRef, id: 'not-in-storage' };
useEditor.getState().replaceProject(brokenSource);
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {}), /Missing media/);
assert.equal(useUI.getState().playing, true, 'media preparation failure must restore playback');
assert.deepEqual(state.size, { width: 640, height: 480 });
useEditor.getState().replaceProject(createProject());
let finishSession, entered = false;
const running = withExportSession({ width: 640, height: 480, transparent: false }, async () => {
  assert.equal(useRenderFlags.getState().exporting, true, 'same-size exports still enable export buffer quality');
  entered = true; await new Promise((resolve) => { finishSession = resolve; });
});
while (!entered) await later();
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {}), /already running/);
finishSession(); await running;
assert.equal(useRenderFlags.getState().exporting, false, 'successful capture restores preview buffer quality');

// The source texture is updated imperatively, but flat geometry and per-shot effects settle in React.
const boundary = createProject();
boundary.mockup.device = 'flat'; boundary.shots = [createShot('Tall', 2), createShot('Wide', 2)];
boundary.shots[0].media = { ...original.ref, width: 300, height: 600 };
boundary.shots[1].media = { ...original.ref, width: 600, height: 300 };
boundary.shots[1].fit = 'contain';
useEditor.getState().replaceProject(boundary);
useUI.setState({ time: 0.25, playing: false });
const originalRaf = globalThis.requestAnimationFrame, originalAdvance = state.advance;
let settledShot = boundary.shots[0].id, boundaryFrames = 0;
globalThis.requestAnimationFrame = (fn) => originalRaf(() => {
  settledShot = locate(useEditor.getState().project, useUI.getState().time).shot.id;
  boundaryFrames++; fn();
});
const renderedClocks = [];
state.advance = (clock) => {
  assert.equal(settledShot, locate(useEditor.getState().project, useUI.getState().time).shot.id, 'first frame at a same-device cut must wait for current-shot geometry/effects');
  renderedClocks.push(clock);
};
try {
  await withExportSession({ width: 100, height: 80, transparent: false }, async ({ renderAt }) => {
    await renderAt(0.25, 0.25);
    const beforeCut = boundaryFrames;
    await renderAt(2.25, 2);
    assert.ok(boundaryFrames > beforeCut, 'same-device shot boundaries must settle before the first captured frame');
    const afterCut = boundaryFrames;
    await renderAt(2.35, 2);
    assert.equal(boundaryFrames, afterCut, 'motion-blur samples inside one shot do not add asset waits');
  });
  assert.deepEqual(renderedClocks, [0.25, 2, 2], 'intra-frame samples share the frame clock while sampling distinct timeline times');
} finally { globalThis.requestAnimationFrame = originalRaf; state.advance = originalAdvance; }

const trimmed = createProject();
trimmed.shots = [createShot('Visible', 3), createShot('Outside endpoint', 3)];
trimmed.shots[1].media = { ...originalRef, id: 'missing-outside-export' };
trimmed.duration = 2;
useEditor.getState().replaceProject(trimmed);
await withExportSession({ width: 100, height: 80, transparent: false }, async () => {});
assert.deepEqual(exportAssets(trimmed, { type: 'video', start: 0, end: 2 }, false).shots.map((s) => s.name), ['Visible']);
trimmed.duration = 6;
useEditor.getState().replaceProject(trimmed);
state.gl.domElement.toBlob = (callback, mime) => callback(new Blob(['image'], { type: mime }));
assert.equal((await captureImage({ width: 100, height: 80, transparent: false, format: 'png', time: 0.5 })).type, 'image/png', 'a still must not require another shot media');
await assert.rejects(captureImage({ width: 100, height: 80, transparent: false, format: 'png', time: 3.5 }), /Missing media/);

const held = createProject();
held.shots = [createShot('Leading hold', 1), createShot('Later', 1)];
held.shots[0].gap = 2; held.shots[1].gap = 2;
assert.deepEqual(shotsInExport(held, { type: 'video', start: 0, end: 1 }).map((s) => s.name), ['Leading hold']);
assert.deepEqual(shotsInExport(held, { type: 'video', start: 3, end: 5 }).map((s) => s.name), ['Leading hold']);
assert.deepEqual(shotsInExport(held, { type: 'video', start: 5, end: 9 }).map((s) => s.name), ['Later']);
assert.equal(shotsInExport(held, { type: 'still', time: 4 })[0].name, 'Leading hold');
assert.equal(shotsInExport(held, { type: 'still', time: 9 })[0].name, 'Later');
assert.equal(locate(trimmed, exportSampleTime(3, 3)).shot.id, trimmed.shots[0].id, 'last motion-blur sample cannot reveal the excluded next shot');

const scoped = createProject();
const scopeRef = (id, kind = 'image') => ({ ...originalRef, id, kind, duration: kind === 'audio' ? 4 : undefined });
scoped.shots = [createShot('Screen', 1), createTextShot('Title', 1), createLogoShot('Brand', 1)];
scoped.shots[0].media = scopeRef('screen');
scoped.shots[1].media = scopeRef('stale-hidden-text-media');
scoped.shots[2].logo.media = scopeRef('logo');
scoped.scene.preset = 'custom'; scoped.scene.background.type = 'image'; scoped.scene.background.image = scopeRef('scene-bg');
scoped.screen.bg = { type: 'image', image: scopeRef('screen-bg'), color: '#000000' };
scoped.audio = { media: scopeRef('soundtrack', 'audio'), start: 0, trimStart: 0, volume: 1, fadeIn: 0, fadeOut: 0 };
const assetIds = (scope, transparent = false) => exportAssets(scoped, scope, transparent).media.map((m) => m.id).sort();
assert.deepEqual(assetIds({ type: 'still', time: 0.5 }), ['scene-bg', 'screen', 'screen-bg']);
assert.deepEqual(assetIds({ type: 'still', time: 0.5 }, true), ['screen', 'screen-bg']);
assert.deepEqual(assetIds({ type: 'still', time: 1.5 }), []);
assert.equal(exportAssets(scoped, { type: 'still', time: 1.5 }, false).fonts.length, 1);
assert.deepEqual(assetIds({ type: 'still', time: 2.5 }), ['logo']);
assert.deepEqual(assetIds({ type: 'video', start: 0, end: 3 }), ['logo', 'scene-bg', 'screen', 'screen-bg', 'soundtrack']);
scoped.shots[0].scene = 'studio';
assert.deepEqual(assetIds({ type: 'still', time: 0.5 }), ['screen', 'screen-bg'], 'room presets do not need the stored custom background image');
scoped.scene.background.type = 'color'; scoped.screen.bg.type = 'color';
scoped.audio.start = 3;
assert.deepEqual(assetIds({ type: 'video', start: 0, end: 2 }), ['screen'], 'off-range audio and inactive background fields cannot block capture');
scoped.audio.start = 0; scoped.audio.volume = 0;
assert.equal(exportAssets(scoped, { type: 'video', start: 0, end: 2 }, false).audio, null);
scoped.audio.volume = 1; scoped.audio.trimStart = 4;
assert.equal(exportAssets(scoped, { type: 'video', start: 0, end: 2 }, false).audio, null);
scoped.duration = 181;
useEditor.setState({ project: scoped });
await assert.rejects(exportVideo({ width: 100, height: 80, fps: 30, quality: 'med', samples: 1, transparent: false, format: 'mp4' }), /180 seconds/);
useEditor.getState().replaceProject(createProject());
const ctrl = new AbortController(); ctrl.abort();
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false, signal: ctrl.signal }, async () => {}), { name: 'AbortError' });
await assert.rejects(withExportSession({ width: NaN, height: 80, transparent: false }, async () => {}), /whole-pixel/);
assert.ok(revoked.size > 0);
console.log('PASS: IO validation, concurrent persistence, import isolation, media status/recovery races, mixed imports, audio bounds and export cleanup regression checks');
