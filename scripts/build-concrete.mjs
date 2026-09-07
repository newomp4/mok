// Build only from original CC0 Poly Haven files; keep source hashes and complete mip chains.
// MOK_ASSET_TOOLS=../asset-tools TOKTX=../asset-tools/ktx/bin/toktx node scripts/build-concrete.mjs ../asset-source/concrete_layers_02
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile), source = resolve(process.argv[2] ?? '../asset-source/concrete_layers_02');
const require = createRequire(resolve(process.env.MOK_ASSET_TOOLS ?? '.', 'package.json')), sharp = require('sharp');
const meta = JSON.parse(await readFile(join(source, 'files.json')));
const tmp = await mkdtemp(join(tmpdir(), 'mok-concrete-'));
const report = { source: 'https://polyhaven.com/a/concrete_layers_02', author: 'Rob Tuytel', license: 'CC0-1.0', sourceWidthMeters: 2, maps: [] };
try {
  for (const [name, slot] of [['diff', 'Diffuse'], ['nor_gl', 'nor_gl'], ['arm', 'arm']]) {
    const original = await readFile(join(source, `${name}_2k.png`)), reference = meta[slot]['2k'].png;
    if (createHash('md5').update(original).digest('hex') !== reference.md5) throw new Error(`Source integrity failed: ${name}`);
    const png = join(tmp, `${name}.png`);
    // GPU UASTC encodes 8-bit channels. Never gamma-transform normal/ARM data based on PNG tags.
    await sharp(original, { ignoreIcc: name !== 'diff' }).removeAlpha().png().toFile(png);
    for (const edge of [1024, 2048]) {
      const tier = edge === 1024 ? '1k' : '2k', output = `public/textures/concrete/${tier}/${name}.ktx2`;
      await mkdir(`public/textures/concrete/${tier}`, { recursive: true });
      const args = ['--t2', '--encode', 'uastc', '--uastc_quality', '3', '--zcmp', '22', '--threads', '4', '--genmipmap', '--lower_left_maps_to_s0t0', '--assign_oetf', name === 'diff' ? 'srgb' : 'linear', '--assign_primaries', 'bt709'];
      if (edge !== 2048) args.push('--resize', `${edge}x${edge}`);
      if (name === 'nor_gl') args.push('--normalize');
      await run(process.env.TOKTX ?? 'toktx', [...args, output, png]);
      const bytes = await readFile(output);
      if (bytes.readUInt32LE(20) !== edge || bytes.readUInt32LE(40) !== Math.log2(edge) + 1) throw new Error('Invalid KTX dimensions or mip count');
      report.maps.push({ name, tier, width: edge, levels: Math.log2(edge) + 1, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sourceUrl: reference.url, sourceSha256: createHash('sha256').update(original).digest('hex'), sourceBytes: original.length, encoding: 'KTX2 UASTC quality3, Zstd22; XYZ normals; GL lower-left origin; full mips', output });
      console.log(`${tier}/${name}: ${bytes.length} bytes`);
    }
  }
  await writeFile('docs/research/assets/concrete-layers-02.json', JSON.stringify(report, null, 2) + '\n');
} finally { await rm(tmp, { recursive: true, force: true }); }
