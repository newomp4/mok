// Real MCP client → stdio server → isolated browser → mok renderer → atomic workspace file.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { connect } from './client.mjs';

function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function png() {
  const width = 128, height = 256, raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 4 + 1) + 1 + x * 4; raw.set([x * 2, y, 200, 255], i); }
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc32(body)); return Buffer.concat([head, body, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const root = resolve(process.argv[2] ?? 'artifacts'); await mkdir(root, { recursive: true });
await writeFile(join(root, 'screen.png'), png());
const api = await connect({ MOK_MCP_WORKSPACE: root });
const report = { appURL: process.env.MOK_MCP_APP_URL ?? 'http://127.0.0.1:3000', checks: [], outputs: [] };
const pass = (text) => { report.checks.push(text); process.stderr.write(`${text}\n`); };
try {
  const catalog = await api.call('mok_catalog');
  assert.ok(catalog.devices.length >= 15); assert.ok(catalog.templates.length);
  report.appVersion = catalog.appVersion; pass('Actual app catalog/device/template discovery');
  const created = await api.call('mok_create_project', { path: 'created.mok', name: 'MCP render regression', templateId: catalog.templates[0].id, deviceId: 'iphone-17-pro-glb', aspect: '16:9', overwrite: true });
  assert.equal(created.project.name, 'MCP render regression'); assert.equal(created.project.mockup.device, 'iphone-17-pro-glb');
  const shared = await api.call('mok_update_project', { path: 'created.mok', outputPath: 'shared-source.mok', overwrite: true, changes: [{ op: 'set', path: '/camera/x', value: -20 }] });
  const sharedFile = JSON.parse(await readFile(join(root, 'shared-source.mok'), 'utf8'));
  assert.equal(Object.keys(sharedFile.media).length, 1);
  assert.ok(shared.project.shots.every((shot) => !shot.media || Object.hasOwn(sharedFile.media, shot.media.id)), 'Every repeated media reference must retain embedded bytes after an unrelated setting edit');
  const imported = await api.call('mok_import_media', { path: 'created.mok', outputPath: 'with-media.mok', overwrite: true, mediaPath: 'screen.png', target: 'screen', shotId: created.project.shots.find((s) => !s.kind || s.kind === 'media').id, expectedRevision: created.revision });
  assert.equal(imported.media.width, 128); assert.equal(imported.media.height, 256);
  const first = imported.project.shots.find((s) => s.media?.name === 'screen.png');
  const updated = await api.call('mok_update_project', { path: 'with-media.mok', outputPath: 'render.mok', overwrite: true, expectedRevision: imported.revision, changes: [
    { op: 'set', path: '/shots', value: [{ ...first, duration: .4, keyframes: {}, enter: undefined, exit: undefined }] },
    { op: 'set', path: '/duration', value: .4 }, { op: 'set', path: '/fade', value: { in: 0, out: 0, color: '#000000' } },
    { op: 'set', path: '/blur/mode', value: 'off' }, { op: 'set', path: '/effects', value: [] },
  ] });
  const read = await api.call('mok_read_project', { path: 'render.mok' });
  assert.equal(read.revision, updated.revision); assert.equal(read.project.duration, .4); assert.equal(read.project.shots[0].media.name, 'screen.png');
  assert.notEqual((await readFile(join(root, 'render.mok'), 'utf8')).indexOf('data:image/png;base64,'), -1);
  await assert.rejects(api.call('mok_update_project', { path: 'render.mok', overwrite: true, expectedRevision: '0'.repeat(64), changes: [{ op: 'set', path: '/name', value: 'stale' }] }), /changed since/);
  pass('Portable create/template/import/read/update round trip, embedded media, and stale-revision protection');
  const image = await api.call('mok_render_image', { path: 'render.mok', outputPath: 'render.png', overwrite: true, width: 320, height: 180, transparent: true, transparentShadows: false, time: .2 });
  const imageDone = await api.wait(image.id); assert.equal(imageDone.state, 'succeeded', imageDone.error); report.outputs.push(imageDone.result);
  const imageBytes = await readFile(join(root, 'render.png')); assert.equal(imageBytes.subarray(1, 4).toString(), 'PNG'); assert.equal(imageBytes.readUInt32BE(16), 320); assert.equal(imageBytes.readUInt32BE(20), 180);
  pass('Actual imported-screen GLB image render through MCP');
  const video = await api.call('mok_render_video', { path: 'render.mok', outputPath: 'render.webm', overwrite: true, width: 320, height: 180, format: 'webm', transparent: true, transparentShadows: false, fps: 10, samples: 2, quality: 'low' });
  const queued = await api.call('mok_render_image', { path: 'render.mok', outputPath: 'cancelled-queued.png', overwrite: true, width: 320, height: 180 });
  await api.call('mok_cancel_job', { id: queued.id });
  assert.equal((await api.wait(queued.id)).state, 'cancelled');
  const videoDone = await api.wait(video.id); assert.equal(videoDone.state, 'succeeded', videoDone.error); report.outputs.push(videoDone.result);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', join(root, 'render.webm')], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].nb_read_frames, '4'); assert.equal(probe.streams[0].tags.alpha_mode, '1'); assert.ok(Math.abs(Number(probe.format.duration) - .4) < .002); report.videoProbe = probe;
  const rgba = execFileSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', join(root, 'render.webm'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  let min = 255, max = 0; for (let i = 3; i < rgba.length; i += 4) { min = Math.min(min, rgba[i]); max = Math.max(max, rgba[i]); }
  assert.equal(min, 0); assert.equal(max, 255); report.alpha = { min, max };
  pass('Actual alpha WebM, 2-sample motion, exact duration/frame count, serialized queue cancellation');
  const active = await api.call('mok_render_video', { path: 'render.mok', outputPath: 'cancelled-active.webm', overwrite: true, width: 1280, height: 720, format: 'webm', fps: 60, samples: 8 });
  // Wait for actual capture progress, not just browser startup, before aborting.
  for (let i = 0; i < 120; i++) { const state = await api.call('mok_job_status', { id: active.id }); if (state.progress > 0 || state.state !== 'running') break; await new Promise((resolve) => setTimeout(resolve, 500)); }
  await api.call('mok_cancel_job', { id: active.id }); assert.equal((await api.wait(active.id)).state, 'cancelled');
  const recovery = await api.call('mok_render_image', { path: 'render.mok', outputPath: 'after-cancel.png', overwrite: true, width: 320, height: 180 });
  const recoveryDone = await api.wait(recovery.id); assert.equal(recoveryDone.state, 'succeeded', recoveryDone.error); report.outputs.push(recoveryDone.result);
  const files = await readdir(root); assert.ok(!files.some((name) => name.endsWith('.mok-part') || name.startsWith('cancelled-')));
  pass('In-flight export cancellation, successful subsequent render, no partial/cancelled output files');
  report.diagnostics = api.diagnostics(); assert.equal(report.diagnostics, '');
} finally { await api.close(); await writeFile(join(root, 'mcp-render-report.json'), JSON.stringify(report, null, 2)); }
