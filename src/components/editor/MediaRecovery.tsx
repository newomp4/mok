"use client";
import { useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { MediaRef } from "@/lib/types";
import { ACCEPTED_AUDIO, ACCEPTED_IMAGES, ACCEPTED_TYPES, retryMedia, type MediaStatus } from "@/lib/media";
import { repairMedia, type MediaRepairTarget } from "@/lib/repairMedia";
import { pickFiles } from "./hooks";

export function MediaRecovery({ media, status, target }: { media: MediaRef; status: MediaStatus; target: MediaRepairTarget }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const missing = status === "missing";
  const pick = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const projectId = useEditor.getState().project.id;
    let projectChanged = false;
    const unsubscribe = useEditor.subscribe((s, prev) => { if (s.project.id !== prev.project.id) projectChanged = true; });
    try {
      const [file] = await pickFiles(media.kind === "audio" ? ACCEPTED_AUDIO : media.kind === "image" ? ACCEPTED_IMAGES : ACCEPTED_TYPES);
      if (file && !projectChanged && await repairMedia(file, projectId, media, target)) useUI.getState().showToast(`File restored · ${file.name}`);
    } catch (error) {
      useUI.getState().showToast(`Could not restore file: ${(error as Error).message}`);
    } finally { unsubscribe(); inFlight.current = false; setBusy(false); }
  };
  return (
    <div role="status" className={`flex flex-col gap-2 rounded-md border p-3 ${missing ? "border-dashed border-amber-500/50 bg-amber-500/5" : "border-line bg-panel-2"}`}>
      <div className="flex items-center gap-1.5 text-fg-2"><Icon name={missing ? "info" : "spinner"} size={13} className={missing ? "text-amber-600 dark:text-amber-400" : "spin"} /><span className="label">{missing ? "Source file unavailable" : "Loading source…"}</span></div>
      <span className="label-sm break-all text-muted">{media.name}</span>
      {missing && <>
        <span className="label-sm text-muted">Choose the source again to restore its clips and keep your edits.</span>
        <Button size="sm" variant="outline" icon="upload" onClick={() => void pick()} disabled={busy}>{busy ? "Restoring…" : "Locate file…"}</Button>
        <button type="button" disabled={busy} className="label-sm text-left text-muted hover:text-fg" onClick={() => void retryMedia(media)}>Retry loading</button>
      </>}
    </div>
  );
}
