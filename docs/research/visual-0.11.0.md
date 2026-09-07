# Visual and download preparation, 0.11.0

Work date: 2026-09-06. These changes use the already credited models and original CC0 texture sources. They do not import UltraMock assets or change model geometry.

## Concrete: original resolution, physical scale and complete fallback

The source is [Concrete Layers 02](https://polyhaven.com/a/concrete_layers_02) by Rob Tuytel, [CC0-1.0](https://polyhaven.com/license). Poly Haven specifies a 2-metre tile. The original 2K diffuse, OpenGL normal and ARM PNGs were downloaded from its public file service and checked against the MD5 hashes in its public file metadata. Exact direct URLs, source SHA-256, conversion parameters and output SHA-256 are recorded in [the asset manifest](assets/concrete-layers-02.json).

`scripts/build-concrete.mjs` converts the original 16-bit PNGs to 8-bit GPU UASTC quality 3 with Zstd 22 and complete mip chains. The generator explicitly uses the GL lower-left origin to match the floor geometry and legacy TextureLoader path. XYZ normals stay linear and are normalized; diffuse uses sRGB; ARM remains linear and is shared between ambient occlusion (R) and roughness (G). Alpha channels unused by these maps are removed. It generates both 2048² and 1024² tiers. This is a high-quality texture conversion, not a claim of pixel-identical PNG compression.

The 2K three-map set downloads 12,379,830 bytes; the 1K set downloads 3,116,034 bytes. With 4×4 GPU blocks and complete mips, the three 2K maps occupy about 16 MiB; the 1K set about 4 MiB. The higher-quality source costs more network bytes than the old JPEGs. The existing renderer quality plan chooses the tier; failed 2K loads try the complete 1K set, then the original JPEG fallback. A complete set is promoted together so normal and color maps cannot come from unrelated partial loads. The active set has a cache lease until its replacement is ready; caches retain at most two tier entries. Models and concrete share one renderer-local KTX transcoder pool with two workers.

The material is recreated when the complete tier becomes ready, so Three enables the new map shader defines; production GPU QA caught and verified this null-map-to-loaded-map lifecycle case.

The tile repeats every 20 world units (2m), replacing the previous arbitrary 3.4-unit repeat. Grazing surfaces use up to the device-supported anisotropy, capped at 16. Concrete also uses the existing receiver-only depth material so VSM does not make it shadow itself.

Rebuild with the existing development asset tools:

```sh
MOK_ASSET_TOOLS=../asset-tools TOKTX=../asset-tools/ktx/bin/toktx node scripts/build-concrete.mjs ../asset-source/concrete_layers_02
```

## Screen-light blocking and softness

`screenOcclusion.ts` rasterizes actual fixed deck, keycap and hinge triangles into an at-most-256² one-byte height field, in the receiver's native coordinate frame. It leaves the GLB geometry and UVs untouched. Upward surfaces contribute; undersides, moving lid descendants, authored hidden children and fully transparent helper materials do not. Mirrored and instanced geometry uses its correct transform. The resulting texture is owned and disposed with the model.

The diffuse screen-light calculation tests six points along the ray to each of the existing nine emitter patches. This produces source-size penumbra variation rather than one hard shadow per whole screen. Linear height sampling and a geometry-scaled quantization bias prevent each key from shadowing its own top. Specular spill tests the central reflected ray. Blocking only reduces irradiance; it never renormalizes a blocked patch into brighter energy. Existing closed-lid energy bounds remain intact.

This is a bounded screen-space-independent height-field approximation, not ray tracing: it does not represent overhangs, per-pixel alpha-cutout holes or arbitrary multilayer geometry, and its six ray samples may miss a very thin distant blocker. It applies to the existing detailed MacBook deck models. The procedural laptop retains its original lighting without a generated field.

Production Chromium/SwiftShader 151 A/B at 1920×1080, identical camera/media and only the blocker uniform changed:

| Pose | Pixels changing by >1 channel code value | Maximum channel change | Draw calls |
| --- | ---: | ---: | ---: |
| MacBook14, lid 110° | 3,176 | 66 | 306 both |
| MacBook14, lid 45° | 3,051 | 78 | 305 both |

The open-lid changes are confined to the key/deck edges (pixel bounds x273–1335, y806–1056), rather than dimming the whole palm rest or screen. The measured height field is 256×184, 47,104 bytes. These are image and resource measurements; SwiftShader wall times under concurrent browser QA are not hardware performance benchmarks.

## Narrow material calibration

The 14-inch MacBook's identified silver enclosure materials `hPcehRUjcLAosED` and `zqeFZcIteZtOShc` use a shared 256² grain normal with 4.13° RMS normal tilt at authored strength. The distinct 16-inch enclosure's 512² source has 2.37° RMS tilt. Applying 0.55 normal gain only to the two 14-inch silver enclosure slots reduces visible pitted grain and grazing sparkle. It does not alter albedo, metalness, roughness textures, normals themselves, keycaps, legends, rubber or the trackpad.

In a 1080p A/B render, high-frequency luminance deviation in an unobstructed palm-rest patch (x1470,y1000,width110,height24) fell from 0.361 to 0.269 8-bit code values (25.5%), while the broad highlight and material color stayed consistent. The change is deliberately subtle. The existing iPhone17Pro anodized profile remains; the 16-inch MacBook receives no blanket normal scaling.

## Model transfer: lossless HTTP transport

Two experiments were rejected: duplicate binary geometry views save only 3,955 bytes across the catalog; increasing the iPhone17Pro embedded KTX Zstd level from 18 to 22 saves only 38,040 bytes (0.22% of its image payload). Neither justified touching the original GLBs or texture fidelity.

Instead, `scripts/build-model-transport.mjs` precomputes Brotli 11 and gzip 9 sidecars. Every variant is verified to decompress byte-for-byte to its original GLB. All ten original files remain untouched and available under `/models/`. The allowlisted Node route `/api/models/[name]?v=<sha256>` streams generated files, negotiates Accept-Encoding quality/exclusions, and sends Content-Encoding, Vary, length, representation-specific ETag and immutable caching only for a matching content hash. It supports HEAD and conditional 304. A missing sidecar redirects to the original; a failed route load also retries the static model URL. No request performs compression or retains a full decoded model buffer on the server.

| Asset | Original bytes | Brotli bytes | Reduction |
| --- | ---: | ---: | ---: |
| MacBook Pro 14 | 1,319,748 | 833,597 | 36.8% |
| Pro Display XDR | 6,090,396 | 4,052,644 | 33.5% |
| iMac 24 | 3,595,864 | 2,827,910 | 21.4% |
| iPhone17Pro | 17,162,852 | 16,941,212 | 1.3% |
| All ten models | 59,847,424 | 53,484,044 | 10.6% |

Gzip totals 53,964,901 bytes (9.8% less). The default 17Pro was already texture-heavy and compressed, so its initial download barely improves; this is not a 37% claim for every device. Shipping both variants increases repository/static deployment size by 107,448,945 bytes. The extra stored bytes trade disk space for faster supported-client downloads with identical visual fidelity. Existing GLBs provide deployment fallback; Next's Node runtime is required for the negotiated route.

Regenerate after changing any shipped model:

```sh
node scripts/build-model-transport.mjs
node --test scripts/test-visual.mjs
```

## Validation

`test-visual.mjs` covers real key-height blocking, open gaps, self-shadow bias, mirrored instances, invisible helpers, bounded shared KTX ownership, exact-source material profiles, all concrete hashes/mips, all 20 sidecars' decoded byte identity, encoding negotiation, HEAD, conditional responses, path/version rejection and static fallback. Together with existing asset and screen-light regressions: 26 tests pass. TypeScript and scoped ESLint pass. Concrete and screen-light GLSL compile and export opaque 1080p PNGs in the production browser without page or shader errors. Native-browser compatibility is covered separately by the main agent.

Final 0.11.0 production verification: automatic concrete promotion renders the complete 2048² set without manual material invalidation. Forcing HTTP 404 on all three 2K texture URLs successfully renders the complete 1024² set; both produce 1920×1080 opaque PNGs with 144 draws. The forced failures are the only expected 404s, with no page or shader errors. The shared transcoder removes the earlier multiple-active-loader warning. The actual Next Brotli route returned 833,597 bytes for MacBook14 with correct representation headers; its decompressed response equals the original GLB exactly.
