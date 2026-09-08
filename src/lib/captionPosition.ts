import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { canEditProject } from "./projectOwnership";
import { locate, shotStart } from "./animation";
import { shotKind } from "./defaults";
import type { Project } from "./types";
type PositionTarget = NonNullable<ReturnType<typeof useUI.getState>["captionPosition"]>;

export function positionedCaption(p: Project, mode: PositionTarget | null) {
  return mode?.overlayId ? p.textOverlays?.find((t) => t.id === mode.overlayId) : p.shots.find((s) => s.id === mode?.shotId)?.caption;
}
export function updateCaptionPosition(mode: PositionTarget, x: number, y: number) {
  const set = (c: { x: number; y: number }) => { c.x = x; c.y = y; };
  if (mode.overlayId) useEditor.getState().updateTextOverlay(mode.overlayId, set);
  else if (mode.shotId) useEditor.getState().updateShot(mode.shotId, (s) => { if (s.caption) set(s.caption); });
}


/** Show a settled point in the caption animation when a newly enabled caption is invisible. */
export function previewCaption(shotId: string) {
  const p = useEditor.getState().project, shot = p.shots.find((s) => s.id === shotId), c = shot?.caption;
  if (!shot || !c?.enabled || !canEditProject(p.id)) return;
  const start = shotStart(p, shotId), ui = useUI.getState(), timing = c.timing ?? { offset: 0, duration: shot.duration };
  const local = Math.max(0, Math.min(shot.duration, ui.time - start));
  const t = timing.offset + local;
  const entering = c.enter && c.enter.effect !== "none" ? c.enter.duration : 0;
  const exiting = c.exit && c.exit.effect !== "none" ? c.exit.duration : 0;
  const settled = Math.max(0, Math.min(shot.duration / 2, entering - timing.offset));
  useUI.setState({ playing: false, activeShotId: shotId, time: t < entering || t > timing.duration - exiting ? start + settled : start + local });
}

export function canPositionCaption() {
  const ui = useUI.getState(), p = useEditor.getState().project, mode = ui.captionPosition;
  if (!mode || mode.projectId !== p.id || ui.playing || ui.exporting || ui.autoMotion || ui.modal || ui.cropShot || !canEditProject(p.id)) return false;
  if (mode.overlayId) {
    const t = p.textOverlays?.find((t) => t.id === mode.overlayId);
    return ui.activeTextOverlayId === mode.overlayId && !!t?.enabled && ui.time >= t.start && ui.time < t.start + t.duration;
  }
  const selected = ui.activeShotId ?? locate(p, ui.time).shot?.id;
  const shot = p.shots.find((s) => s.id === mode.shotId);
  return selected === mode.shotId && !!shot?.caption?.enabled && shotKind(shot) === "media";
}

export function startCaptionPosition(shotId: string) {
  const p = useEditor.getState().project, shot = p.shots.find((s) => s.id === shotId);
  if (!shot?.caption?.enabled || shotKind(shot) !== "media" || !canEditProject(p.id) || useUI.getState().exporting) return false;
  previewCaption(shotId);
  useUI.setState({ captionPosition: { projectId: p.id, shotId }, autoMotion: false });
  return true;
}

export function startTextOverlayPosition(overlayId: string) {
  const p = useEditor.getState().project, t = p.textOverlays?.find((t) => t.id === overlayId);
  if (!t?.enabled || !canEditProject(p.id) || useUI.getState().exporting) return false;
  const local = Math.min(t.duration / 2, Math.max(0, (t.enter?.duration ?? 0) - (t.timing?.offset ?? 0)));
  useUI.setState({ captionPosition: { projectId: p.id, overlayId }, activeTextOverlayId: overlayId, selectedShots: [], selectedKeys: [], playing: false, autoMotion: false, time: t.start + local });
  return true;
}
