# Asset and render preparation — 2026-09-06

## Shipped assets

All 10 existing models and 129 embedded textures were converted from WebP to KTX2/UASTC quality 3 with lossless Zstd 18 supercompression and complete mip chains. XYZ normal maps are normalized without the incompatible R/A packing used by `toktx --normal_mode`. Color textures retain sRGB; normal/roughness/metal/AO data retain linear sampling. No geometry optimization or resizing was applied in this conversion.

The texture-only repacker preserves node, mesh, material, accessor, animation and scene JSON, as well as exact Meshopt compressed geometry payloads. Independent before/after checks verified those invariants. Khronos glTF Validator 2.0.0-dev.3.10 reports **zero errors on all 10 source and converted GLBs**. Reports in `docs/research/assets/` record dimensions, roles, mip levels and SHA-256 checksums.

| Metric, complete catalog | Before | After |
|---|---:|---:|
| GLB download bytes | 22,514,588 | 59,847,424 |
| Estimated texture bytes including mips | 558,608,345 | 139,655,696 |

The memory estimate assumes RGBA8 before and 16-byte 4×4 GPU blocks after (ASTC 4×4 / BC7 class). Real memory depends on the browser's transcoded format and excludes geometry, framebuffer attachments and driver overhead. This is approximately **75% less texture memory**, with a **2.66× larger model download**. High-quality UASTC was chosen to protect the dense normal maps, fine grilles and finish detail; an ETC1S size optimization is not claimed. Actual browser load/upload timing requires the integrated browser benchmarks.

The six original CC0 Poly Haven environments now have 2048×1024 variants alongside the unchanged 1024×512 fallbacks. Sources, authors and licenses are in `CREDITS.md`; URLs and checksums are in `public/hdri/2k/manifest.json`. Spherical, luminance-weighted means differ only +0.05% to +0.30% from the 1K versions, so exposure and light orientation remain unchanged.

## Runtime ownership and preparation

- `environmentAssets.ts` selects the quality plan's HDR tier and falls back to 1K on 2K load failure. A leased two-entry PMREM cache retains the displayed map until its replacement is ready. Source HDR textures and the PMREM generator's temporary targets are disposed after conversion.
- `modelAssets.ts` replaces unbounded global GLTF caching with a renderer-local three-entry cache. Mounted, staged and compiling users own explicit leases. Unreferenced old sources release GPU geometry, materials and textures; CPU image data is not manually closed underneath a concurrent React render. A brief initial-render lease gives Suspense time to commit. Pending/active ownership may temporarily exceed the nominal cache capacity.
- `gpuPreparation.ts` waits for the environment, uploads each unique borrowed texture, then invokes `compileAsync(modelRoot, liveCamera, liveScene)` with final material hooks installed. The normal loading manager covers the preparation period. `waitForGpuPreparation(signal?)` is available to exports.
- Cancelling a device change prevents stale promotion. Three cannot cancel its shader compiler; model/source resources remain leased until every outstanding compile settles. Failed incoming loads or compilation keep the old device displayed and report the failure.
- `materialProfiles.ts` preserves authored normal scales by default. Only the known dense `Anodized_aluminum` material on the 17 Pro retains the earlier 0.65 attenuation. Key legends, rubber, grilles and other materials no longer receive a blanket reduction.

## Shadow and mirror calibration

Directional shadows fit the visible device and its bounded floor projection in light space, update after the device/light animation, and snap coverage to texel increments. Bias and normal offset derive from actual world units per shadow texel; shadow blur compensates for the new coverage to retain the authored world-space softness. Very low-angle floor projection is bounded to four device scene sizes.

Both screen and floor reflections request the quality plan's exact supported MSAA count. Support must be shared by RGBA16F and depth24 attachments. A 2-sample request is never silently rounded to a 4-sample allocation; unsupported counts fall back to zero. Floor blur consumes the resolved color/depth reflection.

The darkroom mirror floor has a receiver-only shadow material. Three's VSM path otherwise treats every shadow receiver as a caster, including an infinite floor whose `castShadow` is false. Production isolation showed that self-casting created broad diagonal bands; preventing only the floor's shadow writes removed them while keeping device shadows and reflections. The custom material is disposed with its reflection buffers.

## Validation

`scripts/test-assets.mjs` covers cache leases and eviction; environment-before-GPU ordering; deduplicated texture uploads; cancellation and export wait aborts; targeted normal profiles; exact MSAA support; shadow coverage and bias; all 129 KTX2 mip payloads; and six HDR originals/fallbacks. TypeScript and targeted ESLint pass. Existing renderer, screen-light, reflection-pass and lid geometry tests also passed against the converted GLBs.

Integrated visual checks still matter: cycle through more than three models, rapidly select A→B→C, compare thin key/grille normals, inspect low-angle shadows and Darkroom mirrors, and export while an incoming model is preparing. This report does not claim measured browser speedups or physical equivalence to UltraMock's assets.

### Integrated model-cache check

On September 6, 2026 (EDT), isolated Chromium 151 with SwiftShader completed two full cycles through iPhone 17 Pro, MacBook Pro 14, iPad Pro 13, Watch Series 9, iMac 24 and MacBook Pro 16. Each step checked the actual visible screen mesh, including its source material name where the model uses a material hint. Both cycle endpoints retained exactly **41 textures, 208 geometries and 37 shader programs**; repeated traversal did not grow those GPU resource counts. Intermediate counts also fell as old sources were evicted.

A five-choice rapid switch sequence included a previously unloaded Watch Ultra and finished on iPhone 17 Pro. The iPhone remained visible after delayed loads and shader preparation settled; the final counts were 27 textures, 24 geometries and 37 programs. There were no browser errors. These are Three resource counters on a software renderer, not measured VRAM bytes or hardware performance claims. Assets still loading or compiling may temporarily remain leased above the nominal three-model cache capacity.

The final integration review also added bounded source-material mask variants, preserving mirrored-face culling and alpha cutouts without taking ownership of their textures. Zero-strength detail shading now skips the extra scene render and releases unused mask variants. GPU timer results are read in submission order so an old completed query cannot overwrite the newest timing in the same polling pass.
