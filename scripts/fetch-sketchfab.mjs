#!/usr/bin/env node
// Download CC-licensed Sketchfab models with your own API token and convert them
// into optimised .glb files under public/models/.
//
//   SKETCHFAB_TOKEN=xxxx node scripts/fetch-sketchfab.mjs <uid>=<name> [<uid>=<name> ...]
//
// Get a token at https://sketchfab.com/settings/password (API token). Only download
// models whose license allows it (CC-BY needs attribution — add it to CREDITS.md).
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const token = process.env.SKETCHFAB_TOKEN;
if (!token) { console.error("Set SKETCHFAB_TOKEN"); process.exit(1); }
const args = process.argv.slice(2);
if (!args.length) { console.error("Usage: <uid>=<name> ..."); process.exit(1); }

function findGltf(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { const r = findGltf(p); if (r) return r; }
    else if (/\.(gltf|glb)$/i.test(f)) return p;
  }
  return null;
}

for (const arg of args) {
  const [uid, name] = arg.split("=");
  const meta = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
  console.log(`\n${name}: ${meta.name} by ${meta.user?.displayName} — ${meta.license?.label} — ${meta.faceCount} faces`);
  const dl = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } })).json();
  const src = dl.gltf ?? dl.glb;
  if (!src?.url) { console.error("  no download available:", JSON.stringify(dl).slice(0, 200)); continue; }
  const work = join(tmpdir(), `sketchfab-${uid}`);
  mkdirSync(work, { recursive: true });
  const zip = join(work, "model.zip");
  writeFileSync(zip, Buffer.from(await (await fetch(src.url)).arrayBuffer()));
  execSync(`unzip -o -q "${zip}" -d "${work}/src"`);
  const gltf = findGltf(join(work, "src"));
  if (!gltf) { console.error("  no gltf in archive"); continue; }
  mkdirSync("public/models", { recursive: true });
  const out = `public/models/${name}.glb`;
  execSync(`npx --yes @gltf-transform/cli@4 optimize "${gltf}" "${out}" --compress meshopt --texture-compress webp --texture-size 2048 --simplify false --join false --palette false --flatten false`, { stdio: "inherit" });
  const credits = `- **${meta.name}** by [${meta.user?.displayName}](${meta.user?.profileUrl}) — ${meta.license?.label} — ${meta.viewerUrl}\n`;
  writeFileSync("CREDITS.md", (existsSync("CREDITS.md") ? readFileSync("CREDITS.md", "utf8") : "# Model credits\n\n") + credits);
  console.log(`  → ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}
