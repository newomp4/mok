import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { canEditProject } from "./projectOwnership";
import { locate, shotStart } from "./animation";
import { shotKind } from "./defaults";

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
