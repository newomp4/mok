#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { AutomationService } from './service.mjs';

const path = z.string().min(1).max(4096).describe('File path relative to MOK_MCP_WORKSPACE, or an absolute path inside it.');
const overwrite = z.boolean().default(false).describe('Explicitly replace an existing output file. Defaults to false.');
const revision = z.string().regex(/^[a-f0-9]{64}$/).optional().describe('Optional revision returned by read/create/update. Rejects an externally changed source file.');
const change = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: z.string().min(2).max(512), value: z.json() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string().min(2).max(512) }).strict(),
]);
const raster = { path, outputPath: path, overwrite, expectedRevision: revision,
  width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192),
  transparent: z.boolean().default(false), transparentShadows: z.boolean().default(true).describe('Keep floor/contact shadows in transparent output; false exports a clean cutout.'),
};

export function createServer(service) {
  const server = new McpServer({ name: 'mok-local', version: '0.11.0' }, { capabilities: { tools: {}, resources: {} } });
  const tool = (name, description, shape, readOnly, callback) => server.registerTool(name, {
    description, inputSchema: z.object(shape).strict(),
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false },
  }, async (args, context) => {
    try {
      const result = await callback(args, context.mcpReq.signal), text = JSON.stringify(result);
      if (text.length > 1024 * 1024) throw new Error('Result settings exceed the 1 MiB automation response limit.');
      return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message ?? String(error) }] }; }
  });
  tool('mok_info', 'Read configuration, workspace limits, and the local automation workflow. Does not start a browser.', {}, true, () => service.info());
  tool('mok_catalog', 'Discover selectable device/finish ids, built-in templates, scenes, and effect parameter definitions from the running local app.', { kind: z.enum(['all', 'devices', 'templates', 'scenes', 'effects']).default('all') }, true, ({ kind }, signal) => service.catalog(kind, signal));
  tool('mok_create_project', 'Create a validated portable .mok project, optionally applying a built-in template and device. Returns the complete settings and shot ids; embeds template media.', {
    path, overwrite, name: z.string().min(1).max(160).optional(), templateId: z.string().max(128).optional(), deviceId: z.string().max(128).optional(), aspect: z.enum(['fill', '16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '3:2', '2:3', '21:9', 'as-iphone', 'as-ipad', 'as-mac', 'as-video-h', 'as-video-v', 'ps-phone', 'ps-tablet-7', 'ps-tablet-10', 'ps-feature']).optional(),
  }, false, (args, signal) => service.write('create_project', args, signal));
  tool('mok_read_project', 'Read and validate a portable .mok file in an isolated browser context. Returns settings and a source revision; embedded binary media is omitted from the response.', { path }, true, ({ path }, signal) => service.read(path, signal));
  tool('mok_update_project', 'Apply data-only JSON Pointer edits to project settings and save a portable .mok file. For example set /camera/x or /shots/0/duration; append a shot with /shots/-. Arrays can be replaced in full. Read the returned normalized project to see clamped/defaulted values. Existing outputs require overwrite=true.', {
    path, outputPath: path.optional(), overwrite, expectedRevision: revision, changes: z.array(change).min(1).max(128),
  }, false, (args, signal) => service.write('update_project', args, signal));
  tool('mok_import_media', 'Import one workspace media file into a project and write an embedded portable .mok. Screen/logo targets require a shot id. Video import follows editor behavior and can adjust clip duration; update timing afterward if needed. Embedded source-video audio remains opt-in via shot.audio.', {
    path, outputPath: path.optional(), overwrite, expectedRevision: revision, mediaPath: path,
    target: z.enum(['screen', 'logo', 'soundtrack', 'background', 'screenBackground']), shotId: z.string().max(128).optional(),
  }, false, (args, signal) => service.write('import_media', args, signal));
  tool('mok_render_image', 'Queue an image export through the actual mok WebGL renderer. Returns a job id immediately; poll mok_job_status. The output is published atomically on success. Use PNG/WebP for transparency.', {
    ...raster, format: z.enum(['png', 'jpg', 'webp']).default('png'), time: z.number().min(0).max(180).default(0), quality: z.number().min(.1).max(1).default(.95),
  }, false, (args) => {
    if (args.transparent && args.format === 'jpg') throw new Error('JPEG does not support transparency. Choose PNG or WebP.');
    return service.render('image', args);
  });
  tool('mok_render_video', 'Queue an MP4 or WebM export through the actual mok renderer/encoder, including enabled source audio and soundtrack. Returns a job id; poll status or cancel explicitly. Motion samples accumulate in linear HDR. Transparent video requires WebM. Output duration is the project endpoint (maximum 180s).', {
    ...raster, format: z.enum(['mp4', 'webm']).default('mp4'), fps: z.number().int().min(1).max(120).default(30),
    quality: z.enum(['low', 'med', 'high', 'ultra']).default('high'), samples: z.number().int().min(1).max(32).default(1),
  }, false, (args) => {
    if (args.transparent && args.format !== 'webm') throw new Error('Transparent video requires format=webm and a .webm output path.');
    return service.render('video', args);
  });
  tool('mok_job_status', 'Read queued/running/succeeded/failed/cancelled status, progress, and the finished output path/hash. Most recent 100 jobs are retained for this stdio session.', { id: z.string().uuid() }, true, ({ id }) => service.jobs.snapshot(id));
  tool('mok_cancel_job', 'Cancel a queued or running render. Wait for cancelled status before assuming cleanup is complete. Successful outputs are never deleted by cancellation.', { id: z.string().uuid() }, false, ({ id }) => service.jobs.cancel(id));
  server.registerResource('automation-config', 'mok://automation/config', { mimeType: 'application/json', description: 'Local workspace and rendering limits.' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(service.info()) }] }));
  return server;
}

async function main() {
  const service = await AutomationService.create();
  const handle = serveStdio(() => createServer(service), { onerror: (error) => console.error(error.message) });
  let closing;
  const close = () => closing ??= (async () => { await service.close(); await handle.close(); })();
  process.stdin.once('end', () => void close());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close().finally(() => process.exit(0)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(`mok-local: ${error.message}`); process.exitCode = 1; });
