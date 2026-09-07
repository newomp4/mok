// End-to-end capture of the actual editor. Requires a running mok server and generated test source.
// MOK_QA_URL=http://127.0.0.1:35361 MOK_QA_NODE_MODULES=... node scripts/export-regression.mjs /tmp/mok-exports [--source source.mp4]
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const destination = resolve(process.argv[2] ?? '../media-e2e'); await mkdir(destination, { recursive: true });
const sourceArgument = process.argv.indexOf('--source');
const sourceFile = sourceArgument >= 0 ? resolve(process.argv[sourceArgument + 1]) : join(destination, 'synthetic-source.mp4');
if (sourceArgument < 0) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=60:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourceFile]);
const fixture = [...await readFile(sourceFile)];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], report = { url: process.env.MOK_QA_URL ?? 'http://127.0.0.1:35361', files: [], errors };
page.on('pageerror', (error) => errors.push(String(error))); page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.setItem('mok:seen-version', '0.9.0'); });
try {
  await page.goto(report.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mok?.registry.state && window.__mok?.registry.composer);
  const result = await page.evaluate(async ({ fixture, traceFrames }) => {
    const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
    m.useUI.setState({ playing: false, time: 0, modal: null, tourStep: null });
    p.id = 'export-regression'; p.duration = .65; p.name = 'Export regression'; p.aspect = '16:9';
    p.shots = [{ id: 'first', name: 'First', duration: .3, media: null, fit: 'contain', keyframes: {}, focusAreas: [], blurMode: 'off', effects: [{ id: 'vignette', enabled: true, params: { amount: .2 } }], screenPadding: .08 }];
    p.mockup.device = 'flat'; p.mockup.finish = 'black'; p.scene.preset = 'custom'; p.scene.detailShadows = 0;
    p.scene.background = { type: 'color', color: '#cccccc', image: null, blur: 0 };
    p.camera = { x: -8, y: 8, z: 0, fov: 30, zoom: 1.1, panX: 0, panY: 0 }; p.effects = []; p.audio = null;
    p.fade = { in: 0, out: 0, color: '#000000' }; p.blur.mode = 'off'; p.blur.strength = 1.2; p.screen.padding = 0;
    m.useEditor.getState().replaceProject(p); m.useUI.getState().setActiveShot('first');
    await m.actions.importFilesToShot([new File([new Uint8Array(fixture)], 'timecode-audio.mp4', { type: 'video/mp4' })], 'first');
    const updated = structuredClone(m.useEditor.getState().project); updated.duration = .65; updated.shots[0].duration = .3;
    updated.shots[0].trimStart = .1; updated.shots[0].audio = { enabled: true, volume: .7, fadeIn: .05, fadeOut: .05 };
    updated.shots.push({ ...structuredClone(updated.shots[0]), id: 'second', name: 'Second', gap: .1, duration: .3, trimStart: .5, speed: .5, screenPadding: .2, blurMode: 'depth', effects: [{ id: 'grain', enabled: true, params: { amount: .05 } }] });
    m.useEditor.getState().replaceProject(updated); m.useUI.setState({ time: .15, playing: false });
    await new Promise((r) => setTimeout(r, 1500));
    const size = { ...m.registry.state.size }, dpr = m.registry.state.viewport.dpr, initialCapture = m.registry.linearCapture;
    const outputs = [], trace = [];
    if (traceFrames) {
      let frame = 0, active = false;
      for (const method of ['beginFrame', 'endFrame', 'render', 'setSize']) {
        const original = initialCapture[method].bind(initialCapture);
        initialCapture[method] = (...args) => {
          if (method === 'beginFrame') { active = true; frame++; }
          if (active && trace.length < 1000) trace.push({ method, frame, time: m.useUI.getState().time, size: { ...m.registry.state.size }, raster: [m.registry.state.gl.domElement.width, m.registry.state.gl.domElement.height], requested: method === 'setSize' ? args : undefined });
          try { return original(...args); } finally { if (method === 'endFrame') active = false; }
        };
      }
    }
    for (const transparent of [false, true]) {
      const start = performance.now(), progress = [];
      const output = await m.capture.exportVideo({ width: 640, height: 360, fps: 12, quality: 'med', samples: 4, transparent, format: transparent ? 'webm' : 'mp4', onProgress: (p, label) => { progress.push(label); } });
      const bytes = [...new Uint8Array(await output.blob.arrayBuffer())]; await output.cleanup();
      outputs.push({ name: transparent ? 'mixed-alpha.webm' : 'mixed-audio.mp4', bytes, elapsedMs: performance.now() - start, progress });
      if (m.registry.state.size.width !== size.width || m.registry.state.size.height !== size.height || m.registry.state.viewport.dpr !== dpr || m.useUI.getState().time !== .15) throw new Error('Export did not restore editor size/time');
      if (m.registry.linearCapture !== initialCapture) throw new Error('Depth/off shot switch recreated the capture accumulator');
    }
    const controller = new AbortController(); let cancelled = false;
    try { await m.capture.exportVideo({ width: 640, height: 360, fps: 12, quality: 'med', samples: 4, transparent: false, format: 'mp4', signal: controller.signal, onProgress: (progress) => { if (progress > 0) controller.abort(); } }); }
    catch (error) { if (error.name !== 'AbortError') throw error; cancelled = true; }
    if (!cancelled) throw new Error('Export cancellation did not abort');
    const image = await m.capture.captureImage({ width: 640, height: 360, transparent: true, format: 'png', time: .5 });
    outputs.push({ name: 'after-cancel.png', bytes: [...new Uint8Array(await image.arrayBuffer())] });
    for (const [name, time] of [['first-still.png', .15], ['second-still.png', .5]]) {
      const image = await m.capture.captureImage({ width: 640, height: 360, transparent: true, format: 'png', time });
      outputs.push({ name, bytes: [...new Uint8Array(await image.arrayBuffer())] });
    }
    const plain = structuredClone(m.useEditor.getState().project); plain.effects = []; for (const shot of plain.shots) { shot.effects = []; shot.blurMode = 'off'; }
    m.useEditor.getState().replaceProject(plain); await new Promise((r) => setTimeout(r, 100));
    const plainImage = await m.capture.captureImage({ width: 640, height: 360, transparent: true, format: 'png', time: .15 });
    outputs.push({ name: 'plain-still.png', bytes: [...new Uint8Array(await plainImage.arrayBuffer())] });
    const temp = await (await navigator.storage.getDirectory()).getDirectoryHandle('mok-export-temp'); let temporaryFiles = 0; for await (const entry of temp.values()) { void entry; temporaryFiles++; }
    if (temporaryFiles) throw new Error(`Export retained ${temporaryFiles} temporary files`);
    return { outputs, trace, cancelled, temporaryFiles, version: m.version };
  }, { fixture, traceFrames: process.env.MOK_TRACE_EXPORT === '1' });
  for (const file of result.outputs) {
    await writeFile(join(destination, file.name), Buffer.from(file.bytes));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', join(destination, file.name)], { encoding: 'utf8' }));
    if (!file.name.endsWith('.png')) {
      if (Math.abs(Number(probe.format.duration) - .65) > .002) throw new Error(`${file.name} duration drifted`);
      if (!probe.streams.some((stream) => stream.codec_type === 'audio')) throw new Error(`${file.name} lost source audio`);
      if (Number(probe.streams.find((stream) => stream.codec_type === 'video').nb_read_frames) !== 8) throw new Error(`${file.name} does not contain all 8 expected frames`);
    }
    const { bytes, ...summary } = file;
    const decoded = spawnSync('ffmpeg', ['-v', 'error', ...(file.name.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : []), '-i', join(destination, file.name), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 });
    if (decoded.status !== 0) throw new Error(`Native frame decode failed for ${file.name}: ${decoded.stderr}`);
    let minAlpha = 255, maxAlpha = 0, transparentPixels = 0, opaquePixels = 0;
    for (let i = 3; i < decoded.stdout.length; i += 4) { const alpha = decoded.stdout[i]; minAlpha = Math.min(minAlpha, alpha); maxAlpha = Math.max(maxAlpha, alpha); if (!alpha) transparentPixels++; if (alpha === 255) opaquePixels++; }
    const validation = { minAlpha, maxAlpha, transparentPixels, opaquePixels, decodeWarning: decoded.stderr.toString() };
    if (!file.name.endsWith('.png')) {
      const audio = spawnSync('ffmpeg', ['-v', 'error', '-i', join(destination, file.name), '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
      if (audio.status !== 0) throw new Error(`Native PCM decode failed for ${file.name}: ${audio.stderr}`);
      const floats = new Float32Array(audio.stdout.buffer, audio.stdout.byteOffset, audio.stdout.length / 4);
      const rms = (start, end) => { let sum = 0, n = 0; for (let i = Math.ceil(start * 48000) * 2; i < Math.min(floats.length, end * 48000 * 2); i++) { sum += floats[i] ** 2; n++; } return Math.sqrt(sum / n); };
      validation.audio = { frames: floats.length / 2, firstClipRms: rms(.1, .2), gapRms: rms(.34, .38), secondClipRms: rms(.5, .6), decodeWarning: audio.stderr.toString() };
      if (validation.audio.firstClipRms < .001 || validation.audio.secondClipRms < .001 || validation.audio.gapRms > .01) throw new Error(`Audio clip/gap validation failed: ${JSON.stringify(validation.audio)}`);
    }
    report.files.push({ ...summary, bytes: bytes.length, probe, validation });
    if (file.name.endsWith('.mp4') ? minAlpha !== 255 : minAlpha !== 0 || maxAlpha < 250 || opaquePixels < 100) throw new Error(`${file.name} has invalid alpha coverage: ${JSON.stringify(validation)}`);
  }
  report.trace = result.trace; report.cancelled = result.cancelled; report.temporaryFiles = result.temporaryFiles; report.version = result.version;
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ files: report.files.map(({ name, elapsedMs, bytes }) => ({ name, elapsedMs, bytes })), cancelled: report.cancelled, temporaryFiles: report.temporaryFiles }, null, 2));
} finally { await writeFile(join(destination, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
