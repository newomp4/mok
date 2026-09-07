# mok rendering and export gap audit

September 6, 2026. Source and asset audit of [mok c316d05](https://github.com/newomp4/mok/tree/c316d05c3c5fc1aa3abbc307ccb41775af1adf5f). References below are relative to that repository snapshot. No application code or assets were changed in this research pass. See the companion [technical dossier](ultramock-technical-dossier.md) and [implementation plan](mok-improvement-plan.md).

## Conclusions

mok already has the essential renderer architecture: Three.js physically based glTF materials, HDR image-based lighting, shadowed scene lights, live display textures, planar display/floor reflections, screen-driven laptop lighting, half-float postprocessing, and deterministic timeline stepping for WebCodecs exports. A renderer rewrite would discard useful working systems without itself solving the most visible differences.

The strongest opportunities are:

1. **Raise the HDR source tier from 1K to 2K and calibrate materials under it.** This is a verified asset-resolution difference from the publicly served UltraMock default HDR, rather than a guess about proprietary shaders.
2. **Standardize asset quality and use GPU-compressed textures.** Some mok models have substantial authored PBR maps; others have none. Their finishes cannot become equally convincing through one global gloss multiplier. UltraMock's inspected public models use KTX2/Basis; mok's shipped models all use WebP despite already supporting KTX2 loading.
3. **Add a renderer/export memory budget.** Fixed 4× MSAA on two full-resolution half-float composer targets is expensive at 4K/8K; output muxing also buffers the entire video. Current dimension and duration limits do not bound the product.
4. **Accumulate motion blur in linear light before tone mapping.** Current samples are averaged after display conversion. This produces darker trails and alters bright highlights even when alpha arithmetic is correct.
5. **Add final-output dithering, reflection-specific antialiasing, and automated visual/export fixtures.** These are practical polish improvements with measurable acceptance criteria.

The screen-on-keyboard effect is already present in this commit. It is a bounded analytic rectangle light plus a rough Fresnel reflection, not general GI. The previous missing interaction should no longer appear on the gap list.

## Evidence boundaries

- Local facts below come from application source, installed library source, Radiance headers, glTF JSON/accessors, and embedded WebP image headers.
- Public UltraMock metadata was independently examined by the `ultramock_stack` agent using small HTTP range requests, without copying model geometry. The inspected default HDR is 2048×1024; the inspected free iPhone 17 and MacBook Neo GLBs require Meshopt, quantization and KTX2/Basis; two concrete KTX2 maps are 2048×2048 with 12 mip levels. Its broader catalog is not proven to have identical settings.
- The companion dossier separates official product announcements from observed controls and verified metadata; paid rendering quality remains unmeasured.
- Existing `docs/ultramock-comparison.md` is a useful dated feature inventory. Its remaining-limit paragraph predates the new metadata findings: HDR resolution and KTX2 use are now known for the public assets inspected. Its video row incorrectly claimed source-video audio support for mok; that documentation has now been corrected. See the audio section below.
- Existing `docs/renderer-screen-lighting.md` records the latest 100-test/production-browser verification. This audit did not rerun those tests or benchmark a GPU. Memory figures below are allocation estimates, explicitly not measured process memory or browser limits.

## Current stack and frame pipeline

`package.json`: Next 16.3.4, React 19.2.8, Three 0.185.1, R3F 9.7.0, drei 10.7.8, React Three Postprocessing 3.1.1, postprocessing 6.39.4, Mediabunny 1.55.5, Zustand 5.0.15. UltraMock's inspected public bundle uses Three r183, GLTFLoader, Meshopt, KTX2, a Three EffectComposer and Mediabunny/WebCodecs. There is no verified reason to regard mok's newer Three version, React wrapper, or different composer library as a quality deficit by itself.

`src/three/Viewport.tsx:30`: WebGL canvas with alpha and premultiplied alpha, no default-framebuffer antialiasing, VSM shadows, sRGB output, `preserveDrawingBuffer: true`, and high-performance GPU preference. Demand rendering stops continuous work when idle. `src/components/editor/ViewportPane.tsx:124` reduces DPR to 1.5 while interacting, then restores the chosen quality. It is not an FPS- or GPU-memory-adaptive quality controller.

The main frame order is explicit:

- Driver at -100 evaluates the timeline, fades, card/media mode and current shot.
- Camera at -50; HDR intensity/rotation at -40; laptop lid at -25.
- Device at -20 updates user transforms, screen pixels, video image, screen brightness and live emitter frame.
- Screen/floor lighting and receiver transforms follow; post-effect uniforms update before rendering.
- Contact/depth and shadow work precedes the screen mirror at 0.5 and floor mirror at 0.6; the composer renders afterward.

`src/three/renderPass.ts` now preserves renderer clear/target/XR/shadow state and restores hidden objects, including error paths. Offscreen reliability improvements are already implemented and tested. `src/three/resources.ts` deliberately disposes only owned material/geometry clones; shared GLTF-cache textures survive component unmount.

## HDR lighting and PMREM

`src/lib/presets.ts:192` defines eight lighting looks from **six unique HDR files**, with different intensity/orientation for some shared files. All six local Radiance headers read **1024×512**; each is approximately 1.6 MB on disk. `src/three/Scene.tsx:143` uses HDRLoader, creates PMREM on a lighting change, assigns its texture to `scene.environment`, and disposes the PMREM output on cleanup. HDRLoader defaults to half float in the installed Three version.

The installed `node_modules/three/src/extras/PMREMGenerator.js:268` computes cube-face size from **equirectangular width / 4**, rounded down to a power of two. Therefore the local HDRs produce **256-pixel faces**. The source-sized CubeUV output is 768×1024, RGBA16F. This is not merely a stale documentation guess: the calculation is in the installed implementation.

The inspected UltraMock `brown_photostudio_04_2k.hdr` is 2048×1024. Given a conventional width/4 PMREM path, that corresponds to 512-pixel faces; **that resulting runtime PMREM size remains an inference until its actual conversion code/output is observed**. Source resolution is verified. Higher environment resolution mainly helps sharp/glossy reflections and small light-source contours, not every matte surface equally. [Three's PMREM documentation](https://threejs.org/docs/pages/PMREMGenerator.html) describes roughness-dependent prefiltering.

Approximate live texture costs, excluding temporary generation buffers and driver overhead:

| HDR source | PMREM face | PMREM RGBA16F output | HDR RGBA16F source |
| --- | ---: | ---: | ---: |
| 1024×512 | 256 | 6 MiB | 4 MiB |
| 2048×1024 | 512 | 24 MiB | 16 MiB |
| 4096×2048 | 1024 | 96 MiB | 64 MiB |

PMREM generation also creates a similarly sized temporary ping-pong target. Moving everything to 4K immediately would multiply those allocations by 16 over the current 1K tier. A **2K default, 1K low-memory fallback, optional 4K export tier only after comparison** is a more defensible experiment. Load the higher-resolution originals from the licensed source, not resized 1K images. The project's HDR supplier, [Poly Haven, licenses its assets CC0](https://polyhaven.com/license), which permits redistribution; its website imagery/text have separate terms.

Other limits: analytic lights are separately authored per scene. `SceneLightRig` keeps an intentional minimum gain of 0.15, so setting the light-intensity control to zero does not mean a physically dark room. Several bright scenes add hemisphere fill on top of HDR diffuse. This is artistic calibration, not a broken renderer, but it can flatten creases. A repeatable neutral-gray/chrome/rough-metal calibration scene would let changes be assessed systematically.

## Model detail, PBR maps and texture storage

Inventory derived directly from shipped glTF JSON. Map counts mean **materials with that slot**, not unique images; geometric triangles are accessor counts before runtime hiding, not visible draw-call counts.

| GLB | MB on disk | Meshes | Materials | Triangles | Base maps | Normal maps | Metal/rough maps | AO maps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| iPhone 17 Pro | 7.72 | 19 | 17 | 51,223 | 2 | 6 | 0 | 0 |
| iPhone 17 Pro Max | 0.26 | 12 | 12 | 29,544 | 2 | 0 | 0 | 0 |
| iPhone 16 Pro Max | 0.57 | 36 | 11 | 50,146 | 2 | 2 | 0 | 0 |
| MacBook Pro 14 | 1.03 | 50 | 29 | 104,997 | 1 | 10 | 1 | 1 |
| MacBook Pro 16 | 1.22 | 61 | 34 | 112,625 | 4 | 12 | 7 | 0 |
| iPad Pro 13 | 1.95 | 46 | 36 | 136,864 | 11 | 12 | 22 | 17 |
| Pro Display XDR | 3.01 | 16 | 14 | 253,481 | 5 | 10 | 6 | 4 |
| iMac 24 | 1.59 | 132 | 20 | 155,598 | 5 | 1 | 0 | 0 |
| Watch Series 9 | 1.81 | 28 | 19 | 93,413 | 3 | 4 | 4 | 2 |
| Watch Ultra 2 | 3.35 | 55 | 32 | 140,916 | 8 | 15 | 7 | 3 |

Every shipped GLB uses `EXT_meshopt_compression`, `KHR_mesh_quantization` and **`EXT_texture_webp`**. None currently uses `KHR_texture_basisu`. Some have useful clearcoat/specular/transmission extensions; these should be preserved. The loader already configures KTX2 support (`src/three/devices/GlbModel.tsx:26`), so adopting properly encoded KTX2 assets requires much less runtime work than introducing a new rendering engine. [Three's KTX2 loader](https://threejs.org/docs/pages/KTX2Loader.html) transcodes Basis textures to a GPU-supported compressed format.

WebP saves transfer bytes but is not GPU block compression. Header-derived RGBA8+mipmap storage estimates are about **127 MB for iPad**, **101 MB for iPhone 17 Pro**, **86 MB for Watch Ultra**, and **559 MB across all ten GLBs** if each distinct embedded image is uploaded separately. Actual GPU storage depends on internal formats, image reuse and driver behavior. GLTF caching retains shared resources; no model-cache eviction is present. It would be incorrect to report these numbers as measured peak VRAM, but they identify sensible optimization targets.

`src/three/devices/GlbModel.tsx:650` preserves source maps and material-specific roughness, but scales **every authored normal map by 0.65**. Gloss uses broad material categories and a few roughness floors. `src/three/surfaceDetail.ts` adds a restrained derivative-filtered grain only to untextured metals; that cannot create missing engravings, machining, bevels, speaker-hole depth or physically correct coating structure. Better-looking surfaces need per-material inspection and sometimes a better model, not increased global gloss.

Recommended asset work:

- Start with the weak-map iPhone 17 Pro Max and highly compressed small MacBook details; inspect at consistent close-up scale, grazing angle and lighting.
- Author material profiles that identify body metal, coated glass, keys, rubber, lenses and logos. Preserve authored normal/roughness/metal/AO channels; replace blanket adjustments only when a matched image demonstrates an improvement.
- Re-encode textures to KTX2 with complete mips; favor high-quality normal-map encoding, check swizzles/color space, and visually compare small text and gradients. Compression can harm detail if used indiscriminately.
- Where topology or dimensions are inaccurate, acquire or author a better model. A map conversion cannot repair hardware geometry.

Licensing: `CREDITS.md` lists ten Sketchfab sources as CC Attribution. This audit confirms those recorded credits, not each current source's license text. Keep attribution, provenance and modification notes; verify the exact source/license before acquiring replacements. Do not assume an asset described elsewhere as an “official Apple model” is licensed for redistribution in this repository. Purchased or reference-site assets may require separate distribution rights. No UltraMock assets were copied into mok during this audit.

## Shadows and surface contact

`Viewport.tsx:36` selects VSM. Scene keys use 2048 maps in preview and 4096 for exports larger than 2048 (`src/three/renderQuality.ts`). `src/three/scenes/EnvScene.tsx:44` scales blur radius with resolution and uses 8–32 blur samples. The light camera spans ±1.6× device scene size and near/far 0.1 to 22× size. Bias is -0.0004/-0.0005, with **normalBias 0.02 world units** across all devices. Because `src/three/geometry.ts` uses 0.01 units/mm, that normal offset corresponds to roughly **2 mm**, regardless of device scale or shadow texel size.

This is a plausible source of over-separated small contact details and varying acne/softness across a watch versus a large display. It is a **calibration candidate**, not a new proven screenshot defect. VSM softness is a filtered shadow estimate, with known finite-map limits; simply increasing map size does not solve a bias mismatch or make a finite source physically exact.

Contact shadows are a second, upward orthographic depth render plus two separable blur rounds (`src/three/ContactShadow.tsx:13–63`), composited as a transparent black catcher. Lit scenes use a tight contact shadow in addition to the scene key. This keeps objects grounded, but is not general ambient occlusion between all parts. There is no general SSAO/GTAO/SSGI pass.

Practical experiment: scale normal bias from shadow world-units-per-texel with small per-model clamps, tighten the shadow camera around actual visible device bounds, and compare zero/medium/max softness. Check laptop key contact, watch crown, thin stand, sidewalls, floor edges and arbitrary rotation. Any SSAO prototype should separately exclude emissive screens/cards and prove no alpha halos or double-dark contact; it should not ship just because another product looks more contrasted.

## Display, mirrors and laptop light

The live screen is an sRGB CanvasTexture with anisotropy and generated mipmaps (`screen.ts:32`). Preview is bounded to 2560 edge; export can reach 4096 edge and 12 million pixels. Orientation, contain/cover fit, status bar, background and video are rasterized before the texture is sampled. A closer-than-native 8K crop can therefore expose the 4K screen raster ceiling even when the output is larger.

The screen material combines emissive artwork, a restrained base specular layer, clearcoat, HDR and a planar mirror (`materials.ts:88`). The mirror is rendered in half float from the actual display plane, clips geometry behind the display, and excludes camera-mounted cards. Reflection quality is bounded to 60% of preview pixels, max 1440 edge/1.5M pixels; export uses 85%, max 2560/4M pixels. The mirror target has **no multisampling and no mip chain** (`src/three/ScreenReflection.tsx:37`). Main-view MSAA cannot recreate detail already aliased in that texture. Controlled 2× mirror MSAA or a filtered reflection pyramid is worth comparing, particularly keyboard edges at grazing views; this increases render cost and must respect the memory budget.

The dark-room floor has a separate half-float planar capture plus depth-aware blur (`src/three/scenes/EnvScene.tsx:171`). It is a stylized broad reflection with fixed tuning, not a general rough-material ray tracer. Screen and floor mirrors each rerender scene geometry; heavy devices and effect stacks multiply frame cost.

`screenSpill.ts` already provides finite-screen diffuse light and a nine-tap rough Fresnel reflection on selected laptop deck/key materials. It follows actual content UVs and lid transforms, preserves instance transforms and material maps, borrows the screen texture, bounds near-closed diffuse energy, and filters source edges to avoid bands. Black content, zero brightness and fades produce zero new light. It does **not** trace source-to-key occlusion or multiple bounces. Floor glow remains a separate average-color approximation. These are defined limits, not evidence that the recent effect is missing.

## Antialiasing, color and blur

`src/three/effects/PostFX.tsx:194` uses RGBA16F composer targets with 4× MSAA, except depth lens mode switches to zero MSAA plus SMAA. Depth-of-field internal resolution is 0.75; radial/directional focus and ghost blur use half-resolution Kawase buffers. `EFFECT_MERGE_MODE = "none"` is intentional: each effect samples the previous result and incompatible UV/convolution combinations cannot be merged into a crashing pass. The tradeoff is more full-screen passes. Do not blindly restore automatic merging without the existing full-stack regression.

The output sequence includes blur/distortions, bloom, Neutral tone mapping, then stylized glass/grain/vignette. The composer forces renderer tone mapping off while active; the Neutral setting on the canvas is **not** evidence of accidental double tone mapping. Color textures are sRGB; lighting and half-float buffers are linear. [Three's color-management guide](https://threejs.org/manual/en/color-management.html) explains why interpolation and lighting require linear values.

No material or final EffectPass enables dithering. The installed postprocessing EffectMaterial defaults it off; the optional Noise effect is a visible artistic grain effect, not a guaranteed subtle quantization dither. Enable approximately half an 8-bit step of stable output dither on the **last** screen-output pass only, then inspect dark ramps, transparent edges and compressed video. This is a small, feasible polish change.

Autofocus is correct for the installed postprocessing version: its circle-of-confusion shader measures `length(viewPosition)`, so mok's ray hit distance matches it (`src/three/effects/PostFX.tsx:120`; library `build/index.js:4947`). Replacing it with camera-space Z based on older documentation would introduce a bug. Its radial-distance focus surface is a library approximation; this is distinct from the correctness of the current mapping.

The major color issue is motion blur: `src/export/capture.ts:394–406` sums already rendered **sRGB canvas pixels after tone mapping**, using Canvas2D lighter compositing and 1/samples alpha. Alpha averaging was fixed, but this remains display-space color averaging. As a simple opaque example, averaging black/white sRGB values produces 0.5; averaging their linear intensities and converting to sRGB yields about **0.7354**. Real motion trails and bright specular highlights therefore differ. A GPU linear/HDR accumulation target before the final tone/output stage is the principled fix; tone map once after accumulation and preserve premultiplied alpha. It requires careful effect ordering and regression of bloom, fades, grain and transparency, not a one-line gamma tweak.

## Export correctness and performance

Strengths already implemented in `src/export/capture.ts`:

- Fixed output-size stepping with saved/restored renderer state, cancellation and asset/font waits.
- Still/video asset scope; unrelated missing clips do not block an earlier export.
- Per-shot React geometry/effect settling, including same-device cuts.
- Half-open endpoint sampling, exact final frame duration and per-frame shared clock for motion blur.
- Encoder codec/quality fallback that actually encodes a first frame before accepting the configuration.
- Explicit PNG/JPEG/WebP MIME validation and transparent WebM codec selection.

Remaining issues and risks:

**Source frame precision.** `seekVideoForTime` uses HTMLVideoElement seek events and a learned frame window floored at 1/60 s and capped at 1/24 s (`src/export/capture.ts:70–103`). It does not inspect decoded-frame presentation timestamps. High-frame-rate or variable-frame-rate sources need a numbered-frame fixture; a 120fps source may have two distinct frames within the minimum reuse window. This is a code-supported risk, not a claim that the prior 24fps export was wrong. The already installed Mediabunny offers timestamp-based [VideoSampleSink](https://mediabunny.dev/api/VideoSampleSink) and efficient ordered sample iteration; using it for export would make frame identity explicit, at the cost of a source-decoding/cache lifecycle and rotation-metadata tests.

**Audio scope.** `src/lib/media.ts:87` mutes uploaded video elements. `src/lib/audio.ts:84` renders only `project.audio` into a stereo 48kHz OfflineAudioContext. There is no per-shot source-audio extraction, speed treatment, gain or mixing. The documentation is now corrected to soundtrack-only. Adding clip audio would require explicit trim/speed/gap/loop semantics. This is independent of 3D realism but a real capability gap.

**GPU memory.** Installed postprocessing creates an MSAA input buffer and clones it for output (`build/index.js:927–928`). At 3840×2160, one RGBA16F texture is 66.4 MB and its four-sample color storage is about 265.4 MB. Two resolved+MSAA color targets total roughly **664 MB before depth, reflections, shadows, source textures or other effects**. At 7680×4320, that color estimate becomes **2.65 GB**. Implementation/driver allocations may differ, but maxTextureSize alone cannot guarantee this will fit. Full-screen quality budgeting is missing even though reflection buffers are bounded.

**CPU/output memory.** The muxer uses `BufferTarget` and MP4 fastStart in-memory (`src/export/capture.ts:304–308`). At the configured 4K60 Ultra bitrate, the estimate is 109.5 Mbps: 180 seconds implies about **2.46 GB** before extra copies, audio and GPU resources. Stereo 48kHz float audio for 180 seconds adds about 69 MB plus the decoded source. Mediabunny's [writing guide](https://mediabunny.dev/guide/writing-media-files) recommends streaming for large outputs and supports backpressure. Use a file/OPFS stream when available, retain a conservative Blob fallback, and clearly handle disk/quota/cancel failures.

**Performance observability.** No timer-query instrumentation, sustained frame-time quality adaptation, renderer memory readout or repeatable export benchmark was found. Main geometry, mirrors, shadow work, serial effects, source seeks and Canvas2D copies are currently bundled into perceived slowness. Instrument before selecting a costly GI/AA upgrade.

## Proposed implementation sequence and acceptance gates

| Priority | Work | Feasibility / dependency | Acceptance gate |
| --- | --- | --- | --- |
| 1 | 2K licensed HDR tier + neutral calibration fixtures | Small renderer/data change; original source download and memory fallback | Identical camera/material crop comparing 1K/2K; improve glossy highlight edge without changing brightness; measure PMREM generation and memory |
| 1 | Final-output dithering | Small shader/composer change; no new assets | Dark ramps improve; alpha remains 0 outside the device; grain toggle remains independent |
| 1 | Export memory estimate + quality negotiation | Medium UI/export/render-quality change | 4K/8K stress fixtures cannot silently overallocate; downgrade is explicit and normal preview restores |
| 2 | KTX2 asset pipeline + model-by-model material calibration | Asset tooling and visual QA; preserve licensing/attribution | Same geometry and maps, smaller measured GPU residency, no normal seams, blur or brand-detail damage |
| 2 | Linear HDR motion-blur accumulation | Medium/large pipeline change | Black/white sweep has expected linear average; specular trail, bloom, premultiplied-alpha silhouette and all effect combinations stay correct |
| 2 | Timestamp-driven export decode | Medium export/media change using installed library | Numbered 24/30/60/120fps and VFR sources, split/trim/speed/loop/phone rotation fixtures match decoded PTS |
| 2 | Streaming mux and bounded cache | Medium storage/export lifecycle change | Long high-bitrate output succeeds without a complete RAM copy; cancel/error paths release handles and recover editor |
| 3 | Shadow bias/frustum and reflection AA calibration | Medium rendering/QA change | Thin components remain attached, no acne/light leaks or clipped floors, no temporal mirror shimmer; budget enforced |
| 3 | Optional crevice AO / screen-source occlusion | Experimental rendering feature | Demonstrated improvement in matched images, no emissive/card darkening, no alpha halos, measured cost acceptable |
| Product | Clip audio or accurate soundtrack-only wording | Documentation small; actual audio feature medium/large | Source audio stays synchronized under trim/speed/gaps and does not double with soundtrack |

Before claiming “as realistic,” create a reference suite with fixed synthetic artwork, camera/FOV, device/finish, source light rotation, output size and crop. Include each asset, front/grazing/back views, small shiny details, white/black/split-color screens, closed/open lids, bright/dark backgrounds, and alpha over a checkerboard. Compare at equal apparent device size; otherwise framing alone can make a sharper or more detailed model look better.

Automate actual browser rendering and export inspection alongside the existing CPU suite: screenshot diffs with tolerant metrics, 4K alpha edge/color checks, encoded frame counts/timestamps, first frames at cuts, temporal shimmering samples, and Chrome/Safari/Firefox capability outcomes where supported. Current regression tests protect math and lifecycles well, but cannot prove PBR appearance or codec output by themselves.

## What not to infer

Higher model triangle counts do not prove better appearance. Newer Three does not automatically outperform an older, well-calibrated renderer. KTX2 improves GPU storage and delivery, but cannot invent missing texture detail. More HDR pixels are not equivalent to global illumination. Missing AO maps do not mean every corresponding material needs AO. An UltraMock changelog claim about an official hardware model is not a redistribution license. Finally, paid and cloud export behavior remains unverified; local implementation priorities should follow measurable mok gaps and the user's actual workflow.
