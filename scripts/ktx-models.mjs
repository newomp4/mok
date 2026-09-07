// Texture-only repack: keep every geometry/accessor/animation/node/material byte and assignment.
// Requires Khronos toktx 4.4.2 and sharp 0.34.5 (TOKTX and MOK_ASSET_TOOLS may point to local tools).
// Usage: node scripts/ktx-models.mjs input.glb output.glb
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const run = promisify(execFile);
const require = createRequire(resolve(process.env.MOK_ASSET_TOOLS ?? '.', 'package.json'));
const sharp = require('sharp');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Expected input.glb output.glb');
const source = await readFile(input), jsonSize = source.readUInt32LE(12);
const gltf = JSON.parse(source.subarray(20, 20 + jsonSize));
const binary = source.subarray(28 + jsonSize);
const imageViews = new Set((gltf.images ?? []).map((image) => image.bufferView));
const geometryHash = createHash('sha256');
for (const [i, view] of gltf.bufferViews.entries()) {
  if (view.buffer === 0 && !imageViews.has(i)) geometryHash.update(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  const compressed = view.extensions?.EXT_meshopt_compression;
  if (compressed?.buffer === 0) geometryHash.update(binary.subarray(compressed.byteOffset ?? 0, (compressed.byteOffset ?? 0) + compressed.byteLength));
}
const sourceInvariants = {
  structure: createHash('sha256').update(JSON.stringify(Object.fromEntries(['nodes', 'meshes', 'materials', 'accessors', 'animations', 'scenes', 'scene', 'asset'].map((key) => [key, gltf[key]])))).digest('hex'),
  geometry: geometryHash.digest('hex'),
};
const tmp = await mkdtemp(join(tmpdir(), 'mok-ktx-'));
const imageRoles = new Map();
function mark(value, role = '') {
  if (!value || typeof value !== 'object') return;
  if (typeof value.index === 'number' && /texture$/i.test(role)) {
    const texture = gltf.textures[value.index];
    const image = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    if (image !== undefined) {
      const roles = imageRoles.get(image) ?? new Set();
      roles.add(/baseColor|emissive|sheenColor|specularColor/i.test(role) ? 'srgb' : /normal/i.test(role) ? 'normal' : 'linear');
      imageRoles.set(image, roles);
    }
  }
  for (const [key, child] of Object.entries(value)) mark(child, key);
}
gltf.materials?.forEach((m) => mark(m));
const replacement = new Map(), report = [];
try {
  for (let i = 0; i < (gltf.images?.length ?? 0); i++) {
    const image = gltf.images[i], view = gltf.bufferViews[image.bufferView];
    if (image.mimeType === 'image/ktx2') throw new Error('Refusing a second lossy texture conversion');
    if (view.buffer !== 0) throw new Error('Expected embedded image in GLB buffer 0');
    const roles = imageRoles.get(i) ?? new Set(['linear']);
    if (roles.has('srgb') && roles.size > 1) throw new Error(`Image ${i} mixes color and data roles; split it deliberately first`);
    const data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const png = join(tmp, `${i}.png`), ktx = join(tmp, `${i}.ktx2`);
    // No resizing or color transforms. GLTF defines color slots as sRGB and data maps as linear.
    const info = await sharp(data).png().toFile(png);
    const args = ['--t2', '--encode', 'uastc', '--uastc_quality', '3', '--zcmp', '18', '--threads', '4', '--genmipmap', '--assign_oetf', roles.has('srgb') ? 'srgb' : 'linear', '--assign_primaries', 'bt709'];
    // Keep XYZ channels: --normal_mode packs XY into R/A and would break Three's standard shader.
    if (roles.has('normal') && roles.size === 1) args.push('--normalize');
    await run(process.env.TOKTX ?? 'toktx', [...args, ktx, png], { maxBuffer: 2 ** 20 });
    const encoded = await readFile(ktx);
    const levels = encoded.readUInt32LE(40), expected = 1 + Math.floor(Math.log2(Math.max(info.width, info.height)));
    if (levels !== expected) throw new Error(`Incomplete mip chain ${i}: ${levels}/${expected}`);
    replacement.set(image.bufferView, encoded);
    image.mimeType = 'image/ktx2';
    report.push({ image: i, name: image.name, width: info.width, height: info.height, roles: [...roles], levels, sourceBytes: data.length, ktxBytes: encoded.length,
      rgbaMipBytes: Math.round(info.width * info.height * 4 * 4 / 3), blockMipBytes: mipBytes(info.width, info.height), sha256: createHash('sha256').update(encoded).digest('hex') });
    console.log(`${i + 1}/${gltf.images.length} ${info.width}x${info.height} ${[...roles]}: ${data.length} → ${encoded.length}`);
  }
  for (const texture of gltf.textures ?? []) {
    const image = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    if (image === undefined) throw new Error('Unsupported texture source');
    texture.extensions ??= {};
    delete texture.extensions.EXT_texture_webp;
    delete texture.source;
    texture.extensions.KHR_texture_basisu = { source: image };
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) gltf[key] = [...new Set([...(gltf[key] ?? []).filter((x) => x !== 'EXT_texture_webp'), 'KHR_texture_basisu'])];
  // Rebuild only the embedded buffer. Meshopt fallback buffers are virtual and keep their offsets.
  const parts = [], copied = new Map(); let offset = 0;
  function append(data, key) {
    if (key && copied.has(key)) return copied.get(key);
    const start = offset, pad = (4 - data.length % 4) % 4;
    parts.push(data, Buffer.alloc(pad)); offset += data.length + pad;
    if (key) copied.set(key, start);
    return start;
  }
  for (let i = 0; i < gltf.bufferViews.length; i++) {
    const view = gltf.bufferViews[i];
    if (view.buffer === 0) {
      const start = view.byteOffset ?? 0, length = view.byteLength;
      const data = replacement.get(i) ?? binary.subarray(start, start + length);
      view.byteOffset = append(data, replacement.has(i) ? null : `${start}:${length}`);
      view.byteLength = data.length;
    }
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (meshopt?.buffer === 0) {
      const start = meshopt.byteOffset ?? 0, length = meshopt.byteLength;
      meshopt.byteOffset = append(binary.subarray(start, start + length), `${start}:${length}`);
    }
  }
  gltf.buffers[0].byteLength = offset;
  const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + padded.length + offset, 8); head.writeUInt32LE(padded.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(offset); binHead.writeUInt32LE(0x004e4942, 4);
  const packed = Buffer.concat([head, padded, binHead, ...parts]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, packed);
  await mkdir('docs/research/assets', { recursive: true });
  await writeFile(`docs/research/assets/${basename(output)}.report.json`, `${JSON.stringify({ inputBytes: source.length, outputBytes: packed.length, sourceInvariants, encoder: 'Khronos toktx 4.4.2 UASTC quality 3, Zstd 18, full mips; normalized XYZ normals', textures: report }, null, 2)}\n`);
} finally { await rm(tmp, { recursive: true, force: true }); }

function mipBytes(width, height) {
  let bytes = 0;
  do { bytes += Math.ceil(width / 4) * Math.ceil(height / 4) * 16; if (width === 1 && height === 1) break; width = Math.max(1, width >> 1); height = Math.max(1, height >> 1); } while (true);
  return bytes;
}
