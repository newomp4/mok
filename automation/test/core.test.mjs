import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, loopbackURL } from '../src/workspace.mjs';
import { Jobs } from '../src/jobs.mjs';
import { applyChanges } from '../src/changes.mjs';

test('loopback URL accepts only configured local origins, without credential/query ambiguity', () => {
  for (const url of ['http://127.0.0.1:3000', 'https://localhost:443/editor', 'http://[::1]:3000']) assert.equal(typeof loopbackURL(url), 'string');
  for (const url of ['https://example.com', 'file:///tmp/a', 'http://127.0.0.1.evil.test', 'http://user:password@localhost', 'http://localhost/?fetch=external']) assert.throws(() => loopbackURL(url));
});

test('workspace rejects traversal and symlinks; bounded output is atomically published or fully cleaned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mok-mcp-core-'));
  try {
    const workspace = await Workspace.create(root);
    await symlink(tmpdir(), join(root, 'escape'));
    await assert.rejects(workspace.path('../secret.txt'), /traversal/);
    await assert.rejects(workspace.path('/etc/passwd'), /inside/);
    await assert.rejects(workspace.path('escape/stolen.txt'), /Symbolic/);
    await writeFile(join(root, 'original.mok'), 'original');
    await assert.rejects(workspace.output('original.mok', { maxBytes: 10 }), /exists/);
    const output = await workspace.output('renders/test.png', { maxBytes: 7 });
    await output.write(Buffer.from('abcd'));
    await assert.rejects(readFile(join(root, 'renders/test.png')), /ENOENT/);
    await assert.rejects(output.write(Buffer.from('efgh')), /limit/);
    await output.cleanup();
    assert.deepEqual(await readdir(join(root, 'renders')), []);
    const good = await workspace.output('renders/test.png', { maxBytes: 7 });
    await good.write(Buffer.from('abc')); await good.write(Buffer.from('def')); await good.commit(); await good.cleanup();
    assert.equal(await readFile(join(root, 'renders/test.png'), 'utf8'), 'abcdef');
    const racing = await workspace.output('renders/race.png', { maxBytes: 10 });
    await racing.write(Buffer.from('ours')); await writeFile(join(root, 'renders/race.png'), 'theirs');
    await assert.rejects(racing.commit(), /EEXIST/); await racing.cleanup();
    assert.equal(await readFile(join(root, 'renders/race.png'), 'utf8'), 'theirs');
    await assert.rejects(workspace.input('original.mok', 3), /at most/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('data-only project edits append/remove arrays, preserve originals, and reject prototype paths/values', () => {
  const original = { id: 'p', camera: { x: 0 }, shots: [{ id: 'one', duration: 3 }] };
  const edited = applyChanges(original, [{ op: 'set', path: '/camera/x', value: 40 }, { op: 'set', path: '/shots/-', value: { id: 'two', duration: 1 } }, { op: 'remove', path: '/shots/0' }]);
  assert.equal(edited.camera.x, 40); assert.equal(edited.shots[0].id, 'two'); assert.equal(original.camera.x, 0);
  for (const path of ['/id', '/camera/__proto__/x', '/shots/4', '/missing/x']) assert.throws(() => applyChanges(original, [{ op: 'set', path, value: 3 }]));
  assert.throws(() => applyChanges(original, [{ op: 'set', path: '/camera', value: JSON.parse('{"__proto__":{"polluted":true}}') }]), /Unsafe/);
  assert.equal({}.polluted, undefined);
});

test('jobs serialize, cancel queued/running work, propagate request abort, bound history, and recover', async () => {
  const jobs = new Jobs({ maxQueued: 2, maxHistory: 3, timeoutMs: 2000 });
  const events = []; let release;
  const first = jobs.enqueue('first', (signal) => new Promise((resolve) => { events.push('first'); release = resolve; signal.addEventListener('abort', resolve); }));
  const second = jobs.enqueue('second', async () => { events.push('second'); });
  const third = jobs.enqueue('third', async () => { events.push('third'); });
  assert.throws(() => jobs.enqueue('overflow', async () => {}), /full/);
  jobs.cancel(second.id); await assert.rejects(second.done, /cancelled/); assert.deepEqual(events, ['first']);
  release('done'); await first.done; await third.done; assert.deepEqual(events, ['first', 'third']);
  const controller = new AbortController();
  const active = jobs.enqueue('active', (signal) => new Promise((resolve) => signal.addEventListener('abort', resolve)), controller.signal);
  controller.abort(); await assert.rejects(active.done, /cancelled/);
  assert.equal(jobs.snapshot(active.id).state, 'cancelled');
  assert.equal(await jobs.enqueue('recovery', async () => 42).done, 42);
  assert.ok(jobs.entries.size <= 3); await jobs.close();
  assert.throws(() => jobs.enqueue('closed', async () => {}), /closing/);
});
