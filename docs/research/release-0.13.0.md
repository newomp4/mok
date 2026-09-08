# Mok 0.13.0 — studio lighting, glass and independent text

This release addresses visible lighting and reflection problems and adds two of the remaining editing workflows identified in the UltraMock comparison. It also reintroduces conservative automatic cleanup for newly stored unused media. It does not claim complete feature parity or identical rendering.

## Rendering

Studio and Gallery use finite area lights to shape highlights across the enclosure, with a weaker shadow key and restrained HDR fill. Studio's front fill sits to the side to keep its broad rectangular reflection away from the display at the default framing. Concrete has a bounded spotlight pool and warm/cool area sources. Light rotation turns each emitting face toward the subject; intensity zero disables the room's analytic lights and HDR contribution. The screen's independent lighting control remains separate.

The sweep has a uniform material instead of a painted radial light pool. Nearby shading responds to lighting; a distant world-space fade joins the floor to the scene's fog colour. The existing VSM boundary guard still prevents a detached strip at the shadow map's edge. These shader changes preserve environment intensity and compose with the export passes.

Screen glass no longer adds a local planar reflection after the material's physical response, on top of the HDR reflection already there. Local radiance and coverage replace the covered environment contribution before the shared glass BRDF. The screen has one glass interface. Ordinary displays retain ordinary glass reflectance; the XDR uses its documented lower reflectance, and the iPad Pro has a separately disclosed artistic calibration. Actual GPU checks compare empty environment, identical local coverage, fractional coverage, a black local occluder and reflection disabled.

The 16-inch MacBook also had thin gaps around its display. Out-of-window screen UVs now render opaque black rather than discarding pixels. A narrowly guarded internal backing closes a separate lower bezel gap on the private model clone, preserving authored meshes, materials and lid motion. The helper is owned and disposed with the clone.

A preexisting MacBook palm-rest artifact was traced to perspective spotlight shadow precision, rather than screen spill or enclosure normals. The spotlight's near plane now fits the visible caster with padding; its field of view and aspect are calibrated before the first draw. This keeps shadow maps enabled and retains authored geometry and light falloff.

## Editing and storage

Independent text tracks can overlap, span scenes, sit in front of or behind a device, and retain their own timing and layer order. Timeline bar movement, trims, enter/exit handles, canvas placement, typography, copy/paste, duplication, portable projects and undo are integrated. Legacy attached captions remain supported and can be converted explicitly. Shortening an animation interval keeps live values consistent with reload normalization. Active text shares a bounded raster allocation; inactive tracks release their large canvases.

Simple mode offers evenly spaced camera pose slots within each media scene. Selecting a slot edits the corresponding camera key. Changing the number of slots or switching modes preserves Advanced keys and their easing. Both timeline views use absolute project time, including gaps. See [workflow details](workflow-0.13.0.md).

Unused-media cleanup uses browser-held tab locks, persistent reference manifests, and one atomic storage scan. Saved projects, unindexed project records, drafts, autosaves, templates, pending imports and tab-lifetime undo sources retain their bytes. New orphans must be observed on separate openings at least seven days apart before deletion; each opening has bounded work. Unsupported lock APIs, damaged metadata or pinning failures defer cleanup. Pre-protocol media records are deliberately excluded from automatic deletion; reading them never opts them in. The exact historical-tab compatibility boundary and storage tests are documented in [media reclamation](media-reclamation-0.13.0.md).

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint` and a production build. The release also includes real-browser scene exports, text workflows, storage concurrency cases, shadow-boundary comparison and image/video export tests. Final integration passed 204 application tests, six MCP automation tests, TypeScript, ESLint and the production build. Twelve scene/control captures, all three browser engines (Chrome, Firefox and WebKit), 12 independent-text checks, 19 cleanup checks, 14 ownership checks and 11 existing editing checks passed. Five final Mac16 front/rear/lid captures match the validated seam repair. Strict native-decoded MP4/WebM exports preserve all eight expected frames, audio timing and transparency; cancellation leaves no temporary files and resizing restores the preview. See [display seam evidence](display-seams-0.13.0.md) and the [Opus parser audit](opus-parser-0.13.0.md).

Relevant reproducible scripts:

- `scripts/test-scene-fidelity.mjs` — matched device/scene exports and light-control variants.
- `scripts/test-screen-glass-gpu.mjs` — numerical physical glass composition.
- `scripts/test-text-tracks-browser.mjs` — overlapping text, timeline gestures, camera slots, persistence and PNG pixels.
- `scripts/test-media-reclamation-browser.mjs` — multiple actual tabs and IndexedDB, including rollback and migration.
- `scripts/test-shadow-boundary-browser.mjs` — the guard corrects visible boundary pixels while preserving useful device/shadow regions. The revised lower-energy key changes the artifact's peak contrast; the test still requires over 100 pixels corrected by more than 5/255.
- `scripts/browser-matrix.mjs`, `scripts/test-workflow-editing-browser.mjs`, `scripts/test-workflow-browser.mjs`, and `scripts/export-regression.mjs` — existing browser, editing, ownership and export coverage.

## Remaining differences

New detailed MacBook Neo, base iPhone 17, current Android devices, iPad Air, MacBook Air and Watch Ultra 3 assets are not silently substituted with older meshes. Public metadata was rechecked, but original distributable files were not available through the configured download flow. The missing models and intake requirements remain listed in [hardware sources](missing-hardware-assets.md).

Text position keyframes, general indirect illumination and path-traced output remain outside this implementation. The renderer still uses bounded real-time approximations. UltraMock's paid Studio/Concrete/Dark Room scene exports were not accessible in the inspected guest session, so the matched PNG comparisons in this release are Mok before/after comparisons. UltraMock's private shaders and complete rendering pipeline remain unverified. No new device asset or proprietary scene was copied.
