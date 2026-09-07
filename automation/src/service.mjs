import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Jobs, check } from './jobs.mjs';
import { Workspace, loopbackURL } from './workspace.mjs';
import { BrowserAdapter } from './browser.mjs';
import { applyChanges } from './changes.mjs';

const MiB = 1024 * 1024;
function bytesSetting(value, fallback, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < MiB || number > maximum) throw new Error('Configured byte limits must be whole bytes between 1 MiB and their documented maximum.');
  return number;
}
async function digest(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }

export class AutomationService {
  static async create(env = process.env) {
    const workspace = await Workspace.create(env.MOK_MCP_WORKSPACE);
    return new AutomationService({ workspace, appURL: loopbackURL(env.MOK_MCP_APP_URL),
      executablePath: env.MOK_MCP_CHROMIUM_PATH || undefined, softwareGL: env.MOK_MCP_SOFTWARE_GL === '1',
      projectBytes: bytesSetting(env.MOK_MCP_MAX_PROJECT_BYTES, 256 * MiB, 512 * MiB),
      mediaBytes: bytesSetting(env.MOK_MCP_MAX_MEDIA_BYTES, 128 * MiB, 256 * MiB),
      outputBytes: bytesSetting(env.MOK_MCP_MAX_OUTPUT_BYTES, 512 * MiB, 4 * 1024 * MiB) });
  }
  constructor(config) { this.config = config; this.workspace = config.workspace; this.browser = new BrowserAdapter(config); this.jobs = new Jobs(); }
  info() {
    return { serverVersion: '0.11.0', transport: 'stdio', workspace: this.workspace.root, appURL: this.config.appURL,
      isolation: 'A fresh private browser context per operation; no existing browser profile or tab is attached.',
      limits: { projectBytes: this.config.projectBytes, mediaBytes: this.config.mediaBytes, outputBytes: this.config.outputBytes, queuedJobs: 8, history: 100, jobMinutes: 30, maximumVideoSeconds: 180, maximumEdge: 8192 },
      paths: 'Relative to workspace; no symlinks or traversal. Existing files require explicit overwrite=true. .mok files embed media.',
      changes: 'JSON Pointer set/remove. Arrays replace by index, append with /-, or replace in full. Values pass through the editor validator, which may clamp or default invalid settings.',
      workflow: 'catalog → create_project → read_project → import_media/update_project → render_image/render_video → job_status; cancel_job to abort.' };
  }
  async upload(page, path) { await page.locator('#mok-automation-input').setInputFiles(path); }
  async projectInput(path, expectedRevision) {
    const file = await this.workspace.input(path, this.config.projectBytes, ['.mok']);
    file.revision = await digest(file.path);
    if (expectedRevision && file.revision !== expectedRevision) throw new Error('The project changed since it was read. Read it again before updating.');
    return file;
  }
  async load(page, file) { await this.upload(page, file.path); return page.evaluate(() => window.__mokAutomation.load()); }
  async publish(page, output, metadata, signal) {
    if (!Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1) throw new Error('The app returned an empty or invalid result.');
    const maximum = metadata.type === 'application/json' ? this.config.projectBytes : this.config.outputBytes;
    if (metadata.bytes > maximum) throw new Error(`Result exceeds the ${maximum}-byte configured limit.`);
    for (let offset = 0; offset < metadata.bytes; offset += 256 * 1024) {
      check(signal);
      const chunk = Buffer.from(await page.evaluate(([offset, size]) => window.__mokAutomation.chunk(offset, size), [offset, 256 * 1024]), 'base64');
      if (chunk.length !== Math.min(256 * 1024, metadata.bytes - offset)) throw new Error('Result transfer was truncated.');
      await output.write(chunk);
    }
    check(signal); const result = await output.commit();
    return { ...result, mimeType: metadata.type, sha256: await digest(output.path) };
  }
  async catalog(kind, signal) {
    return this.jobs.enqueue('catalog', (jobSignal) => this.browser.session(jobSignal, async (page) => {
      const result = await page.evaluate(() => window.__mokAutomation.catalog());
      return kind === 'all' ? result : { appVersion: result.appVersion, [kind]: result[kind] };
    }), signal).done;
  }
  async read(path, signal) {
    return this.jobs.enqueue('read_project', async (jobSignal) => {
      const file = await this.projectInput(path);
      return this.browser.session(jobSignal, async (page) => ({ path, revision: file.revision, project: await this.load(page, file) }));
    }, signal).done;
  }
  async write(kind, options, signal) {
    return this.jobs.enqueue(kind, async (jobSignal) => {
      const file = kind === 'create_project' ? null : await this.projectInput(options.path, options.expectedRevision);
      const media = kind === 'import_media' ? await this.workspace.input(options.mediaPath, this.config.mediaBytes) : null;
      const output = await this.workspace.output(options.outputPath ?? options.path, { overwrite: options.overwrite, maxBytes: this.config.projectBytes, extensions: ['.mok'] });
      try {
        return await this.browser.session(jobSignal, async (page) => {
          let result;
          if (file) {
            const project = await this.load(page, file);
            if (kind === 'update_project') {
              const changed = applyChanges(project, options.changes);
              if (JSON.stringify(changed).length > MiB) throw new Error('Project settings exceed the 1 MiB automation response limit.');
              result = await page.evaluate((p) => window.__mokAutomation.update(p), changed);
            } else {
              await this.upload(page, media.path);
              result = await page.evaluate((settings) => window.__mokAutomation.importMedia(settings), { target: options.target, shotId: options.shotId });
            }
          } else result = await page.evaluate((settings) => window.__mokAutomation.create(settings), options);
          const saved = await this.publish(page, output, result.output, jobSignal);
          return { ...saved, revision: saved.sha256, project: result.project, ...(result.media ? { media: result.media } : {}) };
        });
      } finally { await output.cleanup(); }
    }, signal).done;
  }
  render(kind, options) {
    const entry = this.jobs.enqueue(`render_${kind}`, async (signal, progress) => {
      const file = await this.projectInput(options.path, options.expectedRevision);
      const output = await this.workspace.output(options.outputPath, { overwrite: options.overwrite, maxBytes: this.config.outputBytes, extensions: [`.${options.format}`] });
      try {
        return await this.browser.session(signal, async (page) => {
          await this.load(page, file); check(signal);
          const { path, outputPath, overwrite, expectedRevision, ...settings } = options;
          void path; void outputPath; void overwrite; void expectedRevision;
          let polling = false;
          const timer = setInterval(async () => {
            if (polling) return; polling = true;
            try { const info = await page.evaluate(() => window.__mokAutomation.progress()); progress(info.progress * .9, info.phase); } catch {} finally { polling = false; }
          }, 500);
          let metadata;
          try { metadata = await page.evaluate((settings) => window.__mokAutomation.render(settings), { ...settings, kind }); }
          finally { clearInterval(timer); }
          if (metadata.format !== options.format) throw new Error(`The browser selected ${metadata.format.toUpperCase()} fallback. Render again with that format and matching output extension.`);
          progress(.95, 'Writing output');
          const saved = await this.publish(page, output, metadata, signal);
          await page.evaluate(() => window.__mokAutomation.release());
          return { ...saved, format: metadata.format, width: options.width, height: options.height };
        });
      } finally { await output.cleanup(); }
    });
    return this.jobs.snapshot(entry.id);
  }
  async close() { const stopping = this.jobs.close(); await this.browser.close(); await stopping; }
}
