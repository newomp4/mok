import { uid } from "./ids";
import { validateProject } from "./validateProject";
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
      lighting: "soft",
      lightRotX: 0,
      lightRotY: 200,
      lightIntensity: 0.85,
      contactShadow: true,
      detailShadows: 0,
      shadowSoft: 0.5,
      shadowOpacity: 0.5,
      background: { type: "preset", color: "#f2f2f2", preset: "paper", image: null, blur: 0.6 },
    },
    mockup: { device: "iphone-17-pro-glb", finish: "model", reflection: 0.35, gloss: 1, borderRadius: 0.04, rotX: 0, rotY: 0, rotZ: 0, lid: 110, notch: true, caseKeyboard: true, bandColor: null },
    camera: { x: -22, y: 12, z: -3, fov: 30, zoom: 0.92, panX: 0, panY: 0 },
    blur: { mode: "off", strength: 6, focusSize: 0.42, falloff: 0.4, bokeh: true, focusX: 0.5, focusY: 0.5, focusDistance: 0, angle: 0 },
    screen: { padding: 0, brightness: 1, spill: 1, bg: { type: "color", color: "#000000", image: null }, statusBar: false },
    effects: [],
    shots: [createShot("Shot 1", 3), createShot("Shot 2", 3)],
    fps: 30,
    audio: null,
    fade: { in: 0, out: 0, color: "#000000" },
  };
}

/** Validate restored projects and fill fields older saved projects predate. */
export function normalizeProject(p: Project): Project {
  return validateProject(p, createProject());
}
