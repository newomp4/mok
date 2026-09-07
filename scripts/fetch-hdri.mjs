// Original CC0 lighting assets, downloaded directly from Poly Haven. See CREDITS.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const names = ['brown_photostudio_04', 'studio_small_09', 'neon_photostudio', 'blue_photo_studio', 'photo_studio_01', 'studio_small_03'];
const manifest = [];
await mkdir('public/hdri/2k', { recursive: true });
for (const name of names) {
  const url = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${name}_2k.hdr`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.subarray(0, 1000).toString().includes('-Y 1024 +X 2048')) throw new Error(`Unexpected HDR dimensions: ${name}`);
  await writeFile(`public/hdri/2k/${name}.hdr`, data);
  manifest.push({ name, url, license: 'CC0-1.0', width: 2048, height: 1024, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  console.log(`${name}: ${data.length} bytes`);
}
await writeFile('public/hdri/2k/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
