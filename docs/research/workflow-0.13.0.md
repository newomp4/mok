# Independent text tracks and Simple camera poses — 2026-09-07

This release adds independent, overlapping text tracks in both timeline modes. The existing full-frame text scenes and attached shot captions remain compatible. The reference's September 7 public changelog describes layered text tracks; these changes address that functional gap without claiming identical internal implementation.

## Independent text workflow

Timeline Add → Text creates a text overlay with its own absolute start and duration. It can overlap other text, cross a media scene boundary, occupy a scene gap or extend beyond the media sequence. Each overlay has a named row. Dragging the bar moves it; edge handles trim it; triangle handles adjust enter and exit animation durations. Holding Shift during a time drag permits millisecond positioning instead of tenth-second snapping. The inspector also offers numeric start/duration controls.

Rows above the device scenes render in front; rows below render behind. Dragging a row onto another row sets its layer and relative order. Dropping onto the named layer divider changes sides. The row's arrow button and inspector's Layer, Bring forward and Send backward controls provide alternatives. Array order is back to front within each side. Hiding text keeps its timing and metadata for later use.

The text inspector supports font, weight, size, alignment, colour, line height, letter spacing, position, and separate enter/exit effects. Position on canvas targets only the selected overlay. Completed canvas and timeline gestures create one undo; cancelled gestures restore their initial values. Editing guards cover project switches and ownership changes. Copy, paste, duplicate, delete, autosave, portable projects and undo retain independent text metadata.

Head trimming preserves the existing enter-animation phase. Tail trimming places the exit animation at the new end. Editing the inspector's Duration or Enter/Exit intentionally starts a new animation interval. Attached legacy captions retain their existing split/trim phase and can be converted with Make independent track; conversion removes the attachment and creates a matching absolute track in one undo. Full-frame text scenes remain available as Add → Text scene.

Text is composited above the background/room and either behind or in front of the device. It remains camera-facing graphic text, not physical scene geometry. Captions above full-frame text/logo scenes follow the same compositing order. This release does not introduce arbitrary text-position keyframes or multiple soundtrack lanes.

## Simple camera poses

Simple mode keeps one scene row and adds equal camera pose slots inside each media scene. Select a pose slot, then change the camera controls or a camera preset. Slots include the scene's start and end; the number of slots is adjustable from 2 to 12 in the Camera inspector. An empty camera property receives endpoint holds plus the edited slot; an existing animation edits or inserts only the selected key. Other keys and their easing handles remain unchanged.

Changing slot count changes editing locations only. Switching Simple/Advanced does not resample or delete keys. Existing Advanced keys remain visible in Simple's compact key lane and continue to influence motion. Both modes now show the actual project clock and preserve gaps, which keeps independently timed text and audio aligned.

## Persistence and render integration

`Project.textOverlays` is optional, with stable unique IDs, start/duration bounds, normalized typography and animation metadata. Old project files remain valid. Extending visual content grows the playback endpoint within the existing three-minute project limit; trimming/removing tracks retains that endpoint. Moving/reordering media scenes does not silently retime independent text.

The existing CaptionLayer mount renders all text records, evaluating activity from the export/preview clock each frame. Inactive tracks retain only tiny rasters; active text shares a 16-megapixel raster budget and the current GPU texture limits. All text uses the existing Caption overlay material name for effect-pass glyph masking. Export font preloading includes only enabled text that intersects the output range.

## Verification

`node --test scripts/test-text-tracks.mjs` passes ten focused regressions: normalization and legacy compatibility, half-open overlap/font scope, conversion/undo, independent timing and project duration, copy/paste/order/portable values, trim phase, lossless camera slots, empty-track pose editing, read-only/project-switch positioning guards, and identical animation state before/after reopening severely shortened text.

`scripts/test-text-tracks-browser.mjs` exercises actual text creation, typography, overlapping rendering, layer buttons and row dragging, time movement/trimming, animation handles, canvas positioning, Simple camera edits, mode switching, reload, portable import, deletion/undo, inactive raster release and PNG pixel checks. On stable production 0.13.0 at `http://127.0.0.1:35362`, all 12 browser checks pass, with zero page or console errors. The PNG check verifies glyph pixels from both simultaneous text tracks; hidden tracks release full rasters at their own end. Artifacts and the completed report are in `work/text-tracks-prod/` beside the repository. Development runs were interrupted by hot reloads; two strict selector corrections were confined to the test harness.

The broader workflow set (`test-text-tracks`, `test-timeline`, `test-workflow`, `test-product`, `test-io`) passes 72 tests. TypeScript, targeted ESLint and diff whitespace checks pass. The root release validation owns the full renderer/browser matrix.

`scripts/capture-text-tracks-demo.mjs` also exports a 1600×900 phone demo with three simultaneous front/behind text tracks and captures desktop plus 390-pixel mobile inspector layouts. The viewed artifacts are `text-track-demo.png`, `text-track-demo-ui.png` and `text-track-demo-mobile.png` in the same output directory. That run reported no console/page errors and no horizontal page overflow.
