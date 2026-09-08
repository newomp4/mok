# Display glass and spotlight calibration — 2026-09-07

This pass changes two demonstrated rendering problems. It does not replace model geometry, flatten authored metal materials, alter finish colors, or claim knowledge of UltraMock's private shaders.

## One physical display reflection

The 0.12 display combined the environment's physical reflection with an additional planar mirror after the BRDF. A nearby surface therefore added light without occluding the environment behind it. The underlying display also retained a second dielectric specular response beneath its clearcoat.

The local mirror now supplies scene-linear radiance and coverage before Three's indirect-specular BRDF. Covered directions replace the environment; uncovered directions keep it. Its antialiased RGB is already premultiplied, so coverage is applied to the environment only, rather than multiplying the mirror RGB by alpha a second time. The existing Reflection control still controls both contributions. The clearcoat is the single glass interface over the emissive image, with the physical Fresnel response controlling grazing angles.

Two narrowly scoped coating profiles reduce frontal glare without pretending that standard glossy glass is the optional nano-texture finish:

| Display | Normal-incidence F0 | Evidence |
|---|---:|---|
| Pro Display XDR | 0.0165 | Apple's [February 2020 technology overview, Cover Glass](https://www.apple.com/pro-display-xdr/pdf/Pro_Display_White_Paper_Feb_2020.pdf) specifies 1.65% on-axis reflection for standard coated glass. |
| iPad Pro 13-inch | 0.02 | An artist calibration. [M4 technical specifications](https://support.apple.com/en-us/119891) confirm an antireflective coating but do not give this percentage. The older iPad's published 1.8% is not attributed to the M4 model. |
| Other current displays | 0.04 | Existing ordinary-glass interface; no unsupported device-specific optical claim. |

All profiles retain clearcoat roughness 0.04. Coating updates use the displayed model's layout and stable uniforms, including during staged device loading. Source media textures remain borrowed, and source model maps/materials are untouched.

`scripts/test-screen-glass-gpu.mjs` renders the actual physical shader into a half-float target. Native Chrome / ANGLE Metal on Apple M4 Pro measured:

| Scene-linear probe | RGB value |
|---|---:|
| Unit-white environment, ordinary glass | 0.039978 |
| Same unit-white local surface replacing the environment | 0.039978 |
| Half-covered premultiplied local surface over the same environment | 0.039978 |
| Opaque black local occluder over the white environment | 0 |
| Previous additive formulation, same white inputs | 0.073547 |
| XDR coating, same white input | 0.016495 |
| Reflection disabled | 0 |

The suite also checks a profile switch back to ordinary glass, a local reflection without an HDR environment, shader compilation and GPU error state. These values establish the energy/coverage correction independently of scene styling.

### Matched image evidence

Workspace captures are in `work/visual-013-glass-baseline` (0.12 production), `work/visual-013-glass-oldsame` (old shader in the current scene), and `work/visual-013-glass-new`. Four 1920×1080 fixtures use the same neutral custom background, Default HDR, intensity 0.85, light yaw 120°, Reflection 0.45, no post effects/contact shadow, and identical uploaded artwork. The same-current-scene comparison isolates the material from concurrent scene changes.

The XDR comparison changes 510,678 pixels by more than one byte, with a maximum channel difference of 53, principally removing glare over the screen. The iPad's change is subtler at this particular angle (139,756 pixels, maximum 8). Screen-to-keyboard blue/orange separation remains visible on the Mac16 at a 70° lid opening. Draw counts remain 59 for iPad, 28 for XDR, 101 for Mac16, and 71 for iPhone 17 Pro. These are fixture counts, not a general performance claim.

A separate Studio screen-band probe preserved the band with both planar reflection and HDR disabled independently. It identified the direct area-light reflection, which the scene pass then addressed through source placement. No roughness change was used to conceal that scene-lighting issue.

## Spotlight precision: stepped palm-rest patches

The DarkRoom Mac14 export contained several large polygon-shaped dark patches across the palm rest and trackpad. Isolation retained the artifact with screen spill, its blocker mask, diffuse spill, reflected spill and normal-map strength disabled. Disabling only the spotlight or forcing shadow maps off inside the actual render removed it. A preliminary flag set before export was invalidated by React's export commit. The final harness forces the setting during rendering and explicitly rebuilds material programs: toggling `gl.shadowMap.enabled` alone does not invalidate Three's cached shader defines. Both conditions are required for a true shadow-off comparison.

Directional shadows already fitted their depth range, but perspective spotlights retained Three's default near plane of 0.5 while far followed the much larger light distance. A runtime test moving near to one quarter of the light-to-subject distance removed the stepped self-shadowing without disabling shadows.

The final calibration fits the spotlight near plane conservatively using the light-to-subject distance, closest visible caster, and scale-dependent padding. It retains the authored falloff distance and existing small receiver offsets. The first shadow draw now uses the actual spotlight angle/aspect when calculating texel coverage, matching `SpotLightShadow.updateMatrices` rather than temporarily using its default field of view. No geometry, material relief, caster eligibility, source positions, normal bias multiplier, or shadow opacity was changed to hide the defect.

`scripts/test-assets.mjs` checks scaled devices and articulated lid bounds, that the fitted camera keeps all caster depths, that normal bias remains small, and that Three does not replace the projection on the first draw. Existing directional boundary tests continue to pass. `scripts/test-spot-shadow-browser.mjs` captures the shipped Mac14 in DarkRoom and Concrete using the final calibration, the legacy near plane, and disabled shadows. It checks that the current shadow pass remains active, measures the reduction in DarkRoom palm-rest steps, and compares with disabled shadows to verify retained keyboard/lid shadow pixels.

After-fix scene images in `work/visual-013-shadow-fixed` show clean DarkRoom and Concrete decks. Final production 0.13.0 checks in `work/visual-013-spot-production` pass: the DarkRoom palm-rest step count drops 340→183, while 2,354 subject pixels still differ from a true shadow-off image. Concrete drops 369→217 with 4,559 retained shadow pixels. Both cameras have active shadow maps and fitted near planes 7.19/7.14; draw counts remain 257/202. The test uses the same image, viewpoint, scene and renderer for its three variants.

The independent `scripts/test-spot-shadow-gpu.mjs` provides a controlled positive shadow fixture with our calibration, VSM 1024, spotlight angle 0.6, distance 44 and fitted near 4.5. With explicit shader invalidation between modes, a cube shadows 1,143 pixels (maximum 105/255), and key-height blockers plus an upright lid shadow 1,399 pixels (maximum 135). GPU error is 0. Raw report: `work/visual-013-spot-gpu.json`. The test does not claim that the legacy camera loses every shadow; the real Mac14 exports establish the stepped-artifact regression. Early probes that omitted shader invalidation were diagnostic only and are not the final evidence.

The physical glass readback suite also passes in `work/visual-013-glass-gpu-production.json`.

## Validation and scope

- Device fidelity: 10 tests, including stable coating uniforms and borrowed-media ownership.
- Screen light: all 8 existing geometry, energy, material-composition and Mac14/Mac16 receiver tests pass.
- Asset/shadow calibration: 11 tests; directional shadow-boundary tests: 2; renderer integration tests: 29.
- TypeScript and targeted ESLint pass. Runtime assets, model profiles, and metal textures are unchanged by this pass.
- Remaining approximations include RGB-neutral coatings, a sharp planar local-reflection map, and bounded screen-light quadrature/heightfield occlusion. This is not a spectral thin-film or general path-traced renderer.
