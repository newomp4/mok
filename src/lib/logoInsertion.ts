import { useEditor, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { canEditProject, writeTicket } from "./projectOwnership";
import { createLogoShot } from "./defaults";
import { deleteMedia, importMedia } from "./media";
import { shotStart } from "./animation";

/** Decode first, then insert one complete shot. Cancel, project changes and lost leases are no-ops. */
export async function insertLogoFromPicker(pick: () => Promise<File | undefined>, afterId?: string): Promise<string | null> {
  const original = useEditor.getState().project, ticket = writeTicket(original.id);
  let changedProject = false;
  const unsubscribe = useEditor.subscribe((s, old) => { if (s.project.id !== old.project.id) changedProject = true; });
  const current = () => !changedProject && useEditor.getState().project.id === original.id && canEditProject(original.id) && writeTicket(original.id)?.token === ticket?.token && (!afterId || useEditor.getState().project.shots.some((s) => s.id === afterId));
  let imported: Awaited<ReturnType<typeof importMedia>> | null = null, committed = false;
  try {
    if (!current()) return null;
    const file = await pick();
    if (!file || !current()) return null;
    imported = await importMedia(file);
    if (imported.kind !== "image") throw new Error("Choose a PNG, SVG or another supported image for the logo.");
    if (!current()) return null;
    const logo = createLogoShot(); logo.logo!.media = imported;
    beginInteraction();
    try { useEditor.getState().update((p) => { const at = afterId ? p.shots.findIndex((s) => s.id === afterId) + 1 : p.shots.length; p.shots.splice(at, 0, logo); }); }
    finally { endInteraction(); }
    committed = useEditor.getState().project.shots.some((s) => s.id === logo.id);
    if (!committed) return null;
    useUI.setState({ activeShotId: logo.id, selectedShots: [logo.id], selectedKeys: [], playing: false, time: shotStart(useEditor.getState().project, logo.id) });
    return logo.id;
  } catch (error) { useUI.getState().showToast(`Could not add logo: ${(error as Error).message}`); return null; }
  finally { unsubscribe(); if (imported && !committed) await deleteMedia(imported.id); }
}
