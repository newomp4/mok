# mok

3D device mockup editor (Next.js App Router + React Three Fiber). Everything runs client-side.

- `src/lib` — types, presets, devices, animation/keyframes, media + persistence (IndexedDB)
- `src/store` — zustand stores (`editor` = undoable project, `ui` = transient UI state)
- `src/three` — R3F scene: camera rig, HDRI lighting, background, parametric devices, post effects
- `src/export` — deterministic image/video export (WebCodecs via mediabunny)
- `src/components/editor` — the editor UI (top bar, viewport, inspector, timeline)

Run `pnpm dev`. Type-check with `pnpm exec tsc --noEmit`, lint with `pnpm lint`.
