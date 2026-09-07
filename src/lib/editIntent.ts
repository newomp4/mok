import { useEditor } from "@/store/editor";
import { canEditProject, useProjectOwnership, writeTicket } from "./projectOwnership";
import type { Project } from "./types";

/** An asynchronous edit cannot outlive its project, target or editing lease, even after undo. */
export function captureEditIntent(target: (p: Project) => boolean = () => true) {
  const original = useEditor.getState().project, ticket = writeTicket(original.id);
  const matches = () => {
    const p = useEditor.getState().project;
    return p.id === original.id && canEditProject(p.id) && writeTicket(p.id)?.token === ticket?.token && target(p);
  };
  let cancelled = !matches();
  const check = () => { if (!matches()) cancelled = true; };
  const stopProject = useEditor.subscribe(check), stopOwnership = useProjectOwnership.subscribe(check);
  return { current: () => !cancelled && matches(), dispose: () => { stopProject(); stopOwnership(); } };
}
