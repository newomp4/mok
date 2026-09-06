import { useEditor } from "@/store/editor";
import type { MediaRef, Project } from "./types";
import { deleteMedia, importMedia } from "./media";

export type MediaRepairTarget = { kind: "shot" | "logo"; shotId: string } | { kind: "audio" };

function targetRef(project: Project, target: MediaRepairTarget) {
  if (target.kind === "audio") return project.audio?.media;
  const shot = project.shots.find((s) => s.id === target.shotId);
  return target.kind === "logo" ? shot?.logo?.media : shot?.media;
}

const attempts = new Map<string, symbol>();

/** Re-link a missing source without resetting the shots which use it or their soundtrack mix. */
export async function repairMedia(file: File, projectId: string, expected: MediaRef, target: MediaRepairTarget): Promise<boolean> {
  const key = `${projectId}:${expected.id}`;
  const token = Symbol();
  attempts.set(key, token);
  let projectChanged = false;
  const unsubscribe = useEditor.subscribe((s, prev) => { if (s.project.id !== prev.project.id) projectChanged = true; });
  const current = () => {
    const p = useEditor.getState().project;
    const ref = targetRef(p, target);
    return !projectChanged && p.id === projectId && attempts.get(key) === token && ref?.id === expected.id && ref.kind === expected.kind;
  };
  let imported: MediaRef | null = null;
  let applied = false;
  try {
    if (!current()) return false;
    imported = await importMedia(file);
    if (imported.kind !== expected.kind) throw new Error(`Choose a matching ${expected.kind} file to restore ${expected.name}`);
    if (!current()) return false;
    const replacement = imported;
    useEditor.getState().update((p) => {
      // Split clips and duplicated shots can share a source. Repair every use within this project.
      const matches = (ref: MediaRef | null | undefined) => ref?.id === expected.id && ref.kind === expected.kind;
      for (const shot of p.shots) {
        if (matches(shot.media)) shot.media = replacement;
        if (shot.logo && matches(shot.logo.media)) shot.logo.media = replacement;
      }
      if (p.audio && matches(p.audio.media)) p.audio.media = replacement;
      if (matches(p.scene.background.image)) p.scene.background.image = replacement;
      if (p.screen.bg && matches(p.screen.bg.image)) p.screen.bg.image = replacement;
    });
    applied = true;
    return true;
  } finally {
    unsubscribe();
    if (attempts.get(key) === token) attempts.delete(key);
    if (imported && !applied) await deleteMedia(imported.id);
  }
}
