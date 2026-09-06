# Mac screen lighting and renderer fixes

September 6, 2026 · mok 0.9.0

The previous renderer reflected the keyboard **in the display** and sent an average screen color onto the floor. It did not illuminate or reflect the display onto the laptop keyboard. This release adds that missing interaction.

## What changed

- The live display image lights the keys and contributes a rough, view-dependent reflection across the deck and trackpad. The light follows content UVs, device rotation, video frames, screen brightness, fades and the actual lid transform. It works in every scene.
- **Mockup → Screen → Screen lighting** controls the strength from 0 to 2; 1 is the default, including older projects. Zero disables the new effect. The existing Reflection control still controls reflections in the display.
- Receiving materials retain their textures, roughness, metalness and surface normals. Lid, back, side and underside surfaces are excluded. The shared display texture needs no additional render targets.
- Rough reflection edges are filtered to avoid stepped bands. Near-closed diffuse illumination is bounded by the receiving hemisphere so the numerical approximation cannot overbrighten a white Lambertian receiver beyond the display radiance.
- Imported MacBook hinges now preserve their authored rest rotation and close above the keyboard. The inferred hinge position is calibrated against actual deck and lid vertices.
- Contact shadows clear every frame, exclude camera-mounted transitions and disappear in transparent exports. Reflection passes restore framebuffer, clear, XR and shadow-update state, including failure paths.
- Export waits for each new shot's geometry and effects before capturing its first frame, including cuts that keep the same device. Autofocus and lens-effect bounds update for orientation and keyboard-case changes.

## Verification

`npm test`: 100 passing tests. TypeScript, ESLint, diff checks and the optimized production build pass.

New tests exercise the shipped 14-inch and 16-inch MacBook geometry, lid angles 0/20/90/110/135 degrees, arbitrary device rotation, repeated seeks, UV fitting, live uniforms, borrowed textures, instanced keys, shader composition, source-edge filtering and near-closed energy bounds. Offscreen tests cover clears, overlays, errors and render-state restoration. Export tests cover same-device shot boundaries without extra waits between motion-blur samples.

Browser checks use the production build and synthetic test media: colored, black and white screens; both imported MacBook sizes; keyboard light disabled; brightness zero; display reflection disabled independently; rotated/back-facing devices; lens blur; custom and dark-room scenes; closed and animated lids; and video frames. Procedural laptops share the implementation and instance-transform coverage, but portable project migration selects imported MacBook models, so the procedural visual appearance is not independently claimed as tested here.

Actual exports include an opaque 3840×2160 PNG and a transparent 3840×2160 PNG with alpha from 0 to 255 and no floor reflection or ground shadow.

The complete ten-shot sequence exported as H.264 MP4 at 1280×720, 24 fps: exactly 456 frames and 19.000 seconds, with Low motion blur. Extracted frames confirm colored/black/white source changes, both MacBook sizes, closed and opening lids, changing video content, a clean blurred title and a correct custom-scene cut/tail. The paused preview returns to its original framing after export. This verifies the tested browser and codec; it is not a claim that every browser/GPU combination has been tested.

## Scope

This is a finite-screen lighting approximation, not a general global-illumination or path-tracing renderer. It does not ray trace shadowing between individual keys or arbitrary source-to-surface occlusion. Floor glow still uses average screen color. Asset detail remains limited by the available models.

UltraMock's [official changelog](https://www.ultramock.io/changelog) describes screen-driven keyboard/device illumination and a separate keyboard reflection visible in the display. Its complete shader implementation is not public; this implementation does not claim to reproduce that code or exact calibration.
