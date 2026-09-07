# UltraMock comparison and rendering audit

Research date: September 6, 2026. This is a functionality comparison, not a claim of identical rendering or exhaustive paid-feature access.

The subsequent [technical dossier](research/ultramock-technical-dossier.md) adds current stack fingerprints, free-asset metadata, deeper control inspection and a prioritized improvement plan. The verification section below records the earlier 84-test pass; the later renderer pass is documented separately in [screen lighting verification](renderer-screen-lighting.md) with 100 tests.

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
| Screen background | Color backing and a separate Screen Padding control observed on MacBook Neo in the deeper scan | Color/image/gradient backing for contain-fit media; no explicit media-padding control |
| Screen texture | Pixel Grid observed | Replaced whole-frame pixelation with RGB subpixels attached to the screen UVs, with minification filtering |
| Flat thickness | Depth effect observed on Flat | Added real flat/browser extrusion geometry with a depth control |
| Effects | 12 entries observed: Depth, Glass Border, Sharpen, Vignette, Grain, Fish Eye, Pixel Grid, Chromatic Abb., Bloom, Screen Fade, Ghost, Liquid Glass | All 12 corresponding categories now available; independently implemented visual algorithms |
| Blur | Reference blur section observed; maker describes radial, directional, tilt-shift and lens modes | Radial, directional, tilt-shift and depth lens, focal point/distance, keyframed rack focus and per-shot lens settings |
| Timeline | Simple/Advanced, recording, reorder, trim, transitions, loop and zoom observed | Those workflows plus split, duplicate, reverse, multi-selection, clipboard, gaps, custom easing and undo/redo; retained clips remain inspectable beyond the export endpoint |
| Project endpoint | Separate length field observed: 12-second ruler with six seconds of shots | Added independent playback/export length. Trims retain the endpoint; extensions grow it; shorter endpoints retain later editable clips. Three-minute cap prevents excessive allocations |
| Auto-motion | Focus-area workflow and Compose/Shuffle instructions observed | Editable region-based motion; corrected cover/contain/stretch mapping, visible-region clipping, orientation mapping and trimmed-video preview |
| Text and logo | Maker/public context, not a complete live editing comparison | Text cards, typography, three logo shaders and enter/exit animations; Blur now actually blurs instead of changing opacity/scale |
| Templates | 17 entries plus Starter observed in the opened collection; animation indicators visible | 24 starter templates with hover previews and personal template saving. Presets use mok's own scene/assets and may not visually match |
| Still export | JPG/PNG/WebP, transparency, orientation, dimensions observed | All three formats, transparent PNG/WebP, preset/custom sizes and high-resolution output |
| Video export | Four quality levels, 30/60 fps, four motion-blur levels, transparent option observed | MP4 and alpha WebM, quality/frame-rate/motion-blur options, one music/voiceover track with volume, trim and fades, deterministic sampling and cancellation. Audio embedded in source video clips is not currently mixed |
| Export scope | Reference behavior not tested behind paid options | Still/video export only loads sources actually used in its time range; an unused missing clip cannot block an earlier output |
| Project workflow | Save project and Pro gating observed | Local autosave, project library and portable files; missing files retain named placeholders and can be re-linked without losing timing or animation |
| Cloud/account features | Paid controls visible; execution unverified | No UltraMock account system, subscription or cloud collaboration; local portable projects are the personal-tool workflow |
| Keyboard/mobile | Desktop comparison emphasized; no exhaustive reference mobile audit | Keyboard/focus controls and responsive mobile inspector from prior audit, checked again for new controls |

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

Remaining visual limits are explicit: imported asset detail varies; several models lack authored normal/roughness/AO maps. mok's HDRIs are currently 1024×512. There is no general global-illumination or path-tracing renderer; laptop screen lighting uses sampled direct illumination and an approximate rough reflection restricted to deck surfaces. It does not solve arbitrary scene occlusion or multiple light bounces. The deeper scan verified a public UltraMock studio HDR at 2048×1024 and KTX2 texture use in two free models. Its complete shaders, light calibration, broader asset pipeline, AO strategy and paid output quality remain unknown. See the [technical dossier](research/ultramock-technical-dossier.md) for exact metadata and sources. [Three material documentation](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) and [PMREM documentation](https://threejs.org/docs/pages/PMREMGenerator.html) explain the underlying controls.

## Verification

Automated coverage includes orientation transforms and all four image corners, native tablet dimensions, fit-region clipping, video trim/speed/hold boundaries, endpoint migration/trimming/undo, missing-source recovery races, export source scope, HDR gain composition, bounded GPU targets and disposal, plus previous timeline/IO/render regressions. Run `npm test`, `npm run typecheck`, `npm run lint`, and the production build.

Final checks: **84 automated tests passed**, with clean TypeScript, ESLint and production Webpack build. The IO suite includes additional assertions within its single counted test file.

Production-browser checks covered:

- Upright landscape phone and portrait tablet; native keyboard preference restoration; bounded shadow area without the landscape cutoff.
- RGB grid attached to screen pixels, actual flat thickness, card blur softening and a sharp final title.
- Body gloss and screen reflection at low/high values, then restoration to defaults.
- Independent endpoint editing, Simple/Advanced views, selecting retained later clips, and a named missing video repaired through Locate file. The repaired source and project length survived reload.
- A 3840×2160 opaque PNG and a 3840×2160 RGBA PNG with alpha spanning 0–255; normal preview restored after export.
- A 1280×720 H.264 video, 24 fps, **204 frames / exactly 8.500 seconds**, with low motion blur. Encoded frames at the tablet/flat cuts, the blurred title entrance and final held frame were inspected. An unavailable later clip did not block the output.
- A 390×844 viewport: toolbar wrapping, duration entry and mobile adjustments drawer.

The built-in Analytics sample's long floating-point currency string was also corrected. Existing PNG/WebP/JPG and MP4/WebM/audio regression coverage from the preceding audit remains in place.

Paid UltraMock rendering, exact asset matching, exhaustive codec support and cloud synchronization remain unverified.
