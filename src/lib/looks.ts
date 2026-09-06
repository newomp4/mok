import type { AnimProp, LightingId, Project, ScenePresetId } from "./types";

export interface StudioLook {
  id: string;
  name: string;
  description: string;
  scene: ScenePresetId;
  lighting: LightingId;
  color: string;
  rotation: number;
  intensity: number;
  reflection: number;
  gloss: number;
  swatch: string;
}

export const STUDIO_LOOKS: StudioLook[] = [
  { id: "softbox", name: "Softbox", description: "Soft silver · gentle shadows", scene: "studio", lighting: "soft", color: "#dedee2", rotation: 200, intensity: 0.85, reflection: 0.35, gloss: 1, swatch: "radial-gradient(ellipse at 30% 20%, #fff, #d6d6db 65%, #b3b4bc)" },
  { id: "daylight", name: "Daylight", description: "Bright white · clean detail", scene: "gallery", lighting: "lightbox", color: "#f4f4f4", rotation: 120, intensity: 0.9, reflection: 0.22, gloss: 1, swatch: "linear-gradient(135deg, #fff 25%, #ebedf0 65%, #ced2da)" },
  { id: "midnight", name: "Midnight", description: "Cool rim · reflective floor", scene: "darkroom", lighting: "neon", color: "#08090d", rotation: 60, intensity: 0.45, reflection: 0.5, gloss: 1.1, swatch: "radial-gradient(ellipse at 65% 0%, #566582, #202634 40%, #090a0e 80%)" },
  { id: "warm-paper", name: "Warm paper", description: "Warm light · quiet backdrop", scene: "custom", lighting: "contrast", color: "#e8e0d5", rotation: 40, intensity: 0.8, reflection: 0.28, gloss: 1, swatch: "radial-gradient(ellipse at 25% 20%, #fff5e5, #dfd1bf 65%, #b8a58e)" },
];

/** A look changes the set, preserving the media, framing, lens and relative light animation. */
export function applyStudioLook(project: Project, look: StudioLook) {
  const previous = project.scene;
  const values: Partial<Record<AnimProp, [number, number]>> = {
    "scene.lightRotX": [previous.lightRotX, 0],
    "scene.lightRotY": [previous.lightRotY, look.rotation],
    "scene.lightIntensity": [previous.lightIntensity, look.intensity],
  };
  for (const shot of project.shots) {
    delete shot.scene;
    delete shot.lighting;
    for (const [prop, [from, to]] of Object.entries(values) as [AnimProp, [number, number]][]) {
      const adapt = (value: number) => prop === "scene.lightIntensity" && from > 0.001 ? value * to / from : value + to - from;
      for (const key of shot.keyframes[prop] ?? []) key.v = Math.max(prop === "scene.lightIntensity" ? 0 : -Infinity, adapt(key.v));
      if (shot.pose?.[prop] !== undefined) shot.pose[prop] = adapt(shot.pose[prop]!);
    }
  }
  project.scene = {
    ...previous, preset: look.scene, lighting: look.lighting,
    lightRotX: 0, lightRotY: look.rotation, lightIntensity: look.intensity,
    contactShadow: true, shadowSoft: 0.65, shadowOpacity: 0.45,
    background: { type: "color", color: look.color, preset: "paper", image: null, blur: 0 },
  };
  project.mockup.reflection = look.reflection;
  project.mockup.gloss = look.gloss;
}
