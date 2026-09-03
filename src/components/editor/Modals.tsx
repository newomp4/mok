"use client";
import { useEffect, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { Button, IconButton, Kbd, Modal, Segmented, ToggleRow } from "@/components/ui";
import { APP_VERSION, CHANGELOG } from "@/lib/version";
import { Icon } from "@/components/icons";
import { deleteProject, listProjects, loadProject, listingFailed } from "@/lib/persistence";
import type { ProjectMeta } from "@/lib/types";
import { getDevice } from "@/lib/devices";
import { MOD } from "@/lib/cn";
import { exportProjectToFile, importProjectFromFile, saveCurrentProject } from "./hooks";
import { newProject } from "@/lib/actions";
import { REPO_URL } from "./Menus";
import { CropModal } from "./CropModal";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Step one frame (⇧ for 1s)"],
  ["Home / End", "Jump to start / end"],
  ["R", "Toggle keyframe recording"],
  ["L", "Toggle loop"],
  ["T", "Toggle timeline"],
  ["1 – 9", "Camera presets"],
  ["K", "Add camera keyframes at the playhead"],
  [`${MOD} C / ${MOD} V`, "Copy / paste keyframes or the selected shot"],
  [`${MOD} D`, "Duplicate shot"],
  [`⇧ ${MOD} D`, "Split shot at the playhead"],
  ["G", "Centre guides"],
  [`${MOD} scroll`, "Zoom the timeline"],
  ["Drag on tracks", "Marquee-select keyframes (⇧ to add)"],
  [`${MOD} ⌥ A`, "Select every keyframe"],
  ["↑ / ↓", "Nudge selected keyframes (⇧ ×10, ⌥ retime)"],
  ["Drag keyframe", "Move selection (⌥ retimes proportionally)"],
  [`${MOD} Z`, "Undo"],
  [`⇧ ${MOD} Z`, "Redo"],
  [`${MOD} S`, "Save project"],
  [`${MOD} E`, "Quick capture PNG"],
  [`${MOD} V`, "Paste image or video as source"],
  ["Drag", "Orbit camera"],
  ["Scroll", "Zoom"],
  ["Space + drag", "Pan"],
  ["⌫", "Delete selected keyframe"],
  ["D", "Toggle dark mode"],
  ["?", "This list"],
];

function ShortcutsModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  return (
    <Modal open={modal === "shortcuts"} onClose={() => setModal(null)} title="Keyboard shortcuts" width={440}>
      <div className="scroll grid max-h-[60vh] grid-cols-[auto_1fr] gap-x-4 gap-y-2 overflow-auto p-4">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="contents">
            <span className="flex items-center gap-1">{k.split(" ").map((p, i) => <Kbd key={i}>{p}</Kbd>)}</span>
            <span className="text-[11px] text-fg-2">{d}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function InfoModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  return (
    <Modal open={modal === "info"} onClose={() => setModal(null)} width={420}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-inverse-fg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18V8l8 6 8-6v10" /></svg>
          </div>
          <span className="label text-fg">mok</span>
          <span className="label-sm rounded bg-fill px-1.5 py-0.5 text-muted">v{APP_VERSION}</span>
        </div>
        <IconButton icon="x" onClick={() => setModal(null)} label="Close" />
      </div>
      <div className="flex flex-col gap-4 p-4 text-[12px] leading-relaxed text-fg-2">
        <p>Turn product screens into premium 3D mockups and videos. Everything renders locally in your browser with WebGL — nothing is uploaded.</p>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <Row k="Renderer">three.js r185 · React Three Fiber · physically based materials, HDRI lighting, MSAA post-processing</Row>
          <Row k="Devices">Ten photoreal glTF models (iPhone, iPad, MacBook, Apple Watch, iMac, Pro Display XDR) plus flat and browser cards; see CREDITS.md</Row>
          <Row k="Shots">Media, text and logo shots with enter / exit animations, fade transitions and an audio lane</Row>
          <Row k="Video">Frame-exact WebCodecs encoding (H.264 / VP9) via mediabunny, up to 4K 60 fps with motion blur</Row>
          <Row k="Lighting">CC0 studio HDRIs and concrete textures from Poly Haven</Row>
          <Row k="Type">Geist Sans + Geist Mono by Vercel</Row>
        </div>
        <div className="flex gap-2">
          <Button variant="soft" icon="code" onClick={() => window.open(REPO_URL, "_blank")}>Source on GitHub</Button>
          <Button variant="ghost" onClick={() => setModal("changelog")}>Changelog</Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <span className="label-sm pt-0.5 text-muted">{k}</span>
      <span>{children}</span>
    </>
  );
}

function ChangelogModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  return (
    <Modal open={modal === "changelog"} onClose={() => setModal(null)} title="Changelog" width={460}>
      <div className="scroll flex max-h-[70vh] flex-col gap-4 overflow-auto p-4 text-[12px] leading-relaxed text-fg-2">
        {CHANGELOG.map((c) => (
          <div key={c.version}>
            <div className="flex items-baseline gap-2"><span className="label text-fg">{c.version}</span><span className="label-sm text-muted">{c.date}</span></div>
            <div className="mt-0.5 text-fg">{c.title}</div>
            <ul className="mt-1 list-disc pl-4">{c.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ProjectsModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  const toast = useUI((s) => s.showToast);
  const current = useEditor((s) => s.project.id);
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  const refresh = () => void listProjects().then((list) => { setItems(list); setUnreadable(listingFailed()); });
  useEffect(() => { if (modal === "projects") refresh(); }, [modal]);
  const open = async (id: string) => {
    const p = await loadProject(id);
    if (!p) return;
    useEditor.getState().replaceProject(p);
    useEditor.temporal.getState().clear();
    useUI.getState().setTime(0);
    useUI.getState().setActiveShot(p.shots[0]?.id ?? null);
    setModal(null);
    toast(`Opened “${p.name}”`);
  };
  return (
    <Modal open={modal === "projects"} onClose={() => setModal(null)} title="Projects" width={460}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Button variant="solid" size="sm" icon="plus" onClick={() => { newProject(); setModal(null); }}>New</Button>
        <Button variant="soft" size="sm" icon="save" onClick={() => void saveCurrentProject().then(refresh)}>Save current</Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" icon="upload" onClick={() => void importProjectFromFile().then(() => setModal(null))}>Import</Button>
        <Button variant="ghost" size="sm" icon="download" onClick={() => void exportProjectToFile()}>Export .mok</Button>
      </div>
      <div className="scroll max-h-[55vh] overflow-auto p-2">
        {items.length === 0 && (
          // an empty list and an unreadable one look the same, and telling someone they have no
          // projects when the browser is simply blocking storage is the wrong thing to say
          <div className="label-sm px-2 py-6 text-center text-muted">
            {unreadable ? "This browser is blocking storage, so saved projects cannot be listed here." : `No saved projects yet. Press ${MOD} S to save the current one.`}
          </div>
        )}
        {items.map((m) => (
          <div key={m.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-fill">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-panel-2 text-fg-2"><Icon name={getDevice(m.device).icon} size={15} /></div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="label truncate text-fg">{m.name}{m.id === current && <span className="label-sm ml-2 text-accent">current</span>}</span>
              <span className="label-sm text-muted">{getDevice(m.device).name} · {new Date(m.updatedAt).toLocaleString()}</span>
            </div>
            <Button variant="soft" size="sm" onClick={() => void open(m.id)}>Open</Button>
            <IconButton icon="trash" size={12} label="Delete" onClick={() => void deleteProject(m.id).then(refresh)} className="opacity-0 group-hover:opacity-100" />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function PreferencesModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const dpr = useUI((s) => s.dpr);
  const setDpr = useUI((s) => s.setDpr);
  const sounds = useUI((s) => s.sounds);
  const setSounds = useUI((s) => s.setSounds);
  const snapCenter = useUI((s) => s.snapCenter);
  const setSnapCenter = useUI((s) => s.setSnapCenter);
  const timelineMode = useUI((s) => s.timelineMode);
  const setTimelineMode = useUI((s) => s.setTimelineMode);
  const fps = useEditor((s) => s.project.fps);
  const update = useEditor((s) => s.update);
  return (
    <Modal open={modal === "preferences"} onClose={() => setModal(null)} title="Preferences" width={380}>
      <div className="flex flex-col gap-3 p-4">
        <Pref label="Theme"><Segmented size="sm" value={theme} onChange={setTheme} options={[{ value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }]} /></Pref>
        <Pref label="Render quality" sub="Viewport pixel ratio. Exports always render at full resolution."><Segmented size="sm" value={String(dpr)} onChange={(v) => setDpr(Number(v))} options={[{ value: "1", label: "1×" }, { value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }]} /></Pref>
        <Pref label="Timeline frame rate"><Segmented size="sm" value={String(fps)} onChange={(v) => update((p) => { p.fps = Number(v); })} options={[{ value: "24", label: "24" }, { value: "30", label: "30" }, { value: "60", label: "60" }]} /></Pref>
        <Pref label="Timeline" sub="Simple hides the keyframe lanes; Advanced shows every animated property."><Segmented size="sm" value={timelineMode} onChange={setTimelineMode} options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Advanced" }]} /></Pref>
        <ToggleRow label="Snap pan to centre" checked={snapCenter} onChange={setSnapCenter} />
        <ToggleRow label="Interface sounds" checked={sounds} onChange={setSounds} hint="chime · blip" />
      </div>
    </Modal>
  );
}

function WhatsNewModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  const latest = CHANGELOG[0];
  return (
    <Modal open={modal === "whatsnew"} onClose={() => setModal(null)} width={440}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="label text-fg">What&apos;s new</span>
          <span className="label-sm rounded bg-fill px-1.5 py-0.5 text-muted">v{latest.version}</span>
        </div>
        <IconButton icon="x" onClick={() => setModal(null)} label="Close" />
      </div>
      <div className="flex flex-col gap-3 p-4 text-[12px] leading-relaxed text-fg-2">
        <div className="text-fg">{latest.title}</div>
        <ul className="list-disc pl-4">{latest.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal("changelog")}>Full changelog</Button>
          <Button variant="solid" onClick={() => setModal(null)}>Got it</Button>
        </div>
      </div>
    </Modal>
  );
}

function Pref({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col"><span className="label text-fg">{label}</span>{sub && <span className="text-[10px] text-muted">{sub}</span>}</div>
      {children}
    </div>
  );
}

export function Modals() {
  return (
    <>
      <ShortcutsModal />
      <InfoModal />
      <ChangelogModal />
      <ProjectsModal />
      <PreferencesModal />
      <WhatsNewModal />
      <CropModal />
    </>
  );
}
