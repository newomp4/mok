# UltraMock comparison and rendering audit

Reference research: September 6–7, 2026. Mok functionality updated for version 0.13.0. This is a functionality comparison, not a claim of identical rendering or exhaustive paid-feature access.

The [technical dossier](research/ultramock-technical-dossier.md) records the reference stack fingerprints, free-asset metadata and deeper control inspection **before** this implementation. Its descriptions of missing mok controls are historical. The [implementation report](research/implementation-2026-09-06.md) records the subsequent delivery and final validation. The historical verification section below preserves the earlier 84-test pass; the separate [screen lighting verification](renderer-screen-lighting.md) records the following 100-test pass.

## Evidence and method

I inspected the [requested UltraMock editor/template](https://www.ultramock.io/?template=cmsi44fcq00006upexg689pgn) directly: device and scene pickers, lighting/background libraries, camera controls, effects, templates, source upload, orientation, auto-motion, timeline and image/video export panels. A synthetic quadrant image was uploaded to check upright landscape content. I compared those observations with mok's actual code and exercised mok locally.

“Observed” below means a control or result was visible in that live editor. It does not mean a paid export was successfully executed. Pro device selection opened an upgrade dialog; those assets, environments and cloud behavior were not inspected behind the gate.

The [official changelog](https://www.ultramock.io/changelog) identifies Three.js and WebGL2/WebCodecs, and describes HDR-driven reflections. It does not disclose its complete renderer or shaders. [Maker comments on Product Hunt](https://www.producthunt.com/products/ultramock) provide historical context on screenshot upload, camera rotation, stills, animation and blur, rather than proof of current paid behavior.

## Functionality matrix

| Area | UltraMock evidence | mok result |
| --- | --- | --- |
| Source media | Image upload, replace, clear and crop observed | Image/video upload, paste/drop, crop, cover/contain/stretch; mixed audio/image drops route correctly |
| Device orientation | Landscape/portrait observed on iPhone 17; ideal dimensions swap and media stays upright | Added independent portrait/landscape to phones/tablets, per-shot overrides, native-layout migration, upright re-fitting and rotated bounds; incompatible tablet keyboard cases hide and restore with orientation |
| Device details | Finish, reflection, notch and status-bar controls observed | Finish/reflection, notch, adaptive status bar, laptop lid, supported tablet keyboard and watch band; actual available hardware depends on asset |
| Camera | Five presets observed: Hero, Angled, Flat, Bottom, Detail; orbit, roll, FOV, zoom and pan | Nine presets plus manual/keyframed controls, center framing and guides |
| Lighting | Five choices observed: Default, Studio Soft, Dark Rim, Two Tone, Warm Glow; light rotation | Eight lighting presets using six HDR sources, plus four studio looks; intensity/rotation animation |
| Scene environments | Custom plus three Pro entries observed: Dark Room MacBook, Concrete Dark, Studio | Custom, studio, concrete, darkroom and gallery; independently authored scenes, not exact environments |
| Background | 19 preset entries and custom image upload observed | 28 independent presets, color/image/transparent backgrounds, blur; preset artwork differs |
| Screen background and padding | Color backing and a separate Screen Padding control observed on MacBook Neo in the deeper scan; reference units and complete fit interaction remain unverified | Color/image/gradient backing plus 0–45% padding, per shot or inherited from project defaults. Padding applies equally on each side below browser chrome and works with cover/contain/stretch, orientation and Auto-motion |
| Screen texture | Pixel Grid observed | Replaced whole-frame pixelation with RGB subpixels attached to the screen UVs, with minification filtering |
| Flat thickness | Depth effect observed on Flat | Added real flat/browser extrusion geometry with a depth control |
| Effects | 12 entries observed: Depth, Glass Border, Sharpen, Vignette, Grain, Fish Eye, Pixel Grid, Chromatic Abb., Bloom, Screen Fade, Ghost, Liquid Glass | All 12 corresponding categories; independently implemented algorithms. Shots inherit project effects until first edit, then own an independent stack. An empty stack disables effects for that shot; Use project effects restores inheritance |
| Blur | Reference blur section observed; maker describes radial, directional, tilt-shift and lens modes | Radial, directional, tilt-shift and depth lens, focal point/distance, keyframed rack focus and per-shot lens settings |
| Timeline | Simple/Advanced, recording, reorder, trim, transitions, loop and zoom observed | Simple camera pose slots plus Advanced property lanes, split, duplicate, reverse, multi-selection, clipboard, gaps, custom easing and undo/redo; both modes preserve absolute timing and existing keys |
| Project endpoint | Separate length field observed: 12-second ruler with six seconds of shots | Added independent playback/export length. Trims retain the endpoint; extensions grow it; shorter endpoints retain later editable clips. Three-minute cap prevents excessive allocations |
| Auto-motion | Focus-area workflow and Compose/Shuffle instructions observed | Editable region-based motion on the shot at the playhead; shared padding/fit geometry, visible-region clipping, orientation mapping and trimmed-video preview. Draw areas or add one by keyboard; arrows move it, Shift + arrows resize it, Delete removes it |
| Text and logo | September 7 official changelog describes independently timed layered text | Independent overlapping text tracks, named rows, front/behind layers, row order, canvas placement, enter/exit handles and timing trims. Attached captions and full-frame text/logo scenes remain supported. Arbitrary position keyframes remain outstanding |
| Templates | 17 entries plus Starter observed in the opened collection; animation indicators visible | 24 starter templates with hover previews and personal template saving. Presets use mok's own scene/assets and may not visually match |
| Still export | JPG/PNG/WebP, transparency, orientation, dimensions observed | All three formats, transparent PNG/WebP, preset/custom sizes and high-resolution output |
| Video export and audio | Four quality levels, 30/60 fps, four motion-blur levels and a transparent option observed; paid output and complete source-audio behavior unverified | MP4 and alpha WebM, deterministic timestamp-based source decoding, quality/frame-rate/motion-blur options and cancellation. One soundtrack plus opt-in source-video audio per shot, with volume and independent audio fades. Trim, speed and loops follow the clip; speed changes pitch. Gaps and held end frames are silent. Splitting preserves the original fade timing until a fade is edited |
| Export scope | Reference behavior not tested behind paid options | Still/video export only loads sources actually used in its time range; an unused missing clip cannot block an earlier output |
| Project workflow | Save project and Pro gating observed | Local autosave, project library and portable files; missing files retain named placeholders and can be re-linked without losing timing or animation |
| Paste and capture preferences | Ask/replace/add-shot paste choices and an enabled capture-shortcut preference observed; reference shortcut was Cmd/Ctrl+S | Remembered Ask/Replace/New shot choice. Replace preserves duration, trim, fit and camera; additional visual files become following shots and audio uses the soundtrack lane. Cmd/Ctrl+E capture can be disabled independently; Cmd/Ctrl+S continues saving the project |
| Focused tutorials | Separate Help entries for timeline and Auto-motion observed; those reference tours were not launched | General onboarding plus interactive Timeline and Auto-motion practice tours with local examples, reset/back/next/exit controls and keyboard focus handling. Practice does not replace or edit the user's project |
| Cloud/account features | Paid controls visible; execution unverified | No UltraMock account system, subscription or cloud collaboration; local portable projects are the personal-tool workflow |
| Keyboard/mobile | Desktop comparison emphasized; no exhaustive reference mobile audit | Keyboard/focus controls and responsive inspector from the prior audit. New controls and tours were exercised on desktop; this pass does not claim exhaustive mobile verification |

Counts describe the libraries inspected on this date, not a promise of permanent catalog parity. Similar counts do not imply matching assets or algorithms.

## Hardware asset gaps

| Reference model | Closest detailed mok asset / remaining difference |
| --- | --- |
| iPhone 17 | Procedural fallback exists but is hidden; detailed visible models are 17 Pro/Pro Max |
| iPhone 17 Pro / Pro Max | Corresponding GLBs present |
| Galaxy S26 Ultra | S25 Ultra procedural model; S26 asset absent |
| Pixel 10 Pro | Pixel 9 Pro procedural model; Pixel 10 asset absent |
| Watch Ultra 3 | Watch Ultra 2 GLB; Ultra 3 asset absent |
| iPad Pro | iPad Pro 13-inch GLB present |
| iPad Air | Procedural Air 11-inch; no matching detailed keyboard-case asset |
| MacBook Neo | No corresponding model |
| MacBook Air 13 | Hidden procedural fallback; no detailed GLB |
| MacBook Pro 14 / 16 | Corresponding GLBs present |
| Pro Display XDR | Corresponding GLB present |

Older models have not been relabeled as newer devices. Exact hardware parity needs accurate licensed models and device-specific calibration. mok also has extra Browser, iMac, iPhone 16 Pro Max and Watch Series 9 choices.

## What the rendering investigation established

mok already uses a real-time Three.js pipeline: GLTF physically based materials, HDR environments converted by PMREM, shadowed analytic lights, screen/floor planar reflections, half-float postprocessing and deterministic WebCodecs export. The difference was not an absent 3D renderer.

Two concrete faults were corrected. Three's inherited scene environment overrides the usual per-material environment intensity, so mok's material gain now composes explicitly with animated scene lighting. Export buffer sizing now observes both width and height, area and GPU limits; narrow/tall exports can no longer generate enormous reflection targets. Large exports get higher-resolution reflection/contact/shadow buffers, and those allocations are restored/disposed afterward.

Pixel detail now belongs to the display surface, rather than the background and device body. Flat depth uses geometry. Text/logo blur uses filtered premultiplied-alpha samples. Device orientation updates media rasterization, camera fitting, ground bounds and reflection geometry together.

MacBook keyboards now receive screen-image lighting and rough, view-dependent display reflections. A live rectangular emitter follows the actual screen UVs and lid transform; receiver materials retain their authored PBR textures. The display texture is shared without adding reflection render targets. Brightness, video and screen fades update the effect in preview and export. The separate floor glow still uses average screen color.

Version 0.10.0 adds 2048×1024 HDRIs alongside the existing 1024×512 fallback tier, and converts all ten detailed device models to KTX2 textures with complete mip chains. Material-aware calibration preserves existing maps; optional Detail shadows adds selective crevice shading and defaults to zero. See [asset preparation](research/asset-render-preparation.md) for the measured download-size and GPU-texture-memory tradeoff.

The renderer now plans allocations using output dimensions, effect needs, actual supported MSAA counts and a conservative memory estimate. It reduces antialiasing and auxiliary reflection/shadow buffers before refusing an over-budget request; it does not silently change output dimensions. Normal screen-raster export limits are 4096 pixels and 12 megapixels. Larger captures can use up to 8192 pixels and 24 megapixels when the plan permits, bounded by the GPU texture limit. Reduced-memory plans select smaller buffers and the 1K HDR tier. Preview resolution adapts during sustained expensive playback or interaction and returns to the user's quality setting while idle. These estimates are not measurements of free VRAM or guarantees that every device can export at the maximum size.

Motion blur integrates linear HDR samples before tone mapping and final dithering. Timestamp-based source decoding replaces reliance on approximate video-element seeking where supported; unsupported inputs have a reported fallback. Encoded video streams to temporary browser storage when available, with a bounded memory fallback and cleanup after download or failure. The implementation report records final GPU, alpha and mixed-shot export validation; the old export results below are not evidence for every new render path.

Version 0.13.0 shapes Studio/Gallery/Concrete highlights with area lights, reduces competing HDR fill, and blends distant sweeps into the backdrop. Local screen reflections replace covered environment radiance before the shared glass BRDF; they no longer add a second glass highlight. Display glass profiles preserve ordinary glass while giving the XDR its documented lower reflectance. These are independently authored improvements, not evidence that UltraMock uses the same shaders. See [the release report](research/release-0.13.0.md).

Remaining visual limits are explicit: imported asset detail varies; several models lack authored normal/roughness/AO maps. Texture compression and higher-resolution lighting cannot invent missing geometry or source detail. There is no general global-illumination or path-tracing renderer; laptop screen lighting uses sampled direct illumination and an approximate rough reflection restricted to deck surfaces. It does not solve arbitrary scene occlusion or multiple light bounces. The deeper scan verified a public UltraMock studio HDR at 2048×1024 and KTX2 texture use in two free models. Its complete shaders, light calibration, broader asset pipeline, AO strategy and paid output quality remain unknown. See the [technical dossier](research/ultramock-technical-dossier.md) for exact metadata and sources. [Three material documentation](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) and [PMREM documentation](https://threejs.org/docs/pages/PMREMGenerator.html) explain the underlying controls.

## Version 0.10.0 workflow verification

The product regression suite adds 11 tests covering migration, per-shot inheritance and reset, duplication/splitting/undo, template reset, padding with every fit mode and browser chrome, focus-area clipping/orientation, paste routing and preserved timing, source-audio split envelopes, decoded-frame changes and tour/preference isolation. That suite and the existing editor/parity suites passed together (30 tests). Targeted TypeScript and ESLint checks passed after the final product edits. Final whole-project checks belong to the [implementation report](research/implementation-2026-09-06.md).

Desktop browser checks verified:

- Per-shot 10% padding leaves the second shot at 0%; effect-stack edits remain independent of project-default changes, and reset resumes inheritance.
- Timeline practice selection, duration, keyframe creation and reset; Auto-motion practice composition and scrubbing. Exiting the tours preserved the original six-second project and its undo state.
- The real Auto-motion editor's keyboard add, move, resize and Compose path.
- Clipboard image replacement, adding shots, remembered paste routing, and paste/capture preference persistence after reload.

No product blocker was observed in those checks. A separate production-browser check on version 0.10.0 also verified the source-audio controls: a synthetic video started silent, the Source audio toggle revealed its controls, and actual UI edits stored 72% volume, 0.2-second fade in and 0.3-second fade out. Four Undo clicks restored those individually settled edits and the original silent state, with no browser errors. Edits were spaced beyond the editor's existing 350ms history-coalescing window. Decoding, split-envelope timing and encoded audio have separate automated coverage. No exhaustive browser, codec or mobile coverage is claimed.

## Historical verification before version 0.10.0

Automated coverage includes orientation transforms and all four image corners, native tablet dimensions, fit-region clipping, video trim/speed/hold boundaries, endpoint migration/trimming/undo, missing-source recovery races, export source scope, HDR gain composition, bounded GPU targets and disposal, plus previous timeline/IO/render regressions. Run `npm test`, `npm run typecheck`, `npm run lint`, and the production build.

At that earlier checkpoint, **84 automated tests passed**, with clean TypeScript, ESLint and production Webpack build. The IO suite includes additional assertions within its single counted test file.

Production-browser checks at that checkpoint covered:

- Upright landscape phone and portrait tablet; native keyboard preference restoration; bounded shadow area without the landscape cutoff.
- RGB grid attached to screen pixels, actual flat thickness, card blur softening and a sharp final title.
- Body gloss and screen reflection at low/high values, then restoration to defaults.
- Independent endpoint editing, Simple/Advanced views, selecting retained later clips, and a named missing video repaired through Locate file. The repaired source and project length survived reload.
- A 3840×2160 opaque PNG and a 3840×2160 RGBA PNG with alpha spanning 0–255; normal preview restored after export.
- A 1280×720 H.264 video, 24 fps, **204 frames / exactly 8.500 seconds**, with low motion blur. Encoded frames at the tablet/flat cuts, the blurred title entrance and final held frame were inspected. An unavailable later clip did not block the output.
- A 390×844 viewport: toolbar wrapping, duration entry and mobile adjustments drawer.

The built-in Analytics sample's long floating-point currency string was also corrected. Existing PNG/WebP/JPG and MP4/WebM/audio regression coverage from the preceding audit remains in place.

Paid UltraMock rendering, exact asset matching, exhaustive codec support and cloud synchronization remain unverified.
