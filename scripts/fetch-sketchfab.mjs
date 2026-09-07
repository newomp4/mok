#!/usr/bin/env node
// Download CC-licensed Sketchfab models with your own API token and convert them
// into optimised .glb files under public/models/.
//
//   SKETCHFAB_TOKEN=xxxx node scripts/fetch-sketchfab.mjs <uid>=<name> [<uid>=<name> ...]
//
// Get a token at https://sketchfab.com/settings/password (API token). Only download
// models whose license allows it (CC-BY needs attribution — add it to CREDITS.md).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
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
  if (!/^[0-9a-f]{32}=[a-z0-9][a-z0-9-]{0,63}$/.test(arg)) throw new Error("Expected a model UUID and lowercase output slug; paths are not accepted.");
  const [uid, name] = arg.split("=");
  const out = `public/models/${name}.glb`;
  if (existsSync(out)) throw new Error(`${out} already exists. Review a new asset under a distinct slug.`);
  const response = await fetch(`https://api.sketchfab.com/v3/models/${uid}`);
  if (!response.ok) throw new Error(`Model metadata request failed (${response.status})`);
  const meta = await response.json();
  // The actual asset ships in public/models. Render-only licenses do not permit that use.
  if (!["by", "cc0"].includes(meta.license?.slug)) throw new Error(`Unsupported redistribution license: ${meta.license?.label ?? "not stated"}`);
  if (!meta.isDownloadable) throw new Error("The author has not enabled downloads for this model.");
  if ((meta.faceCount ?? 0) < 128) throw new Error("This listing may be an advertising card rather than a device model.");
  console.log(`\n${name}: ${meta.name} by ${meta.user?.displayName} — ${meta.license?.label} — ${meta.faceCount} faces`);
  const downloadResponse = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (!downloadResponse.ok) throw new Error(`Model download request failed (${downloadResponse.status})`);
  const dl = await downloadResponse.json();
  const src = dl.gltf ?? dl.glb;
  if (!src?.url) { console.error("  no download available:", JSON.stringify(dl).slice(0, 200)); continue; }
  const work = mkdtempSync(join(tmpdir(), `sketchfab-${uid}-`));
  try {
    const zip = join(work, "model.zip");
    const archiveResponse = await fetch(src.url);
    if (!archiveResponse.ok) throw new Error(`Model archive request failed (${archiveResponse.status})`);
    writeFileSync(zip, Buffer.from(await archiveResponse.arrayBuffer()));
    const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
    if (entries.some((entry) => entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes(".."))) throw new Error("Unsafe archive paths");
    const details = execFileSync("unzip", ["-Z", "-l", zip], { encoding: "utf8" });
    if (/^l[rwx-]{9}\s/m.test(details)) throw new Error("Model archives containing symbolic links are not supported");
    execFileSync("unzip", ["-o", "-q", zip, "-d", `${work}/src`]);
    const gltf = findGltf(join(work, "src"));
    if (!gltf) { console.error("  no gltf in archive"); continue; }
    mkdirSync("public/models", { recursive: true });
    execFileSync("bash", ["scripts/optimize-model.sh", gltf, out], { stdio: "inherit" });
    mkdirSync("docs/research/assets", { recursive: true });
    writeFileSync(`docs/research/assets/${name}.glb.source.json`, JSON.stringify({ name: meta.name, author: meta.user?.displayName, source: meta.viewerUrl, license: meta.license, acquired: new Date().toISOString(), uid, sourceFaces: meta.faceCount }, null, 2) + "\n");
    const credits = `- **${meta.name}** by [${meta.user?.displayName}](${meta.user?.profileUrl}) — ${meta.license?.label} — ${meta.viewerUrl}\n`;
    writeFileSync("CREDITS.md", (existsSync("CREDITS.md") ? readFileSync("CREDITS.md", "utf8") : "# Model credits\n\n") + credits);
    console.log(`  → ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
