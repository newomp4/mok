import type { AspectDef, AspectId, EffectId, Keyframe, LightingId, Project, ScenePresetId, Shot } from "./types";

export const ASPECTS: AspectDef[] = [
  { id: "fill", label: "Fill", ratio: null, group: "ratio" },
  { id: "21:9", label: "21:9", ratio: 21 / 9, group: "ratio" },
  { id: "16:9", label: "16:9", ratio: 16 / 9, group: "ratio" },
  { id: "3:2", label: "3:2", ratio: 3 / 2, group: "ratio" },
  { id: "4:3", label: "4:3", ratio: 4 / 3, group: "ratio" },
  { id: "1:1", label: "1:1", ratio: 1, group: "ratio" },
  { id: "4:5", label: "4:5", ratio: 4 / 5, group: "ratio" },
  { id: "3:4", label: "3:4", ratio: 3 / 4, group: "ratio" },
  { id: "2:3", label: "2:3", ratio: 2 / 3, group: "ratio" },
  { id: "9:16", label: "9:16", ratio: 9 / 16, group: "ratio" },
  { id: "as-iphone", label: "App Store · iPhone", ratio: 1290 / 2796, group: "appstore", px: [1290, 2796], sub: "1290 × 2796" },
  { id: "as-ipad", label: "App Store · iPad", ratio: 2064 / 2752, group: "appstore", px: [2064, 2752], sub: "2064 × 2752" },
  { id: "as-mac", label: "App Store · Mac", ratio: 2880 / 1800, group: "appstore", px: [2880, 1800], sub: "2880 × 1800" },
  { id: "as-video-h", label: "App Store Video · Horizontal", ratio: 16 / 9, group: "appstore", px: [1920, 1080], sub: "1920 × 1080" },
  { id: "as-video-v", label: "App Store Video · Vertical", ratio: 9 / 16, group: "appstore", px: [1080, 1920], sub: "1080 × 1920" },
];
export const ASPECT_MAP = new Map(ASPECTS.map((a) => [a.id, a]));
export function getAspect(id: AspectId): AspectDef {
  return ASPECT_MAP.get(id) ?? ASPECTS[0];
}

export interface ExportSize {
  id: string;
  label: string;
  /** long-edge pixels */
  long: number;
}
export const EXPORT_SIZES: ExportSize[] = [
  { id: "720", label: "720p", long: 1280 },
  { id: "1080", label: "1080p", long: 1920 },
  { id: "1440", label: "1440p", long: 2560 },
  { id: "2160", label: "4K", long: 3840 },
  { id: "4320", label: "8K", long: 7680 },
];

export interface CameraPreset {
  id: string;
  name: string;
  camera: Project["camera"];
  rot?: { x: number; y: number; z: number };
}
export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "hero", name: "Hero", camera: { x: -18, y: 14, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "angled", name: "Angled", camera: { x: -32, y: 22, z: -6, fov: 26, zoom: 1.05, panX: 0, panY: 0 }, rot: { x: 0, y: 8, z: 0 } },
  { id: "flat", name: "Flat", camera: { x: 0, y: 0, z: 0, fov: 20, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "bottom", name: "Bottom", camera: { x: 10, y: -30, z: 0, fov: 30, zoom: 1.1, panX: 0, panY: 0.05 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "detail", name: "Detail", camera: { x: -24, y: 48, z: 0, fov: 24, zoom: 1.9, panX: 0.06, panY: -0.17 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "top", name: "Top", camera: { x: 0, y: 62, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 } },
];

export interface MotionPreset {
  id: string;
  name: string;
  duration: number;
  build: (duration: number, base: Project["camera"], rot: { x: number; y: number; z: number }) => Partial<Record<keyof Shot["keyframes"], Keyframe[]>>;
}

const kf = (t: number, v: number, ease: Keyframe["ease"] = "smooth"): Keyframe => ({ t, v, ease });

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: "scan-lr", name: "Scan left to right", duration: 4,
    build: (d, c) => ({
      "camera.x": [kf(0, c.x - 14), kf(d, c.x + 14, "smooth")],
      "camera.panX": [kf(0, c.panX - 0.12), kf(d, c.panX + 0.12)],
      "camera.zoom": [kf(0, c.zoom * 1.35), kf(d, c.zoom * 1.35)],
    }),
  },
  {
    id: "scan-tb", name: "Left – top to bottom", duration: 4,
    build: (d, c) => ({
      "camera.x": [kf(0, -28), kf(d, -22)],
      "camera.y": [kf(0, 18), kf(d, 8)],
      "camera.panY": [kf(0, c.panY + 0.22), kf(d, c.panY - 0.22)],
      "camera.zoom": [kf(0, c.zoom * 1.6), kf(d, c.zoom * 1.6)],
    }),
  },
  {
    id: "low-pan-up", name: "Low-angle pan up", duration: 4,
    build: (d, c) => ({
      "camera.y": [kf(0, -28), kf(d, 12, "easeInOut")],
      "camera.x": [kf(0, 14), kf(d, -10, "easeInOut")],
      "camera.zoom": [kf(0, c.zoom * 1.25), kf(d, c.zoom * 1.05)],
    }),
  },
  {
    id: "slow-zoom-out", name: "Slow zoom out", duration: 4,
    build: (d, c) => ({
      "camera.zoom": [kf(0, c.zoom * 1.8), kf(d, c.zoom, "easeOut")],
      "camera.x": [kf(0, c.x - 6), kf(d, c.x + 6, "easeOut")],
    }),
  },
  {
    id: "overhead-pan", name: "Overhead pan", duration: 4,
    build: (d, c) => ({
      "camera.y": [kf(0, 58), kf(d, 42)],
      "camera.x": [kf(0, -24), kf(d, 12)],
      "camera.zoom": [kf(0, c.zoom * 1.2), kf(d, c.zoom * 1.2)],
    }),
  },
  {
    id: "out-and-back", name: "Out and back", duration: 4,
    build: (d, c) => ({
      "camera.zoom": [kf(0, c.zoom * 1.5), kf(d / 2, c.zoom * 0.95, "easeInOut"), kf(d, c.zoom * 1.5, "easeInOut")],
      "camera.x": [kf(0, c.x - 12), kf(d / 2, c.x, "easeInOut"), kf(d, c.x + 12, "easeInOut")],
    }),
  },
  {
    id: "orbit", name: "Orbit", duration: 5,
    build: (d, c, r) => ({
      "mockup.rotY": [kf(0, r.y - 35, "easeInOut"), kf(d, r.y + 35, "easeInOut")],
      "camera.y": [kf(0, c.y - 6), kf(d, c.y + 6)],
    }),
  },
  {
    id: "flip", name: "Flip reveal", duration: 3,
    build: (d, c, r) => ({
      "mockup.rotY": [kf(0, r.y - 180, "expoOut"), kf(d * 0.7, r.y, "expoOut")],
      "camera.zoom": [kf(0, c.zoom * 0.85, "expoOut"), kf(d * 0.7, c.zoom, "expoOut")],
    }),
  },
  {
    id: "drift", name: "Gentle drift", duration: 6,
    build: (d, c) => ({
      "camera.x": [kf(0, c.x - 5, "easeInOut"), kf(d, c.x + 5, "easeInOut")],
      "camera.y": [kf(0, c.y + 3, "easeInOut"), kf(d, c.y - 3, "easeInOut")],
      "camera.panY": [kf(0, c.panY - 0.03), kf(d, c.panY + 0.03)],
    }),
  },
  {
    id: "push-in", name: "Push in", duration: 4,
    build: (d, c) => ({
      "camera.zoom": [kf(0, c.zoom, "easeInOut"), kf(d, c.zoom * 2.2, "easeInOut")],
      "camera.panY": [kf(0, c.panY, "easeInOut"), kf(d, c.panY + 0.12, "easeInOut")],
      "blur.strength": [kf(0, 0, "easeIn"), kf(d, 6, "easeIn")],
    }),
  },
];

export interface LightingPreset {
  id: LightingId;
  name: string;
  file: string;
  intensity: number;
  rotY: number;
}
export const LIGHTINGS: LightingPreset[] = [
  { id: "default", name: "Default", file: "/hdri/brown_photostudio_04.hdr", intensity: 1, rotY: 263 },
  { id: "soft", name: "Soft", file: "/hdri/studio_small_09.hdr", intensity: 0.9, rotY: 180 },
  { id: "bright", name: "Bright", file: "/hdri/studio_small_03.hdr", intensity: 1.15, rotY: 120 },
  { id: "contrast", name: "Contrast", file: "/hdri/photo_studio_01.hdr", intensity: 1, rotY: 220 },
  { id: "neon", name: "Neon", file: "/hdri/neon_photostudio.hdr", intensity: 1, rotY: 40 },
  { id: "cool", name: "Cool", file: "/hdri/blue_photo_studio.hdr", intensity: 1, rotY: 300 },
];
export function getLighting(id: LightingId): LightingPreset {
  return LIGHTINGS.find((l) => l.id === id) ?? LIGHTINGS[0];
}

export interface BgPreset {
  id: string;
  name: string;
  colors: [string, string, string, string];
  style: "mesh" | "linear" | "radial";
}
export const BG_PRESETS: BgPreset[] = [
  { id: "whisp", name: "Whisp", colors: ["#f4f4f6", "#d8dbe2", "#eceef2", "#c5c9d3"], style: "mesh" },
  { id: "glaze", name: "Glaze", colors: ["#f6efe8", "#e5cdb8", "#f1e2d5", "#d7b79c"], style: "mesh" },
  { id: "aurora", name: "Aurora", colors: ["#0c1224", "#1d3d62", "#0f2a3b", "#3a6b8a"], style: "mesh" },
  { id: "dusk", name: "Dusk", colors: ["#2b1c3a", "#7a3b5c", "#3f2350", "#c2664f"], style: "mesh" },
  { id: "mint", name: "Mint", colors: ["#e6f4ec", "#b9e2cb", "#d3ecdd", "#8fd1ae"], style: "mesh" },
  { id: "peach", name: "Peach", colors: ["#fff1e8", "#ffcdb2", "#ffe1d0", "#ff9e7a"], style: "mesh" },
  { id: "lilac", name: "Lilac", colors: ["#f1ecfa", "#cfbfea", "#e2d8f2", "#a992d8"], style: "mesh" },
  { id: "ocean", name: "Ocean", colors: ["#e8f2fa", "#a9cbe6", "#cfe1f1", "#5f95c4"], style: "mesh" },
  { id: "graphite", name: "Graphite", colors: ["#1e1e21", "#3a3a40", "#27272b", "#4d4d55"], style: "mesh" },
  { id: "noir", name: "Noir", colors: ["#050505", "#161616", "#0a0a0a", "#222222"], style: "radial" },
  { id: "paper", name: "Paper", colors: ["#f7f5f0", "#ebe6dc", "#f2eee6", "#ddd5c6"], style: "linear" },
  { id: "ember", name: "Ember", colors: ["#1a0b08", "#6b2313", "#2e100a", "#d1502a"], style: "mesh" },
];
export function getBgPreset(id: string): BgPreset {
  return BG_PRESETS.find((b) => b.id === id) ?? BG_PRESETS[0];
}

export interface ScenePreset {
  id: ScenePresetId;
  name: string;
  description: string;
  swatch: string;
  lighting: LightingId;
  lightRotY: number;
  lightIntensity: number;
  background: Project["scene"]["background"];
  contactShadow: boolean;
}
export const SCENES: ScenePreset[] = [
  {
    id: "custom", name: "Custom scene", description: "Custom lighting + background", swatch: "#e9e9e9",
    lighting: "default", lightRotY: 263, lightIntensity: 1, contactShadow: true,
    background: { type: "color", color: "#f2f2f2", preset: "whisp", image: null, blur: 0.85 },
  },
  {
    id: "studio", name: "Studio", description: "Soft cyclorama with floor shadows", swatch: "#dcdcdc",
    lighting: "soft", lightRotY: 200, lightIntensity: 0.95, contactShadow: true,
    background: { type: "color", color: "#dedede", preset: "whisp", image: null, blur: 0 },
  },
  {
    id: "concrete", name: "Concrete dark", description: "Raw concrete floor, hard key light", swatch: "#3a3a3a",
    lighting: "contrast", lightRotY: 140, lightIntensity: 0.55, contactShadow: true,
    background: { type: "color", color: "#1a1a1a", preset: "graphite", image: null, blur: 0 },
  },
  {
    id: "darkroom", name: "Dark room", description: "Black void with a single rim light", swatch: "#0c0c0c",
    lighting: "neon", lightRotY: 60, lightIntensity: 0.35, contactShadow: true,
    background: { type: "color", color: "#050505", preset: "noir", image: null, blur: 0 },
  },
  {
    id: "gallery", name: "Gallery", description: "Bright white floor and wall", swatch: "#f6f6f6",
    lighting: "bright", lightRotY: 90, lightIntensity: 1.05, contactShadow: true,
    background: { type: "color", color: "#f4f4f4", preset: "paper", image: null, blur: 0 },
  },
];
export function getScene(id: ScenePresetId): ScenePreset {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

export interface EffectDef {
  id: EffectId;
  name: string;
  icon: string;
  params: { key: string; label: string; min: number; max: number; step: number; default: number }[];
}
export const EFFECT_DEFS: EffectDef[] = [
  { id: "vignette", name: "Vignette", icon: "vignette", params: [
    { key: "darkness", label: "Darkness", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "offset", label: "Offset", min: 0, max: 1, step: 0.01, default: 0.35 },
  ] },
  { id: "grain", name: "Grain", icon: "grain", params: [
    { key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.25 },
  ] },
  { id: "bloom", name: "Bloom", icon: "bloom", params: [
    { key: "intensity", label: "Intensity", min: 0, max: 3, step: 0.01, default: 0.6 },
    { key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: "radius", label: "Radius", min: 0, max: 1, step: 0.01, default: 0.6 },
  ] },
  { id: "chromatic", name: "Chromatic abb.", icon: "chromatic", params: [
    { key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.25 },
  ] },
  { id: "sharpen", name: "Sharpen", icon: "sharpen", params: [
    { key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.35 },
  ] },
  { id: "pixel", name: "Pixel grid", icon: "pixel", params: [
    { key: "size", label: "Size", min: 1, max: 40, step: 1, default: 6 },
  ] },
  { id: "fisheye", name: "Fish eye", icon: "fisheye", params: [
    { key: "amount", label: "Amount", min: -1, max: 1, step: 0.01, default: 0.3 },
  ] },
  { id: "glassBorder", name: "Glass border", icon: "glass", params: [
    { key: "width", label: "Width", min: 0, max: 0.2, step: 0.001, default: 0.04 },
    { key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01, default: 0.5 },
  ] },
  { id: "screenFade", name: "Screen fade", icon: "fade", params: [
    { key: "in", label: "Fade in (s)", min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: "out", label: "Fade out (s)", min: 0, max: 3, step: 0.05, default: 0.6 },
  ] },
];
export function getEffectDef(id: EffectId): EffectDef {
  return EFFECT_DEFS.find((e) => e.id === id) ?? EFFECT_DEFS[0];
}

export interface Template {
  id: string;
  name: string;
  device: string;
  finish: string;
  scene: ScenePresetId;
  camera: Project["camera"];
  rot: { x: number; y: number; z: number };
  motion?: string;
  aspect?: AspectId;
  background?: Partial<Project["scene"]["background"]>;
  blur?: Partial<Project["blur"]>;
  swatch: [string, string];
}
export const TEMPLATES: Template[] = [
  { id: "iphone-hero", name: "iPhone hero", device: "iphone-17-pro-max-glb", finish: "model", scene: "custom", camera: { x: -18, y: 14, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, motion: "drift", aspect: "4:5", background: { type: "preset", preset: "glaze" }, swatch: ["#f6efe8", "#d7b79c"] },
  { id: "iphone-detail", name: "iPhone detail", device: "iphone-17-pro-glb", finish: "model", scene: "custom", camera: { x: -24, y: 48, z: 0, fov: 24, zoom: 1.9, panX: 0.06, panY: -0.17 }, rot: { x: 0, y: 0, z: 0 }, motion: "scan-lr", aspect: "16:9", background: { type: "preset", preset: "whisp" }, blur: { mode: "radial", strength: 6, focusSize: 0.5, falloff: 0.3, bokeh: true, focusX: 0.5, focusY: 0.55 }, swatch: ["#f4f4f6", "#c5c9d3"] },
  { id: "concrete-macbook", name: "Concrete MacBook", device: "macbook-pro-14-glb", finish: "space-gray", scene: "concrete", camera: { x: -28, y: 18, z: 0, fov: 26, zoom: 1.1, panX: 0, panY: 0.02 }, rot: { x: 0, y: 12, z: 0 }, motion: "low-pan-up", aspect: "16:9", swatch: ["#3a3a3a", "#151515"] },
  { id: "darkroom-macbook", name: "Dark room MacBook", device: "macbook-pro-16-glb", finish: "space-black", scene: "darkroom", camera: { x: 22, y: 12, z: 0, fov: 24, zoom: 1.15, panX: 0, panY: 0.02 }, rot: { x: 0, y: -18, z: 0 }, motion: "slow-zoom-out", aspect: "16:9", swatch: ["#0c0c0c", "#2a2f39"] },
  { id: "studio-ipad", name: "Studio iPad", device: "ipad-pro-13-glb", finish: "silver", scene: "studio", camera: { x: -20, y: 16, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 10, z: 0 }, motion: "orbit", aspect: "4:3", swatch: ["#dcdcdc", "#f0f0f0"] },
  { id: "watch-aurora", name: "Watch aurora", device: "apple-watch-ultra-glb", finish: "natural", scene: "custom", camera: { x: -26, y: 20, z: 8, fov: 24, zoom: 1.1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, motion: "orbit", aspect: "1:1", background: { type: "preset", preset: "aurora" }, swatch: ["#0c1224", "#3a6b8a"] },
  { id: "display-gallery", name: "Gallery display", device: "pro-display-xdr-glb", finish: "silver", scene: "gallery", camera: { x: -14, y: 8, z: 0, fov: 22, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 6, z: 0 }, motion: "push-in", aspect: "16:9", swatch: ["#f6f6f6", "#dcdcdc"] },
  { id: "browser-peach", name: "Browser card", device: "browser", finish: "light", scene: "custom", camera: { x: -12, y: 10, z: -2, fov: 22, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, motion: "drift", aspect: "16:9", background: { type: "preset", preset: "peach" }, swatch: ["#fff1e8", "#ff9e7a"] },
  { id: "air-mint", name: "Air on mint", device: "iphone-16-pro-max-glb", finish: "model", scene: "custom", camera: { x: 20, y: 12, z: 4, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: -20, z: 0 }, motion: "flip", aspect: "9:16", background: { type: "preset", preset: "mint" }, swatch: ["#e6f4ec", "#8fd1ae"] },
  { id: "imac-noir", name: "iMac noir", device: "imac-24-glb", finish: "green", scene: "darkroom", camera: { x: -16, y: 10, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0.04 }, rot: { x: 0, y: 8, z: 0 }, motion: "out-and-back", aspect: "16:9", swatch: ["#0c0c0c", "#2c5e9a"] },
];
