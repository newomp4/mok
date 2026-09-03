"use client";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type { MediaRef, Project, ProjectMeta } from "./types";
import { ANIMATED_GIF_MESSAGE, blobToDataURL, dataURLToBlob, ensureMedia, registerMedia } from "./media";
import { uid } from "./ids";

const PROJECT_PREFIX = "project:";
const INDEX_KEY = "projects:index";
const AUTOSAVE_KEY = "autosave";

let autosaveWarned = false;
export let onStorageError: (what: string) => void = () => {};
export function setStorageErrorHandler(fn: (what: string) => void) { onStorageError = fn; }

let lastFailure = { message: "", at: 0 };

/**
 * Every one of these is fired without awaiting, so a rejection would otherwise reach nothing but the
 * console. Autosave retries the same write every keystroke, so an identical message only repeats
 * once the previous toast has had time to be read.
 */
function reportStorageFailure(what: string, e: unknown): never {
  console.warn(what, e);
  const message = `${what}: ${(e as Error)?.message || "storage unavailable"}`;
  const now = Date.now();
  if (message !== lastFailure.message || now - lastFailure.at > 5000) {
    lastFailure = { message, at: now };
    onStorageError(message);
  }
  throw e;
}

function mediaNames(refs: MediaRef[]): string {
  const shown = refs.slice(0, 3).map((m) => m.name);
  return refs.length > 3 ? `${shown.join(", ")} and ${refs.length - 3} more` : shown.join(", ");
}

/** Pull a project's media back into memory, naming whatever is no longer on this device. */
async function restoreMedia(p: Project): Promise<void> {
  const refs = collectMedia(p);
  const loaded = await Promise.all(refs.map((m) => ensureMedia(m)));
  const missing = refs.filter((_, i) => !loaded[i]);
  if (!missing.length) return;
  onStorageError(`Could not find ${mediaNames(missing)} — re-add ${missing.length === 1 ? "the file" : "those files"} to restore the project`);
}

/**
 * The bare index read. It throws so a caller that is about to rewrite the index gives up instead of
 * saving a list it could not read, and so the write's own message is the only one the user sees.
 */
async function readIndex(): Promise<ProjectMeta[]> {
  const idx = ((await idbGet(INDEX_KEY)) as ProjectMeta[] | undefined) ?? [];
  return idx.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Autosave lists the index every time an edit settles, so reporting a blocked read here would put a
 * toast on screen every few seconds for as long as someone kept typing — and bury the one about the
 * save that actually failed. A listing nobody can read comes back empty; the writes do the talking.
 */
export async function listProjects(): Promise<ProjectMeta[]> {
  try {
    lastListFailed = false;
    return await readIndex();
  } catch (e) {
    console.warn("Could not read your saved projects", e);
    lastListFailed = true;
    return [];
  }
}

let lastListFailed = false;
/** True when the last listing came back empty because storage refused to be read, not because it is empty. */
export function listingFailed(): boolean { return lastListFailed; }

export async function saveProject(p: Project): Promise<void> {
  try {
    await idbSet(PROJECT_PREFIX + p.id, p);
    const idx = await readIndex();
    const meta: ProjectMeta = { id: p.id, name: p.name, updatedAt: p.updatedAt, device: p.mockup.device };
    const next = [meta, ...idx.filter((m) => m.id !== p.id)];
    await idbSet(INDEX_KEY, next);
    lastFailure = { message: "", at: 0 };
  } catch (e) {
    reportStorageFailure(`Could not save “${p.name}”`, e);
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const p = (await idbGet(PROJECT_PREFIX + id)) as Project | undefined;
  if (!p) return null;
  await restoreMedia(p);
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await idbDel(PROJECT_PREFIX + id);
    const idx = await readIndex();
    await idbSet(INDEX_KEY, idx.filter((m) => m.id !== id));
  } catch (e) {
    reportStorageFailure("Could not delete the project", e);
  }
}

export async function saveAutosave(p: Project): Promise<void> {
  try { await idbSet(AUTOSAVE_KEY, p); autosaveWarned = false; }
  catch (e) {
    // silently losing the session is the worst outcome; warn once per failure streak
    console.warn("autosave failed", e);
    if (!autosaveWarned) { autosaveWarned = true; onStorageError("Autosave failed — this browser is blocking storage"); }
  }
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    const p = (await idbGet(AUTOSAVE_KEY)) as Project | undefined;
    if (!p) return null;
    await restoreMedia(p);
    return p;
  } catch {
    return null;
  }
}

export function collectMedia(p: Project): MediaRef[] {
  const out: MediaRef[] = [];
  for (const s of p.shots) { if (s.media) out.push(s.media); if (s.logo?.media) out.push(s.logo.media); }
  if (p.scene.background.image) out.push(p.scene.background.image);
  if (p.audio?.media) out.push(p.audio.media);
  if (p.screen.bg?.image) out.push(p.screen.bg.image);
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/**
 * Drop stored media that no project references any more. Without this, every screenshot ever
 * dropped on the canvas stays in IndexedDB for good and the quota fills up on its own.
 * Returns how many records were removed.
 */
export async function pruneMedia(live?: Project): Promise<number> {
  try {
    const keep = new Set<string>();
    const add = (p: Project | null | undefined) => { if (p) for (const m of collectMedia(p)) keep.add(m.id); };
    add(live);
    add((await idbGet(AUTOSAVE_KEY)) as Project | undefined);
    const idx = ((await idbGet(INDEX_KEY)) as ProjectMeta[] | undefined) ?? [];
    for (const meta of idx) add((await idbGet(PROJECT_PREFIX + meta.id)) as Project | undefined);
    const all = (await idbKeys()) as string[];
    let removed = 0;
    for (const k of all) {
      if (typeof k !== "string" || !k.startsWith("media:")) continue;
      if (keep.has(k.slice(6))) continue;
      await idbDel(k);
      removed++;
    }
    return removed;
  } catch (e) {
    console.warn("media prune failed", e);
    return 0;
  }
}

/** Copy a project with the given media refs cleared, so a file never ships a ref it cannot fill. */
function withoutMedia(p: Project, ids: Set<string>): Project {
  const gone = (m: MediaRef | null | undefined) => !!m && ids.has(m.id);
  const next: Project = {
    ...p,
    shots: p.shots.map((s) => (gone(s.media) || gone(s.logo?.media)
      ? { ...s, media: gone(s.media) ? null : s.media, logo: s.logo && gone(s.logo.media) ? { ...s.logo, media: null } : s.logo }
      : s)),
  };
  if (gone(p.scene.background.image)) {
    const type = p.scene.background.type === "image" ? "color" : p.scene.background.type;
    next.scene = { ...p.scene, background: { ...p.scene.background, type, image: null } };
  }
  if (p.screen.bg && gone(p.screen.bg.image)) next.screen = { ...p.screen, bg: { ...p.screen.bg, type: "color", image: null } };
  if (gone(p.audio?.media)) next.audio = null;
  return next;
}

/** Serialise a project + its media to a portable JSON file. */
export async function exportProjectFile(p: Project): Promise<Blob> {
  try {
    const media: Record<string, { ref: MediaRef; data: string }> = {};
    const missing: MediaRef[] = [];
    for (const ref of collectMedia(p)) {
      const loaded = await ensureMedia(ref);
      if (loaded) media[ref.id] = { ref, data: await blobToDataURL(loaded.blob) };
      else missing.push(ref);
    }
    // keeping a ref whose blob is gone would import as a screen the crop tools can never fill
    const project = missing.length ? withoutMedia(p, new Set(missing.map((m) => m.id))) : p;
    if (missing.length) onStorageError(`Exported without ${mediaNames(missing)} — ${missing.length === 1 ? "that file is" : "those files are"} no longer on this device`);
    const json = JSON.stringify({ format: "mok", version: 1, project, media });
    return new Blob([json], { type: "application/json" });
  } catch (e) {
    reportStorageFailure(`Could not export “${p.name}”`, e);
  }
}

export async function importProjectFile(file: Blob): Promise<Project> {
  const text = await file.text();
  const data = JSON.parse(text) as { format: string; project: Project; media: Record<string, { ref: MediaRef; data: string }> };
  if (data.format !== "mok" || !data.project) throw new Error("Not a mok project file");
  const dropped: MediaRef[] = [];
  const animated: MediaRef[] = [];
  for (const m of Object.values(data.media ?? {})) {
    const blob = await dataURLToBlob(m.data);
    try {
      await registerMedia(m.ref, blob);
    } catch (e) {
      // one unshowable file should not cost the whole project; clear its refs so nothing points at a blank
      console.warn("media restore failed", e);
      if ((e as Error)?.message === ANIMATED_GIF_MESSAGE) animated.push(m.ref);
      dropped.push(m.ref);
    }
  }
  const p = dropped.length ? withoutMedia(data.project, new Set(dropped.map((m) => m.id))) : data.project;
  if (dropped.length) {
    // the two reasons are tracked separately, so a file that simply would not decode is not
    // reported as an animated GIF just because another file in the same import was one
    const unreadable = dropped.filter((m) => !animated.includes(m));
    const parts: string[] = [];
    if (animated.length) parts.push(`${mediaNames(animated)} — animated GIFs are not supported`);
    if (unreadable.length) parts.push(`${mediaNames(unreadable)} — ${unreadable.length === 1 ? "that file" : "those files"} could not be read`);
    const message = `Imported without ${parts.join("; ")}`;
    // whoever called this announces the import as soon as it resolves, and only one toast is on screen at a time
    setTimeout(() => onStorageError(message), 0);
  }
  p.id = uid();
  p.updatedAt = Date.now();
  return p;
}

export async function hasAnyProjects(): Promise<boolean> {
  const ks = await idbKeys();
  return ks.some((k) => typeof k === "string" && k.startsWith(PROJECT_PREFIX));
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
