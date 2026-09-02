import { uid } from "./ids";
import type { Project, Shot } from "./types";

export function createShot(name: string, duration = 3): Shot {
  return { id: uid(), name, duration, media: null, fit: "cover", keyframes: {}, focusAreas: [] };
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
    mockup: { device: "iphone-17-pro-glb", finish: "model", reflection: 0.99, gloss: 1.4, borderRadius: 0.04, rotX: 0, rotY: 8, rotZ: 0 },
    camera: { x: -48, y: 24, z: 0, fov: 24, zoom: 1.682, panX: 0.054, panY: -0.153 },
    blur: { mode: "off", strength: 10, focusSize: 0.52, falloff: 0, bokeh: true, focusX: 0.5, focusY: 0.5 },
    screen: { brightness: 1 },
    effects: [],
    shots: [createShot("Shot 1", 3), createShot("Shot 2", 3)],
    fps: 30,
  };
}
