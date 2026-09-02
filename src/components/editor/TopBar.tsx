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
    <div className="mx-1 flex h-6 w-6 items-center justify-center rounded-md bg-inverse text-inverse-fg" title="mok">
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
  useEffect(() => setText(name), [name]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  if (editing) {
    return (
      <input
        ref={ref}
        className="label h-7 w-40 rounded-md bg-fill px-2 text-fg outline-none ring-1 ring-accent"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setEditing(false); const v = text.trim(); if (v && v !== name) update((p) => { p.name = v; }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(name); setEditing(false); } }}
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="label flex h-7 max-w-48 items-center gap-1.5 truncate rounded-md px-2 text-fg-2 hover:bg-fill hover:text-fg" title="Rename project">
      <span className="truncate">{name}</span>
      <Icon name="text-cursor" size={11} className="text-muted" />
    </button>
  );
}

export function TopBar() {
  const setModal = useUI((s) => s.setModal);
  const recording = useUI((s) => s.recording);
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-panel px-1.5">
      <MainMenu />
      <Logo />
      <BarButton onClick={() => setModal("info")}>Info</BarButton>
      <TemplatesMenu />
      <HelpMenu />
      <div className="mx-1.5 h-4 w-px bg-line" />
      <ProjectName />
      {recording && (
        <span className="label ml-1 flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-accent">
          <Icon name="record" size={8} /> Rec
        </span>
      )}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <AspectMenu />
      </div>
      <div className="flex-1" />
      <BarButton onClick={() => void saveCurrentProject()}>Save project</BarButton>
      <IconButton icon="history" label="Projects" onClick={() => setModal("projects")} />
      <CaptureButton />
      <ExportButton />
    </div>
  );
}
