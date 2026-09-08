// Actual shared-origin IndexedDB + Web Locks, with isolated tabs and no user browser profile.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] ?? '../media-reclamation'); await mkdir(out, { recursive: true });
const url = process.env.MOK_QA_URL ?? 'http://localhost:35361';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await context.route('**/__media-retention-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Media retention test peer</title>' }));
await context.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.removeItem('mok:seen-version'); });
const report = { url, checks: [], errors: [] }, check = name => { report.checks.push(name); console.log('PASS', name); };
const open = async id => {
  const p = await context.newPage(); p.on('pageerror', e => report.errors.push(String(e)));
  await p.goto(url); await p.waitForFunction(() => window.__mok?.ownership.state.getState().enabled && window.__mok?.ownership.state.getState().mode !== 'checking');
  await p.evaluate(async id => {
    const m = window.__mok, project = structuredClone(m.useEditor.getState().project);
    project.id = id; project.name = id; project.mockup.device = 'flat'; project.effects = []; project.blur.mode = 'off'; project.audio = null; project.scene.preset = 'custom';
    project.scene.background.image = null; if (project.screen.bg) project.screen.bg.image = null;
    project.shots = [{ id: `${id}-shot`, media: null, duration: 1, keyframes: {} }];
    m.useEditor.getState().replaceProject(project); if (!await m.ownership.ready(id)) throw new Error('Fixture ownership failed');
    m.useUI.setState({ modal: null, tourStep: null, playing: false, activeShotId: project.shots[0].id });
    m.useEditor.temporal.getState().clear(); await m.persistence.saveAutosave(m.useEditor.getState().project);
  }, id);
  return p;
};
const helper = async p => p.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  window.__mediaQA = {
    db,
    read(key) { return new Promise((resolve, reject) => { const r = db.transaction('keyval').objectStore('keyval').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); },
    write(entries) { return new Promise((resolve, reject) => { const tx = db.transaction('keyval', 'readwrite'), s = tx.objectStore('keyval'); tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); for (const [key, value] of entries) if (value === undefined) s.delete(key); else s.put(value, key); }); },
    keys() { return new Promise(resolve => { const r = db.transaction('keyval').objectStore('keyval').getAllKeys(); r.onsuccess = () => resolve(r.result); }); },
    async seed(id, old = true) {
      const blob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="red"/></svg>'], { type: 'image/svg+xml' });
      const ref = { id, name: `${id}.svg`, kind: 'image', width: 80, height: 60 }, storedAt = Date.now() - 30 * 86400000;
      await this.write([[`media:${id}`, { ref, blob, storedAt, retentionVersion: 1 }], [`media-orphan:${id}`, old ? { version: 1, observedAt: Date.now() - 8 * 86400000, storedAt, size: blob.size, type: blob.type } : undefined]]);
      return ref;
    },
    async age(id) { const record = await this.read(`media:${id}`); record.storedAt = Date.now() - 30 * 86400000; await this.write([[`media:${id}`, record], [`media-orphan:${id}`, { version: 1, observedAt: Date.now() - 8 * 86400000, storedAt: record.storedAt, size: record.blob.size, type: record.blob.type }]]); },
  };
});
const prune = p => p.evaluate(() => window.__mok.persistence.pruneMedia(window.__mok.useEditor.getState().project));
const exists = (p, id) => p.evaluate(async id => !!await window.__mediaQA.read(`media:${id}`), id);
const seed = (p, id, old = true) => p.evaluate(({ id, old }) => window.__mediaQA.seed(id, old), { id, old });
const importSvg = (p, name) => p.evaluate(async name => {
  const m = window.__mok; return m.actions.importFilesToShot([new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="blue"/></svg>'], name, { type: 'image/svg+xml' })], m.useEditor.getState().project.shots[0].id);
}, name);
try {
  const a = await open('reclaim-a'); await helper(a);
  await seed(a, 'first-observation', false); assert.equal(await prune(a), 0); assert.equal(await exists(a, 'first-observation'), true);
  await a.evaluate(() => window.__mediaQA.age('first-observation')); assert.equal(await prune(a), 1); assert.equal(await exists(a, 'first-observation'), false);
  check('Automatic cleanup requires a full grace period between two orphan observations');

  await seed(a, 'legacy-bytes'); await seed(a, 'new-protocol-bytes');
  await a.evaluate(async () => { const q = window.__mediaQA, record = await q.read('media:legacy-bytes'); delete record.retentionVersion; await q.write([['media:legacy-bytes', record]]); });
  assert.equal(await prune(a), 1); assert.equal(await exists(a, 'legacy-bytes'), true); assert.equal(await exists(a, 'new-protocol-bytes'), false);
  assert.equal(await a.evaluate(async () => (await window.__mediaQA.read('media:legacy-bytes')).retentionVersion), undefined);
  assert.equal(await a.evaluate(() => window.__mediaQA.read('media-orphan:legacy-bytes')), undefined);
  check('Mixed migration retains legacy bytes permanently and reclaims only explicitly tagged new imports');

  const b = await open('reclaim-b'); await helper(b);
  await a.evaluate(async () => {
    const q = window.__mediaQA, base = window.__mok.useEditor.getState().project;
    for (const [id, key] of [['saved-root', 'project:unindexed'], ['draft-root', 'draft:historical'], ['template-root', 'template:legacy']]) {
      const ref = await q.seed(id), p = structuredClone(base); p.shots[0].media = ref;
      await q.write([[key, key.startsWith('template:') ? { project: p } : p]]);
    }
  });
  assert.equal(await prune(a), 0); for (const id of ['saved-root', 'draft-root', 'template-root']) assert.equal(await exists(a, id), true);
  check('Saved, unindexed, draft and legacy template references are retained');

  await a.evaluate(async () => { const q = window.__mediaQA, p = structuredClone(window.__mok.useEditor.getState().project); p.shots[0].media = (await q.read('media:legacy-bytes')).ref; await q.write([['project:legacy-load', p]]); await window.__mok.persistence.loadProject('legacy-load'); });
  assert.equal(await a.evaluate(async () => (await window.__mediaQA.read('media:legacy-bytes')).retentionVersion), undefined);
  check('Loading an old source does not opt its bytes into automatic reclamation');

  const undoRef = await importSvg(b, 'undo.svg'); assert.ok(undoRef?.id);
  await b.waitForTimeout(450); // End the editor's deliberate typing/drag history coalescing window.
  await b.evaluate(async () => { const m = window.__mok; m.useEditor.getState().update(p => { p.shots[0].media = null; }); await m.persistence.saveAutosave(m.useEditor.getState().project); });
  await a.evaluate(id => window.__mediaQA.age(id), undoRef.id);
  assert.equal(await prune(a), 0); assert.equal(await exists(a, undoRef.id), true);
  assert.ok(await b.evaluate(id => window.__mok.useEditor.temporal.getState().pastStates.some(s => s.project.shots.some(shot => shot.media?.id === id)), undoRef.id));
  check('Another tab’s unsaved undo history survives cleanup without relying on its current project');

  await b.evaluate(() => {
    const put = IDBObjectStore.prototype.put, complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    IDBObjectStore.prototype.put = function(value, key) {
      const result = put.call(this, value, key);
      if (typeof key === 'string' && key.startsWith('media:') && value.ref?.name === 'pending.svg') {
        window.__pendingId = value.ref.id;
        Object.defineProperty(this.transaction, 'oncomplete', { configurable: true, set(fn) { complete.set.call(this, event => { window.__finishPendingImport = () => fn.call(this, event); }); }, get() { return complete.get.call(this); } });
        IDBObjectStore.prototype.put = put;
      }
      return result;
    };
    const m = window.__mok;
    window.__pendingImport = m.actions.importFilesToShot([new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>'], 'pending.svg', { type: 'image/svg+xml' })], m.useEditor.getState().project.shots[0].id);
  });
  await b.waitForFunction(() => typeof window.__finishPendingImport === 'function'); const pendingId = await b.evaluate(() => window.__pendingId);
  await a.evaluate(id => window.__mediaQA.age(id), pendingId);
  assert.equal(await prune(a), 0); assert.equal(await exists(a, pendingId), true);
  await b.evaluate(async () => { window.__finishPendingImport(); await window.__pendingImport; const m = window.__mok; m.useEditor.getState().update(p => { p.shots[0].media = null; }); await m.persistence.saveAutosave(m.useEditor.getState().project); });
  check('A blob committed before its importer resolves is pinned across tabs');

  await b.evaluate(() => window.__mok.ownership.release());
  await a.evaluate(async ids => { for (const id of ids) await window.__mediaQA.age(id); }, [undoRef.id, pendingId]);
  assert.equal(await prune(a), 0); assert.equal(await exists(a, undoRef.id), true);
  check('Read-only tabs retain their pins after their editing lease is released');
  const bSessionKeys = await b.evaluate(async () => (await navigator.locks.query()).held.filter(x => x.name?.startsWith('mok-media-session-v1:')).map(x => `media-session:${x.name.slice('mok-media-session-v1:'.length)}`));
  await b.close(); assert.equal(await prune(a), 0);
  const remainingSessionKeys = await a.evaluate(async () => (await window.__mediaQA.keys()).filter(k => typeof k === 'string' && k.startsWith('media-session:')));
  assert.ok(remainingSessionKeys.length < bSessionKeys.length);
  await a.evaluate(async ids => { for (const id of ids) await window.__mediaQA.age(id); }, [undoRef.id, pendingId]);
  assert.equal(await prune(a), 2); assert.equal(await exists(a, undoRef.id), false); assert.equal(await exists(a, pendingId), false);
  check('Closing a tab releases its pins; stale manifests are removed and newly orphaned imports age before deletion');

  await seed(a, 'registration-race');
  const blank = await context.newPage(); await blank.goto(new URL('/__media-retention-probe', url).href);
  await blank.evaluate(() => new Promise(resolve => { void navigator.locks.request('mok-media-session-v1:registration-interrupted', () => { resolve(); return new Promise(r => { window.__releaseRegistration = r; }); }); }));
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'registration-race'), true);
  await blank.close(); assert.equal(await prune(a), 1);
  check('An interrupted live tab registration blocks cleanup until the browser releases its lock');

  await seed(a, 'unknown-writer'); await a.evaluate(() => window.__mediaQA.write([['ownership:legacy-writer', { token: 'legacy-unmanifested', expires: Date.now() + 30000 }]]));
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'unknown-writer'), true);
  await a.evaluate(() => window.__mediaQA.write([['ownership:legacy-writer', undefined]])); assert.equal(await prune(a), 1);
  check('A live writer from an older application version prevents reclamation');

  await seed(a, 'rollback-candidate'); await a.evaluate(() => window.__mediaQA.write([['media:z-broken', { ref: { id: 'wrong' }, blob: new Blob(['bad']) }]]));
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'rollback-candidate'), true);
  await a.evaluate(() => window.__mediaQA.write([['media:z-broken', undefined]])); assert.equal(await prune(a), 1);
  check('A later damaged media record aborts the whole transaction and restores earlier staged deletions');

  await seed(a, 'damaged-project'); await a.evaluate(() => window.__mediaQA.write([['project:broken', { shots: null }]]));
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'damaged-project'), true);
  await a.evaluate(() => window.__mediaQA.write([['project:broken', undefined]])); assert.equal(await prune(a), 1);
  check('Unreadable project roots fail closed');

  await seed(a, 'missing-index-record');
  await a.evaluate(async () => { const q = window.__mediaQA; window.__priorProjectIndex = await q.read('projects:index'); await q.write([['projects:index', [{ id: 'missing-project-record' }]]]); });
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'missing-index-record'), true);
  await a.evaluate(() => window.__mediaQA.write([['projects:index', window.__priorProjectIndex]])); assert.equal(await prune(a), 1);
  check('An index referencing a missing project blocks reclamation');

  await seed(a, 'gc-quota-a'); await seed(a, 'gc-quota-z', false);
  await a.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, key) { if (key === 'media-orphan:gc-quota-z') { IDBObjectStore.prototype.put = put; throw new DOMException('Simulated cleanup quota failure', 'QuotaExceededError'); } return put.call(this, value, key); }; });
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'gc-quota-a'), true);
  assert.equal(await prune(a), 1);
  check('Cleanup quota failure rolls back all staged blob deletions');

  await seed(a, 'maintenance-busy'); const gate = await context.newPage(); await gate.goto(new URL('/__media-retention-probe', url).href);
  await gate.evaluate(() => new Promise(resolve => { void navigator.locks.request('mok-media-maintenance-v1', () => { resolve(); return new Promise(r => { window.__releaseMaintenance = r; }); }); }));
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'maintenance-busy'), true);
  await gate.close(); assert.equal(await prune(a), 1);
  check('An occupied cross-tab maintenance gate skips cleanup without waiting or deleting');

  const c = await open('reclaim-quota'); await helper(c); await seed(a, 'quota-veto');
  await c.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, key) { if (typeof key === 'string' && key.startsWith('media-session:')) { IDBObjectStore.prototype.put = put; throw new DOMException('Simulated manifest quota failure', 'QuotaExceededError'); } return put.call(this, value, key); }; });
  const quotaRef = await importSvg(c, 'quota.svg'); assert.ok(quotaRef?.id); assert.equal(await exists(a, quotaRef.id), true);
  assert.equal(await prune(a), 0); assert.equal(await exists(a, 'quota-veto'), true);
  await c.evaluate(async () => { const m = window.__mok; m.useEditor.getState().update(p => { p.shots[0].media = null; }); await m.persistence.saveAutosave(m.useEditor.getState().project); });
  const closedToken = await c.evaluate(() => window.__mok.ownership.state.getState().token);
  await c.close();
  // A crash can leave a valid lease for up to 30 seconds after its browser-owned lock vanished.
  await a.evaluate(token => window.__mediaQA.write([['ownership:reclaim-quota', { token, expires: Date.now() + 30000 }]]), closedToken);
  assert.equal(await prune(a), 1);
  const closedManifest = await a.evaluate(async token => { const q = window.__mediaQA; for (const key of await q.keys()) if (typeof key === 'string' && key.startsWith('media-session:') && (await q.read(key)).tokens.includes(token)) return key; }, closedToken);
  assert.ok(closedManifest, 'keep modern-protocol evidence while the closed tab lease remains active');
  await a.evaluate(token => window.__mediaQA.write([['ownership:reclaim-quota', { token, expires: 0 }]]), closedToken);
  await prune(a); assert.equal(await a.evaluate(key => window.__mediaQA.read(key), closedManifest), undefined);
  check('Manifest quota failure permits ordinary importing while a live veto prevents unsafe deletion');
  check('A closed modern tab’s lingering lease cannot impersonate an old writer; its proof record expires afterward');

  await a.evaluate(async () => { const q = window.__mediaQA; for (let i = 0; i < 35; i++) await q.seed(`bounded-${i}`); });
  assert.equal(await prune(a), 32); assert.equal(await prune(a), 3);
  check('Each opening reclaims at most 32 blobs');

  await seed(a, 'automatic-opening');
  await a.evaluate(async () => { const m = window.__mok, p = structuredClone(m.useEditor.getState().project); p.id = 'reclaim-open-again'; m.useEditor.getState().replaceProject(p); await m.ownership.ready(p.id); });
  await a.waitForFunction(async () => !await window.__mediaQA.read('media:automatic-opening'), undefined, { timeout: 10000 });
  check('Opening another project automatically runs cleanup after the editor settles');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = String(error.stack ?? error); throw error; }
finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
