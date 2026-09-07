import type { BlurMode, EffectInstance, DeviceOrientation, LightingId, Project, ScenePresetId, Shot } from "./types";
import { getDevice } from "./devices";
import { deviceOrientation } from "./orientation";

/**
 * What a shot actually looks like. Ultramock scopes the device, environment and lighting to each
 * shot; mok keeps project-level values as the default and lets any shot override them, so a
 * sequence can cut between a MacBook in a dark room and a phone on a light sweep.
 */
export interface ShotView {
  device: string;
  orientation: DeviceOrientation;
  finish: string;
  scene: ScenePresetId;
  lighting: LightingId;
  blurMode: BlurMode;
  bokeh: boolean;
  notch: boolean;
}

export function resolveShotView(p: Project, shot: Shot | null | undefined): ShotView {
  return {
    device: shot?.device ?? p.mockup.device,
    orientation: deviceOrientation(getDevice(shot?.device ?? p.mockup.device), shot?.orientation ?? p.mockup.orientation),
    finish: shot?.finish ?? p.mockup.finish,
    scene: shot?.scene ?? p.scene.preset,
    lighting: shot?.lighting ?? p.scene.lighting,
    blurMode: shot?.blurMode ?? p.blur.mode,
    bokeh: shot?.bokeh ?? p.blur.bokeh,
    notch: shot?.notch ?? p.mockup.notch ?? true,
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
  return p.shots.some((s) => s.device || s.orientation || s.finish || s.scene || s.lighting || s.blurMode || s.notch !== undefined || s.effects !== undefined || s.screenPadding !== undefined || s.pose);
}

/** Render/export effects follow the shot under the playhead, including gap/end holds. */
export function resolveShotEffects(p: Project, shot: Shot | null | undefined): EffectInstance[] {
  return shot?.effects ?? p.effects;
}

export function resolveScreenPadding(p: Project, shot: Shot | null | undefined): number {
  const value = shot?.screenPadding ?? p.screen.padding ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.min(0.45, value)) : 0;
}

/** Lazily snapshot inherited effects on the first shot edit; never mutate project defaults. */
export function editShotEffects(p: Project, shotId: string | null, edit: (effects: EffectInstance[]) => void): void {
  if (shotId === null) { edit(p.effects); return; }
  const shot = p.shots.find((item) => item.id === shotId);
  if (!shot) return;
  shot.effects ??= structuredClone(p.effects);
  edit(shot.effects);
}
