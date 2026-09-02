"use client";
import { useRef, useState } from "react";
import { useEditor, redo, undo } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ASPECTS, TEMPLATES, getAspect } from "@/lib/presets";
import { BarButton, IconButton, MenuList, Popover, type MenuItem } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getDevice } from "@/lib/devices";
import { applyTemplate, newProject } from "@/lib/actions";
import { MOD } from "@/lib/cn";
import { exportProjectToFile, importProjectFromFile, saveCurrentProject } from "./hooks";

export const REPO_URL = "https://github.com/newomp4/mok";

export function AspectMenu() {
  const aspect = useEditor((s) => s.project.aspect);
  const update = useEditor((s) => s.update);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const a = getAspect(aspect);
  const icon = a.ratio === null ? "maximize" : a.ratio > 1.05 ? "landscape" : a.ratio < 0.95 ? "portrait" : "square-outline";
  const items: MenuItem[] = [
    ...ASPECTS.filter((x) => x.group === "ratio").map((x) => ({ label: x.label, checked: x.id === aspect, onSelect: () => update((p) => { p.aspect = x.id; }) })),
    { divider: true, label: "" },
    { label: "App Store", disabled: true },
    ...ASPECTS.filter((x) => x.group === "appstore").map((x) => ({ label: x.label, sub: x.sub, checked: x.id === aspect, onSelect: () => update((p) => { p.aspect = x.id; }) })),
  ];
  return (
    <>
      <BarButton ref={ref} icon={icon} iconRight="chevron-down" active={open} onClick={() => setOpen((o) => !o)} className="border border-line">
        {a.label}
      </BarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} align="center" className="w-56">
        <div className="scroll max-h-[70vh] overflow-auto">
          <MenuList items={items} onClose={() => setOpen(false)} />
        </div>
      </Popover>
    </>
  );
}

export function TemplatesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <BarButton ref={ref} iconRight="chevron-down" active={open} onClick={() => setOpen((o) => !o)}>Templates</BarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="w-[420px] p-2">
        <div className="label px-1 pb-2 pt-1 text-muted">Starter templates</div>
        <div className="scroll grid max-h-[60vh] grid-cols-2 gap-2 overflow-auto pr-1">
          {TEMPLATES.map((t) => {
            const spec = getDevice(t.device);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { applyTemplate(t.id); setOpen(false); }}
                className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel-2 text-left transition-colors hover:border-line-2"
              >
                <div className="relative aspect-[8/5] overflow-hidden" style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/templates/${t.id}.webp`} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  {t.motion && <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"><Icon name="play" size={9} /></span>}
                </div>
                <div className="flex items-center justify-between px-2.5 py-2">
                  <span className="label text-fg">{t.name}</span>
                  <span className="label-sm text-muted">{spec.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

export function MainMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const showToast = useUI((s) => s.showToast);
  const setModal = useUI((s) => s.setModal);
  const timelineOpen = useUI((s) => s.timelineOpen);
  const setTimelineOpen = useUI((s) => s.setTimelineOpen);
  const snapCenter = useUI((s) => s.snapCenter);
  const setSnapCenter = useUI((s) => s.setSnapCenter);
  const guides = useUI((s) => s.guides);
  const setGuides = useUI((s) => s.setGuides);
  const items: MenuItem[] = [
    { label: "New project", icon: "plus", onSelect: () => { newProject(); showToast("New project"); } },
    { label: "Open project…", icon: "folder", onSelect: () => setModal("projects") },
    { label: "Save project", icon: "save", shortcut: `${MOD}S`, onSelect: () => void saveCurrentProject() },
    { divider: true, label: "" },
    { label: "Import .mok file…", icon: "upload", onSelect: () => void importProjectFromFile() },
    { label: "Export .mok file", icon: "download", onSelect: () => void exportProjectToFile() },
    { divider: true, label: "" },
    { label: "Undo", icon: "undo", shortcut: `${MOD}Z`, onSelect: undo },
    { label: "Redo", icon: "redo", shortcut: `⇧${MOD}Z`, onSelect: redo },
    { label: "Toggle timeline", icon: "film", shortcut: "T", onSelect: () => setTimelineOpen(!timelineOpen) },
    { label: "Snap to centre", icon: "magnet", checked: snapCenter, onSelect: () => setSnapCenter(!snapCenter) },
    { label: "Centre guides", icon: "target", shortcut: "G", checked: guides, onSelect: () => setGuides(!guides) },
    { label: "Preferences", icon: "settings", onSelect: () => setModal("preferences") },
    { divider: true, label: "" },
    { label: "Info", icon: "info", onSelect: () => setModal("info") },
    { label: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", onSelect: () => setModal("shortcuts") },
    { label: "Changelog", icon: "history", onSelect: () => setModal("changelog") },
    { label: "GitHub", icon: "external-link", onSelect: () => window.open(REPO_URL, "_blank") },
  ];
  return (
    <>
      <IconButton ref={ref} icon="menu" label="Menu" active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref}>
        <MenuList items={items} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const setModal = useUI((s) => s.setModal);
  const items: MenuItem[] = [
    { label: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", onSelect: () => setModal("shortcuts") },
    { label: "How it works", icon: "help-circle", onSelect: () => setModal("info") },
    { label: "What's new", icon: "sparkles", onSelect: () => setModal("whatsnew") },
    { label: "Changelog", icon: "history", onSelect: () => setModal("changelog") },
    { divider: true, label: "" },
    { label: "Source on GitHub", icon: "code", onSelect: () => window.open(REPO_URL, "_blank") },
    { label: "Report an issue", icon: "external-link", onSelect: () => window.open(`${REPO_URL}/issues`, "_blank") },
  ];
  return (
    <>
      <BarButton ref={ref} active={open} onClick={() => setOpen((o) => !o)}>Help</BarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref}>
        <MenuList items={items} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}
