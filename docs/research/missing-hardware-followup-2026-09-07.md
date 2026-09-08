# Missing hardware intake follow-up — 2026-09-07

This bounded check follows `missing-hardware-assets.md`. No model was added or relabeled. No paid assets, private viewer payloads, browser-session credentials, or protected UltraMock assets were used.

## Fresh official verification

Public official Sketchfab metadata is reachable even though a normal fetch of the Neo presentation page returned HTTP 403. On 2026-09-07:

| Candidate | Official metadata | Verified fields | Remaining blocker |
|---|---|---|---|
| rtql8d MacBook Neo | [Public model metadata](https://api.sketchfab.com/v3/models/266970634d9a435fa4589efe326b25d6), [author listing](https://sketchfab.com/3d-models/macbook-neo-266970634d9a435fa4589efe326b25d6) | Downloadable; CC BY 4.0; 17,722 faces. Author listing dates the model 2026-03-14. | The official original-download flow needs an explicitly provided account token. No token is configured in this task; no archive was obtained. Dimensions, ports, screen/lid separation and original materials still need inspection. |
| NS.jjones iPhone 17 | [Public model metadata](https://api.sketchfab.com/v3/models/2aa1d2dbe89d43c39ca8f33c72ab6aab), [author listing](https://sketchfab.com/3d-models/iphone-17-2aa1d2dbe89d43c39ca8f33c72ab6aab) | Downloadable; CC BY 4.0; 134,468 faces. | Same original-download token requirement. The prior listing's orange description still makes exact base-versus-Pro identity uncertain; do not promote from the title alone. |

The metadata's license points to [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), which permits redistribution with its attribution requirements. The source acquisition blocker is account-mediated original download and subsequent geometry inspection, not a claim that these two listings prohibit redistribution. The existing `scripts/fetch-sketchfab.mjs` supports that official workflow with an explicitly configured token, license/downloadability validation, safe archive intake, provenance and attribution. It does not recover tokens from browser sessions.

The fresh search also found a [Meshy community “Iphone 17”](https://www.meshy.ai/3d-models/Iphone-17-v2-019d83c0-6466-734f-8a6f-e89dc2933926) labeled Meshy 6 and CC0. Its public page provides no dimensional or exact-model accuracy evidence. It was not acquired or substituted for a detailed real device merely because of its title/license.

No additional freely redistributable, complete, exact Galaxy S26 Ultra, Pixel 10 Pro, Watch Ultra 3, current iPad Air or MacBook Air archive was verified in this follow-up. Free case meshes, product photographs, paid royalty-free models, and intentionally simplified no-port models do not fill that requirement. The detailed candidate table and exclusions in the earlier report remain the appropriate inventory; this follow-up strengthens the two public metadata checks rather than asserting catalog completion.
