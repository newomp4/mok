"use client";
import { useUI } from "@/store/ui";
import { TopBar } from "./TopBar";
import { ViewportPane } from "./ViewportPane";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { Modals } from "./Modals";
import { useAutosave, useBootstrap, usePasteImport, useShortcuts } from "./hooks";
import { Modal, ProgressBar, Button } from "@/components/ui";
import { useAudioPlayback } from "@/lib/audio";

function ExportProgress() {
  const exporting = useUI((s) => s.exporting);
  if (!exporting) return null;
  return (
    <Modal open onClose={() => {}} width={360}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="label text-fg">{exporting.label}</span>
          <span className="num text-[11px] text-muted">{Math.round(exporting.progress * 100)}%</span>
        </div>
        <ProgressBar value={exporting.progress} />
        <p className="text-[11px] leading-relaxed text-muted">Keep this tab visible while exporting. Rendering happens in your browser, nothing is uploaded.</p>
        {exporting.cancel && (
          <div className="flex justify-end">
            <Button variant="soft" onClick={exporting.cancel}>Cancel</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Editor() {
  useBootstrap();
  useAutosave();
  usePasteImport();
  useShortcuts();
  useAudioPlayback();
  const timelineOpen = useUI((s) => s.timelineOpen);
  return (
    <div className="flex h-dvh w-screen flex-col gap-2 bg-app p-2 text-fg">
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <ViewportPane />
          {timelineOpen && <Timeline />}
        </div>
        <Inspector />
      </div>
      <Modals />
      <ExportProgress />
    </div>
  );
}
