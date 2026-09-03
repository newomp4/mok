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

export type MediaKind = "image" | "video" | "audio";
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

/** cubic-bezier control points [x1, y1, x2, y2], as in CSS timing functions */
export type EaseCurve = [number, number, number, number];

export interface Keyframe {
  t: number;
  v: number;
  ease: EaseId;
  /** when set, this curve is used instead of the named ease */
  cp?: EaseCurve;
}

export const ANIM_PROPS = [
  "camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY",
  "mockup.rotX", "mockup.rotY", "mockup.rotZ", "mockup.lid",
  "scene.lightRotX", "scene.lightRotY", "scene.lightIntensity",
  "blur.strength", "blur.focusSize", "blur.falloff", "blur.focusX", "blur.focusY", "blur.focusDistance",
  "screen.brightness",
] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];

export const ANIM_LABELS: Record<AnimProp, string> = {
  "camera.x": "Camera X", "camera.y": "Camera Y", "camera.z": "Camera Roll", "camera.fov": "FOV",
  "camera.zoom": "Zoom", "camera.panX": "Pan X", "camera.panY": "Pan Y",
  "mockup.rotX": "Rotate X", "mockup.rotY": "Rotate Y", "mockup.rotZ": "Rotate Z", "mockup.lid": "Lid angle",
  "scene.lightRotX": "Light Rot X", "scene.lightRotY": "Light Rot Y", "scene.lightIntensity": "Light Intensity",
  "blur.strength": "Blur Strength", "blur.focusSize": "Focus Size", "blur.falloff": "Falloff",
  "blur.focusX": "Focus X", "blur.focusY": "Focus Y", "blur.focusDistance": "Focus Distance", "screen.brightness": "Screen Brightness",
};

export type FitMode = "cover" | "contain" | "stretch";

export interface FocusArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ShotKind = "media" | "text" | "logo";
export type EnterExitEffect = "none" | "fade" | "slideUp" | "slideDown" | "slideLeft" | "slideRight" | "scale" | "blur";
export interface EnterExit {
  effect: EnterExitEffect;
  duration: number;
}
export interface TextStyle {
  text: string;
  font: string;
  weight: number;
  /** font size as a fraction of the frame height */
  size: number;
  color: string;
  align: "left" | "center" | "right";
  background: string;
  lineHeight: number;
  /** em units */
  letterSpacing: number;
}
export type LogoEffect = "none" | "liquidMetal" | "gemSmoke" | "heatmap";
export interface LogoStyle {
  media: MediaRef | null;
  /** logo height as a fraction of the frame height */
  scale: number;
  background: string;
  effect: LogoEffect;
}
export type TransitionType = "cut" | "fade";
export interface Transition {
  type: TransitionType;
  duration: number;
  color: string;
}

export interface Shot {
  id: string;
  name: string;
  duration: number;
  media: MediaRef | null;
  fit: FitMode;
  keyframes: Partial<Record<AnimProp, Keyframe[]>>;
  focusAreas: FocusArea[];
  /** media (default), text card or logo card */
  kind?: ShotKind;
  text?: TextStyle;
  logo?: LogoStyle;
  enter?: EnterExit;
  exit?: EnterExit;
  /** video playback speed (0.25 – 4) */
  speed?: number;
  /** seconds into the video where the shot starts */
  trimStart?: number;
  /** how this shot hands over to the next one */
  transitionOut?: Transition;
}

export interface AudioTrack {
  media: MediaRef;
  /** timeline second where the clip starts */
  start: number;
  /** seconds trimmed from the clip's head */
  trimStart: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export type BackgroundType = "color" | "preset" | "image" | "transparent";
export type ScenePresetId = "custom" | "studio" | "concrete" | "darkroom" | "gallery";
export type LightingId = "default" | "soft" | "bright" | "contrast" | "neon" | "cool" | "lightbox" | "dramatic";
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
    /** contact shadow blur (0..1) and opacity (0..1) on the custom scene */
    shadowSoft?: number;
    shadowOpacity?: number;
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
    /** laptop lid opening angle in degrees (keyframeable) */
    lid?: number;
    /** show the Dynamic Island / notch on phones */
    notch?: boolean;
    /** tablets: keep the keyboard case on */
    caseKeyboard?: boolean;
    /** watches: tint the band */
    bandColor?: string | null;
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
    /** lens blur: metres in front of the camera; 0 = autofocus on the surface under the focus point */
    focusDistance?: number;
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
    /** what shows behind media that does not fill the screen (contain fit) */
    bg?: { type: "color" | "image"; color: string; image: MediaRef | null };
    /** paint an iOS-style status bar over the screen (phones) */
    statusBar?: boolean;
  };
  effects: EffectInstance[];
  shots: Shot[];
  fps: number;
  audio?: AudioTrack | null;
  /** fade the whole video in from / out to a colour */
  fade?: { in: number; out: number; color: string };
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  device: string;
}
