# mok

Turn product screens into premium 3D mockups and videos, entirely in the browser.

mok is a self-hosted device-mockup editor: drop a screenshot or a screen recording onto a
procedurally built iPhone, iPad, MacBook, Apple Watch, Studio Display, iMac or flat card,
light it with studio HDRIs, animate the camera on a keyframe timeline and export stills up to
8K or frame-exact MP4 / WebM video up to 4K 60 fps with motion blur. Nothing is uploaded — all
rendering and encoding happens locally with WebGL and WebCodecs.

## Features

- **16 device models** built parametrically from real dimensions (no model downloads):
  iPhone 17 / 17 Pro / 17 Pro Max / Air, iPad Pro 13" / Air 11", MacBook Pro 14" / 16",
  MacBook Air 13" / 15", Apple Watch 46 mm / Ultra, Studio Display, iMac 24", flat card, browser window
- **Finishes** per device (Cosmic Orange, Deep Blue, Lavender, Sage, Midnight, Starlight …)
- **Scenes**: custom (any background), Studio cyclorama, Concrete dark, Dark room, Gallery — with real
  shadow-mapped lighting on the 3D sets and contact shadows on the custom scene
- **6 lighting rigs** from CC0 Poly Haven HDRIs, rotatable and keyframeable
- **Backgrounds**: solid color, 12 mesh-gradient presets, your own image with blur, or transparent
- **Camera**: orbit / zoom / pan directly in the viewport, six presets, FOV, roll
- **Blur**: radial or linear focus blur with bokeh, or true depth of field
- **Effects**: vignette, grain, bloom, chromatic aberration, sharpen, pixel grid, fisheye, glass border, screen fade
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

## Icons

The UI uses an icon set drawn in the style of the Central Icon System (24 px grid, 1.5 px round
strokes). To use the licensed `@central-icons-react` glyphs instead, replace the path map in
`src/components/icons.tsx` — names match Central's.

## Credits

- HDRIs and concrete textures: [Poly Haven](https://polyhaven.com) (CC0)
- three.js, React Three Fiber, drei, postprocessing, mediabunny, zustand, Next.js, Tailwind CSS
- Type: [Geist](https://vercel.com/font) by Vercel

Device names are used descriptively; this project is not affiliated with Apple.
