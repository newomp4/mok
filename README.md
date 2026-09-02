# mok

Turn product screens into premium 3D mockups and videos, entirely in the browser.

mok is a self-hosted device-mockup editor: drop a screenshot or a screen recording onto a
procedurally built iPhone, iPad, MacBook, Apple Watch, Studio Display, iMac or flat card,
light it with studio HDRIs, animate the camera on a keyframe timeline and export stills up to
8K or frame-exact MP4 / WebM video up to 4K 60 fps with motion blur. Nothing is uploaded — all
rendering and encoding happens locally with WebGL and WebCodecs.

## Features

- **10 photoreal device models** (CC-BY glTF from Sketchfab, credits in `CREDITS.md`): iPhone 17 Pro,
  17 Pro Max, 16 Pro Max, iPad Pro 13" on Magic Keyboard, MacBook Pro 14" / 16", Apple Watch Ultra 2 /
  Series 9, iMac 24", Pro Display XDR — the screen is detected automatically, mapped at the device's
  true aspect and aligned to the camera, so a native screenshot fits exactly
- **Flat card and browser window** for plain screenshots; parametric fallbacks for every device remain
  in the code (hidden from the picker)
- **Finishes** per device (Cosmic Orange, Deep Blue, Lavender, Sage, Midnight, Starlight …)
- **Scenes**: custom (any background), Studio cyclorama, Concrete dark, Dark room, Gallery — with real
  shadow-mapped lighting on the 3D sets and contact shadows on the custom scene
- **6 lighting rigs** from CC0 Poly Haven HDRIs, rotatable and keyframeable
- **Backgrounds**: solid color, 12 mesh-gradient presets, your own image with blur, or transparent
- **Camera**: orbit / zoom / pan directly in the viewport, six presets, FOV, roll
- **Blur**: radial or linear focus blur with bokeh, or true depth of field with a placeable focal point
  (drag the pad or ⌥-click the viewport; the focus distance is measured on the device surface)
- **Effects**: vignette, grain, bloom, chromatic aberration, sharpen, pixel grid, fisheye, glass border,
  screen fade, ghost, liquid glass
- **Timeline**: multiple shots, keyframes on every camera / device / light / blur property, easing,
  motion presets (scan, zoom, orbit, flip …) and auto-motion that composes a camera move from focus areas you draw on the screen
- **Export**: PNG / WebP / JPG up to 8K with transparent background; MP4 (H.264) or WebM (VP9, alpha)
  up to 4K, 24 / 30 / 60 fps, 4× / 8× / 16× motion blur, App Store preview sizes
- **Projects**: autosave, local project library (IndexedDB), portable `.mok.json` files, undo / redo
- Light and dark UI in Geist Sans + Geist Mono, keyboard shortcuts (`?`)

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Production build: `pnpm build && pnpm start`. Deploys to Vercel as-is.

## How it works

- **Rendering** — three.js r185 via React Three Fiber. Devices are extruded rounded-rect solids with
  bevels, physically based materials (metallic frames, clear-coated back glass) and a screen material
  whose emissive map is the uploaded media, with a clear coat so the HDRI reflects across the glass
  like real cover glass. The renderer uses Khronos Neutral tone mapping so screenshot colors stay true.
- **Speed** — the scene only re-renders on demand (state changes, playback, export), textures are
  uploaded at native screen resolution once, HDRIs are 1k and pre-filtered with PMREM, and MSAA runs
  inside the post-processing composer.
- **Video** — every frame is rendered deterministically at the requested time, optionally
  super-sampled in time for motion blur, and pushed through `VideoEncoder` with
  [mediabunny](https://github.com/Vanilagy/mediabunny) muxing into MP4 or WebM.
- **State** — a single undoable project document (zustand + zundo); the timeline evaluates keyframes
  into a shared per-frame object that scene components read imperatively, so playback never re-renders React.

## Adding more 3D models

`public/models/` ships ten CC-BY glTF devices (see `CREDITS.md`). To add your own:

1. Get a model you have rights to — e.g. CC-BY models on [Sketchfab](https://sketchfab.com/search?features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b&q=iphone&type=models)
   (credit the author), or a one-time purchase (keep purchased models out of a public repo).
   `SKETCHFAB_TOKEN=… node scripts/fetch-sketchfab.mjs <uid>=<name>` downloads, converts and credits
   a Sketchfab model in one go.
2. Or convert a file you already have: `scripts/optimize-model.sh input.glb public/models/name.glb`
   (meshopt geometry + WebP textures; a 25 MB export becomes 1–8 MB).
3. Add a spec with a `model` block in `src/lib/devices.ts`. `screenMesh` takes a mesh or material name
   (comma-separated list allowed); leave it empty to let mok pick the largest thin, non-horizontal
   surface. In the running app, `window.__mok.registry.glbInfo()` lists every mesh with its size,
   textures and which one is currently the screen, which makes picking the right name quick.
   `rotation` / `size` / `hideOverlays` fine-tune orientation, scale and cover-glass handling.

## Icons

The UI uses the [Central Icon System](https://iconists.co/central) (round · outlined · radius 2 ·
stroke 1.5) through the `@central-icons-react` package, which needs a Central license key to
install. Without a key the editor falls back to a hand-drawn set in the same style:

```bash
CENTRAL_LICENSE_KEY=… node scripts/use-central-icons.mjs        # swap the real glyphs in
node scripts/use-central-icons.mjs --revert                       # back to the built-in set
```

## Development

- `pnpm dev` — dev server · `pnpm typecheck` · `pnpm lint`
- `scripts/qa-shot.mjs out.png "<js>"` — headless screenshot of the editor for visual QA
  (needs Playwright's Chromium; `window.__mok` exposes the stores, actions and export API in the page)
- `scripts/optimize-model.sh in.glb out.glb` — compress a glTF for the web

## Credits

- HDRIs and concrete textures: [Poly Haven](https://polyhaven.com) (CC0)
- three.js, React Three Fiber, drei, postprocessing, mediabunny, zustand, Next.js, Tailwind CSS
- Type: [Geist](https://vercel.com/font) by Vercel

Device names are used descriptively; this project is not affiliated with Apple.
