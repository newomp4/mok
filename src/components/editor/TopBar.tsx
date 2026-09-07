"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { BarButton, IconButton } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AspectMenu, HelpMenu, MainMenu, TemplatesMenu } from "./Menus";
import { CaptureButton, ExportButton } from "./ExportPopover";
import { saveCurrentProject } from "./hooks";

function Logo() {
  return (
    <div className="mx-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md bg-inverse text-inverse-fg sm:flex" title="mok">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 18V8l8 6 8-6v10" />
      </svg>
    </div>
  );
}

function ProjectName() {
  const name = useEditor((s) => s.project.name);
  const update = useEditor((s) => s.update);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => setText(name), [name]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  if (editing) {
    return (
      <input
        ref={ref}
        aria-label="Project name"
        className="label h-7 w-40 rounded-md bg-fill px-2 text-fg outline-none ring-1 ring-accent"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setEditing(false); const v = text.trim(); if (!cancelled.current && v && v !== name) update((p) => { p.name = v; }); else setText(name); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancelled.current = true; e.currentTarget.blur(); } }}
      />
    );
  }
  return (
    <button type="button" onClick={() => { cancelled.current = false; setText(name); setEditing(true); }} className="label flex h-7 max-w-48 items-center gap-1.5 truncate rounded-md px-2 text-fg-2 hover:bg-fill hover:text-fg" title="Rename project">
      <span className="truncate">{name}</span>
      <Icon name="text-cursor" size={11} className="text-muted" />
    </button>
  );
}

export function TopBar() {
  const setModal = useUI((s) => s.setModal);
  const recording = useUI((s) => s.recording);
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-panel px-1.5 [&>button]:shrink-0 [&>span]:shrink-0">
      <MainMenu />
      <Logo />
      <BarButton className="hidden lg:flex" onClick={() => setModal("info")}>Info</BarButton>
      <span data-tour="templates"><TemplatesMenu /></span>
      <div className="hidden lg:block"><HelpMenu /></div>
      <div className="mx-1.5 hidden h-4 w-px bg-line md:block" />
      <div className="hidden min-w-0 md:block"><ProjectName /></div>
      {recording && (
        <span className="label ml-1 flex items-center gap-1 rounded-md bg-accent-soft px-1 py-1 text-accent sm:px-2" title="Recording keyframes">
          <Icon name="record" size={8} /><span className="sr-only sm:not-sr-only">Rec</span>
        </span>
      )}
      <div className="ml-auto shrink-0">
        <AspectMenu />
      </div>
      <div className="hidden flex-1 lg:block" />
      <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
        <BarButton className="hidden md:flex" onClick={() => void saveCurrentProject()}>Save project</BarButton>
        <IconButton className="md:hidden" icon="save" label="Save project" onClick={() => void saveCurrentProject()} />
        <IconButton icon="history" label="Projects" onClick={() => setModal("projects")} />
        <CaptureButton />
      </div>
      <span data-tour="export"><ExportButton /></span>
    </div>
  );
}
