import type { LightingId, Project, ScenePresetId, Shot } from "./types";

/**
 * What a shot actually looks like. Ultramock scopes the device, environment and lighting to each
 * shot; mok keeps project-level values as the default and lets any shot override them, so a
 * sequence can cut between a MacBook in a dark room and a phone on a light sweep.
 */
export interface ShotView {
  device: string;
  finish: string;
  scene: ScenePresetId;
  lighting: LightingId;
}

export function resolveShotView(p: Project, shot: Shot | null | undefined): ShotView {
  return {
    device: shot?.device ?? p.mockup.device,
    finish: shot?.finish ?? p.mockup.finish,
    scene: shot?.scene ?? p.scene.preset,
    lighting: shot?.lighting ?? p.scene.lighting,
  };
}

/** Every distinct device the project can show, so they can all be kept loaded during playback. */
export function devicesInProject(p: Project): string[] {
  const out = new Set<string>([p.mockup.device]);
  for (const s of p.shots) if (s.device) out.add(s.device);
  return [...out];
}

/** True when any shot overrides something, i.e. the per-shot column is worth showing. */
export function hasShotOverrides(p: Project): boolean {
  return p.shots.some((s) => s.device || s.finish || s.scene || s.lighting);
}
