# Export/media robustness and quality pass — 0.12

The baseline was `f8debac`. This report covers export and media changes; scene, device and workflow results are recorded in the linked release report.

## Confirmed fixes

- **Scoped quality planning:** `src/export/quality.ts` is shared by `capture.ts` and `components/editor/ExportPopover.tsx`. The picker now counts enabled effects and actual visible still/video shots, including held gaps and tails. Unrelated later depth effects no longer block valid large still captures. The open image picker follows playhead changes. Actual UI test: 5600 × 5600 simple still enabled, later depth shot disabled, returning to the simple shot re-enabled it.
- **Failed native video seeks:** `src/export/videoSeek.ts` rejects assignment errors and decoder errors, bounds retries, removes every listener, and checks that a seek really lands. The previous fallback accepted any still-ready video after a failed seek, even when it still held the old frame. A video disappearing after export preload now produces an explicit missing-source error rather than silently rendering a placeholder or stale frame.
- **Source-audio summary and bounded presence checks:** the export summary recognizes enabled embedded clip audio. `src/lib/audioPlan.ts` checks audio presence without expanding source loops; otherwise a very short, fast-looped video could exceed the mixer segment budget while merely rendering the picker. Actual mixing retains its explicit 100,000-segment safety bound.
- **Caption font readiness:** `src/export/assets.ts` loads fonts for enabled media-shot captions in the actual output range, alongside full-frame text fonts. Disabled/out-of-range captions are excluded.
- **Bloom alpha composition:** `src/three/effects/CompositableBloomEffect.ts` retains the library's exact opaque SCREEN RGB expression but gives bloom its own coverage and combines it with source-over alpha. This avoids interpreting glow radiance through an unrelated tiny shadow alpha. It reuses BloomEffect's existing bounded luminance/MIP targets, with explicit lifecycle ownership in `PostFX.tsx`.

## Verification already completed

- `node --test scripts/test-export-media.mjs`: **16/16 passing**, including scope/budget, caption fonts, failed/stale/error/cancelled native seeks, listener cleanup, and tiny-loop audio presence.
- `scripts/test-io.mjs`: passing, including export-state restoration and scoped missing-media behavior.
- Direct TypeScript and targeted ESLint checks passed during implementation; final stable-tree checks will be recorded below.
- **Baseline actual export** (`export-0.12-baseline/report.json`, production 35362): mixed 640 × 360 MP4 and alpha WebM, four motion samples, depth/off shot boundary, video padding, trim/speed, source audio and interstitial silence. Both files contain **8 decoded frames over 0.65 seconds**. Native PCM verifies audible first/second clips and silent gap. Cancellation, subsequent PNG capture, preview size/time restoration, and zero OPFS leftovers pass.
- **Demanding baseline** (`export-0.12-stress-baseline/report.json`): the same mixed export using MacBook Pro geometry, studio/transparent ground shadow, animated camera and the full effect stack except screen fade. Both codecs decode and recover after cancellation. Individual frames were extracted and visually inspected.
- **Resize during encoding baseline** (`export-0.12-resize-baseline/report.json`): after the first encoded frame, the browser window changed from 1280 × 900 to 1000 × 740. Both videos remained 640 × 360; all 8 MP4 frames were opaque and all 8 WebM frames retained alpha 0–255. Cancellation/recovery passed, no temporary files remained, and the preview recovered to 672 × 378 consistently across CSS, root state and backing raster.
- **Per-effect actual image/failure matrix** (`export-0.12-robustness-{baseline,dev}/report.json`): plain, individual spatial/bloom effects, complete stack, exclusions, broken-image import preserving the current source, explicit missing media failure, state restoration, a trimmed video excluding later missing media, and successful capture after failure. Dev run on `http://localhost:35361` passed without page errors.
- **Native source fixtures** (`scripts/test-media-browser.mjs`): 120fps frame-number decoding, VFR boundaries, rotated 48 × 64 source, backwards/late native Blob-video seeks yielding frames **60, 1, 119**, rate-2 audio shifted from 1000Hz to **2000Hz**, AAC/Opus synchronization with best lag **0 samples**, **0.537-second** MP4/WebM endpoints, transparent source-frame clearing, and **0** temporary OPFS files.
- **Numerical bloom shader** (`export-0.12-bloom-gpu.json`): five actual half-float GPU cases passed. Opaque SCREEN and HDR results match established values; a black shadow with alpha 0.001 plus glow 0.01 produces alpha ≈ 0.01099 rather than dividing that glow through 0.001. Zero glow preserves shadow coverage.
- Disabled bloom shrinks its old export-sized MIP pyramid to 1 × 1 targets; re-enabling lets EffectPass restore the active raster. A 7680 × 4320 pyramid was checked to shrink all six levels to 1 × 1.
- **Actual picker UI** (`export-0.12-picker.json`): simple/current vs later depth rejection and live playhead update all pass.

## Visual and test limitations

- The raw transparent PNG image viewer exaggerated RGB in alpha≈1/255 pixels into an apparently large white lobe. Explicit gray composites (`bloom-on-gray.png` in the baseline/dev robustness folders) show the actual baseline and fixed appearance as faint glow. The correction is improved alpha composition, not removal of an opaque white object visible in every compositing application.
- Bloom with transparency is a compositable approximation: arbitrary future backgrounds cannot be known during rendering. Opaque bloom color is preserved exactly; source-over glow coverage is chosen from radiance so exported RGBA remains meaningful.
- Software Chromium/SwiftShader is a correctness check, not a claim about hardware GPU performance or every browser/codec. Root owns the broader browser/device matrix.
- FFmpeg's known Opus parser EOF diagnostic can appear during WebM probing despite successful frame/PCM decode. Prior packet/native-libopus investigation identified a parser flush diagnostic; native PCM and packet timing checks still pass here. It is not counted as an app error.
- Synthetic failure injection covers rejected seeks and missing media; it cannot enumerate every damaged media file or driver failure.

## Reproduction commands

Run inside `mok/`, with the app already running. For development, use `localhost` rather than `127.0.0.1` because Next's development origin checks can prevent browser initialization.

```sh
MOK_QA_URL=http://localhost:35361 MOK_QA_NODE_MODULES="$PWD/automation/node_modules" node scripts/export-regression.mjs ../export-0.12-final
MOK_QA_URL=http://localhost:35361 MOK_QA_STRESS=1 MOK_QA_RESIZE=1 MOK_QA_NODE_MODULES="$PWD/automation/node_modules" node scripts/export-regression.mjs ../export-0.12-final-stress
MOK_QA_URL=http://localhost:35361 MOK_QA_NODE_MODULES="$PWD/automation/node_modules" node scripts/export-robustness.mjs ../export-0.12-robustness-final
MOK_QA_URL=http://localhost:35361 MOK_QA_NODE_MODULES="$PWD/automation/node_modules" node scripts/test-bloom-gpu.mjs ../export-0.12-bloom-gpu.json
MOK_QA_URL=http://localhost:35361 MOK_QA_NODE_MODULES="$PWD/automation/node_modules" node scripts/test-export-picker-browser.mjs ../export-0.12-picker.json
MOK_QA_NODE_MODULES="$PWD/automation/node_modules" node scripts/test-media-browser.mjs
```

## Final stable-build status — PASS

Production **0.12.0**, `http://127.0.0.1:35362`, passed the final stress and resize run. No further application changes were needed.

- `export-0.12-final-stress/report.json`: MacBook Pro studio scene, complete effect stack except screen fade, video source with embedded audio, gap, trim/speed changes, per-shot padding, depth/off transition, four temporal samples, and browser resize after the first encoded frame.
- Both MP4 and alpha WebM contain **8 fully decoded frames at 640 × 360 over 0.65 seconds**. Every MP4 frame is opaque; every WebM frame retains alpha **0–255**, including the depth/effect transition. Source-audio and gap PCM checks pass.
- Preview CSS, root render size and backing raster all restore to **672 × 378** after the actual window resize. Cancellation and subsequent PNG captures succeed, with **zero temporary OPFS files and zero browser errors**.
- `export-0.12-bloom-gpu-final.json`: all five numerical GPU cases pass on production, including opaque/HDR parity and low-alpha glow coverage.
- Final focused suite: **16/16 tests**. Targeted ESLint and `git diff --check` are clean. Root's production build provides the final integrated TypeScript/build validation.
- Measured software-rendering times under concurrent browser QA were approximately **49.4 seconds for MP4** and **37.8 seconds for WebM**. These are correctness-test timings, not a hardware performance benchmark.

The final clips and PNGs are alongside their report in `export-0.12-final-stress/`. Root owns broader browser, caption and scene/device visual verification.
