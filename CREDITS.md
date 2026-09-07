# Model credits

The files below remain adaptations of their credited authors' models under their original CC Attribution licenses. Mok's 2026-09-06 texture update converts the existing WebP textures to KTX2/UASTC with full mip chains and normalized XYZ normal maps; it preserves source geometry, UVs, nodes, material assignments, and animation data. Earlier geometry optimization uses Meshopt. Runtime changes include screen replacement, optional finish tinting, lid articulation, and material/lighting adjustments. No UltraMock models or textures are redistributed.

- **iPhone 17 Pro** by [Ranguel](https://sketchfab.com/Ranguel) — CC Attribution — https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec
- **iPhone 17 Pro Max** by [MajdyModels](https://sketchfab.com/MG990) — CC Attribution — https://sketchfab.com/3d-models/iphone-17-pro-max-87fc1df741384124a8ce0226d2b2058d
- **iPhone 16 Pro Max** by [MajdyModels](https://sketchfab.com/MG990) — CC Attribution — https://sketchfab.com/3d-models/iphone-16-pro-max-41a071ae12794b668502f58d1e0fd1a3
- **2021 Macbook Pro 14" (M1 Pro / M1 Max)** by [akshatmittal](https://sketchfab.com/akshatmittal) — CC Attribution — https://sketchfab.com/3d-models/2021-macbook-pro-14-m1-pro-m1-max-f6b0b940fb6a4286b18a674ef32af2d3
- **macbook pro M3 16 inch 2024** by [jackbaeten](https://sketchfab.com/jackbaeten) — CC Attribution — https://sketchfab.com/3d-models/macbook-pro-m3-16-inch-2024-8e34fc2b303144f78490007d91ff57c4
- **Ipad pro 13in silver m4** by [polyman Studio](https://sketchfab.com/Polyman_3D) — CC Attribution — https://sketchfab.com/3d-models/ipad-pro-13in-silver-m4-8a113340443e49d3b905ab9f0b45efd6
- **Apple Watch Ultra 2** by [polyman Studio](https://sketchfab.com/Polyman_3D) — CC Attribution — https://sketchfab.com/3d-models/apple-watch-ultra-2-f33263c457664b43909200c5ed5e6fa2
- **Apple Watch Series 9** by [polyman Studio](https://sketchfab.com/Polyman_3D) — CC Attribution — https://sketchfab.com/3d-models/apple-watch-series-9-b6d698e718bb425a97057767f0cede47
- **iMac 24" M1 Green (2021)** by [Kanedog](https://sketchfab.com/Kane33) — CC Attribution — https://sketchfab.com/3d-models/imac-24-m1-green-2021-0cfe04fb7123492ab96664877607333f
- **Apple Pro Display XDR** by [polyman Studio](https://sketchfab.com/Polyman_3D) — CC Attribution — https://sketchfab.com/3d-models/apple-pro-display-xdr-7e92cfb7c84d41f886c7748be6c567da

## Lighting environments

Original HDR environments from [Poly Haven](https://polyhaven.com/license), licensed **CC0-1.0**. Both existing 1K fallbacks and original 2K variants are included. The 2K files were acquired directly from Poly Haven on 2026-09-06, without exposure or orientation changes. Download URLs and SHA-256 checksums are recorded in `public/hdri/2k/manifest.json`.

- [Brown Photostudio 04](https://polyhaven.com/a/brown_photostudio_04) — Sergej Majboroda.
- [Studio Small 09](https://polyhaven.com/a/studio_small_09) — Sergej Majboroda.
- [Neon Photostudio](https://polyhaven.com/a/neon_photostudio) — Sergej Majboroda.
- [Blue Photo Studio](https://polyhaven.com/a/blue_photo_studio) — Sergej Majboroda.
- [Photo Studio 01](https://polyhaven.com/a/photo_studio_01) — Sergej Majboroda.
- [Studio Small 03](https://polyhaven.com/a/studio_small_03) — Greg Zaal.

## Asset tooling

Texture conversion uses [Khronos KTX-Software 4.4.2](https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2) and Sharp 0.34.5. Source data is preserved by `scripts/ktx-models.mjs`; reports in `docs/research/assets/` record dimensions, formats, mip counts, sizes, and checksums. Tool binaries and intermediate source backups are not shipped with the application.
