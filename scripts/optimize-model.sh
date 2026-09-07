#!/usr/bin/env bash
# Optimize geometry first, then convert textures with full mip chains.
# Requires Khronos toktx and sharp; see scripts/ktx-models.mjs.
# usage: scripts/optimize-model.sh input.glb public/models/output.glb
set -euo pipefail
in="${1:?input.glb}"; out="${2:?output.glb}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
npx --yes @gltf-transform/cli@4.5.0 optimize "$in" "$tmp/geometry.glb" --compress meshopt --texture-compress png --texture-size 2048 --simplify false --join false --palette false --flatten false
node scripts/ktx-models.mjs "$tmp/geometry.glb" "$out"
ls -la "$out"
