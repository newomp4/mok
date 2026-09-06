"use client";
import { useRef, useState } from "react";
import { Button, Popover } from "@/components/ui";
import { beginInteraction, endInteraction, useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { applyStudioLook, STUDIO_LOOKS } from "@/lib/looks";

export function StudioLooks() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={anchor} icon="sparkles" variant="ghost" aria-label="Studio looks" onClick={() => setOpen(!open)} aria-expanded={open}><span className="hidden sm:inline">Studio looks</span></Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={320} align="end" className="p-3">
        <div className="mb-3 flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">A better starting light</span>
          <p className="text-[11px] leading-relaxed text-muted">Lighting, surfaces and background for your project. Your framing, media and lens stay in place.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {STUDIO_LOOKS.map((look) => (
            <button type="button" key={look.id} className="group overflow-hidden rounded-lg border border-line text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => {
              beginInteraction();
              try { useEditor.getState().update((project) => applyStudioLook(project, look)); }
              finally { endInteraction(); }
              useUI.getState().showToast(`${look.name} studio look applied`);
              setOpen(false);
            }}>
              <div className="relative flex h-20 items-center justify-center overflow-hidden" style={{ background: look.swatch }}>
                <div className="absolute bottom-3 h-2 w-16 rounded-[50%] bg-black/20 blur-sm" />
                <div className="relative h-14 w-7 -rotate-12 rounded-md border border-white/60 bg-gradient-to-br from-[#62666f] via-[#1c2028] to-[#060709] shadow-[3px_2px_0_#a2a5ae,8px_10px_10px_#0003] transition-transform group-hover:-translate-y-1">
                  <div className="mx-auto mt-1 h-0.5 w-2 rounded-full bg-black" />
                  <div className="mx-1 mt-2 h-5 rounded-sm bg-white/10" />
                </div>
              </div>
              <div className="flex flex-col gap-1 px-2 py-2.5">
                <span className="label text-fg">{look.name}</span>
                <span className="text-[10px] leading-snug text-muted">{look.description}</span>
              </div>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
