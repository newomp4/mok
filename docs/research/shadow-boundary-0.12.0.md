# VSM floor boundary repair — 0.12.0

The studio caption fixture at zoom 0.5 and camera (-15, 10) reproduced a detached diagonal shadow at the lower right. It persisted with detail shadows disabled.

Installed Three r185's VSM path includes receiveShadow meshes in its depth pass. Its separable variance blur clamps samples to the shadow map border. On the sloping depth of the studio sweep, these one-sided samples falsely shade the receiving floor at that boundary. Removing floor depth eliminated the line but changed the useful penumbra; multiplying blur by 2–4 largely removed the real laptop shadow. Increasing the depth range alone did not remove the line; expanding the XY range moved it.

The shipped fix keeps the existing floor contribution and its soft shadow. SoftFloor's material excludes the outer blur-kernel strip from VSM reception, where the clamped moments are invalid. The fitted directional camera reserves the complete kernel around the caster and floor projection when maximum softness exceeds the existing padding. It preserves the sweep's enlarged geometry, repeated/offset texture mapping, renderOrder -100, inherited environment intensity, and all non-VSM shadow branches. It adds no GPU resources.

Validation completed before final production build:

- TypeScript, targeted ESLint and diff whitespace checks pass.
- 12 asset and boundary tests pass. The new tests verify shader composition and fitted caster/floor bounds at three softness values, three map resolutions and three light directions; repeated calibration cannot drift.
- Actual caption PNG and MP4 renders completed. Compared with the original opaque no-AO image, the detached-line ROI changes by up to 34/255; the intended shadow ROI has mean absolute change 0.069/255 and the device ROI about 0.007/255. The dev session logged a truncated Next chunk while the server changed, so this is visual/numeric evidence, not a clean final browser run.
- `scripts/test-shadow-boundary-browser.mjs` performs the final same-page guarded/unguarded comparison with the real capture pipeline, exporting both PNGs and a JSON pixel report. It mutates the floor shader only in its isolated test browser and restores it in finally.

Artifacts: `caption-render-shadow-fixed/studio-behind.png`; controlled probes `shadow-floor-probe/` and `shadow-floor-range-probe/`.

Final stable production validation passed on http://127.0.0.1:35362 with zero browser or WebGL errors. Same-page guarded/unguarded exports prove 1,132 artifact pixels brighten by more than 5/255 (maximum 34); the intended soft-shadow ROI changes by only 0.03386/255 on average and every device ROI pixel is identical. Report and PNGs: `shadow-boundary-012-final/{report.json,original.png,fixed.png}`. No app files changed after the final build freeze.
