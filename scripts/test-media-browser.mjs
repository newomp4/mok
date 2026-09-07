// Real WebCodecs/OPFS fixtures; optional MOK_QA_NODE_MODULES points to Playwright's module folder.
// Requires ffmpeg on PATH. Creates and removes its own temporary source videos and browser profile.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const temporary = await mkdtemp(join(tmpdir(), 'mok-media-regression-'));
const width = 64, height = 48, raw = Buffer.alloc(width * height * 3 * 120);
for (let frame = 0; frame < 120; frame++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const value = x < 56 && (frame & (1 << Math.floor(x / 8))) ? 235 : 16;
  raw.fill(value, (frame * width * height + y * width + x) * 3, (frame * width * height + y * width + x) * 3 + 3);
}
await writeFile(join(temporary, 'frames.rgb'), raw);
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
ffmpeg('-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', '120', '-i', join(temporary, 'frames.rgb'), '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', join(temporary, 'cfr.mp4'));
ffmpeg('-display_rotation:v:0', '90', '-i', join(temporary, 'cfr.mp4'), '-c', 'copy', join(temporary, 'rotated.mp4'));
ffmpeg('-i', join(temporary, 'cfr.mp4'), '-an', '-vf', String.raw`setpts=if(lt(N\,10)\,N/(120*TB)\,(10/120+(N-10)/30)/TB)`, '-fps_mode', 'vfr', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', join(temporary, 'vfr.mp4'));
const allowed = new Set(['/src/export/videoDecoder.ts', '/src/export/videoSeek.ts', '/src/export/abort.ts', '/src/export/output.ts', '/src/export/audioDecode.ts', '/src/export/audioEncode.ts', '/src/export/mp4Timing.ts', '/src/lib/audioPlan.ts', '/src/lib/animation.ts', '/src/lib/videoFrames.ts', '/src/three/raster.ts']);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Mok media fixtures</title>'); }
    else if (path === '/mediabunny.mjs') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs'))); }
    else if (/^\/(cfr|rotated|vfr)\.mp4$/.test(path)) { res.setHeader('content-type', 'video/mp4'); res.end(await readFile(join(temporary, path.slice(1)))); }
    else if (allowed.has(path)) {
      const source = ts.transpileModule(await readFile(join(root, path.slice(1)), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      const code = source.replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, specifier) => {
        let target = specifier === 'mediabunny' ? '/mediabunny.mjs' : specifier.startsWith('@/') ? `/src/${specifier.slice(2)}` : new URL(specifier, `http://localhost${path}`).pathname;
        if (target !== '/mediabunny.mjs' && !target.endsWith('.ts')) target += '.ts';
        return `from ${quote}${target}${quote}`;
      });
      res.setHeader('content-type', 'text/javascript'); res.end(code);
    } else { res.statusCode = 404; res.end(); }
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const { ExportVideoDecoder } = await import('/src/export/videoDecoder.ts');
    const { seekVideoElement } = await import('/src/export/videoSeek.ts');
    const { getVideoFrame } = await import('/src/lib/videoFrames.ts');
    const { openAudioChunks } = await import('/src/export/audioDecode.ts');
    const { audioSegments, mixAudioChunk } = await import('/src/lib/audioPlan.ts');
    const { createExportOutput } = await import('/src/export/output.ts');
    const { prepareAudioTrack } = await import('/src/export/audioEncode.ts');
    const { correctMp4AudioTiming } = await import('/src/export/mp4Timing.ts');
    const mb = await import('/mediabunny.mjs');
    const check = (yes, why) => { if (!yes) throw new Error(why); };
    const media = async (name, duration = 1) => ({ ref: { id: name, name, kind: 'video', duration }, kind: 'video', blob: await (await fetch(`/${name}.mp4`)).blob() });
    const cfr = await media('cfr'), vfr = await media('vfr', 4), rotated = await media('rotated');
    const decoder = new ExportVideoDecoder({ onFallback(name) { throw new Error(`Unexpected decoder fallback: ${name}`); } });
    const frameNumber = (frame) => {
      const ctx = frame.image.getContext('2d'); let number = 0;
      for (let bit = 0; bit < 7; bit++) if (ctx.getImageData(bit * 8 + 4, 24, 1, 1).data[0] > 120) number |= 1 << bit;
      return number;
    };
    const decoded = [];
    for (const [source, queries] of [[cfr, [[0, 0], [1 / 120, 1], [2 / 120, 2], [.5, 60], [.999, 119], [.01, 1]]], [vfr, [[.01, 1], [.09, 10], [.11, 10], [.12, 11], [.2, 13]]]]) {
      for (const [time, expected] of queries) {
        check(await decoder.prepare(source, time), 'Timestamp decoder unexpectedly fell back');
        const actual = frameNumber(getVideoFrame(source.ref.id)); decoded.push([source.ref.id, time, actual]); check(actual === expected, `Timestamp ${source.ref.id}/${time}: frame ${actual}, expected ${expected}`);
      }
    }
    await decoder.prepare(rotated, .5); const rotatedFrame = getVideoFrame('rotated');
    check(rotatedFrame.width === 48 && rotatedFrame.height === 64, `Rotation metadata applied incorrectly: ${rotatedFrame.width}x${rotatedFrame.height}`);
    decoder.dispose(); check(getVideoFrame('rotated') === null, 'Decoded override survives disposal');
    const nativeUrl = URL.createObjectURL(cfr.blob), nativeVideo = document.createElement('video'); nativeVideo.muted = true; nativeVideo.preload = 'auto'; nativeVideo.src = nativeUrl;
    await new Promise((resolve, reject) => { nativeVideo.onloadeddata = resolve; nativeVideo.onerror = reject; });
    const nativeCanvas = document.createElement('canvas'); nativeCanvas.width = 64; nativeCanvas.height = 48;
    const nativeFrames = [];
    for (const time of [.5, 1 / 120, .999]) {
      await seekVideoElement(nativeVideo, time); nativeCanvas.getContext('2d').drawImage(nativeVideo, 0, 0);
      const frame = frameNumber({ image: nativeCanvas }); nativeFrames.push(frame);
      check(frame === Math.floor(time * 120 + 1e-7), `Native fallback returned stale frame ${frame} at ${time}`);
    }
    nativeVideo.removeAttribute('src'); nativeVideo.load(); URL.revokeObjectURL(nativeUrl);
    const audio = await openAudioChunks(cfr); check(audio, 'AAC source track missing');
    const shot = { id: 'a', duration: .5, gap: .1, speed: 2, trimStart: .25, media: cfr.ref, audio: { enabled: true, volume: 1, fadeIn: .1, fadeOut: .1 } };
    const project = { shots: [shot], audio: null }, total = .537;
    const mix = new AudioBuffer({ numberOfChannels: 2, sampleRate: 48000, length: Math.ceil(total * 48000) });
    for (const segment of audioSegments(project, total)) for await (const chunk of audio.chunks(segment.sourceStart, segment.sourceStart + (segment.end - segment.start) * segment.rate)) mixAudioChunk(mix, chunk.buffer, chunk.timestamp, segment, total);
    audio.dispose();
    const samples = mix.getChannelData(0), rms = (start, end) => Math.sqrt(samples.slice(start * 48000, end * 48000).reduce((sum, value) => sum + value * value, 0) / ((end - start) * 48000));
    check(rms(0, .09) === 0, 'Leading gap must remain silent'); check(rms(.25, .35) > .06, 'Trimmed/rate-scaled AAC did not mix'); check(rms(.1, .12) < rms(.25, .35) * .4, 'Fade-in missing');
    let crossings = 0; for (let i = .25 * 48000; i < .35 * 48000; i++) if (samples[i] <= 0 && samples[i + 1] > 0) crossings++;
    check(Math.abs(crossings - 200) < 5, `Rate=2 must shift 1000Hz to 2000Hz, found ${crossings * 10}`);
    const storage = await createExportOutput(2 * 1024 * 1024); check(storage.streamed, 'Chromium should use OPFS');
    let movie; const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: false, onMoov: (data, position) => { movie = { data, position }; } }), target: storage.target });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const source = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 }), audioSource = await prepareAudioTrack(mix, 'aac', false);
    output.addVideoTrack(source); output.addAudioTrack(audioSource.source); await output.start(); await audioSource.write();
    for (let frame = 0; frame < 11; frame++) { const ctx = canvas.getContext('2d'); ctx.fillStyle = frame % 2 ? '#fff' : '#000'; ctx.fillRect(0, 0, 320, 180); await source.add(frame / 20, Math.min(.05, total - frame / 20)); }
    source.close(); await output.finalize(); const blob = correctMp4AudioTiming(await storage.finish('video/mp4'), movie, audioSource.delay, total);
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
    const duration = await input.computeDuration(), track = await input.getPrimaryVideoTrack(), audioTrack = await input.getPrimaryAudioTrack();
    check(Math.abs(duration - total) < .001, `Seek-positioned mux output duration ${duration} != ${total}`); check(track && audioTrack, 'Muxed A/V tracks missing');
    const sink = new mb.VideoSampleSink(track), last = await sink.getSample(.52); check(last && Math.abs(last.timestamp - .5) < .001, 'Final muxed frame not decodable'); last.close(); input.dispose();
    const native = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await blob.arrayBuffer());
    const actualPcm = native.getChannelData(0); let maxError = 0;
    // Compare correlation across possible offsets: the muxed signal must not drift by AAC priming.
    let bestLag = 0, bestError = Infinity;
    for (let lag = -2400; lag <= 2400; lag += 16) { let error = 0; for (let i = 0; i < samples.length; i += 17) error += Math.abs(samples[i] - (actualPcm[i + lag] ?? 0)); if (error < bestError) { bestError = error; bestLag = lag; } }
    check(Math.abs(bestLag) < 32, `AAC priming shifted audible output by ${bestLag} samples`);
    maxError = bestError;
    const size = blob.size; await storage.cleanup();
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('mok-export-temp'); let files = 0; for await (const ignored of directory.values()) { void ignored; files++; } check(files === 0, 'Finished export left temporary files behind');
    const webmStorage = await createExportOutput(2 * 1024 * 1024);
    const webmAudio = await prepareAudioTrack(mix, 'opus', true);
    const webm = new mb.Output({ format: new mb.WebMOutputFormat(), target: webmStorage.target });
    const webmVideo = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 100_000, alpha: 'keep' });
    webm.addVideoTrack(webmVideo); webm.addAudioTrack(webmAudio.source); await webm.start(); await webmAudio.write();
    for (let frame = 0; frame < 11; frame++) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 320, 180); ctx.fillStyle = '#fff'; ctx.fillRect(frame === 0 ? 0 : 80, 0, 160, 180); await webmVideo.add(frame / 20, Math.min(.05, total - frame / 20)); }
    webmVideo.close(); await webm.finalize(); const webmBlob = await webmStorage.finish('video/webm');
    const webmInput = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(webmBlob) });
    const webmPacketDuration = await webmInput.computeDuration(), webmDuration = await webmInput.getDurationFromMetadata(); check(Math.abs(webmDuration - total) < .001, `WebM endpoint ${webmDuration} != ${total}`);
    const opusPcm = (await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await webmBlob.arrayBuffer())).getChannelData(0);
    let opusLag = 0, opusError = Infinity;
    for (let lag = -2400; lag <= 2400; lag += 16) { let error = 0; for (let i = 0; i < samples.length; i += 17) error += Math.abs(samples[i] - (opusPcm[i + lag] ?? 0)); if (error < opusError) { opusError = error; opusLag = lag; } }
    check(Math.abs(opusLag) < 32, `Opus sync moved by ${opusLag} samples`);
    const alphaDecoder = new ExportVideoDecoder();
    const alphaSource = { ref: { id: 'alpha', name: 'alpha.webm', kind: 'video', duration: total }, blob: webmBlob, kind: 'video' };
    await alphaDecoder.prepare(alphaSource, 0); await alphaDecoder.prepare(alphaSource, .2);
    const alphaFrame = getVideoFrame('alpha').image, alphaPixels = alphaFrame.getContext('2d');
    check(alphaPixels.getImageData(20, 20, 1, 1).data[3] === 0, 'Transparent source frames retain stale/black pixels');
    check(alphaPixels.getImageData(120, 20, 1, 1).data[3] === 255, 'Opaque source content lost alpha');
    alphaDecoder.dispose();
    webmInput.dispose(); await webmStorage.cleanup();
    const cancel = new AbortController(), aborted = await createExportOutput(1024, cancel.signal); cancel.abort(); await aborted.cleanup();
    return { decoded, nativeFrames, rotated: [rotatedFrame.width, rotatedFrame.height], audioRms: rms(.25, .35), audioHz: crossings * 10, outputBytes: size, outputDuration: duration, webmDuration, webmPacketDuration, opusLag, opusDelay: webmAudio.delay, transparentSource: true, audioDelay: audioSource.delay, bestLag, maxError, opfsFilesAfterCleanup: files };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); await new Promise((r) => server.close(r)); await rm(temporary, { recursive: true, force: true }); }
