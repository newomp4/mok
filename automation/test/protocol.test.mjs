import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from './client.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

test('official MCP client initializes stdio, discovers schemas/resources, gets typed results/errors and polls failed jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mok-mcp-protocol-'));
  const api = await connect({ MOK_MCP_WORKSPACE: root, MOK_MCP_APP_URL: 'http://127.0.0.1:1' });
  try {
    const { tools } = await api.client.listTools();
    assert.equal(tools.length, 10); assert.ok(tools.some((t) => t.name === 'mok_render_video' && t.inputSchema.properties.transparentShadows));
    const info = await api.call('mok_info'); assert.equal(info.transport, 'stdio'); assert.equal(info.workspace, await realpath(root));
    const { resources } = await api.client.listResources(); assert.equal(resources[0].uri, 'mok://automation/config');
    const resource = await api.client.readResource({ uri: resources[0].uri }); assert.equal(JSON.parse(resource.contents[0].text).serverVersion, '0.11.0');
    await assert.rejects(api.call('mok_render_video', { path: 'a.mok', outputPath: 'a.mp4', width: 320, height: 180, transparent: true }), /requires/);
    await writeFile(join(root, 'a.mok'), '{}');
    const job = await api.call('mok_render_image', { path: 'a.mok', outputPath: '../escape.png', width: 320, height: 180 });
    const result = await api.wait(job.id); assert.equal(result.state, 'failed'); assert.match(result.error, /traversal/);
    assert.deepEqual(await readdir(root), ['a.mok']);
    const unknown = await api.client.callTool({ name: 'mok_job_status', arguments: { id: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(unknown.isError, true);
    assert.equal(api.diagnostics(), '', 'SDK stdio should contain no unrelated logging');
  } finally { await api.close(); await rm(root, { recursive: true, force: true }); }
});

test('stdio also accepts the established 2025-11-25 initialize/tools protocol used by existing clients', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mok-mcp-legacy-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], { env: { ...process.env, MOK_MCP_WORKSPACE: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  const reader = createInterface({ input: child.stdout }), pending = new Map(); let id = 0, diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  reader.on('line', (line) => { const result = JSON.parse(line); pending.get(result.id)?.(result); });
  const request = (method, params) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => reject(new Error('Legacy protocol timeout')), 5000);
    pending.set(key, (result) => { clearTimeout(timer); pending.delete(key); if (result.error) reject(new Error(JSON.stringify(result.error))); else resolve(result.result); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: key, method, params })}\n`);
  });
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-regression', version: '1' } });
    assert.equal(initialized.protocolVersion, '2025-11-25');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    assert.equal((await request('tools/list', {})).tools.length, 10);
    const info = await request('tools/call', { name: 'mok_info', arguments: {} });
    assert.equal(info.structuredContent.transport, 'stdio'); assert.equal(diagnostics, '');
  } finally { child.stdin.end(); await new Promise((resolve) => child.once('close', resolve)); reader.close(); await rm(root, { recursive: true, force: true }); }
});
