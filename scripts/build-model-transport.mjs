// Lossless HTTP transport only. No texture, scene, animation or geometry bytes are re-encoded.
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { brotliCompress, gzip, constants } from 'node:zlib';
const br = promisify(brotliCompress), gz = promisify(gzip);
const output = 'public/model-transport'; await mkdir(output, { recursive: true });
const manifest = {};
for (const name of (await readdir('public/models')).filter((n) => n.endsWith('.glb')).sort()) {
  const source = await readFile(`public/models/${name}`), hash = createHash('sha256').update(source).digest('hex');
  const brotli = await br(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }), gzip = await gz(source, { level: 9 });
  const prefix = `${name}.${hash.slice(0, 16)}`;
  await writeFile(`${output}/${prefix}.br`, brotli); await writeFile(`${output}/${prefix}.gz`, gzip);
  manifest[name] = { hash, bytes: source.length, br: { file: `${prefix}.br`, bytes: brotli.length }, gzip: { file: `${prefix}.gz`, bytes: gzip.length } };
  console.log(`${name}: ${source.length} → br ${brotli.length}, gzip ${gzip.length}`);
}
// Remove only generated sidecars no longer referred to by the freshly generated manifest.
const keep = new Set(Object.values(manifest).flatMap((m) => [m.br.file, m.gzip.file]));
for (const file of await readdir(output)) if (/\.glb\.[0-9a-f]{16}\.(br|gz)$/.test(file) && !keep.has(file)) await rm(`${output}/${file}`);
await writeFile('src/lib/modelTransportManifest.json', JSON.stringify(manifest, null, 2) + '\n');
