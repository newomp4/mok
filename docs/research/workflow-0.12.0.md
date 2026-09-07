# Workflow audit and shot captions — 2026-09-07

This tranche adds one caption to each media shot and fixes reproducible editing defects. The reference's September 7 [changelog](https://www.ultramock.io/changelog) describes independent layered text tracks; Mok's delivered scope is narrower: one caption per image/video shot, with no independent text track, track reordering, multiple simultaneous captions or arbitrary position keyframes.

## Delivered caption workflow

The Caption inspector can enable, edit or remove text; select a font, weight, size, alignment, colour, line height and spacing; choose front/behind device; position the text with horizontal/vertical controls; and choose separate enter/exit animations. Caption rendering reuses the existing text-card typography and effects. Enabling text at an invisible animation endpoint previews a visible frame.

“Position on canvas” opens an explicit positioning tool. Dragging moves the caption without orbiting or zooming the device. A completed drag is one undo. Escape restores an in-progress drag, leaves no empty undo entry and closes the tool; Done keeps the placement. The tool exits on shot/project change, disabled/removed caption, playback, export, modal/crop/Auto-motion opening or lost editing ownership. Secondary pointers cannot replace the active gesture. Its DOM controls are absent from exported pixels.

Caption fields are optional, normalized and accepted only on media shots. Duplication deep-copies caption settings. Splitting and head trimming preserve the original enter/exit phase with `caption.timing = { offset, duration }`; changing Enter or Exit intentionally restarts those animations for the edited shot. Portable projects and autosave retain the typography, placement and layer. Export preloads enabled caption fonts for the relevant time range.

Behind captions render above the room/background and beneath the device; front captions render over the device. This is compositing order, not a physical scene text mesh or a claim of independently tracked reference parity. Root's render audit owns capture/effect-pass and multiple-device visual checks.

## Confirmed defects fixed

- **Read-only shot insertion crashed.** Timeline Add → Shot from camera dereferenced the empty ID returned by the guarded editor store. The action now exits cleanly, with no project or timeline mutation.
- **Failed uploads created duplicate shots.** A valid image followed by a corrupt PNG left a new shot displaying the previous image, while reporting both files imported. Upload batches now decode first, skip failures, apply accepted items together and produce accurate counts. One undo restores the batch.
- **Uploads could outlive their target.** Media upload, paste, scene/screen background imports and sample-screen generation now capture their project, target and editing lease. Background imports also track their background configuration; samples track the device/orientation used to rasterize the source. Switching away and back, replacing then restoring a source, or losing ownership permanently cancels the pending edit and releases decoded media that was not attached.
- **Screen crop ignored device orientation.** The crop aspect now uses the upright display, uniform padding and content beneath browser chrome. The reproduced 1200 × 800 landscape-phone source now crops to approximately 1200 × 552, rather than 368 × 800. Applying a crop rechecks the original target before committing and cleans up a cancelled result.
- **New shots lost scoped settings.** New media shots inherit independent copies of padding/effects together with the existing device/scene overrides and closing camera pose.
- **Head trims reset a split source fade.** The Timeline head-trim gesture now advances the source-audio envelope offset from its original pointer-down snapshot. Caption phase follows the same rule. Repeated pointer moves do not compound the offset.
- **A cancelled drag could consume undo/redo.** An interaction whose document returns to its original values, apart from `updatedAt`, no longer adds an empty undo entry or clears redo.

## Verification

`node --test scripts/test-workflow.mjs scripts/test-product.mjs scripts/test-io.mjs` covers 15 workflow tests, 11 product tests and the IO regression file. It verifies normalization/migration, split/duplicate/undo, source fade equivalence after head trim, crop geometry for orientation/padding/browser chrome, failed decode batches, target cancellation and cleanup (including deferred background decode, rejected media types, sample generation and source/device/orientation changes), scope inheritance, caption positioning guards and no-op history.

`scripts/test-workflow-editing-browser.mjs` is a disposable Chromium test using the installed `automation/node_modules` Playwright runtime and software WebGL. It performs real menu/control/pointer actions and actual image decode/crop; reads the app's debug state to assert the results. The split/trim fade check exercises timeline metadata; audible source mixing is covered by the export/media agent's tests. The browser script does not claim exhaustive verification of all fonts, every touch device or every output format.

Development verification and screenshots are in `work/workflow-editing-dev/` (beside the repository). The initial defect captures are in `work/workflow-0.12-baseline/`. On the stable 0.12.0 production build at `http://127.0.0.1:35362`, all 11 editing checks passed with no page errors; artifacts are in `work/workflow-editing-prod/`. The existing same-context multi-tab suite (`scripts/test-workflow-browser.mjs`) also passed all 14 checks with no page errors; artifacts are in `work/workflow-ownership-prod-012/`. Together these cover 25 real-browser checks. The split/trim check uses envelope metadata on its disposable timeline fixture; audible export remains separately validated.
