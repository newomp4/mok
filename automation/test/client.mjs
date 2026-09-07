import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

export async function connect(env) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], env: { ...process.env, ...env }, stderr: 'pipe' });
  const client = new Client({ name: 'mok-protocol-regression', version: '1.0.0' });
  let diagnostics = '';
  transport.stderr?.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-32_768); });
  await client.connect(transport);
  return { client, transport, diagnostics: () => diagnostics,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args }, { timeoutMs: 180_000 });
      if (result.isError) throw new Error(result.content.map((item) => item.text ?? '').join('\n'));
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    },
    async wait(id) {
      for (let i = 0; i < 1800; i++) {
        const result = await this.call('mok_job_status', { id });
        if (['succeeded', 'failed', 'cancelled'].includes(result.state)) return result;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error('Render regression timed out.');
    },
    close: () => client.close(),
  };
}
