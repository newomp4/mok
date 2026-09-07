# Mok 0.12.0 — realism and reliability pass

This release improves visible screen fidelity, contact shadows and room continuity, adds captions to device shots, and fixes reproducible editing/export failures. It continues the UltraMock comparison with a fresh review of its [September 7 changelog](https://www.ultramock.io/changelog) and the live free editor. It does not claim complete feature or rendering parity.

## What changed

- Contact shadows select the nearest underside using depth testing, rather than depending on mesh draw order. Three independently filtered height bands keep nearby contact tight and soften/fade higher surfaces. Half-float buffers retain faint coverage; the blur target needs no depth attachment. This is an area-shadow approximation, not ray tracing. Softness no longer changes the custom contact camera's coverage or height range. All shadow layers reach zero opacity.
- Room floors extend beyond the fog fade, removing the straight finite-plane boundary in wide Concrete/Dark Room compositions. Their material tiling and central light pool retain their physical scale. A VSM receiver boundary guard removes a separate detached diagonal shadow strip on the studio floor; blur-aware camera padding keeps the device's projected shadow inside valid samples. The production A/B test corrects 1,132 artifact pixels, with exactly unchanged device pixels and only 0.034/255 mean change in the intended soft-shadow region.
- Nearly planar imported displays receive a guarded normal repair on their private geometry clone. This removes diagonal iPad reflection facets. The existing studio-window reflection remains. A screen-plane cover test removes the duplicate iPhone 17 Pro glass attenuation. Fully invisible, non-transmissive source helpers no longer enter bounds/shadow/render work. Watch Series 9 media is restricted to its actual front display, preserving the rear sensor and enclosure.
- Each media shot can have one caption with typography, front/behind placement and enter/exit animation. An explicit canvas placement mode separates dragging from device orbit, supports center snapping, and exits safely. Captions retain their animation phase across splits/head trims, persist in portable projects and autosave, preload fonts for export, and participate correctly in image/video captures. Room meshes sort before behind captions; detail masks preserve glyph alpha rather than masking the entire frame.
- Crop to Screen uses orientation, uniform padding and browser chrome. File batches decode before insertion, skip corrupt files with accurate counts, and undo together. Pending imports cannot outlive their project/source/editing lease. New media shots inherit scoped effects/padding. Read-only Shot from camera is guarded, head trims preserve source-audio envelopes, and cancelled drags preserve undo/redo.
- Export budgeting uses the visible frame or selected range and enabled effects. Failed DOM video seeks reject stale frames; missing sources produce recoverable errors. Audio presence checks avoid expanding huge short-clip loops. Bloom retains opaque color while giving transparent glow independent coverage; disabled bloom releases its large pyramid.

## Verification

The final integrated results and copied visual artifacts are recorded in the workspace output report. Repository tests are reproducible with:

```sh
npm test
npm run typecheck
npm run lint
node scripts/test-contact-gpu.mjs
node scripts/test-caption-render.mjs
node scripts/test-shadow-boundary-browser.mjs
node scripts/browser-matrix.mjs
node scripts/test-workflow-editing-browser.mjs
node scripts/test-workflow-browser.mjs
node scripts/export-regression.mjs
```

The browser scripts require Playwright, a running local Mok server and, for decoded media tests, FFmpeg. `MOK_QA_NODE_MODULES` can point at `automation/node_modules`; `MOK_QA_URL` selects the server. Use `localhost` for Next development, or the production server's bound address. Contact GPU tests also support `MOK_QA_ENGINE=firefox` or `webkit`; `MOK_QA_CHANNEL=chrome` selects installed Chrome for Chromium.

The numerical contact fixture reproduces the old draw-order defect (maximum coverage difference about 0.837), then verifies zero difference with the new depth selection. The raised fixture has a wider footprint and approximately one-third the peak contact density. Chrome/Metal, Firefox and WebKit pass the same checks without GPU errors.

Further evidence and safeguards are in [device fidelity](device-fidelity-2026-09-07.md), [workflow/captions](workflow-0.12.0.md) and [export/media](export-0.12.0.md).

## Remaining scope

UltraMock's latest layered text feature supports independent text tracks and multiple simultaneous captions. Mok now supports one caption per media shot; independent overlay tracks, arbitrary caption position keyframes and dragging captions between timeline layers remain future work. Render fidelity still depends on the source model: procedural devices do not acquire the detail of a newly licensed high-quality model through shader changes. Contact shadows, bloom coverage and screen/floor reflections remain bounded real-time approximations, with no general indirect-light solver or path-traced output.

The audit covers named fixtures and browser engines, not every GPU, mobile device, damaged file, font or combination of effects. No private UltraMock assets or gated downloads were used.
