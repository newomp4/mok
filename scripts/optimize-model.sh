#!/usr/bin/env bash
# Optimise a .glb for the web the same way commercial mockup tools do:
# quantised + meshopt-compressed geometry and KTX2 (Basis Universal) textures.
# usage: scripts/optimize-model.sh input.glb public/models/output.glb
set -euo pipefail
in="${1:?input.glb}"; out="${2:?output.glb}"
pnpm dlx @gltf-transform/cli optimize "$in" "$out" --compress meshopt --texture-compress ktx2 --texture-size 2048
ls -la "$out"
