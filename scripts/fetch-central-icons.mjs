#!/usr/bin/env node
// Pull icons from the Central Icon System Figma file with a personal access token
// (figma.com → Settings → Security → Personal access tokens, scope "File content: read").
//
//   FIGMA_TOKEN=figd_xxx node scripts/fetch-central-icons.mjs list            # writes scratch/central-components.json
//   FIGMA_TOKEN=figd_xxx node scripts/fetch-central-icons.mjs export map.json # map: { "my-name": "<figma node id>" }
//
// Exported SVGs land in scratch/central-svg/<my-name>.svg; run scripts/build-icons.mjs afterwards.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const FILE = process.env.FIGMA_FILE ?? "TBfBl4ckkUB9Z0J9RiInWl";
const ROOT = process.env.FIGMA_ROOT ?? "7:118";
const token = process.env.FIGMA_TOKEN;
if (!token) { console.error("Set FIGMA_TOKEN"); process.exit(1); }
const H = { "X-Figma-Token": token };
const api = async (path) => {
  const r = await fetch(`https://api.figma.com/v1${path}`, { headers: H });
  if (r.status === 429) { await new Promise((res) => setTimeout(res, 15000)); return api(path); }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const CONTAINERS = new Set(["FRAME", "SECTION", "GROUP", "CANVAS", "DOCUMENT"]);
mkdirSync("scratch", { recursive: true });

async function list() {
  const out = [];
  const queue = [ROOT];
  let calls = 0;
  while (queue.length) {
    const batch = queue.splice(0, 20);
    const res = await api(`/files/${FILE}/nodes?ids=${encodeURIComponent(batch.join(","))}&depth=2`);
    calls++;
    for (const id of batch) {
      const node = res.nodes[id]?.document;
      if (!node) continue;
      const visit = (n, path) => {
        if (n.type === "COMPONENT_SET") {
          out.push({ id: n.id, name: n.name, type: n.type, path, variants: (n.children ?? []).map((c) => ({ id: c.id, name: c.name })) });
        } else if (n.type === "COMPONENT") {
          out.push({ id: n.id, name: n.name, type: n.type, path });
        } else if (CONTAINERS.has(n.type)) {
          if (n.children) for (const c of n.children) visit(c, `${path}/${n.name}`);
          else queue.push(n.id); // deeper than our depth: fetch later
        }
      };
      if (node.id === id && CONTAINERS.has(node.type) && node.children) for (const c of node.children) visit(c, node.name);
      else visit(node, "");
    }
    process.stderr.write(`\r${out.length} components, ${queue.length} pending, ${calls} calls   `);
  }
  writeFileSync("scratch/central-components.json", JSON.stringify(out, null, 1));
  console.log(`\nwrote scratch/central-components.json (${out.length} entries)`);
}

async function exportSvgs(mapFile) {
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  const entries = Object.entries(map);
  mkdirSync("scratch/central-svg", { recursive: true });
  for (let i = 0; i < entries.length; i += 30) {
    const chunk = entries.slice(i, i + 30);
    const ids = chunk.map(([, id]) => id).join(",");
    const res = await api(`/images/${FILE}?ids=${encodeURIComponent(ids)}&format=svg&svg_include_id=false&svg_simplify_stroke=true`);
    for (const [name, id] of chunk) {
      const url = res.images[id];
      if (!url) { console.warn("no export for", name, id); continue; }
      const svg = await (await fetch(url)).text();
      writeFileSync(`scratch/central-svg/${name}.svg`, svg);
      console.log("✓", name);
    }
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "list") await list();
else if (cmd === "export" && arg) await exportSvgs(arg);
else { console.error("usage: list | export <map.json>"); process.exit(1); }
