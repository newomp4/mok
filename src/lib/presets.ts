import type { AnimProp, EffectInstance, EnterExit, LogoStyle, ShotKind, TextStyle, Transition, AspectDef, AspectId, EffectId, Keyframe, LightingId, Project, ScenePresetId, Shot } from "./types";

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
// The five classic framings match Ultramock's numerically (45° lens, converted to this rig's units);
// the rest are additions.
export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "hero", name: "Hero", camera: { x: 0, y: 0, z: 0, fov: 45, zoom: 1.141, panX: 0.343, panY: -0.352 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "angled", name: "Angled", camera: { x: -26, y: -28, z: 5, fov: 45, zoom: 0.969, panX: 0.276, panY: -0.112 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "flat", name: "Flat", camera: { x: 0, y: 0, z: 0, fov: 45, zoom: 0.77, panX: 0.0, panY: 0.0 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "bottom", name: "Bottom", camera: { x: -1, y: -50, z: 0, fov: 45, zoom: 1.027, panX: 0.0, panY: 0.0 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "detail", name: "Detail", camera: { x: 22, y: 26, z: 1, fov: 45, zoom: 1.925, panX: -0.445, panY: -0.594 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "top", name: "Top", camera: { x: -8, y: 68, z: 0, fov: 30, zoom: 1.05, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "profile", name: "Profile", camera: { x: -70, y: 6, z: 0, fov: 35, zoom: 1.1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 } },
  { id: "dramatic", name: "Dramatic", camera: { x: 30, y: -12, z: -8, fov: 45, zoom: 1.25, panX: 0, panY: 0.02 }, rot: { x: 6, y: -22, z: 0 } },
  { id: "float", name: "Float", camera: { x: -20, y: 24, z: 0, fov: 30, zoom: 0.95, panX: 0, panY: 0 }, rot: { x: -10, y: 20, z: -6 } },
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
    id: "fold-up", name: "Fold up", duration: 4,
    build: (d, c) => ({
      "camera.y": [kf(0, 78, "easeInOut"), kf(d, c.y, "easeInOut")],
      "camera.x": [kf(0, c.x - 10, "easeInOut"), kf(d, c.x, "easeInOut")],
      "camera.zoom": [kf(0, c.zoom * 1.15, "easeInOut"), kf(d, c.zoom, "easeInOut")],
    }),
  },
  {
    id: "flat-truck", name: "Flat truck", duration: 4,
    build: (d, c) => ({
      "camera.x": [kf(0, 0), kf(d, 0)],
      "camera.y": [kf(0, 0), kf(d, 0)],
      "camera.panX": [kf(0, c.panX + 0.18, "easeInOut"), kf(d, c.panX - 0.18, "easeInOut")],
      "camera.zoom": [kf(0, c.zoom * 1.3), kf(d, c.zoom * 1.3)],
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
  { id: "soft", name: "Studio soft", file: "/hdri/studio_small_09.hdr", intensity: 0.9, rotY: 180 },
  { id: "neon", name: "Dark rim", file: "/hdri/neon_photostudio.hdr", intensity: 0.9, rotY: 40 },
  { id: "cool", name: "Two tone", file: "/hdri/blue_photo_studio.hdr", intensity: 1, rotY: 300 },
  { id: "contrast", name: "Warm glow", file: "/hdri/photo_studio_01.hdr", intensity: 1, rotY: 220 },
  { id: "bright", name: "Bright", file: "/hdri/studio_small_03.hdr", intensity: 1.15, rotY: 120 },
  { id: "lightbox", name: "Lightbox", file: "/hdri/studio_small_09.hdr", intensity: 1.35, rotY: 20 },
  { id: "dramatic", name: "Dramatic key", file: "/hdri/photo_studio_01.hdr", intensity: 1.5, rotY: 55 },
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
  { id: "whisp", name: "Whisp", colors: ["#eef0f4", "#cfd6e4", "#f7f8fb", "#aeb8cc"], style: "mesh" },
  { id: "glaze", name: "Glaze", colors: ["#f7efe6", "#e8c9a8", "#fdf7f1", "#c79a72"], style: "mesh" },
  { id: "crystal", name: "Crystal", colors: ["#eaf1f7", "#b9d7ec", "#ffffff", "#8fbfe0"], style: "mesh" },
  { id: "aurora", name: "Aurora", colors: ["#0a1020", "#1f4d7a", "#123049", "#48a2c8"], style: "mesh" },
  { id: "dusk", name: "Dusk", colors: ["#2a1836", "#8a3f63", "#43254f", "#d8734f"], style: "mesh" },
  { id: "mint", name: "Mint", colors: ["#e8f5ee", "#a9dfc4", "#f4fbf7", "#6cc79c"], style: "mesh" },
  { id: "peach", name: "Peach", colors: ["#fff2ea", "#ffc6a8", "#fff8f3", "#ff9a6e"], style: "mesh" },
  { id: "lilac", name: "Lilac", colors: ["#f2edfb", "#c9b6ee", "#faf7ff", "#9b7fdc"], style: "mesh" },
  { id: "ocean", name: "Ocean", colors: ["#e9f2fa", "#9cc4e6", "#f6fafd", "#4d8fc4"], style: "mesh" },
  { id: "spectrum", name: "Spectrum", colors: ["#141018", "#6d3ff0", "#1d1430", "#f2478f"], style: "mesh" },
  { id: "sundrape", name: "Sundrape", colors: ["#1b0f16", "#e0573a", "#3a1a20", "#ffb765"], style: "mesh" },
  { id: "graphite", name: "Graphite", colors: ["#1b1b1f", "#3d3d45", "#26262c", "#585864"], style: "mesh" },
  { id: "noir", name: "Noir", colors: ["#050506", "#191920", "#0b0b0e", "#2a2a34"], style: "radial" },
  { id: "paper", name: "Paper", colors: ["#f8f6f1", "#eae4d8", "#fdfcf9", "#d9d0be"], style: "linear" },
  { id: "ember", name: "Ember", colors: ["#190a07", "#7a2712", "#31100a", "#e0632f"], style: "mesh" },
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
    id: "studio", name: "Studio", description: "Infinite soft floor with real shadows", swatch: "#dcdcdc",
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
    id: "gallery", name: "Bright studio", description: "High-key white floor, soft shadows", swatch: "#f6f6f6",
    lighting: "soft", lightRotY: 120, lightIntensity: 1.1, contactShadow: true,
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
  { id: "ghost", name: "Ghost", icon: "ghost", params: [
    { key: "offset", label: "Offset", min: 0, max: 0.08, step: 0.001, default: 0.02 },
    { key: "angle", label: "Angle", min: 0, max: 360, step: 1, default: 45 },
    { key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01, default: 0.35 },
  ] },
  { id: "liquidGlass", name: "Liquid glass", icon: "droplet", params: [
    { key: "x", label: "X", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "y", label: "Y", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "width", label: "Width", min: 0.05, max: 1, step: 0.005, default: 0.42 },
    { key: "height", label: "Height", min: 0.05, max: 1, step: 0.005, default: 0.26 },
    { key: "radius", label: "Radius", min: 0, max: 0.5, step: 0.005, default: 0.12 },
    { key: "refraction", label: "Refraction", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "tint", label: "Tint", min: 0, max: 1, step: 0.01, default: 0.12 },
  ] },
  { id: "screenFade", name: "Screen fade", icon: "fade", params: [
    { key: "in", label: "Fade in (s)", min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: "out", label: "Fade out (s)", min: 0, max: 3, step: 0.05, default: 0.6 },
  ] },
];
export function getEffectDef(id: EffectId): EffectDef {
  return EFFECT_DEFS.find((e) => e.id === id) ?? EFFECT_DEFS[0];
}

export interface TemplateShot {
  kind: ShotKind;
  name?: string;
  duration: number;
  /** motion preset for media shots */
  motion?: string;
  /** camera held for this shot (written as keyframes at t = 0) */
  camera?: Partial<Project["camera"]>;
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>;
  text?: Partial<TextStyle>;
  logo?: Partial<LogoStyle>;
  enter?: EnterExit;
  exit?: EnterExit;
  transitionOut?: Transition;
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
  effects?: EffectInstance[];
  /** multi-shot sequence (text / media / logo); without it the template keeps the project's shots */
  sequence?: TemplateShot[];
  fade?: { in: number; out: number; color: string };
  swatch: [string, string];
  /** where along shot 1 (0..1) the thumbnail is captured */
  thumbAt?: number;
  description?: string;
  /** built-in sample screen applied when the project has no media yet */
  screen?: string;
}

const FADE: Transition = { type: "fade", duration: 0.6, color: "#000000" };
const fx = (id: EffectId, params: Record<string, number>): EffectInstance => ({ id, enabled: true, params });
export const TEMPLATES: Template[] = [
  { id: "iphone-hero", screen: "finance-dark", name: "iPhone hero", device: "iphone-17-pro-max-glb", finish: "model", scene: "custom", camera: { x: -18, y: 14, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, motion: "drift", aspect: "4:5", background: { type: "preset", preset: "glaze" }, swatch: ["#f6efe8", "#d7b79c"] },
  { id: "iphone-detail", screen: "finance-dark", name: "iPhone detail", device: "iphone-17-pro-glb", finish: "model", scene: "custom", camera: { x: -24, y: 48, z: 0, fov: 24, zoom: 1.9, panX: 0.06, panY: -0.17 }, rot: { x: 0, y: 0, z: 0 }, motion: "scan-lr", aspect: "16:9", background: { type: "preset", preset: "whisp" }, blur: { mode: "radial", strength: 6, focusSize: 0.5, falloff: 0.3, bokeh: true, focusX: 0.5, focusY: 0.55 }, swatch: ["#f4f4f6", "#c5c9d3"], thumbAt: 0.5 },
  { id: "concrete-macbook", screen: "analytics", name: "Concrete MacBook", device: "macbook-pro-14-glb", finish: "space-gray", scene: "concrete", camera: { x: -28, y: 18, z: 0, fov: 26, zoom: 1.1, panX: 0, panY: 0.02 }, rot: { x: 0, y: 12, z: 0 }, motion: "low-pan-up", aspect: "16:9", swatch: ["#3a3a3a", "#151515"] },
  { id: "darkroom-macbook", screen: "analytics", name: "Dark room MacBook", device: "macbook-pro-16-glb", finish: "space-black", scene: "darkroom", camera: { x: 22, y: 12, z: 0, fov: 24, zoom: 1.15, panX: 0, panY: 0.02 }, rot: { x: 0, y: -18, z: 0 }, motion: "slow-zoom-out", aspect: "16:9", swatch: ["#0c0c0c", "#2a2f39"] },
  { id: "studio-ipad", screen: "analytics", name: "Studio iPad", device: "ipad-pro-13-glb", finish: "silver", scene: "studio", camera: { x: -20, y: 16, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 10, z: 0 }, motion: "orbit", aspect: "4:3", swatch: ["#dcdcdc", "#f0f0f0"] },
  { id: "watch-aurora", screen: "finance-dark", name: "Watch aurora", device: "apple-watch-ultra-glb", finish: "natural", scene: "custom", camera: { x: -26, y: 20, z: 8, fov: 24, zoom: 1.1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, motion: "orbit", aspect: "1:1", background: { type: "preset", preset: "aurora" }, swatch: ["#0c1224", "#3a6b8a"] },
  { id: "display-gallery", screen: "analytics", name: "Gallery display", device: "pro-display-xdr-glb", finish: "silver", scene: "gallery", camera: { x: -14, y: 8, z: 0, fov: 22, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 6, z: 0 }, motion: "push-in", aspect: "16:9", swatch: ["#f6f6f6", "#dcdcdc"], thumbAt: 0.05 },
  { id: "browser-peach", screen: "landing", name: "Browser card", device: "browser", finish: "light", scene: "custom", camera: { x: -12, y: 10, z: -2, fov: 22, zoom: 1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, motion: "drift", aspect: "16:9", background: { type: "preset", preset: "peach" }, swatch: ["#fff1e8", "#ff9e7a"] },
  { id: "air-mint", screen: "music", name: "Air on mint", device: "iphone-16-pro-max-glb", finish: "model", scene: "custom", camera: { x: 20, y: 12, z: 4, fov: 24, zoom: 0.8, panX: 0, panY: 0 }, rot: { x: 0, y: -20, z: 0 }, motion: "flip", aspect: "9:16", background: { type: "preset", preset: "mint" }, swatch: ["#e6f4ec", "#8fd1ae"] },
  { id: "imac-noir", screen: "analytics", name: "iMac noir", device: "imac-24-glb", finish: "green", scene: "darkroom", camera: { x: -16, y: 10, z: 0, fov: 24, zoom: 1, panX: 0, panY: 0.04 }, rot: { x: 0, y: 8, z: 0 }, motion: "out-and-back", aspect: "16:9", swatch: ["#0c0c0c", "#2c5e9a"] },
  {
    id: "watch-detail", screen: "finance-dark", name: "Watch detail", description: "Side close-up on plain grey", device: "apple-watch-ultra-glb", finish: "natural", scene: "custom",
    camera: { x: 22, y: -10, z: 0, fov: 24, zoom: 1.75, panX: -0.02, panY: -0.02 }, rot: { x: 0, y: 0, z: 0 }, aspect: "4:3", motion: "drift",
    background: { type: "color", color: "#f2f2f2" }, swatch: ["#f2f2f2", "#d8d8d8"], thumbAt: 0.4,
  },
  {
    id: "iphone-top", screen: "finance-dark", name: "iPhone top", description: "Tight on the top third", device: "iphone-17-pro-glb", finish: "model", scene: "custom",
    camera: { x: -14, y: 16, z: 0, fov: 24, zoom: 2.05, panX: 0.02, panY: -0.3 }, rot: { x: 0, y: 0, z: 0 }, aspect: "4:3", motion: "drift",
    background: { type: "color", color: "#f2f2f2" }, swatch: ["#f2f2f2", "#dcdcdc"], thumbAt: 0.4,
  },
  {
    id: "iphone-angle", screen: "music", name: "iPhone angle", description: "Low three-quarter, plain ground", device: "iphone-17-pro-max-glb", finish: "model", scene: "custom",
    camera: { x: 26, y: -34, z: 3, fov: 30, zoom: 1.12, panX: -0.02, panY: -0.03 }, rot: { x: 0, y: 0, z: 0 }, aspect: "4:3", motion: "low-pan-up",
    background: { type: "color", color: "#f2f2f2" }, swatch: ["#f2f2f2", "#d0d0d0"], thumbAt: 0.6,
  },
  {
    id: "macbook-1", screen: "analytics", name: "MacBook 1", description: "Open lid on a light sweep", device: "macbook-pro-14-glb", finish: "space-gray", scene: "studio",
    camera: { x: -24, y: 16, z: 0, fov: 26, zoom: 1.02, panX: 0, panY: 0.02 }, rot: { x: 0, y: 6, z: 0 }, aspect: "16:9", swatch: ["#e6e6e6", "#f4f4f4"],
    sequence: [
      { kind: "media", name: "Open", duration: 4, keyframes: { "mockup.lid": [{ t: 0, v: 62, ease: "easeInOut" }, { t: 2.6, v: 108, ease: "easeInOut" }], "camera.zoom": [{ t: 0, v: 1.15, ease: "easeInOut" }, { t: 4, v: 1.0, ease: "easeInOut" }] } },
      { kind: "media", name: "Detail", duration: 3.5, motion: "scan-lr" },
    ],
  },
  {
    id: "clean-demo", screen: "finance-light", name: "Clean demo", description: "Title · two iPhone moves · logo", device: "iphone-17-pro-glb", finish: "model", scene: "custom",
    camera: { x: -30, y: -12, z: 0, fov: 24, zoom: 1.05, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, aspect: "16:9",
    background: { type: "preset", preset: "paper" }, swatch: ["#f7f5f0", "#ddd5c6"], fade: { in: 0.4, out: 0.6, color: "#f7f5f0" },
    sequence: [
      { kind: "text", name: "Title", duration: 2.5, text: { text: "Meet the new\ndashboard", font: "Geist", weight: 700, size: 0.11, color: "#111111", background: "#f7f5f0", letterSpacing: -0.03 }, enter: { effect: "scale", duration: 0.6 }, exit: { effect: "fade", duration: 0.4 }, transitionOut: { ...FADE, color: "#f7f5f0" } },
      { kind: "media", name: "Hero", duration: 4, motion: "slow-zoom-out", transitionOut: { ...FADE, color: "#f7f5f0" } },
      { kind: "media", name: "Scan", duration: 4, motion: "scan-lr", transitionOut: { ...FADE, color: "#f7f5f0" } },
      { kind: "logo", name: "Outro", duration: 2.5, logo: { background: "#111111", scale: 0.32 }, enter: { effect: "blur", duration: 0.6 }, exit: { effect: "fade", duration: 0.5 } },
    ],
  },
  {
    id: "appstore-iphone", screen: "finance-dark", name: "App Store iPhone", description: "1290 × 2796 still", device: "iphone-17-pro-glb", finish: "model", scene: "custom",
    camera: { x: -8, y: 6, z: 0, fov: 24, zoom: 1.02, panX: 0, panY: 0.02 }, rot: { x: 0, y: 0, z: 0 }, aspect: "as-iphone",
    background: { type: "preset", preset: "glaze" }, swatch: ["#f6efe8", "#d7b79c"],
  },
  {
    id: "tablet-corner", screen: "analytics", name: "Tablet corner", description: "Lens blur on an iPad edge", device: "ipad-pro-13-glb", finish: "silver", scene: "custom",
    camera: { x: 24, y: 22, z: 2, fov: 32, zoom: 2.1, panX: -0.42, panY: -0.46 }, rot: { x: 0, y: 0, z: 0 }, aspect: "16:9", motion: "drift",
    background: { type: "preset", preset: "whisp" }, blur: { mode: "depth", strength: 9, focusSize: 0.35, falloff: 0.3, focusX: 0.32, focusY: 0.42 }, swatch: ["#f4f4f6", "#c5c9d3"],
  },
  {
    id: "linear", screen: "analytics", name: "Linear", description: "Dark, typographic MacBook sequence", device: "macbook-pro-16-glb", finish: "space-black", scene: "darkroom",
    camera: { x: 20, y: 14, z: 0, fov: 24, zoom: 1.1, panX: 0, panY: 0.02 }, rot: { x: 0, y: -14, z: 0 }, aspect: "16:9",
    effects: [fx("grain", { amount: 0.16 }), fx("vignette", { darkness: 0.55, offset: 0.3 })], swatch: ["#0b0b0f", "#2a2a33"], fade: { in: 0.5, out: 0.8, color: "#000000" },
    sequence: [
      { kind: "text", name: "Build", duration: 2.2, text: { text: "Build faster.", font: "Geist", weight: 600, size: 0.12, color: "#f4f4f6", background: "#0b0b0f", letterSpacing: -0.035 }, enter: { effect: "slideUp", duration: 0.7 }, exit: { effect: "fade", duration: 0.4 }, transitionOut: FADE },
      { kind: "media", name: "Laptop", duration: 5, motion: "low-pan-up", transitionOut: FADE },
      { kind: "text", name: "Ship", duration: 2.2, text: { text: "Ship today.", font: "Geist", weight: 600, size: 0.12, color: "#f4f4f6", background: "#0b0b0f", letterSpacing: -0.035 }, enter: { effect: "slideUp", duration: 0.7 }, exit: { effect: "fade", duration: 0.5 } },
    ],
  },
  {
    id: "brutal-phone", screen: "finance-dark", name: "Brutal phone", description: "Square, grainy, high contrast", device: "iphone-16-pro-max-glb", finish: "model", scene: "custom",
    camera: { x: 0, y: 0, z: 0, fov: 30, zoom: 1.2, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, aspect: "1:1", motion: "push-in",
    background: { type: "color", color: "#000000" }, effects: [fx("grain", { amount: 0.5 }), fx("vignette", { darkness: 0.7, offset: 0.25 }), fx("chromatic", { amount: 0.4 })], swatch: ["#000000", "#333333"], thumbAt: 0.15,
  },
  {
    id: "hero-detail", screen: "finance-dark", name: "Hero detail", description: "Corner close-up with radial blur", device: "iphone-17-pro-glb", finish: "model", scene: "custom",
    camera: { x: 22, y: 26, z: 1, fov: 45, zoom: 1.925, panX: -0.445, panY: -0.594 }, rot: { x: 0, y: 0, z: 0 }, aspect: "16:9", motion: "drift",
    background: { type: "preset", preset: "whisp" }, blur: { mode: "radial", strength: 8, focusSize: 0.3, falloff: 0.35, focusX: 0.3, focusY: 0.35 }, swatch: ["#f4f4f6", "#c5c9d3"],
  },
  {
    id: "flat-look", screen: "landing", name: "Flat look", description: "Straight-on browser card", device: "browser", finish: "light", scene: "custom",
    camera: { x: 0, y: 0, z: 0, fov: 20, zoom: 0.95, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, aspect: "16:9",
    background: { type: "preset", preset: "paper" }, swatch: ["#f7f5f0", "#ddd5c6"],
  },
  {
    id: "violet-glass", screen: "music", name: "Violet glass", description: "Liquid glass over lilac", device: "iphone-17-pro-max-glb", finish: "model", scene: "custom",
    camera: { x: -20, y: 10, z: 0, fov: 24, zoom: 0.82, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, aspect: "4:5", motion: "out-and-back",
    background: { type: "preset", preset: "lilac" }, effects: [fx("liquidGlass", { x: 0.5, y: 0.5, width: 0.5, height: 0.3, radius: 0.14, refraction: 0.55, tint: 0.14 })], swatch: ["#f1ecfa", "#a992d8"],
  },
  {
    id: "spectrum", screen: "music", name: "Spectrum", description: "Watch flip with bloom and fringing", device: "apple-watch-9-glb", finish: "midnight", scene: "custom",
    camera: { x: -20, y: 14, z: 6, fov: 24, zoom: 1.1, panX: 0, panY: 0 }, rot: { x: 0, y: 0, z: 0 }, aspect: "1:1", motion: "orbit",
    background: { type: "preset", preset: "dusk" }, effects: [fx("bloom", { intensity: 0.8, threshold: 0.7, radius: 0.7 }), fx("chromatic", { amount: 0.3 })], swatch: ["#2b1c3a", "#c2664f"],
  },
  {
    id: "macbook-2", screen: "analytics", name: "MacBook 2", description: "Lid opens as the camera settles", device: "macbook-pro-16-glb", finish: "space-black", scene: "studio",
    camera: { x: -26, y: 22, z: 0, fov: 26, zoom: 1.05, panX: 0, panY: 0.03 }, rot: { x: 0, y: 8, z: 0 }, aspect: "16:9", swatch: ["#dcdcdc", "#f0f0f0"],
    sequence: [
      { kind: "media", name: "Open", duration: 4.5, keyframes: { "mockup.lid": [{ t: 0, v: 28, ease: "easeInOut" }, { t: 3.2, v: 110, ease: "easeInOut" }], "camera.y": [{ t: 0, v: 34, ease: "easeInOut" }, { t: 4.5, v: 18, ease: "easeInOut" }], "camera.zoom": [{ t: 0, v: 1.2, ease: "easeInOut" }, { t: 4.5, v: 1.02, ease: "easeInOut" }] } },
      { kind: "media", name: "Scan", duration: 4, motion: "scan-lr" },
    ],
  },
];
