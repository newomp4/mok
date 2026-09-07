"use client";
import { useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ownershipReady, releaseProjectOwnership, takeOverProjectOwnership, useProjectOwnership } from "@/lib/projectOwnership";
import { uid } from "@/lib/ids";
import { Button } from "@/components/ui";
import { exportProjectToFile } from "./hooks";

export function OwnershipBanner() {
  const state = useProjectOwnership();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const copy = async () => {
    const p = structuredClone(useEditor.getState().project);
    p.id = uid(); p.name = `${p.name} copy`; p.createdAt = p.updatedAt = Date.now();
    useEditor.getState().replaceProject(p);
    await ownershipReady(p.id);
    useUI.getState().showToast("Editing a separate copy. The other tab keeps its project.");
  };
  if (!state.enabled) return null;
  if (state.mode === "editing") return <div className="flex items-center justify-between px-2 text-[11px] text-muted" role="status"><span>Editing in this tab</span><Button size="sm" variant="ghost" onClick={() => void run(releaseProjectOwnership)} disabled={busy}>Release editing</Button></div>;
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2" role="status" aria-live="polite">
    <div className="min-w-0 flex-1 text-[12px]"><strong>{state.mode === "checking" ? "Opening project" : state.mode === "session" ? "Session only" : "Read-only"}</strong><span className="ml-2 text-fg-2">{state.reason}</span>{state.mode !== "checking" && <p className="mt-1 text-[11px] text-muted">{state.mode === "session" ? "Retry storage" : "Edit here"} opens the latest saved draft. Keep a copy first to preserve this tab&apos;s local view.</p>}</div>
    {state.mode !== "checking" && <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="soft" onClick={() => void exportProjectToFile()}>Download project</Button>
      <Button size="sm" variant="soft" onClick={() => void run(copy)} disabled={busy}>Edit a copy</Button>
      <Button size="sm" variant="accent" onClick={() => void run(takeOverProjectOwnership)} disabled={busy}>{state.mode === "session" ? "Retry storage" : "Edit here"}</Button>
    </div>}
  </div>;
}
