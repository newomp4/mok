#!/usr/bin/env node
// Swap the editor's icons for the real Central Icon System glyphs.
// Requires a Central license (https://iconists.co/central): the npm package's
// preinstall step validates CENTRAL_LICENSE_KEY against centralicons.com.
//
//   CENTRAL_LICENSE_KEY=xxxx node scripts/use-central-icons.mjs
//
// To go back to the built-in glyphs: node scripts/use-central-icons.mjs --revert
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const PKG = "@central-icons-react/round-outlined-radius-2-stroke-1.5";
const revert = process.argv.includes("--revert");
const ws = "pnpm-workspace.yaml";

if (revert) {
  copyFileSync("scripts/templates/icons.legacy-renderer.tsx", "src/components/icons.tsx");
  execSync(`pnpm remove ${PKG}`, { stdio: "inherit" });
  console.log("Reverted to built-in glyphs.");
  process.exit(0);
}
if (!process.env.CENTRAL_LICENSE_KEY) {
  console.error("Set CENTRAL_LICENSE_KEY (the package's install step checks it).");
  process.exit(1);
}
// allow the package's preinstall script so the license check can run
let y = existsSync(ws) ? readFileSync(ws, "utf8") : "";
if (!/allowBuilds:/.test(y)) y += "\nallowBuilds:\n";
if (!y.includes(`'${PKG}'`)) y = y.replace(/allowBuilds:\n/, `allowBuilds:\n  '${PKG}': true\n`);
else y = y.replace(new RegExp(`'${PKG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}':.*`), `'${PKG}': true`);
// the package is republished often; exempt it from pnpm's minimum-release-age policy
if (!/minimumReleaseAgeExclude:/.test(y)) y += "\nminimumReleaseAgeExclude:\n";
if (!y.includes(`- '${PKG}'`)) y = y.replace(/minimumReleaseAgeExclude:\n/, `minimumReleaseAgeExclude:\n  - '${PKG}'\n`);
writeFileSync(ws, y);
if (!existsSync("scripts/templates/icons.legacy-renderer.tsx")) copyFileSync("src/components/icons.tsx", "scripts/templates/icons.legacy-renderer.tsx");
execSync(`pnpm add ${PKG}@1.1.317`, { stdio: "inherit", env: process.env });
copyFileSync("scripts/templates/icons.central.tsx", "src/components/icons.tsx");
console.log("Central icons installed and wired into src/components/icons.tsx");
