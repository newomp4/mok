# Device surface audit and repairs — 7 September 2026

This pass changes `src/three/devices/GlbModel.tsx`, corrects one device display assignment in `src/lib/devices.ts`, adds nine regressions in `scripts/test-device-fidelity.mjs`, and adds optional GPU image regressions to `scripts/render-regression.mjs`. It uses the existing licensed shipped models. No model bytes, positions, indices, texture maps, authored opacity, housing colors, material profiles or physical dimensions were edited.

## Confirmed visual defects

### Flat iPad display produced diagonal reflection scratches

The shipped iPad display (`EjCaatfcGdAQBho`) is geometrically almost planar: PCA measures 0.264759 × 0.197732 m, with only 0.00002261 m thickness. Its imported normals nevertheless vary by roughly half a degree. Under a bright studio environment this becomes distinct diagonal reflective lines through a smooth uploaded image.

A browser A/B experiment replaced only the display normals, leaving camera, geometry, media and lighting unchanged. The scratches disappeared. The large reflected window/grid remained; isolation of the environment and planar mirror confirmed that this grid is the studio HDR, not hidden keyboard geometry.

The implemented repair operates on the already-owned screen geometry clone used for UV projection. It requires relative thickness below 0.02%, every existing normal within 2° of the fitted plane, and a full-vertex thickness check. It transforms the fitted normal correctly through nonuniform and mirrored transforms. Curved glass, bevel normals and opposing faces retain their authored data. Source geometry remains unchanged.

Native Chrome after exports confirm that the lines disappear with the same 59 drawing operations. MacBook 14 also qualifies for geometric normal stabilization, but its normals were already uniform; its representative closeup is visually unchanged. Watch screens are curved and fail the repair guard as intended.

### Separate iPhone cover glass tinted the live screen twice

The iPhone 17 Pro source's `Object_21` / `Glass` is a transparent/transmitting cover above the OLED. The old cover detector required the boxes to intersect in three dimensions; even its closest surface sits about 0.00000226 m above the display, so it was missed. The live display already provides its own clearcoat, making the imported cover an extra attenuation layer.

The detector now recognizes a thin sheet immediately in front of the screen, using actual vertex bounds projected into the screen plane. It requires over 60% projected screen coverage, less than 1.8 times its area, thickness below 2% of the shorter screen edge and a maximum front gap of 1% of the longer edge. Camera lenses, back glass and distant shells fail these tests. Existing overlapping-cover decisions also require actual overlap along the plane normal; this prevents tilted back sheets from being confused with a front cover simply because their device-axis boxes intersect.

Matched 1920 × 1080 exports show:

| Fixture | Before draws | After draws | Result |
|---|---:|---:|---|
| iPhone 17 Pro front | 73 | 71 | Extra tint removed; main cyan probe `[1,189,222]` → `[31,205,240]`, orange `[222,103,2]` → `[240,116,31]` |
| iPhone 17 Pro side | 73 | 71 | Clear screen reflections and colors at a grazing angle |
| iPhone 17 Pro back | 77 | 75 | Housing/camera appearance preserved; only 12 of 2,073,600 pixels differ by more than one channel byte |

The color values are rendered sRGB samples after the existing tone mapper, not a claim of pixel-identical source-image reproduction. All finish and lens material metadata are preserved.

### Watch Series 9 uploaded artwork leaked onto the rear sensors

A production matrix of all ten shipped models from the front and back exposed an existing assignment error: the Watch Series 9 displayed the cyan/orange calibration artwork on its rear health sensor, not only on the display. Three extra meshes had been explicitly assigned the live screen material: `uBMkHzJfTETpPSo`, `hUTWIfJTbVAiNOd` and `hNUadlaBSDpAdCh`. Their geometry includes the black enclosure, rear sensor circles and glass.

A reversible browser experiment restored each original material independently. Restoring all three eliminated the artwork and restored the sensor dots while preserving the actual front display, `rpqLEPlKpASApqb`. The final fix narrows this source's `screenMesh` hint to that display only, so the other meshes also retain their original atlas UVs. No source assets or geometry are modified.

The durable GPU check runs with `MOK_QA_DEVICES=1 MOK_QA_CASES=watch9-display,watch9-sensors node scripts/render-regression.mjs <output>`. It renders the same high-chroma calibration image from the front and rear, requires visible cyan artwork on the front, and rejects cyan on the neutral rear sensor. It was run against both the old production and repaired app: the old build fails with 9,722 rear cyan pixels; the repaired app passes with zero. The source regression separately confirms the exact display selection and unchanged rear UVs/materials.

## Invisible source helpers were consuming rendering and bounds work

Some shipped authoring helpers use fully transparent, zero-opacity, non-transmissive materials. They still participated in model normalization/bounds and ordinary rendering, and could affect passes that override the material. They are now hidden on the cloned instance before visible-only normalization bounds and feature detection.

All material slots must meet the condition. Live display meshes, opaque materials whose unused opacity property is zero, mixed material arrays, positive transmission, and grouping meshes with children are preserved. The original cached scene/materials are untouched. Feature discovery excludes the helpers, so keyboard-case/island toggles cannot re-show them.

| MacBook Pro 16 fixture | Before draws | After draws | Reduction | Pixels differing >1 channel byte |
|---|---:|---:|---:|---:|
| Front | 137 | 101 | 26.3% | 39 / 2,073,600 |
| Back | 116 | 82 | 29.3% | 6 / 2,073,600 |

These sparse differences occur around edges; the exported visible materials, screen light and device shape remain unchanged. Drawing counts represent the complete final capture frame, including auxiliary passes. Timings varied around 90–140 ms on this native GPU setup, so this report claims the measured drawing reduction rather than a universal percentage speedup.

## Validation

- Nine new device regressions pass, including actual shipped iPad and iPhone geometry, source immutability, mirrored/nonuniform normal transforms, curved/bevel/opposite-face rejection, projected front-cover selection, Watch curvature, zero-opacity transmission/multi-material/child guards and Mac16 feature-toggle exclusion.
- All eight existing screen-light regressions pass, including actual Mac14/Mac16 receiver selection and shader composition.
- TypeScript and lint for the changed files pass.
- Native Chrome 152.0.7977.76 on macOS, 1920 × 1080 opaque PNG exports, fixed camera/media/lighting, no effects or contact shadows. Baseline production `f8debac` ran at `127.0.0.1:35362`; current source ran at `localhost:35361`.
- A production matrix covers all ten shipped GLBs from front/back, plus iPhone finish, iPad keyboard case on/off and Mac16 lid 20°/140° variants (25 exports). It checks finite position/normal/UV/transform data, hidden alpha-zero helpers, repaired iPad normals and the iPhone cover. All cases produced valid 1920 × 1080 PNGs without browser errors. Visual review exposed the Watch9 assignment issue above, which was then repaired and checked with the dedicated failing-before/passing-after image regression. The Watch Ultra remains unchanged.

Local audit artifacts (outside the shipped repository) are in the workspace's `work/visual-012-baseline`, `visual-012-after`, `visual-012-cover`, `visual-012-rearglass-before`, and `visual-012-helper-after` directories, each with PNGs and a JSON capture report. `visual-012-pixel-comparison.json` holds matching pixel metrics. The fixture scripts are `work/visual-012-baseline.mjs` and `work/visual-012-rearglass.mjs`. The scene uses the default Brown Photostudio HDR, custom `#303238` background, reflection 0.45, gloss 1, intensity 0.85, environment yaw 120°, screen brightness/spill 1 and contain-fitted calibration artwork. The scratch harness's old `lighting: "studio"` token resolves to that default HDR in both runs.

## Deliberately preserved behavior

The strong studio window reflection is a real environment reflection. Existing authored normal and roughness maps on device housings, keyboards and watch bands remain untouched. This pass does not globally flatten materials, alter glass curvature or add expensive reflection passes. The negative-determinant material branch was inspected, but none of the ten shipped sources use it; removing or expanding that branch would not deliver a current visual benefit.

Production matrix artifacts are in `work/visual-012-production-matrix` (including `matrix-contact-sheet.png` and `report.json`). The final Watch9 actual-app pair is in `work/visual-012-watch9-fixed`. The durable image-regression evidence is in `work/watch9-regression-before` (expected failure) and `work/watch9-regression-after` (pass). The matrix also observed 11 hidden Mac16 helpers and eight hidden iMac helpers, with no visible helper resurrection after finish, case and lid changes.
