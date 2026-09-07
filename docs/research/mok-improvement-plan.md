# mok improvement backlog after UltraMock research

September 6, 2026. Implementation plan based on **mok c316d05**. This document preserves the original proposal. The subsequent implementation of Q01–Q07, R01–R04, A01–A02 and P01–P04 is recorded in [the implementation report](implementation-2026-09-06.md); detailed hardware additions still depend on suitable original licensed assets.

Inputs: the companion [renderer audit](mok-rendering-audit.md), [technical dossier](ultramock-technical-dossier.md), [asset metadata](ultramock-asset-metadata.json), and the [mok c316d05 source snapshot](https://github.com/newomp4/mok/tree/c316d05c3c5fc1aa3abbc307ccb41775af1adf5f). Source paths are relative to that repository.

The aim is measurable visual quality, stable exports and responsive editing. Matching library names or adding effects without controlled comparisons is not the goal. UltraMock's public 2K HDR and KTX2/UASTC metadata provide actionable evidence; its undisclosed kernels, lighting calibration, paid assets and complete export pipeline do not.

## Already shipped — preserve these

- Three PBR/glTF, HDR/PMREM lighting and per-material environment gain; live sRGB screen content and screen-bound RGB pixel grid.
- Phone/tablet orientation, upright screen rasterization, measured native bounds and compatible tablet keyboard-case behavior.
- Display and floor planar reflections, VSM scene shadows, contact shadows, isolated offscreen render state and resource disposal.
- Live laptop screen-on-keyboard/deck light and rough image reflection, normal/height/back-side restrictions, filtered source edges and energy-bounded near-closed diffuse light.
- Corrected imported laptop hinge rest orientation and closing position.
- Half-float postprocessing, four-sample MSAA or SMAA for depth blur, effect isolation, and autofocus distance matching the installed CoC shader.
- Scoped media/font preload, shot-boundary settling, exact timeline/sample stepping, alpha image/WebM options, encoder startup fallback, cancellation and editor restoration.
- A separate soundtrack lane with volume, trim, fades and start offset.

Existing test/docs record production checks and 100 tests. That is a useful baseline, not proof that all GPU/browser/source-codec combinations work. The sections below describe the original acceptance criteria and evidence at the research baseline; consult the implementation report for current status and validation limits.

## Priority and effort conventions

P0 means establish a reliable baseline or correct a demonstrably inaccurate claim. P1 means the strongest near-term quality/reliability payoff. P2 means valuable work with a larger integration or asset dependency. P3 means optional/experimental work that needs a demonstrated benefit first.

Effort is relative engineering scope, not a delivery commitment: **S** is a contained change plus focused checks; **M** crosses two or more subsystems or needs a browser matrix; **L** changes pipeline/resource semantics or needs substantial asset authoring. Asset procurement and outside licensing are separate, unknown costs.

## First implementation tranche

| ID | Priority | Proposed work | Why now | Effort |
| --- | --- | --- | --- | --- |
| Q01 | P0 | Reference fixtures and render/export measurements | Makes subsequent quality claims falsifiable | M |
| D01 | Complete | Correct the source-video-audio claim | One verified documentation error, now fixed | S |
| Q02 | P1 | Licensed 2K HDR tier and exposure/material calibration | Verified 1K local versus 2K public reference source | S–M |
| Q03 | P1 | Subtle final-output dithering | Small change targeting smooth-gradient banding | S |
| R01 | P1 | Full renderer/export memory budget and explicit quality fallback | Current 4K/8K combinations can request very large GPU and RAM allocations | M |
| A01 | P1 pilot, then P2 | KTX2 texture conversion and asset material profiles | Largest repeatable quality inconsistency is the asset pipeline | M pilot; L catalog |
| R02 | P1 | GPU-ready model promotion | Staging currently lacks explicit async shader compilation | M |

### Q01 — comparison and performance fixtures

**Evidence / source:** CPU suites live in `scripts/test-*.mjs`; the latest browser verification is recorded in `docs/renderer-screen-lighting.md`. No automated image-diff suite, GPU timer query, renderer-memory report or repeatable export benchmark exists. `src/components/editor/ViewportPane.tsx:124` only reduces DPR during interaction.

**Implementation:** Add a small deterministic fixture project set and browser capture runner. Fix camera/FOV, apparent device size, finish, light rotation/intensity, source media, time, dimensions and export settings. Include black/white/gray ramps, saturated patches, split-color artwork, tiny screen text, numbered-frame videos, transparent edges, closed/open lids and the heaviest current model. Record render duration, exported dimensions/frame count/timestamps, sampled alpha, draw calls, texture counts and target allocation estimates. GPU timer queries are optional capability-dependent diagnostics, never a prerequisite for rendering.

**Acceptance:** Baseline outputs are reproducible on the designated browser/GPU; every quality change includes equal-size before/after crops and a performance/memory delta. Encoded exports get decoded frame inspection, not only file-exists checks. A slow or unsupported capability produces useful diagnostics without breaking the editor.

**Dependencies / tradeoff:** Choose a small representative suite first; rendering every combination would slow iteration. Golden-image tolerances must allow browser/driver variation. Public UltraMock imagery can guide composition comparisons without importing its assets or shaders into mok.

### D01 — documentation accuracy

The false source-video-audio claim in the earlier comparison has been corrected to one separate music/voiceover track. The exact historical location and replacement are recorded at the end. No audio implementation changed.

### Q02 — 2K HDR tier, with controlled calibration

**Evidence / source:** `src/lib/presets.ts:192`, `src/three/Scene.tsx:143`; every local HDR is 1024×512. Installed Three PMREM uses width/4, producing 256-pixel faces. The inspected [UltraMock HDR header](https://www.ultramock.io/hdri/brown_photostudio_04_2k.hdr) is 2048×1024. A 512-face UltraMock PMREM is an inference, not a measured runtime target.

**Implementation:** Obtain the same licensed source family independently from [Poly Haven](https://polyhaven.com/a/brown_photostudio_04), add 2K source variants, select a bounded quality tier, and preserve the current 1K path for constrained GPUs. Keep luminance and orientation consistent while comparing. Recheck glossy metal, glass clearcoat and grazing screen reflection before changing exposure or roughness. Consider retaining/reusing a small number of active PMREM outputs only if measured switching cost justifies their memory.

**Acceptance:** On matched glossy crops, 2K preserves smaller light-source contours without a global brightness shift. Low-memory tier remains functional. Model/light switches and still/video exports use the same chosen tier and restore preview quality afterward. Source and PMREM targets are disposed or deliberately cached with a bounded lifetime.

**Cost / tradeoff:** A 2K HDR and 512-face PMREM use roughly four times the source/output texture storage of the current 1K setup; output alone rises from about 6 to 24 MiB. A 4K HDR would be a sixteenfold increase and is not part of the first default change. No license fee is expected for the identified CC0 source assets, but source attribution/provenance should remain documented.

### Q03 — final-output dithering

**Evidence / source:** `src/three/effects/PostFX.tsx:194`; no pass sets dithering. The installed postprocessing final shader supports it and defaults it off. The optional artistic Noise effect is not equivalent to mandatory subtle output quantization dither.

**Implementation:** Enable a stable, approximately half-8-bit-step dither on the last output pass after color conversion. It must follow changes in effect ordering without being applied repeatedly to intermediate buffers. Keep it independent of the user's Grain setting.

**Acceptance:** Neutral and dark ramps show fewer quantization bands at 8-bit output; the mean color stays effectively unchanged; alpha-zero pixels remain alpha zero; export motion-blur samples do not accidentally average away or multiply the noise. Compare PNG and compressed video.

**Dependencies / tradeoff:** Q01 ramp fixtures. Slight extra noise can affect compression; keep it at output precision rather than film-grain amplitude. This improves quantization, not low-resolution textures or incorrect lighting.

### R01 — renderer and export memory budget

**Evidence / source:** `src/three/effects/PostFX.tsx:194`, `src/three/renderQuality.ts:9`, `src/export/capture.ts:148,304,349`. Composer input/output both carry RGBA16F MSAA targets. Two 4K four-sample color targets plus resolves estimate about 664 MB before depth/effects/assets; 8K is about 2.65 GB. Video muxing uses BufferTarget; configured 4K60 Ultra for 180 seconds estimates about 2.46 GB of encoded data. Current side-length and duration limits do not bound these products.

**Implementation:** Make an export plan that estimates active composer, MSAA, depth, mirror, shadow, screen, effect and mux allocations. Negotiate AA/resolution/effect-buffer tiers using tested conservative budgets and known GPU capabilities. The user should see a concrete quality adjustment or unsupported combination before long rendering begins. Keep dimensions correct; never silently return a smaller file than requested. Retain actual codec startup probing.

**Acceptance:** Tests cover tall/narrow/8K frames, the heavy iPad model, depth versus MSAA modes, complete effects, and maximum-duration high-bitrate output. Planned allocations stay under the selected bound; unsupported combinations fail early with an actionable message. Cancel and allocation failure release targets and restore normal preview.

**Dependencies / tradeoff:** Q01 measurements; coordinate with R04 streaming. There is no portable browser API exposing reliable free VRAM, so estimates must be conservative and described as such. Reducing MSAA can trade edge smoothness for stability; selective AA/supersampling must be compared, not assumed better.

### A01 — texture compression pilot and material profiles

**Evidence / source:** `src/three/devices/GlbModel.tsx:26,650`, `src/three/surfaceDetail.ts`, `scripts/optimize-model.sh`, `CREDITS.md`. All ten local GLBs use Meshopt+WebP; the runtime already configures KTX2Loader. Public UltraMock free model metadata requires KTX2/Basis; its inspected concrete maps use UASTC+Zstd and complete mip chains. Local map coverage differs sharply: iPhone 17 Pro Max has no normal/metal-rough/AO maps; other models have many. All authored normal strengths are currently multiplied by 0.65.

**Implementation:** Pilot one texture-heavy device and one weak-detail device. Convert existing licensed textures to KTX2 with full mips and preserve colorspace/normal convention. Use high-quality encoding for normals and sensitive details; decide ETC1S versus UASTC per asset after comparison, not by copying guessed reference encoder settings. Add per-model/material profiles for body metal, coating, keys, rubber, glass and lenses. Improve or replace missing geometry/maps only when the controlled crop shows a deficit.

**Acceptance:** glTF validates; all material slots, UVs, aspect, hinge/screen detection and finish options remain intact. Small text, logos, gradients and normal seams do not regress. GPU-resident texture estimates and measured loading/interaction costs improve on Apple and integrated GPUs. Existing licenses/credits and exact source provenance are retained.

**Dependencies / tradeoff:** Q01/Q02 calibration; Basis encoder/tooling; rights to redistribute modified source assets. Compression alone does not create missing detail. Detailed model authoring may dominate both effort and appearance; avoid globally raising gloss or normal amplitude to compensate. Do not use UltraMock's protected or publicly delivered device assets as replacements without separate authorization and distribution rights.

### R02 — promote a device only after GPU preparation

**Evidence / source:** `src/three/devices/GlbModel.tsx:709` marks CPU preparation complete and calls onReady. `GlbDevice` holds the previous model while loading/staging, but no `compileAsync` call exists in local renderer/export code. UltraMock's public renderer actively uses async shader compilation while preparing models.

**Implementation:** Add cancellable generation-scoped GPU compilation for the prepared, correctly lit/material-configured incoming model before promotion. Include screen shader hooks, finish variants, current scene lights and transparency/blur requirements. Keep export readiness and the visible loading state connected to this preparation. Use Three's supported async compilation path when available and a safe fallback otherwise.

**Acceptance:** First transition to a texture-heavy/complex model does not introduce a large shader-compilation hitch after the loading indicator disappears. Rapid A→B→C changes never promote stale B. Failure/cancel leaves the old model and editor usable. Export cannot capture an unprepared incoming view.

**Dependencies / tradeoff:** GPU compilation does not necessarily upload every texture or allocate every effect target; measure what the readiness gate actually covers. Compiling hidden geometry must use the correct camera/lights without exposing it in the live scene. More variants increase preparation time/cache size.

## Second tranche: accuracy and sustained work

### Q04 — linear-light motion blur (P2, L)

**Evidence / source:** `src/export/capture.ts:394–406` averages already tone-mapped sRGB canvas samples with Canvas2D. Alpha arithmetic is fixed, but display-space averaging differs from light integration: black/white gives 0.5 sRGB versus approximately 0.7354 for linear averaging then encoding.

**Implementation:** Accumulate premultiplied linear/HDR color on the GPU, then tone map and encode once per output frame. Keep time-driven grain stable, preserve alpha, and define which user effects occur before or after accumulation. Avoid CPU readback for every sample where possible.

**Acceptance:** Numeric black/white sweep, bright specular trails, colored transparent silhouettes, bloom, fades, complete effect stacks and single-sample equivalence pass. No new colorspace conversion is applied twice. Output timestamps/duration remain unchanged.

**Dependency / tradeoff:** R01 memory budget and Q01 color fixtures first. This changes visual output intentionally and requires migration/expectation notes if existing templates relied on the darker blur. Extra accumulation targets cost memory; a one-line gamma adjustment cannot recover already tone-mapped HDR highlights.

### R03 — timestamp-driven video decoding for export (P2, M–L)

**Evidence / source:** `src/export/capture.ts:70–103` relies on HTMLVideoElement seeking plus a frame-reuse window floored at 1/60 second, with no decoded-frame PTS inspection. Distinct 120fps/VFR source frames can fall inside that window. Previous 24fps exports are not thereby invalidated.

**Implementation:** Use the installed Mediabunny's timestamp-based [VideoSampleSink](https://mediabunny.dev/api/VideoSampleSink) for export, with bounded decoded-frame reuse and explicit closing. Keep browser-video playback for ordinary preview if useful. Preserve source rotation metadata and color handling.

**Acceptance:** Numbered 24/30/60/120fps and VFR fixtures match expected frame identities at cuts, trim/speed/loop boundaries and motion-blur sample times. Test portrait phone rotation metadata, long GOPs, cancellation and source decode errors. Verify audio sync if A02 is later implemented.

**Tradeoff:** New decoder/cache lifecycle and codec support variation. Sequential decoding should be measured against repeated seeks; do not promise all imported container/codec combinations. Existing DOM-seek path can remain a documented fallback.

### R04 — streamed muxing and bounded source caches (P2, M–L)

**Evidence / source:** `src/export/capture.ts:304–308` creates BufferTarget and in-memory MP4 fastStart; `src/lib/audio.ts:89` allocates the entire stereo audio mix. Shared GLTF and uploaded-media caches have no general GPU-residency budget.

**Implementation:** Use a seek-capable file or OPFS stream for large mux outputs, honoring chunk positions and backpressure; use a conservative Blob fallback where unavailable. Release file handles and partial output on cancellation. Add explicit bounded decoded-frame and asset-cache policy only after ownership/refcounts are defined for active, staged, undo and exporting scenes.

**Acceptance:** A long high-bitrate fixture does not keep the whole encoded file in JS RAM. Disk/quota/write errors are recoverable. Cancellation does not leak handles/targets or remove original user files. Switching repeatedly through the catalog produces stable bounded residency under the selected cache policy.

**Tradeoff:** Browser file/OPFS capabilities differ; cache eviction can make later switches slower. Shared GLTF geometry/textures cannot be disposed while active clones still use them. StreamTarget is already available in Mediabunny; blindly concatenating its seek-positioned chunks would corrupt files.

### Q05 — shadow bias and reflection AA calibration (P2, M)

**Evidence / source:** `src/three/scenes/EnvScene.tsx:269–306` and `Scene.tsx:342` use a fixed 0.02-unit normal bias, roughly 2 mm. Shadow camera spans derive from overall device size. `src/three/ScreenReflection.tsx:37` uses non-multisampled half-float targets with no mips at reduced resolution; main-view MSAA cannot restore aliased mirror detail.

**Implementation:** Derive shadow bias from world units per texel with bounded per-device overrides; fit the frustum to relevant geometry. Separately compare two-sample mirror AA or a filtered reflection pyramid with the current target. Preserve low-angle floors and valid shadow bounds.

**Acceptance:** Watch crown, thin stand, laptop keys/hinge, small phone bevels and floor contact remain attached without acne, bright leaks or clipping. Slow grazing camera motion has less mirror shimmer. Equal-size output shows a worthwhile improvement within R01 budgets.

**Tradeoff:** Not a proven current defect in every device; a globally smaller bias can create acne. More samples/blur may remove detail or increase render cost. Keep these experiments separate so the cause of an improvement remains clear.

### A02 — optional source-video audio (P2 product feature, M–L)

**Verified local gap:** Uploaded video elements are muted and export mixes only `project.audio`. There is no per-shot embedded-audio extraction/mix policy. UltraMock's exact current mix policy is not established, so this is an optional mok workflow improvement, not a confirmed reference-parity requirement.

**Implementation:** Add explicit per-shot audio enable/gain, extract the source audio track, and define trim, playback-speed/pitch, loop, gap/hold, fades and soundtrack mixing semantics. Default new behavior carefully so old projects do not unexpectedly gain sound.

**Acceptance:** Exported waveform landmarks align with visible numbered frames under trim/split/speed/loop/cuts. Gap/end holds do not accidentally replay audio. Soundtrack plus source clips do not double-play or clip unexpectedly. Preview/export agree and source audio can be disabled independently.

**Dependencies / tradeoff:** R03 timestamp/media infrastructure and portable project migration. Audio policy is a product decision; implementation cost is larger than correcting the documentation.

## Further product scope

**P01: screen padding control (P2 product gap, M).** The main agent's fresh live UI scan found a **Screen Padding 0.00** control on the free MacBook Neo. mok's screen configuration, ScreenSurface and screen inspector have no equivalent media-padding field/control (`src/lib/types.ts`, `src/three/screen.ts`, `src/components/editor/Inspector.tsx:619`). This is a verified missing control; the reference control's exact units and complete rendering semantics still need characterization. Implement a clearly defined inset around source content, exposing the existing screen background inside that space and preserving content aspect. Acceptance should cover image/video, portrait/landscape, cover/contain/stretch, crop, status bar, browser chrome, auto-motion focus-area mapping, pixel-grid placement and still/video export. Decide whether padding belongs to the project screen or a per-shot source override before writing migration code. Adding an inset without updating focus-area/media mapping would create a new framing bug.

**P02: per-shot effects (design opportunity, not an established reference gap).** mok stores effects at project level and reads that array in Inspector/PostFX. UltraMock shows a selected-shot-related hint, but a live empty-media-template experiment retained the effect list and Ghost visibility state across Shot 1/2. Its actual inheritance/edit semantics are therefore unresolved. Do not describe mok as missing reference per-shot effects based on that hint alone. If independently useful, specify project defaults, shot overrides, inheritance/reset, transition behavior and export settling, then test those semantics as a separate product feature.

## Product completeness and optional experiments

**P03: paste routing and shortcut preferences (P2 product gap, S–M).** UltraMock exposes ask/replace/add-shot paste choices; mok currently calls `importFilesToShot` directly in `src/components/editor/hooks.ts`. Add a persistent preference and a keyboard-accessible chooser with a remembered choice. Preserve clip identity, timing, crop and undo when replacing; create an independent source and sensible duration when adding. Test mixed file types, empty selection, missing-media replacement and cancel. Also expose an option to disable quick capture. Keep mok's existing save/capture key assignments unless there is a separate usability reason to change them.

**P04: focused workflow tours (P2 guidance gap, S–M).** UltraMock has dedicated timeline and Auto-motion tours; mok's `Tour.tsx` has one general introduction. Add short walkthroughs using disposable sample content, with a clear exit and reset. Explain shot selection versus playhead, trimming, property keys, easing and focus areas. Acceptance: keyboard-only completion, reopening the relevant Help entry, mobile inspector visibility and no changes to the user's existing project unless explicitly applied.

**Q06: optional crevice AO or more accurate screen-source occlusion (P3, L).** Current ground contact shadows and baked maps are not general scene AO; screen spill does not trace key-to-key/source occlusion. Prototype only on a representative close-up. Require improvement in matched images, no darkening of emissive screens/cards, no transparent-edge halos, stable temporal behavior and acceptable performance. Do not replace authored material maps with heavy screen-space darkening. UltraMock's AO/GI implementation remains unknown.

**Q07: higher-than-4K screen raster or temporal AA (P3, M–L).** ScreenSurface intentionally caps texture edge to 4096 and 12M pixels; ordinary output rarely needs more. Test a macro 8K use case first. Temporal AA would need stable history, cuts/resets, animated lids, videos, transparency and export handling; it is not a free improvement over current MSAA/SMAA.

**No scheduled rewrite:** Do not downgrade Three to r183, replace R3F solely to match fingerprints, add a path tracer by default, or adopt a cloud render farm without a demonstrated workflow need. Those are architecture choices, not evidence-based solutions to current gaps.

## Exact source-video audio documentation audit

Search covered all tracked Markdown/MDX documentation and user-facing audio wording in source at c316d05. Only **one repository location explicitly claims source-video audio**:

| Location | Existing wording | Assessment | Suggested correction |
| --- | --- | --- | --- |
| `docs/ultramock-comparison.md:35` | `soundtrack/source audio` in the mok video-export cell | Incorrect: there is only one separate soundtrack lane | Replace with `one music/voiceover track with volume, trim and fades`. Optionally add: `Audio embedded in source video clips is not currently mixed.` |

Exact proposed replacement for that cell:

> MP4 and alpha WebM, quality/frame-rate/motion-blur options, one music/voiceover track with volume, trim and fades, deterministic sampling and cancellation

Other wording is not the same false claim:

- `README.md:68` correctly describes an audio lane for music/voiceover and export mixing.
- `README.md:75` says “audio muxed in”; in the context of the audio-lane description, this is accurate. Optional clarity edit: “the music/voiceover track muxed in.”
- `src/lib/version.ts:138` correctly describes the separate audio lane mixed into MP4/WebM.
- `src/components/editor/Tour.tsx:24` says “your audio,” which is broad but does not explicitly promise audio from source videos. Optional clarity edit: “your soundtrack.”
- `docs/ultramock-comparison.md:17` describes mixed audio/image drops, which is about routing files and is accurate; line 89 describes audio regression coverage, also not a source-clip-audio claim.
- `docs/renderer-screen-lighting.md` does not claim embedded source-video audio support.

Code proof: `src/lib/media.ts:87` sets `v.muted = true`; `src/lib/audio.ts:85` reads exactly `project.audio`, then creates one source at line 95; `src/export/capture.ts:371` calls that mix; `src/lib/types.ts:155` defines the single AudioTrack shape, with no per-shot audio settings. The comparison documentation was corrected when this report was assembled; the audio implementation remains unchanged.

## Suggested review checkpoints

With D01 complete, establish Q01, then ship Q02/Q03/R01 only when measured crops and resource checks are ready. Run A01 as a two-device pilot alongside R02. Then choose Q04/R03/R04 based on whether visual output, frame precision or long exports are the user's most frequent pain point. Re-evaluate Q05 using the new asset/HDR baseline. Keep A02 and all P3 experiments separate from the core realism work so scope stays reviewable.
