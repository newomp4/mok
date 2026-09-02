import { uid } from "./ids";
import type { EnterExit, Project, Shot, TextStyle, LogoStyle } from "./types";

export function createShot(name: string, duration = 3): Shot {
  return { id: uid(), name, duration, media: null, fit: "cover", keyframes: {}, focusAreas: [] };
}

export const DEFAULT_ENTER: EnterExit = { effect: "fade", duration: 0.4 };
export const DEFAULT_EXIT: EnterExit = { effect: "fade", duration: 0.4 };

export function defaultTextStyle(): TextStyle {
  return { text: "Your headline here", font: "Geist", weight: 600, size: 0.09, color: "#111111", align: "center", background: "#f2f2f2", lineHeight: 1.15, letterSpacing: -0.02 };
}

export function defaultLogoStyle(): LogoStyle {
  return { media: null, scale: 0.35, background: "#f2f2f2", effect: "none" };
}

export function createTextShot(name = "Text", duration = 3): Shot {
  return { ...createShot(name, duration), kind: "text", text: defaultTextStyle(), enter: { ...DEFAULT_ENTER }, exit: { ...DEFAULT_EXIT } };
}

export function createLogoShot(name = "Logo", duration = 3): Shot {
  return { ...createShot(name, duration), kind: "logo", logo: defaultLogoStyle(), enter: { ...DEFAULT_ENTER }, exit: { ...DEFAULT_EXIT } };
}

export function shotKind(s: Shot | null | undefined): "media" | "text" | "logo" {
  return s?.kind ?? "media";
}

export function createProject(): Project {
  const now = Date.now();
  return {
    id: uid(),
    name: "Untitled",
    version: 1,
    createdAt: now,
    updatedAt: now,
    aspect: "fill",
    scene: {
      preset: "custom",
      lighting: "default",
      lightRotX: 0,
      lightRotY: 263,
      lightIntensity: 1,
      contactShadow: true,
      background: { type: "preset", color: "#f2f2f2", preset: "whisp", image: null, blur: 0.85 },
    },
    mockup: { device: "iphone-17-pro-glb", finish: "model", reflection: 0.99, gloss: 1.4, borderRadius: 0.04, rotX: 0, rotY: 8, rotZ: 0, lid: 110, notch: true, caseKeyboard: true, bandColor: null },
    camera: { x: -48, y: -24, z: 0, fov: 24, zoom: 1.58, panX: 0.073, panY: -0.207 },
    blur: { mode: "radial", strength: 6, focusSize: 0.42, falloff: 0.4, bokeh: true, focusX: 0.5, focusY: 0.4 },
    screen: { brightness: 1, bg: { type: "color", color: "#000000", image: null }, statusBar: false },
    effects: [],
    shots: [openingShot(), createShot("Shot 2", 3)],
    fps: 30,
    audio: null,
    fade: { in: 0, out: 0, color: "#000000" },
  };
}

/** Fill fields that older saved projects predate. */
export function normalizeProject(p: Project): Project {
  p.mockup.lid ??= 110;
  p.mockup.notch ??= true;
  p.mockup.caseKeyboard ??= true;
  p.mockup.bandColor ??= null;
  p.screen.bg ??= { type: "color", color: "#000000", image: null };
  p.screen.statusBar ??= false;
  p.audio ??= null;
  p.fade ??= { in: 0, out: 0, color: "#000000" };
  for (const s of p.shots) { s.kind ??= "media"; s.focusAreas ??= []; s.keyframes ??= {}; }
  return p;
}

/** Shot 1 opens with the same gentle settle as Ultramock's starter project. */
function openingShot(): Shot {
  const s = createShot("Shot 1", 3);
  s.keyframes = {
    "camera.x": [{ t: 0, v: -48, ease: "easeInOut" }, { t: 3, v: -13.75, ease: "easeInOut" }],
    "camera.y": [{ t: 0, v: -24, ease: "easeInOut" }, { t: 3, v: -24.43, ease: "easeInOut" }],
    "camera.panX": [{ t: 0, v: 0.073, ease: "easeInOut" }, { t: 3, v: 0.037, ease: "easeInOut" }],
  };
  return s;
}
