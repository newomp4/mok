import './test-loader.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const records = new Map();
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
  return nextResolve(specifier, context);
} });
const urls = new Map(), revoked = new Set();
let urlIndex = 0, holdImages = false;
const imageWaiters = [];
URL.createObjectURL = (blob) => { const url = `blob:test-${++urlIndex}`; urls.set(url, blob); return url; };
URL.revokeObjectURL = (url) => { revoked.add(url); urls.delete(url); };
globalThis.Image = class {
  naturalWidth = 80; naturalHeight = 60;
  set src(value) { this._src = value; if (!value) return; const done = () => this.onload?.(); if (holdImages) imageWaiters.push(done); else queueMicrotask(done); }
  get src() { return this._src; }
};
globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.(); }); } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.document = { hidden: false };
const { createProject, normalizeProject } = await import('../src/lib/defaults.ts');
const { validateMediaRef } = await import('../src/lib/validateProject.ts');
const persistence = await import('../src/lib/persistence.ts');
const media = await import('../src/lib/media.ts');
const audio = await import('../src/lib/audio.ts');
const { useEditor } = await import('../src/store/editor.ts');
const { useUI } = await import('../src/store/ui.ts');
const { viewport, useRenderFlags } = await import('../src/three/registry.ts');
const { anim } = await import('../src/three/anim.ts');
const { withExportSession } = await import('../src/export/capture.ts');

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
let missing;
const warn = console.warn;
try {
  console.warn = () => {}; // The missing embedded blob is intentional in this regression case.
  missing = await persistence.importProjectFile(new Blob([JSON.stringify(fileWithoutBlob)]));
} finally { console.warn = warn; }
assert.equal(missing.shots[0].media, null, 'a portable file must not accidentally pick up local media with the same id');

const ref = { id: 'loading-then-deleted', kind: 'image', width: 80, height: 60, name: 'test.png' };
records.set(`media:${ref.id}`, { ref, blob: new Blob(['png'], { type: 'image/png' }) });
holdImages = true;
const loading = media.ensureMedia(ref);
while (!imageWaiters.length) await later();
await media.deleteMedia(ref.id);
imageWaiters.shift()();
assert.equal(await loading, null);
assert.equal(media.getMedia(ref.id), null, 'finishing a decode must not resurrect deleted media');
assert.equal(media.useMediaStore.getState().loading[ref.id], undefined);
holdImages = false;
assert.ok(media.isMediaFile(new File(['png'], 'SCREEN.PNG')), 'files without browser MIME metadata should use their extension');
const extensionRef = await media.importMedia(new File(['png'], 'SCREEN.PNG'));
assert.equal(extensionRef.kind, 'image');

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
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => { throw new Error('encoder failure'); }), /encoder failure/);
assert.deepEqual(state.size, { width: 640, height: 480 });
assert.equal(state.viewport.dpr, 2); assert.equal(state.frameloop, 'demand');
assert.equal(useUI.getState().time, 0.8); assert.equal(useUI.getState().playing, true);
assert.equal(useRenderFlags.getState().transparent, true); assert.equal(anim.exporting, false);
const originalSetSize = state.setSize; let failed = false;
state.setSize = function(w, h) { if (w === 100 && !failed) { failed = true; throw new Error('resize failure'); } originalSetSize.call(this, w, h); };
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {}), /resize failure/);
assert.deepEqual(state.size, { width: 640, height: 480 }); assert.equal(state.frameloop, 'demand'); assert.equal(useUI.getState().playing, true);
const brokenSource = createProject(); brokenSource.shots[0].media = { ...originalRef, id: 'not-in-storage' };
useEditor.getState().replaceProject(brokenSource);
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {}), /Missing media/);
assert.equal(useUI.getState().playing, true, 'media preparation failure must restore playback');
assert.deepEqual(state.size, { width: 640, height: 480 });
useEditor.getState().replaceProject(createProject());
let finishSession, entered = false;
const running = withExportSession({ width: 100, height: 80, transparent: false }, async () => { entered = true; await new Promise((resolve) => { finishSession = resolve; }); });
while (!entered) await later();
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false }, async () => {}), /already running/);
finishSession(); await running;
const ctrl = new AbortController(); ctrl.abort();
await assert.rejects(withExportSession({ width: 100, height: 80, transparent: false, signal: ctrl.signal }, async () => {}), { name: 'AbortError' });
await assert.rejects(withExportSession({ width: NaN, height: 80, transparent: false }, async () => {}), /whole-pixel/);
assert.ok(revoked.size > 0);
console.log('PASS: IO validation, concurrent persistence, import isolation, media deletion races, audio bounds and export cleanup regression checks');
