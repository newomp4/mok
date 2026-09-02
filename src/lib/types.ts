export type AspectId =
  | "fill" | "21:9" | "16:9" | "3:2" | "4:3" | "1:1" | "4:5" | "3:4" | "2:3" | "9:16"
  | "as-iphone" | "as-ipad" | "as-mac" | "as-video-h" | "as-video-v";

export interface AspectDef {
  id: AspectId;
  label: string;
  /** width / height, null = fill viewport */
  ratio: number | null;
  group: "ratio" | "appstore";
  /** fixed pixel size for app-store presets */
  px?: [number, number];
  sub?: string;
}

export type MediaKind = "image" | "video";
export interface MediaRef {
  id: string;
  kind: MediaKind;
  width: number;
  height: number;
  name: string;
  duration?: number;
}

export type EaseId =
  | "linear" | "smooth" | "easeIn" | "easeOut" | "easeInOut" | "expoOut" | "expoInOut" | "backOut" | "hold";

export interface Keyframe {
  t: number;
  v: number;
  ease: EaseId;
}

export const ANIM_PROPS = [
  "camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY",
  "mockup.rotX", "mockup.rotY", "mockup.rotZ",
  "scene.lightRotX", "scene.lightRotY", "scene.lightIntensity",
  "blur.strength", "blur.focusSize", "blur.falloff", "blur.focusX", "blur.focusY",
  "screen.brightness",
] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];

export const ANIM_LABELS: Record<AnimProp, string> = {
  "camera.x": "Camera X", "camera.y": "Camera Y", "camera.z": "Camera Roll", "camera.fov": "FOV",
  "camera.zoom": "Zoom", "camera.panX": "Pan X", "camera.panY": "Pan Y",
  "mockup.rotX": "Rotate X", "mockup.rotY": "Rotate Y", "mockup.rotZ": "Rotate Z",
  "scene.lightRotX": "Light Rot X", "scene.lightRotY": "Light Rot Y", "scene.lightIntensity": "Light Intensity",
  "blur.strength": "Blur Strength", "blur.focusSize": "Focus Size", "blur.falloff": "Falloff",
  "blur.focusX": "Focus X", "blur.focusY": "Focus Y", "screen.brightness": "Screen Brightness",
};

export type FitMode = "cover" | "contain" | "stretch";

export interface FocusArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shot {
  id: string;
  name: string;
  duration: number;
  media: MediaRef | null;
  fit: FitMode;
  keyframes: Partial<Record<AnimProp, Keyframe[]>>;
  focusAreas: FocusArea[];
}

export type BackgroundType = "color" | "preset" | "image" | "transparent";
export type ScenePresetId = "custom" | "studio" | "concrete" | "darkroom" | "gallery";
export type LightingId = "default" | "soft" | "bright" | "contrast" | "neon" | "cool";
export type BlurMode = "off" | "radial" | "directional" | "linear" | "depth";
export type EffectId =
  | "vignette" | "grain" | "bloom" | "chromatic" | "sharpen" | "pixel" | "fisheye" | "glassBorder" | "screenFade" | "ghost" | "liquidGlass";

export interface EffectInstance {
  id: EffectId;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Project {
  id: string;
  name: string;
  version: 1;
  createdAt: number;
  updatedAt: number;
  aspect: AspectId;
  scene: {
    preset: ScenePresetId;
    lighting: LightingId;
    lightRotX: number;
    lightRotY: number;
    lightIntensity: number;
    contactShadow: boolean;
    background: {
      type: BackgroundType;
      color: string;
      preset: string;
      image: MediaRef | null;
      blur: number;
    };
  };
  mockup: {
    device: string;
    finish: string;
    reflection: number;
    /** environment reflectivity of glTF body materials (1 = as authored) */
    gloss?: number;
    borderRadius: number;
    rotX: number;
    rotY: number;
    rotZ: number;
  };
  camera: {
    x: number;
    y: number;
    z: number;
    fov: number;
    zoom: number;
    panX: number;
    panY: number;
  };
  blur: {
    mode: BlurMode;
    /** direction of the directional blur, degrees */
    angle?: number;
    strength: number;
    focusSize: number;
    falloff: number;
    bokeh: boolean;
    focusX: number;
    focusY: number;
  };
  screen: {
    brightness: number;
  };
  effects: EffectInstance[];
  shots: Shot[];
  fps: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  device: string;
}
