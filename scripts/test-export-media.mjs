import './test-loader.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { ExportVideoDecoder } = await import('../src/export/videoDecoder.ts');
const { getVideoFrame } = await import('../src/lib/videoFrames.ts');
const { MemoryOutputFile, createExportOutput, MEMORY_OUTPUT_LIMIT } = await import('../src/export/output.ts');
const { audioSegments, sourceAudioGainAt, sourceAudioAt, audioHeadroom, mixAudioChunk, hasAudio } = await import('../src/lib/audioPlan.ts');
const { trimAudioPacket } = await import('../src/export/audioEncode.ts');
const { EncodedPacket } = await import('mediabunny');
const { createProject } = await import('../src/lib/defaults.ts');
const { exportQualityRequirements } = await import('../src/export/quality.ts');
const { planRenderQuality } = await import('../src/three/qualityPlan.ts');
const { seekVideoElement } = await import('../src/export/videoSeek.ts');
const { exportAssets } = await import('../src/export/assets.ts');
const canvas = () => ({ width: 1, height: 1, getContext: () => ({ clearRect() {} }) });
const media = (id = 'video') => ({ ref: { id, name: `${id}.mp4`, kind: 'video', duration: 2 }, blob: new Blob(), kind: 'video' });
function pcm(values, rate = 8) {
  const data = Float32Array.from(values);
  return { sampleRate: rate, length: data.length, numberOfChannels: 1, getChannelData: () => data };
}

await test('120fps timestamps and VFR duration boundaries never reuse a guessed 60fps frame', async () => {
  const requests = [], closed = [];
  const source = media();
  const decoder = new ExportVideoDecoder({ canvas, open: async () => ({ firstTimestamp: 0, dispose() {}, async getSample(t) {
    const index = Math.floor(t * 120 + 1e-8); requests.push(index);
    return { timestamp: index / 120, duration: 1 / 120, displayWidth: 90, displayHeight: 160, draw() {}, close() { closed.push(index); } };
  } }) });
  for (const t of [0, 0.002, 1 / 120, 2 / 120, 0.01]) assert.equal(await decoder.prepare(source, t), true);
  assert.deepEqual(requests, [0, 1, 2, 1]); assert.deepEqual(closed, requests);
  assert.equal(getVideoFrame('video').width, 90); assert.equal(getVideoFrame('video').height, 160);
  decoder.dispose(); assert.equal(getVideoFrame('video'), null);
  const times = [], vfr = new ExportVideoDecoder({ canvas, open: async () => ({ firstTimestamp: 0, dispose() {}, async getSample(t) { times.push(t); return { timestamp: t < .1 ? 0 : .1, duration: t < .1 ? .1 : .7, displayWidth: 100, displayHeight: 100, draw() {}, close() {} }; } }) });
  for (const t of [0, .09, .1, .7]) await vfr.prepare(source, t);
  assert.deepEqual(times, [0, .1]); vfr.dispose();
});
await test('source changes release the input and unsupported codecs fall back once per loaded source', async () => {
  let opened = 0, disposed = 0, fallback = 0;
  const a = media('a'), b = media('b');
  const decoder = new ExportVideoDecoder({ canvas, onFallback: () => fallback++, open: async (m) => {
    opened++; if (m === b) throw new Error('unsupported');
    return { firstTimestamp: 0, dispose() { disposed++; }, async getSample(t) { return { timestamp: t, duration: .1, displayWidth: 40_000, displayHeight: 40_000, draw() {}, close() {} }; } };
  } });
  await decoder.prepare(a, 0); const frame = getVideoFrame('a');
  assert.ok(frame.image.width * frame.image.height <= 12_000_000); assert.ok(frame.image.width <= 4096);
  assert.equal(await decoder.prepare(b, 0), false); assert.equal(await decoder.prepare(b, .1), false);
  assert.equal(opened, 2); assert.equal(disposed, 1); assert.equal(fallback, 1); assert.equal(getVideoFrame('a'), null); decoder.dispose();
});
await test('cancel returns promptly, releases the input, and closes a late decoded sample', async () => {
  let resolveSample, closed = 0, disposed = 0;
  const ctrl = new AbortController();
  const decoder = new ExportVideoDecoder({ canvas, open: async () => ({ firstTimestamp: 0, dispose() { disposed++; }, getSample: () => new Promise((r) => { resolveSample = r; }) }) });
  const pending = decoder.prepare(media(), 0, ctrl.signal);
  while (!resolveSample) await Promise.resolve();
  ctrl.abort(); await assert.rejects(pending, { name: 'AbortError' });
  resolveSample({ close() { closed++; } }); await Promise.resolve(); await Promise.resolve();
  assert.equal(closed, 1); assert.equal(disposed, 1); decoder.dispose();
});
await test('paged output preserves overwrites, cross-page positions and zero-filled sparse gaps', async () => {
  const file = new MemoryOutputFile(3 * 1024 * 1024), edge = 1024 * 1024;
  file.write(Uint8Array.of(1, 2, 3, 4), edge - 2); file.write(Uint8Array.of(9, 8), edge - 1); file.write(Uint8Array.of(7), 0);
  const bytes = new Uint8Array(await file.blob('video/mp4').arrayBuffer());
  assert.equal(bytes[0], 7); assert.equal(bytes[100], 0); assert.deepEqual([...bytes.slice(edge - 2)], [1, 9, 8, 4]);
  assert.throws(() => file.write(Uint8Array.of(1), 3 * edge), /limit/);
  assert.throws(() => file.write(Uint8Array.of(1), -1), /limit/); file.clear(); assert.equal(file.size, 0);
  await assert.rejects(createExportOutput(MEMORY_OUTPUT_LIMIT + 1), /128 MiB/);
  await assert.rejects(createExportOutput(NaN), /budget/);
});
await test('trim/speed/loops and duration cut plan only audible shot intervals, never held gaps/tails', () => {
  const p = createProject(); p.duration = 5;
  p.shots = [{ ...p.shots[0], id: 'a', duration: 2, gap: .5, speed: 2, trimStart: .5, media: media().ref, audio: { enabled: true, volume: 1 } }];
  const segments = audioSegments(p, 2);
  assert.deepEqual(segments.map((s) => [s.start, s.end, s.sourceStart, s.rate]), [[.5, 1.25, .5, 2], [1.25, 2, 0, 2]]);
  assert.equal(sourceAudioAt(p, .1, 5), null); assert.equal(sourceAudioAt(p, 2.5, 5), null); assert.equal(sourceAudioAt(p, 4, 5), null);
  assert.equal(sourceAudioAt(p, .75, 5).gain, 1);
});
await test('timecoded PCM proves sample offsets, source loops, rate changes and exact output endpoint', () => {
  const p = createProject(), source = pcm([0, .1, .2, .3, .4, .5, .6, .7], 8);
  p.shots = [{ ...p.shots[0], duration: 1, gap: .25, speed: 2, trimStart: .25, media: { ...media().ref, duration: 1 }, audio: { enabled: true, volume: 1 } }];
  const output = pcm(new Array(8).fill(0), 8);
  for (const segment of audioSegments(p, 1)) mixAudioChunk(output, source, 0, segment, 1);
  assert.deepEqual([...output.getChannelData(0)].map((x) => +x.toFixed(4)), [0, 0, .2, .4, .6, 0, .2, .4]);
});
await test('splits retain a continuous overlapping fade envelope and soundtrack/source share headroom', () => {
  const p = createProject(), shot = { ...p.shots[0], duration: 4, media: media().ref, audio: { enabled: true, volume: 1, fadeIn: 3, fadeOut: 3 } };
  const left = { ...shot, duration: 1.5, audio: { ...shot.audio, envelope: { offset: 0, duration: 4 } } }, right = { ...shot, duration: 2.5, audio: { ...shot.audio, envelope: { offset: 1.5, duration: 4 } } };
  for (const t of [.1, 1, 1.49]) assert.equal(sourceAudioGainAt(left, t), sourceAudioGainAt(shot, t));
  for (const t of [0, .5, 2.49]) assert.equal(sourceAudioGainAt(right, t), sourceAudioGainAt(shot, t + 1.5));
  p.shots = [{ ...shot, audio: { enabled: true, volume: 1 } }];
  p.audio = { media: { ...media('soundtrack').ref, kind: 'audio', duration: 4 }, volume: 1, start: 0, trimStart: 0, fadeIn: 0, fadeOut: 0 };
  assert.equal(audioHeadroom(p, 1, 4), .5); assert.equal(audioHeadroom(p, 4, 4), 1);
});

await test('a wedged timestamp decode times out, disposes the input and falls back visibly', async () => {
  let closed = 0, fallback = 0;
  const decoder = new ExportVideoDecoder({ canvas, timeoutMs: 5, onFallback: () => fallback++, open: async () => ({ firstTimestamp: 0, dispose() { closed++; }, getSample: () => new Promise(() => {}) }) });
  assert.equal(await decoder.prepare(media(), 0), false); assert.equal(closed, 1); assert.equal(fallback, 1); decoder.dispose();
});
await test('audio packet clipping retains AAC priming and removes encoder padding after the endpoint', () => {
  const packet = (timestamp) => new EncodedPacket(Uint8Array.of(1), 'key', timestamp, 1024 / 48000);
  assert.equal(trimAudioPacket(packet(0), .044, .55).timestamp, 0);
  const last = trimAudioPacket(packet(.576), .044, .55);
  assert.ok(Math.abs(last.timestamp + last.duration - .594) < 1e-10);
  assert.equal(trimAudioPacket(packet(.598), .044, .55), null);
});

await test('one export plan budgets mixed depth/off shots before the first N=4 sample and restores preview', async () => {
  const { useEditor } = await import('../src/store/editor.ts');
  const { useUI } = await import('../src/store/ui.ts');
  const { viewport, useRenderFlags } = await import('../src/three/registry.ts');
  const { withExportSession } = await import('../src/export/capture.ts');
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
  const p = createProject(); p.duration = 2; p.effects = [];
  p.shots = [{ ...p.shots[0], id: 'off', duration: 1, blurMode: 'off', media: null }, { ...p.shots[0], id: 'depth', duration: 1, blurMode: 'depth', media: null }];
  useEditor.setState({ project: p }); useUI.setState({ playing: false, time: 0 });
  const state = { size: { width: 640, height: 480 }, viewport: { dpr: 1 }, frameloop: 'always', gl: { capabilities: { maxTextureSize: 8192, maxSamples: 4 }, domElement: {} }, setFrameloop(mode) { this.frameloop = mode; }, setDpr(value) { this.viewport.dpr = value; }, setSize(width, height) { this.size = { width, height }; }, invalidate() {}, advance() {} };
  viewport.get = () => state;
  try {
    await withExportSession({ width: 320, height: 180, transparent: false, motionSamples: 4 }, async ({ renderAt }) => {
      const plan = useRenderFlags.getState().qualityPlan;
      assert.equal(plan.samples, 0, 'later depth shot must disable MSAA from frame zero to keep the composer stable');
      await renderAt(0); await renderAt(1); assert.equal(useRenderFlags.getState().qualityPlan, plan);
    });
    assert.equal(useRenderFlags.getState().qualityPlan, null);
    await withExportSession({ width: 320, height: 180, transparent: false, scope: { type: 'still', time: .5 } }, async () => assert.equal(useRenderFlags.getState().qualityPlan.samples, 4, 'unrelated depth shot must not lower a still capture'));
    useRenderFlags.setState({ transparent: true, transparentShadows: false });
    await withExportSession({ width: 320, height: 180, transparent: true }, async () => {
      assert.equal(useRenderFlags.getState().transparentShadows, true, 'transparent exports include the ground shadow by default');
    });
    assert.equal(useRenderFlags.getState().transparentShadows, false, 'capture restores the previous cutout preview');
    await assert.rejects(withExportSession({ width: 320, height: 180, transparent: true, transparentShadows: true }, async () => { throw new Error('GPU failure'); }), /GPU failure/);
    assert.equal(useRenderFlags.getState().transparent, true);
    assert.equal(useRenderFlags.getState().transparentShadows, false, 'failure restores the previous shadow preference');
    useRenderFlags.setState({ transparent: false, transparentShadows: true });
  } finally { globalThis.requestAnimationFrame = previousRaf; viewport.get = null; }
});

await test('5.1 source audio retains center dialogue in the stereo mix', () => {
  const p = createProject(); p.shots[0].duration = 1; p.shots[0].media = { ...media().ref, duration: 1 }; p.shots[0].audio = { enabled: true, volume: 1 };
  const channels = Array.from({ length: 6 }, (_, i) => new Float32Array(8).fill(i === 2 ? .5 : 0));
  const source = { sampleRate: 8, numberOfChannels: 6, length: 8, getChannelData: (index) => channels[index] }, outChannels = [new Float32Array(8), new Float32Array(8)];
  const output = { sampleRate: 8, numberOfChannels: 2, length: 8, getChannelData: (index) => outChannels[index] };
  mixAudioChunk(output, source, 0, audioSegments(p, 1)[0], 1);
  assert.ok(Math.abs(outChannels[0][1] - .5 * Math.SQRT1_2) < 1e-7); assert.deepEqual(outChannels[0], outChannels[1]);
});

await test('source fade-out follows a trimmed project endpoint in preview and exported gain', () => {
  const p = createProject(); const shot = { ...p.shots[0], duration: 4, media: media().ref, audio: { enabled: true, volume: 1, fadeOut: .5 } }; p.shots = [shot];
  assert.equal(sourceAudioAt(p, .75, 1).gain, .5);
  assert.equal(sourceAudioGainAt(shot, .75, 1), .5);
  assert.equal(sourceAudioAt(p, 1, 1), null);
});

await test('picker and capture budget only the still/current hold or trimmed video interval', () => {
  const p = createProject(); p.effects = [{ id: 'bloom', enabled: true, params: {} }]; p.blur.mode = 'depth';
  p.shots = [
    { ...p.shots[0], id: 'simple', duration: 1, blurMode: 'off', effects: [{ id: 'grain', enabled: false, params: {} }] },
    { ...p.shots[0], id: 'heavy', gap: 1, duration: 1, blurMode: 'depth' },
  ];
  const still = exportQualityRequirements(p, { type: 'still', time: .5 });
  assert.equal(still.depth, false); assert.equal(still.effectCount, 0);
  assert.deepEqual(exportQualityRequirements(p, { type: 'still', time: 1.5 }), still, 'gap holds the preceding shot');
  assert.deepEqual(exportQualityRequirements(p, { type: 'video', start: 0, end: 2 }), still, 'an exact trimmed endpoint excludes the next shot');
  const later = exportQualityRequirements(p, { type: 'still', time: 2 });
  assert.equal(later.depth, true); assert.equal(later.effectCount, 1);
  assert.deepEqual(exportQualityRequirements(p, { type: 'video', start: 0, end: 2.1 }), later);
  assert.deepEqual(exportQualityRequirements(p, { type: 'still', time: 5 }), later, 'extended tail uses the final visible shot');
  const hardware = { width: 4096, height: 4096, maxTextureSize: 8192, maxSamples: 4, budgetBytes: 900 * 1024 * 1024 };
  assert.equal(planRenderQuality({ ...hardware, ...still }).supported, true);
  assert.equal(planRenderQuality({ ...hardware, ...later }).supported, false, 'unrelated depth could formerly disable this valid still');
});

await test('DOM fallback rejects a failed seek instead of encoding the previously decoded frame', async () => {
  class Video extends EventTarget {
    readyState = 2; seeking = false; error = null; at = 0; writes = 0; listeners = new Set(); mode = 'ok';
    get currentTime() { return this.at; }
    set currentTime(value) {
      this.writes++;
      if (this.mode === 'throw') throw new DOMException('No supported seek range', 'InvalidStateError');
      if (this.mode === 'stale') return;
      this.at = this.mode === 'clamped' ? 0 : value; this.seeking = true;
      if (this.mode === 'wedged') return;
      queueMicrotask(() => {
        this.seeking = false;
        if (this.mode === 'error') { this.error = { code: 3 }; this.dispatchEvent(new Event('error')); }
        else this.dispatchEvent(new Event('seeked'));
      });
    }
    addEventListener(name, callback, options) { this.listeners.add(callback); super.addEventListener(name, callback, options); }
    removeEventListener(name, callback, options) { this.listeners.delete(callback); super.removeEventListener(name, callback, options); }
  }
  for (const mode of ['throw', 'stale', 'clamped', 'error', 'wedged', 'ok']) {
    const video = new Video(); video.mode = mode;
    if (mode === 'ok') { await seekVideoElement(video, .5, undefined, 5); assert.equal(video.currentTime, .5); }
    else await assert.rejects(seekVideoElement(video, .5, undefined, 5), /could not|too long/);
    assert.equal(video.listeners.size, 0, `${mode} must release every seek listener`);
    assert.ok(video.writes <= 2, 'failed seeking stays bounded');
  }
  const video = new Video(); video.mode = 'wedged'; const controller = new AbortController();
  const pending = seekVideoElement(video, .5, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(video.listeners.size, 0);
});

await test('only visible enabled captions add fonts to still and video export readiness', () => {
  const p = createProject(), font = { font: 'Geist', weight: 600 };
  p.shots = [
    { ...p.shots[0], id: 'caption', duration: 1, caption: { enabled: true, text: font } },
    { ...p.shots[0], id: 'disabled', duration: 1, caption: { enabled: false, text: { font: 'Other', weight: 400 } } },
    { ...p.shots[0], id: 'later', duration: 1, kind: 'text', text: { font: 'Later', weight: 400 }, caption: { enabled: true, text: { font: 'Ignored', weight: 400 } } },
  ];
  assert.deepEqual(exportAssets(p, { type: 'still', time: .5 }, true).fonts, [font]);
  assert.deepEqual(exportAssets(p, { type: 'still', time: 1.5 }, true).fonts, []);
  assert.deepEqual(exportAssets(p, { type: 'video', start: 0, end: 2 }, true).fonts, [font]);
  assert.deepEqual(exportAssets(p, { type: 'still', time: 2.5 }, true).fonts, [p.shots[2].text]);
});

await test('audio presence in the picker does not expand tiny clips into unbounded loop segments', () => {
  const p = createProject(); p.shots[0].duration = 180; p.shots[0].speed = 4;
  p.shots[0].media = { ...media().ref, duration: 1 / 240 }; p.shots[0].audio = { enabled: true, volume: 1 };
  assert.equal(hasAudio(p, 180), true);
  assert.throws(() => audioSegments(p, 180), /loops too frequently/, 'actual mixing retains its explicit segment budget');
  p.shots[0].gap = 1; assert.equal(hasAudio(p, .5), false);
  p.shots[0].audio.enabled = false; assert.equal(hasAudio(p, 180), false);
});
