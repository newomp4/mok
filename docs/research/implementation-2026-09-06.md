# Renderer and workflow implementation — Mok 0.10.0

Implemented against the research baseline `07cf67f`, following the [improvement plan](mok-improvement-plan.md). This is the engineering implementation of the plan, with original licensed assets. It does not claim access to UltraMock's private renderer, paid device files or backend.

## Delivered work

| Plan | Implementation |
|---|---|
| Q01: reproducible checks | `render-regression.mjs` captures controlled device, gradient, transparency, detail-shadow and high-resolution fixtures. Renderer metrics include full-frame calls/resources, CPU duration and optional nonblocking GPU timers. Separate real-browser media/export suites verify encoded output. |
| Q02: lighting | Six independently obtained CC0 Poly Haven 2K HDR originals, unchanged 1K fallbacks, bounded PMREM ownership. Spherical mean luminance differs only +0.05–0.30%, so exposure was preserved. |
| Q03: gradients and alpha | One final color-conversion/dither pass, independent of artistic grain. Linear lighting is unpremultiplied before nonlinear tone mapping and premultiplied again for browser output, preserving partially transparent color. |
| Q04: motion blur | One half-float linear HDR accumulation target; only deliberate timeline samples add exposure. Tone mapping and final output follow integration. Extra React renders cannot add unintended samples. |
| Q05: shadows/reflections | Directional shadow coverage and bias follow actual device bounds and texel size. Screen and floor mirrors use exact, supported half-float/depth MSAA counts. The infinite mirror floor receives device shadows without casting VSM shadows onto itself, eliminating the striped darkroom floor. |
| Q06: local detail shading | Optional **Detail shadows** control, off by default. A bounded receiver mask shades opaque lit geometry while preserving screens, cards, transparency, mirrored faces and alpha cutouts. This is local screen-space shading, not general indirect lighting. |
| Q07: large screen raster | Memory-permitting exports above 4K can use an 8192-pixel edge and 24-megapixel screen canvas; regular exports retain 4096/12MP bounds. No temporal-AA dependency or history ghosting was introduced. |
| R01: allocation planning | A conservative budget accounts for the composer, actual supported MSAA, depth/effects, temporal sum, screen raster, mirrors, shadows, HDR scratch and retained assets. It reduces auxiliary quality or rejects the combination before allocation. Requested file dimensions never silently change. Busy preview rendering can adapt resolution and idle frames restore the preference. |
| R02: prepared model swaps | Texture uploads and asynchronous shader compilation use the actual camera, materials and environment before promotion. Export waits on the same readiness gate. Superseded swaps retain resources until compilation finishes and cannot promote stale models. |
| R03: source-frame precision | Mediabunny selects decoded samples by timestamps, including high-frame-rate and variable-frame-rate inputs, and respects rotation metadata. Unsupported inputs use an explicit, visible DOM-video fallback. |
| R04: bounded ownership/output | Three-entry model and two-entry PMREM caches with active leases; OPFS-backed, seek-positioned video output up to 4GiB and available quota. A paged 128MiB fallback supports browsers without temporary file storage. Failure, cancellation and completed downloads clean up. |
| A01: device textures | All 10 detailed GLBs, 129 textures converted to UASTC KTX2 with complete mip chains; geometry streams and scene/material semantics preserved. Authored normal strengths are retained except the documented dense aluminum profile. |
| A02: source audio | Opt-in per-shot video audio with volume and independent audio fades, trim, loops and speed, alongside the independent soundtrack. Preview and PCM export share timing/headroom rules. Speed changes pitch. AAC priming is measured for the actual encoder, corrected with MP4 edit metadata; padded audio tails are trimmed. |
| P01: screen padding | Project default and per-shot override; common fit/crop/padding mapping for the renderer and Auto-motion. |
| P02: per-shot effects | Shot stacks inherit project defaults until edited; first edit snapshots the stack; **Use project effects** restores inheritance. Duplication, splitting, undo and portable project validation retain the intended scope. |
| P03: paste/capture preferences | Atomic replace/add paste routing with a remembered choice, a chooser when needed, and a preference to disable the quick-capture shortcut. Labels and shortcut help follow the preference. |
| P04: focused tours | Interactive Timeline and Auto-motion practice experiences use disposable local state. Exiting restores the untouched project/history because the tours never replace them. |

## Material tradeoffs

The full model catalog grows from **22,514,588 to 59,847,424 download bytes**. Estimated mipmapped texture memory falls from **558,608,345 to 139,655,696 bytes**, approximately 75%, assuming the tested 16-byte 4×4 GPU compression class. This favors texture detail and GPU memory over first-download size. Driver format, browser and hardware affect actual residency. The 2K HDR sources add about 37MB of optional assets across the six environments.

Memory budgets are estimates, not a claim to measure free VRAM. Large dimensions plus expensive effects can be refused on constrained devices. UI and export errors explain the limit; no quality setting can recover detail absent from the source image or model.

The export loop now keeps the memoized Canvas's declared frameloop and DPR consistent with capture, and an active exposure owns a fixed-size accumulation target. Merely setting the renderer imperatively was insufficient: later React commits could restart automatic rendering and contribute duplicate motion exposures. Explicit per-sample arming adds a second guard and leaves incomplete captures detectable. The depth-of-field adapter also avoids a wrapper override that replaced transparent coverage with circle-of-confusion values, and keeps floating-point blur intermediates linear. Negative sharpening undershoot is clamped to nonnegative light before tone mapping, preventing tiny-alpha amplification of invalid radiance.

## Validation and reproducibility

The release passes **145 Node regression tests**, TypeScript, ESLint and the production webpack build. Numerical GPU checks pass for linear averaging, partial coverage, HDR highlights, negative sharpening undershoot and unsolicited render protection. Ten converted models pass the Khronos glTF validator with zero errors.

Nine production render fixtures cover open/closed MacBook lids, metal phone materials, iPad lens blur, transparent cards, all 12 artistic effects, detail shadows and a 6000×1800 export. That large export used a measured **5985×4009** screen raster during capture. The final floor/output changes receive additional targeted captures. Browser checks report no application errors.

The encoded-output check renders eight frames across two clips and a gap, with four motion samples per frame, depth blur on one clip, independent shot settings and mixed source audio. MP4 and WebM both report **0.650 seconds**; decoded transparent PNG/WebM contain both zero and full alpha. The MP4 remains opaque. Cancellation restores the editor and permits the next still capture; temporary output files return to zero.

Native decoding confirms all 33 WebM audio packets are valid. FFmpeg 8 emits an Opus-parser diagnostic only while flushing its empty end-of-file buffer; disabling that parser yields the same 33 decoded frames without the diagnostic. This was isolated independently from the app's encoded packets.

Two complete cycles through six detailed devices settle at the same **41 textures, 208 geometries and 37 programs**. A rapid five-choice sequence keeps the final requested device after delayed loads finish. Actual UI checks cover per-shot effects and inheritance, padding, paste routing and persistence, keyboard Auto-motion, both interactive tours, source-audio controls and undo.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`. With a production server and Playwright installed, run:

```sh
MOK_QA_URL=http://localhost:3000 node scripts/test-render-gpu.mjs
MOK_QA_URL=http://localhost:3000 MOK_QA_EXTENDED=1 node scripts/render-regression.mjs /tmp/mok-renders
node scripts/test-media-browser.mjs
MOK_QA_URL=http://localhost:3000 node scripts/export-regression.mjs /tmp/mok-exports
```

`MOK_QA_NODE_MODULES` may point to an existing Playwright installation. Media fixtures also require `ffmpeg`. The browser scripts use the local editor's debug API and synthetic test media. They never upload user media to a service.

Numerical GPU checks distinguish linear light from display-space averaging: opaque black/white averages to linear 0.5 and approximately 188/255 sRGB, not 128/255. A half-coverage gray retains that same straight color at alpha 0.5, and HDR radiance above 1 survives accumulation. Deliberate unsolicited renders between sample advances must not alter the sum.

Media checks decode numbered CFR120 and VFR clips, rotated video, trimmed/looped/sped audio and multichannel dialogue. AAC and Opus checks compare decoded PCM alignment and the final duration. Node tests cover resource leases, timeout/abort behavior, paged seek writes, editing/normalization and render-state restoration after failures.

Older baseline draw-call counters covered the entire capture; new counters cover a complete last frame, including auxiliary passes. Those scopes are labeled and must not be used to claim a draw-call speedup. Shared software-GPU runs are visual/correctness checks, not representative native-GPU performance benchmarks.

## Remaining asset dependencies and limits

Seven detailed catalog entries still need suitable original files and verification: base iPhone17, Galaxy S26 Ultra, Pixel10 Pro, Watch Ultra3, modern iPad Air, MacBook Neo and MacBook Air13. Existing earlier-generation/procedural devices retain their accurate names. See [the source and license investigation](missing-hardware-assets.md) for candidates and exact obstacles. An official, license-checked intake/conversion workflow is implemented; unavailable original meshes are not fabricated or relabeled.

No account/subscription backend, paid-asset mirroring, path tracer, general global illumination, or guaranteed pixel match to UltraMock is claimed. Screen-on-keyboard lighting and rough image reflection remain implemented and follow display content, lid angle and brightness. The new local detail pass does not simulate multiple light bounces or arbitrary occlusion of that light.

Browser validation cannot exhaust every GPU, codec or mobile device. In particular, native Apple/integrated-GPU performance and a broad Safari/Firefox encoding matrix require additional machines. The independent fallback paths and allocation limits remain necessary even when the designated Chromium fixtures pass.
