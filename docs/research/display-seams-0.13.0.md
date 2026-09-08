# MacBook Pro 16 display seam repair

The thin dashed white rectangle was present in both the supplied baseline and final 0.13 gallery renders. It was an existing coverage defect, not a new reflection feature or a regression introduced by the 0.13 glass BRDF.

An isolated production-page probe distinguished two causes. Moving the display or bezel in depth with polygon offset did not change the seam. Preserving the glass surface while zeroing emissive light outside the media UV window removed the top and side inner dashes. The remaining lower seam was a gap between the shipped `Object_129` black bezel and the lower rim: suppressing bezel reflections did not change it, while temporarily hiding that bezel exposed the silver backing. Diagnostic scaling changed both inner and outer edges and was rejected.

The shader now keeps the original surface opaque outside the media window and suppresses only its emitted media color. Glass reflection and coating remain intact. A Mac16-only black backing fills the source crack behind the original bezel. It follows the measured outer bezel contour, extends only to the measured neighboring lower rim, remains within the original rim bounds, inherits lid motion, and follows scene fog. The existing source positions, indices, UVs, transforms and materials are unchanged. The helper has no shadow casting or receiving, owns its small geometry/material through the existing private-instance resource registry, and is disposed with that instance. Missing, nonfinite, unexpectedly large or differently arranged source geometry rejects this model-specific repair.

Files:

- `src/three/materials.ts`: retain opaque glass coverage; media emission still uses the original UV window.
- `src/three/displaySeams.ts`: guarded Mac16 internal backing derived from the shipped geometry.
- `src/three/devices/GlbModel.tsx`: add the helper after lid detection; leave it out of the general shadow/material preparation.
- `scripts/test-display-seams.mjs`: actual shipped geometry, source immutability, internal bounds, repeat setup, inherited transforms and owned-resource disposal.
- `scripts/test-screen-glass-gpu.mjs`: actual GPU readback of four out-of-window edges and the media center, alongside the existing reflection-energy checks.

The actual Apple M4 Pro / ANGLE Metal shader test reads `(0,0,0,1)` on each outside-UV edge and `(1,0,0,1)` for the red media center, with no GPU error. Existing glass reflectance checks retain the same ~0.04 ordinary-interface and ~0.0165 XDR-interface values. Geometry/disposal tests, TypeScript and targeted ESLint pass.

Matched 1600×900 exports before and after the fix differ at only 1,165 pixels, bounded by `[426,165,968,572]` inside the display perimeter. There are zero changed pixels outside the display region. The central media ROI `[475,240,935,530]` is byte-for-byte identical. The left seam's 114 bright pixels are gone; the top and lower regions lose 261 and 584 bright defect pixels respectively. Evidence: `mac-seam-pixel-comparison.json`, baseline `mac-seam-probe2/base.png`, and fixed `mac-seam-fixed-dev/front110.png`.

Five real app exports exercise front views at lid angles 70°, 110° and 160°, plus rear views at 110° and 160°. The development exports pass with zero errors in `mac-seam-fixed-dev/report.json`; the model exterior remains intact and the ordinary front view has no dashed display seams. The final production rerun is recorded separately below. These are bounded pose checks, not an exhaustive sweep of every camera/lid angle or all GPU implementations.

Final production validation at `http://127.0.0.1:35362`: all five poses passed, version 0.13.0, `passed: true`, `errors: []`, command exit 0. Evidence is `mac-seam-fixed-final/report.json` and its five PNGs. All five production captures match their development captures byte-for-byte (`development-comparison.json`). The production front110 image therefore preserves the same central-media and display-perimeter pixel comparison documented above. No additional app source changes were made after this build.
