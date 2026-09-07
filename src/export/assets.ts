import type { MediaRef, Project, Shot } from "@/lib/types";
import { locate } from "@/lib/animation";
import { audioLength } from "@/lib/audioPlan";
import { resolveShotView } from "@/lib/shotView";

export type ExportScope = { type: "still"; time: number } | { type: "video"; start: number; end: number };

/** Visible intervals include the preceding shot held through a gap and the last shot's tail. */
export function shotsInExport(project: Project, scope: ExportScope): Shot[] {
  if (scope.type === "still") {
    const shot = locate(project, scope.time).shot;
    return shot ? [shot] : [];
  }
  let cursor = 0;
  const starts = project.shots.map((shot) => {
    cursor += Math.max(0, shot.gap ?? 0);
    const start = cursor;
    cursor += shot.duration;
    return start;
  });
  return project.shots.filter((_, i) => {
    const start = i === 0 ? -Infinity : starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : Infinity;
    return scope.start < end && scope.end > start;
  });
}

/** Only preload references that can contribute pixels or sound to this particular output. */
export function exportAssets(project: Project, scope: ExportScope, transparent: boolean) {
  const shots = shotsInExport(project, scope);
  const media = new Map<string, MediaRef>();
  const add = (ref: MediaRef | null | undefined) => { if (ref) media.set(ref.id, ref); };
  const mediaShots = shots.filter((s) => (s.kind ?? "media") === "media");
  for (const shot of shots) {
    if ((shot.kind ?? "media") === "media") add(shot.media);
    else if (shot.kind === "logo") add(shot.logo?.media);
  }
  // Full-frame text/logo cards cover the scene. Room presets use a color, not the image field.
  const sceneViews = project.shots.length === 0 ? [null] : mediaShots;
  if (!transparent && project.scene.background.type === "image" && sceneViews.some((s) => resolveShotView(project, s).scene === "custom")) add(project.scene.background.image);
  // A missing-media placeholder paints its own background and never samples this image.
  if (project.screen.bg?.type === "image" && mediaShots.some((s) => s.media)) add(project.screen.bg.image);
  const track = project.audio;
  const audio = scope.type === "video" && track && track.volume > 0 &&
    track.start < scope.end && track.start + audioLength(track) > scope.start ? track : null;
  if (audio) add(audio.media);
  const fonts = shots.filter((s) => s.kind === "text" && s.text).map((s) => s.text!);
  return { shots, media: [...media.values()], fonts, audio };
}

/** A video's interval is half open; a sample at an exact final cut must not reveal the next shot. */
export function exportSampleTime(time: number, end: number): number {
  return Math.max(0, Math.min(time, end - Math.max(1e-9, Number.EPSILON * Math.max(1, end))));
}
