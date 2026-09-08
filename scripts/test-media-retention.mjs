import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { referencedMediaIds, validMediaManifest, oldOrphan, MEDIA_ORPHAN_GRACE_MS, retainMedia, withMediaMaintenance } = await import('../src/lib/mediaRetention.ts');

test('reference discovery includes every source position and legacy template fields without normalization', () => {
  const ref = id => ({ id, kind: 'image' });
  const p = { shots: [{ media: ref('screen'), logo: { media: ref('logo') } }], scene: { background: { image: ref('room') } }, screen: { bg: { image: ref('screen-bg') } }, audio: { media: { id: 'music', kind: 'audio' } }, futureLayer: { media: { id: 'future', kind: 'video' } } };
  p.cycle = p;
  assert.deepEqual([...referencedMediaIds({ project: p })].sort(), ['future', 'logo', 'music', 'room', 'screen', 'screen-bg']);
  assert.deepEqual([...referencedMediaIds({ id: 'partial-ref', name: 'lost.png' })], ['partial-ref'], 'a missing kind cannot discard a recoverable source');
});

test('a live tab requires a complete matching manifest; malformed or mismatched evidence is rejected', () => {
  const m = { version: 1, session: 'a', ids: ['undo', 'pending'], tokens: ['lease'] };
  assert.equal(validMediaManifest(m, 'a'), true);
  for (const bad of [null, { ...m, session: 'b' }, { ...m, ids: null }, { ...m, tokens: null }, { ...m, ids: ['a', 1] }, { ...m, version: 2 }]) assert.equal(validMediaManifest(bad, 'a'), false);
});

test('reclamation needs two old observations of unchanged bytes and fails closed on clock skew or replacement', () => {
  const now = 2_000_000_000_000, blob = new Blob(['old data'], { type: 'image/png' });
  const record = { blob, retentionVersion: 1 };
  const marker = { version: 1, observedAt: now - MEDIA_ORPHAN_GRACE_MS, storedAt: null, size: blob.size, type: blob.type };
  assert.equal(oldOrphan(marker, record, now), true, 'opted-in bytes require a full observed grace period');
  assert.equal(oldOrphan(marker, record, now - 1), false);
  assert.equal(oldOrphan(null, record, now), false);
  assert.equal(oldOrphan(marker, { blob }, now), false, 'untagged pre-protocol bytes are never automatically deleted');
  assert.equal(oldOrphan(marker, { ...record, retentionVersion: 2 }, now), false, 'unknown future protocols are retained too');
  assert.equal(oldOrphan({ ...marker, observedAt: now + 1 }, record, now), false);
  assert.equal(oldOrphan({ ...marker, observedAt: NaN }, record, now), false);
  assert.equal(oldOrphan(marker, { ...record, storedAt: now }, now), false, 'rewriting an ID resets candidacy even at equal dimensions');
  assert.equal(oldOrphan(marker, { ...record, blob: new Blob(['new size'], { type: 'video/mp4' }) }, now), false);
  assert.equal(oldOrphan({ ...marker, storedAt: now }, { ...record, storedAt: now }, now), false, 'a newly stored record cannot inherit an old marker');
});

test('unsupported Web Locks never stop ordinary access and never enable unsafe cleanup', async () => {
  await retainMedia(['local-source']);
  let ran = false;
  assert.equal(await withMediaMaintenance(async () => { ran = true; return 10; }, 0), 0);
  assert.equal(ran, false);
});
