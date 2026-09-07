"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { Button, IconButton, Kbd, Modal, Segmented, ToggleRow } from "@/components/ui";
import { APP_VERSION, CHANGELOG } from "@/lib/version";
import { Icon } from "@/components/icons";
import { deleteProject, deleteTemplate, listProjects, listTemplates, loadProject, listingFailed, projectFromTemplate, saveTemplate, templateListingFailed, type TemplateMeta } from "@/lib/persistence";
import type { Project, ProjectMeta } from "@/lib/types";
import { getDevice } from "@/lib/devices";
import { blobToDataURL, mediaType } from "@/lib/media";
import { captureImage } from "@/export/capture";
import { MOD } from "@/lib/cn";
import { exportProjectToFile, exportSizeFor, importProjectFromFile, saveCurrentProject } from "./hooks";
import { executePaste, newProject } from "@/lib/actions";
import { REPO_URL } from "./Menus";
import { canReplacePastedMedia } from "@/lib/paste";
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
  const captureShortcut = useUI((s) => s.captureShortcut);
  return (
    <Modal open={modal === "shortcuts"} onClose={() => setModal(null)} title="Keyboard shortcuts" width={440}>
      <div className="scroll grid max-h-[60vh] grid-cols-[auto_1fr] gap-x-4 gap-y-2 overflow-auto p-4">
        {SHORTCUTS.filter(([, description]) => captureShortcut || description !== "Quick capture PNG").map(([k, d]) => (
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

/**
 * Template cards are small, so the thumbnail is rendered at card size rather than shrunk from a
 * full export, and kept inline as a data URL so a listing never has to load anything else.
 */
async function captureTemplateThumb(p: Project): Promise<string> {
  const [w, h] = exportSizeFor(p.aspect, 360, useUI.getState().viewport);
  const blob = await captureImage({ width: w, height: h, format: "webp", quality: 0.8, transparent: false });
  return blobToDataURL(blob);
}

function ProjectsModal() {
  const modal = useUI((s) => s.modal);
  const setModal = useUI((s) => s.setModal);
  const toast = useUI((s) => s.showToast);
  const current = useEditor((s) => s.project.id);
  const [tab, setTab] = useState<"projects" | "templates">("projects");
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [templatesUnreadable, setTemplatesUnreadable] = useState(false);
  // the name being typed for a new template; null while nothing is being saved
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TemplateMeta | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const scope = useRef(0);
  const openRequest = useRef(0);
  const projectListRequest = useRef(0);
  const templateListRequest = useRef(0);
  const saveBusy = useRef(false);
  const refresh = () => {
    const request = ++projectListRequest.current;
    void listProjects().then((list) => { if (request === projectListRequest.current) { setItems(list); setUnreadable(listingFailed()); } });
  };
  const refreshTemplates = () => {
    const request = ++templateListRequest.current;
    void listTemplates().then((list) => { if (request === templateListRequest.current) { setTemplates(list); setTemplatesUnreadable(templateListingFailed()); } });
  };
  useEffect(() => {
    if (modal === "projects") { refresh(); refreshTemplates(); }
    // a half-typed name or an unanswered confirmation should not be waiting here on the way back in
    else { setNaming(null); setPendingDelete(null); setOpening(null); }
    const counters = [scope, openRequest, projectListRequest, templateListRequest];
    return () => { for (const counter of counters) counter.current++; };
  }, [modal]);
  const load = async (id: string, loader: () => Promise<Project | null>, message: (p: Project) => string) => {
    const request = ++openRequest.current;
    const generation = scope.current;
    const source = useEditor.getState().project;
    setOpening(id);
    try {
      const p = await loader();
      if (request !== openRequest.current || generation !== scope.current || useUI.getState().modal !== "projects") return;
      if (useEditor.getState().project !== source) { toast("The current project changed while loading. Open the saved item again to switch."); return; }
      if (!p) { toast("That saved item is no longer available"); refresh(); refreshTemplates(); return; }
      useUI.getState().setPlaying(false);
      useEditor.getState().replaceProject(p);
      useEditor.temporal.getState().clear();
      useUI.getState().setTime(0);
      useUI.getState().setActiveShot(p.shots[0]?.id ?? null);
      setModal(null);
      toast(message(p));
    } catch (e) {
      if (request === openRequest.current && generation === scope.current) toast(`Could not open the saved item: ${(e as Error).message}`);
    } finally {
      if (request === openRequest.current) setOpening(null);
    }
  };
  const open = (id: string) => load(id, () => loadProject(id), (p) => `Opened “${p.name}”`);
  const saveAsTemplate = async () => {
    const name = (naming ?? "").trim();
    if (!name || saveBusy.current) return;
    saveBusy.current = true;
    const generation = scope.current;
    const source = useEditor.getState().project;
    const snapshot = structuredClone(source);
    setSaving(true);
    try {
      // Capture and save the same project even if the user changes projects while the thumbnail
      // encoder is working. A failed thumbnail does not prevent saving the template itself.
      const captured = await captureTemplateThumb(snapshot).catch(() => "");
      const thumb = useEditor.getState().project === source ? captured : "";
      await saveTemplate(snapshot, name, thumb);
      if (generation === scope.current && useUI.getState().modal === "projects") { setNaming(null); setTab("templates"); refreshTemplates(); }
      toast(`Saved “${name}” as a template`);
    } catch {
      // saveTemplate reports storage failures itself.
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  };
  const startFrom = (t: TemplateMeta) => load(t.id, () => projectFromTemplate(t.id), () => `Started from “${t.name}”`);
  const removeProject = async (id: string) => {
    try { await deleteProject(id); } catch { /* Persistence already reports the storage failure. */ }
    refresh();
  };
  const removeTemplate = async (t: TemplateMeta) => {
    setPendingDelete(null);
    try {
      await deleteTemplate(t.id);
      toast(`Deleted “${t.name}”`);
    } catch {
      // deleteTemplate has already said why storage refused it
    }
    refreshTemplates();
  };
  return (
    <Modal
      open={modal === "projects"}
      onClose={() => setModal(null)}
      width={520}
      className="relative"
      title={
        <Segmented
          size="sm"
          className="w-[220px]"
          value={tab}
          onChange={(next) => { openRequest.current++; setOpening(null); setTab(next); }}
          options={[{ value: "projects", label: "Projects", icon: "folder" }, { value: "templates", label: "Templates", icon: "sparkles" }]}
        />
      }
    >
      {tab === "projects" && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <Button variant="solid" size="sm" icon="plus" onClick={() => { newProject(); setModal(null); }}>New</Button>
          <Button variant="soft" size="sm" icon="save" onClick={() => void saveCurrentProject().then(refresh)}>Save current</Button>
          <Button variant="soft" size="sm" icon="sparkles" onClick={() => setNaming(useEditor.getState().project.name)}>Save as template</Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" icon="upload" onClick={() => void importProjectFromFile()}>Import</Button>
          <Button variant="ghost" size="sm" icon="download" onClick={() => void exportProjectToFile()}>Export .mok</Button>
        </div>
      )}
      {tab === "templates" && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <Button variant="soft" size="sm" icon="sparkles" onClick={() => setNaming(useEditor.getState().project.name)}>Save as template</Button>
          <div className="flex-1" />
          {templates.length > 0 && <span className="label-sm text-muted">Starts a new project from the look you saved</span>}
        </div>
      )}
      {naming !== null && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <input
            autoFocus
            value={naming}
            placeholder="Template name"
            onChange={(e) => setNaming(e.target.value)}
            // Escape belongs to the field while it is open, or the whole modal would close with it
            onKeyDown={(e) => { if (e.key === "Enter") void saveAsTemplate(); if (e.key === "Escape") { e.stopPropagation(); setNaming(null); } }}
            className="label h-7 flex-1 rounded-md bg-fill px-2 text-fg outline-none ring-1 ring-accent placeholder:text-muted"
          />
          <Button variant="ghost" size="sm" onClick={() => setNaming(null)}>Cancel</Button>
          <Button variant="solid" size="sm" disabled={saving || !naming.trim()} onClick={() => void saveAsTemplate()}>{saving ? "Saving…" : "Save template"}</Button>
        </div>
      )}
      {tab === "projects" ? (
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
              <Button variant="soft" size="sm" disabled={opening === m.id} onClick={() => void open(m.id)}>{opening === m.id ? "Opening…" : "Open"}</Button>
              <IconButton icon="trash" size={12} label="Delete" onClick={() => void removeProject(m.id)} className="opacity-0 group-hover:opacity-100" />
            </div>
          ))}
        </div>
      ) : (
        <div className="scroll max-h-[55vh] overflow-auto p-3">
          {templates.length === 0 ? (
            <div className="label-sm px-2 py-8 text-center text-muted">
              {templatesUnreadable ? "This browser is blocking storage, so saved templates cannot be listed here." : "No templates of your own yet. Save the project you are in and every new one can start from it."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => (
                <div key={t.id} className="group relative overflow-hidden rounded-lg border border-line bg-panel-2 transition-colors hover:border-line-2">
                  <button type="button" disabled={opening === t.id} onClick={() => void startFrom(t)} className="flex w-full flex-col text-left">
                    <div className="flex aspect-[8/5] w-full items-center justify-center overflow-hidden bg-fill text-muted">
                      {t.thumb
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={t.thumb} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" draggable={false} />
                        : <Icon name={getDevice(t.device).icon} size={20} />}
                    </div>
                    <div className="flex min-w-0 flex-col px-2.5 py-2">
                      <span className="label truncate text-fg">{t.name}</span>
                      <span className="label-sm truncate text-muted">{getDevice(t.device).name} · {new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                  <IconButton icon="trash" size={12} label="Delete template" onClick={() => setPendingDelete(t)} className="absolute right-1.5 top-1.5 bg-panel/80 opacity-0 group-hover:opacity-100" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {pendingDelete && (
        // a sheet over the panel rather than a second modal, so a click on it cannot land outside
        // the projects modal and dismiss the very list being edited
        <div className="fade-in absolute inset-0 z-10 flex items-center justify-center bg-panel/85 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[320px] rounded-lg border border-line bg-panel p-4 shadow-2xl">
            <div className="label text-fg">Delete template</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-2">“{pendingDelete.name}” will be gone from this browser for good. Projects already started from it are not affected.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="danger" size="sm" icon="trash" onClick={() => void removeTemplate(pendingDelete)}>Delete</Button>
            </div>
          </div>
        </div>
      )}
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
  const captureShortcut = useUI((s) => s.captureShortcut);
  const setCaptureShortcut = useUI((s) => s.setCaptureShortcut);
  const pasteMode = useUI((s) => s.pasteMode);
  const setPasteMode = useUI((s) => s.setPasteMode);
  const fps = useEditor((s) => s.project.fps);
  const update = useEditor((s) => s.update);
  return (
    <Modal open={modal === "preferences"} onClose={() => setModal(null)} title="Preferences" width={380}>
      <div className="flex flex-col gap-3 p-4">
        <Pref label="Theme"><Segmented size="sm" value={theme} onChange={setTheme} options={[{ value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }]} /></Pref>
        <Pref label="Render quality" sub="Viewport pixel ratio. Exports always render at full resolution."><Segmented size="sm" value={String(dpr)} onChange={(v) => setDpr(Number(v))} options={[{ value: "1", label: "1×" }, { value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }]} /></Pref>
        <Pref label="Timeline frame rate"><Segmented size="sm" value={String(fps)} onChange={(v) => update((p) => { p.fps = Number(v); })} options={[{ value: "24", label: "24" }, { value: "30", label: "30" }, { value: "60", label: "60" }]} /></Pref>
        <Pref label="Timeline" sub="Simple hides the keyframe lanes; Advanced shows every animated property."><Segmented size="sm" value={timelineMode} onChange={setTimelineMode} options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Advanced" }]} /></Pref>
        <Pref label="Pasted media" sub="Choose where clipboard images and videos go. Replacing keeps clip timing and camera settings."><Segmented size="sm" value={pasteMode} onChange={setPasteMode} options={[{ value: "ask", label: "Ask" }, { value: "replace", label: "Replace" }, { value: "add", label: "New shot" }]} /></Pref>
        <ToggleRow label="Quick capture shortcut" checked={captureShortcut} onChange={setCaptureShortcut} hint={`${MOD}E`} />
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
      <PasteChoiceModal />
    </>
  );
}

function PasteChoiceModal() {
  const request = useUI((s) => s.pasteRequest);
  const close = useUI((s) => s.setPasteRequest);
  const project = useEditor((s) => s.project);
  const [remember, setRemember] = useState(false);
  const shot = project.shots.find((s) => s.id === request?.shotId);
  const types = request?.files.map((file) => ({ kind: mediaType(file).startsWith("audio/") ? "audio" as const : mediaType(file).startsWith("video/") ? "video" as const : "image" as const }));
  const replace = canReplacePastedMedia(shot, types);
  const choose = (mode: "replace" | "add") => {
    if (!request) return;
    if (remember) useUI.getState().setPasteMode(mode);
    void executePaste(request, mode);
  };
  return <Modal open={!!request} onClose={() => close(null)} title="Paste media" width={400}>
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[12px] text-fg-2">{request?.files.length} file{request?.files.length === 1 ? "" : "s"} from your clipboard. Choose where to put them.</p>
      <p className="label-sm text-muted">Replace keeps the current clip&apos;s duration, trim, fit and camera. Additional images or videos become following shots. Audio files use the soundtrack lane.</p>
      <Button variant="soft" onClick={() => choose("replace")} disabled={!replace}>Replace {shot?.name ?? "current shot"}</Button>
      <Button variant="accent" onClick={() => choose("add")}>Add as new shot{(request?.files.length ?? 0) > 1 ? "s" : ""}</Button>
      <ToggleRow label="Remember this choice" checked={remember} onChange={setRemember} />
      <Button variant="ghost" onClick={() => close(null)}>Cancel paste</Button>
    </div>
  </Modal>;
}
