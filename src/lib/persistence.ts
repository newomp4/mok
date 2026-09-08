"use client";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, update as idbUpdate, createStore } from "idb-keyval";
import type { MediaRef, Project, ProjectMeta } from "./types";
import { ANIMATED_GIF_MESSAGE, blobToDataURL, dataURLToBlob, ensureMedia, registerMedia, useMediaStore } from "./media";
import { uid } from "./ids";
import { normalizeProject } from "./defaults";
import { validateMediaRef } from "./validateProject";
import { draftKey, leaseKey, ownedTransaction, ProjectOwnershipError, useProjectOwnership, writeTicket, type WriteTicket, type ProjectLease } from "./projectOwnership";

import { MEDIA_ORPHAN_PREFIX, MEDIA_RETENTION_VERSION, MEDIA_SESSION_PREFIX, oldOrphan, referencedMediaIds, retainMedia, validMediaManifest, withMediaMaintenance, type MediaOrphan } from "./mediaRetention";

const PROJECT_PREFIX = "project:";
const INDEX_KEY = "projects:index";
const TEMPLATE_PREFIX = "template:";
const TEMPLATE_INDEX_KEY = "templates:index";
const AUTOSAVE_KEY = "autosave";
const projectStore = createStore("keyval-store", "keyval");

// Keep a record and its index update in call order, including save/delete races on the same id.
let writeTail: Promise<unknown> = Promise.resolve();
function writeInOrder<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeTail.then(fn, fn);
  writeTail = next.catch(() => {});
  return next;
}

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
  await writeTail;
  const idx = ((await idbGet(INDEX_KEY)) as ProjectMeta[] | undefined) ?? [];
  if (!Array.isArray(idx)) throw new Error("Saved project index is damaged");
  return idx.filter((m) => m && typeof m.id === "string").sort((a, b) => b.updatedAt - a.updatedAt);
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

function writeProjectRecord(p: Project, onlyIfSaved: boolean, ticket: WriteTicket | null | undefined): Promise<void> {
  return ownedTransaction<void>(p.id, ticket, (store) => {
    const tx = store.transaction;
    const request = store.get(INDEX_KEY);
    request.onsuccess = () => {
      try {
        const idx = (request.result ?? []) as ProjectMeta[];
        if (!Array.isArray(idx)) throw new Error("Saved project index is damaged");
        if (onlyIfSaved && !idx.some((m) => m.id === p.id)) return;
        const meta: ProjectMeta = { id: p.id, name: p.name, updatedAt: p.updatedAt, device: p.mockup.device };
        store.put(p, PROJECT_PREFIX + p.id);
        if (ticket !== undefined) store.put(p, draftKey(p.id));
        store.put([meta, ...idx.filter((m) => m.id !== p.id)], INDEX_KEY);
      } catch { tx.abort(); }
    };
  });
}

function queueProjectSave(p: Project, onlyIfSaved: boolean): Promise<void> {
  p = structuredClone(p);
  const ticket = writeTicket(p.id);
  const retained = retainMedia(referencedMediaIds(p));
  return writeInOrder(async () => {
    try {
      await retained;
      await writeProjectRecord(p, onlyIfSaved, ticket);
      lastFailure = { message: "", at: 0 };
    } catch (e) {
      if (e instanceof ProjectOwnershipError) throw e;
      reportStorageFailure(`Could not save “${p.name}”`, e);
    }
  });
}

export function saveProject(p: Project): Promise<void> { return queueProjectSave(p, false); }

/** Autosave an existing project without a delayed list read reordering saves or reviving deletions. */
export function saveProjectIfSaved(p: Project): Promise<void> { return queueProjectSave(p, true); }

export async function loadProject(id: string): Promise<Project | null> {
  await writeTail;
  const saved = (await idbGet(PROJECT_PREFIX + id)) as Project | undefined;
  const draft = (await idbGet(draftKey(id))) as Project | undefined;
  const p = draft ?? saved;
  if (!p) return null;
  const safe = normalizeProject(p);
  await restoreMedia(safe);
  return safe;
}

export async function deleteProject(id: string): Promise<void> {
  return writeInOrder(async () => {
    try {
      if (useProjectOwnership.getState().enabled) {
        await projectStore("readwrite", (store) => new Promise<void>((resolve, reject) => {
          const tx = store.transaction;
          tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new ProjectOwnershipError());
          const lease = store.get(leaseKey(id));
          lease.onsuccess = () => {
            const l = lease.result as ProjectLease | undefined;
            if (l && l.expires > Date.now() && l.token !== writeTicket(id)?.token) { tx.abort(); return; }
            const index = store.get(INDEX_KEY);
            index.onsuccess = () => { store.delete(PROJECT_PREFIX + id); store.delete(draftKey(id)); store.put((index.result ?? []).filter((m: ProjectMeta) => m.id !== id), INDEX_KEY); };
          };
        }));
        return;
      }
      await idbDel(PROJECT_PREFIX + id);
      await idbUpdate<ProjectMeta[]>(INDEX_KEY, (idx = []) => idx.filter((m) => m.id !== id));
    } catch (e) {
      reportStorageFailure("Could not delete the project", e);
    }
  });
}

export async function saveAutosave(p: Project, explicitTicket?: WriteTicket): Promise<void> {
  p = structuredClone(p);
  const ticket = explicitTicket ?? writeTicket(p.id);
  if (ticket === null) return;
  const retained = retainMedia(referencedMediaIds(p));
  return writeInOrder(async () => {
    try {
      await retained;
      if (ticket === undefined) await idbSet(AUTOSAVE_KEY, p);
      else await ownedTransaction<void>(p.id, ticket, (store) => { store.put(p, draftKey(p.id)); store.put(p, AUTOSAVE_KEY); });
      autosaveWarned = false;
    }
    catch (e) {
      if (e instanceof ProjectOwnershipError) return;
      // silently losing the session is the worst outcome; warn once per failure streak
      console.warn("autosave failed", e);
      if (!autosaveWarned) { autosaveWarned = true; onStorageError("Autosave failed — this browser is blocking storage"); }
    }
  });
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    await writeTail;
    let tabProject: string | null = null;
    try { tabProject = sessionStorage.getItem("mok:open-project"); } catch {}
    const p = (tabProject && await idbGet(draftKey(tabProject))) || (await idbGet(AUTOSAVE_KEY)) as Project | undefined;
    if (!p) return null;
    const safe = normalizeProject(p);
    await restoreMedia(safe);
    return safe;
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
 * Reclaim only old, repeatedly unreferenced bytes. Web Locks prove which tab manifests are live;
 * the IndexedDB transaction scans records directly, so an out-of-date index cannot hide a project.
 * Missing evidence, damaged records and unsupported locks all retain media instead of guessing.
 */
export async function pruneMedia(live?: Project): Promise<number> {
  try {
    await writeTail;
    const local = new Set([...Object.keys(useMediaStore.getState().items), ...Object.keys(useMediaStore.getState().loading)]);
    if (live) for (const id of referencedMediaIds(live)) local.add(id);
    await retainMedia(local);
    return await withMediaMaintenance((sessions) => projectStore("readwrite", (store) => new Promise<number>((resolve, reject) => {
      const tx = store.transaction, now = Date.now();
      let removed = 0, deletedBytes = 0, marked = 0;
      tx.oncomplete = () => resolve(removed);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Media cleanup was interrupted"));
      const fail = () => { try { tx.abort(); } catch {} };
      const keys = store.getAllKeys(undefined, 50_001);
      keys.onsuccess = () => {
        if (keys.result.length > 50_000) { fail(); return; }
        const all = keys.result.filter((key): key is string => typeof key === "string");
        const keySet = new Set(all);
        const records = new Map<string, unknown>();
        const metadata = all.filter((key) => !key.startsWith("media:"));
        let remaining = metadata.length;
        const scan = () => {
          try {
            const keep = new Set(local), knownTokens = new Set<string>(), activeTokens = new Set<string>();
            for (const [key, record] of records) {
              if (key.startsWith(MEDIA_SESSION_PREFIX) && validMediaManifest(record, key.slice(MEDIA_SESSION_PREFIX.length))) {
                for (const token of record.tokens) knownTokens.add(token);
              }
            }
            for (const session of sessions) {
              const manifest = records.get(MEDIA_SESSION_PREFIX + session);
              if (!validMediaManifest(manifest, session)) throw new Error("A live tab has no complete media manifest");
              for (const id of manifest.ids) keep.add(id);
            }
            let unknownWriter = false;
            for (const [key, record] of records) {
              if (key.startsWith("ownership:")) {
                const lease = record as ProjectLease;
                if (!lease || typeof lease.token !== "string" || !Number.isFinite(lease.expires)) throw new Error("Project lease is damaged");
                if (lease.expires > now) { activeTokens.add(lease.token); if (!knownTokens.has(lease.token)) unknownWriter = true; }
              }
              const isProject = key === AUTOSAVE_KEY || key.startsWith(PROJECT_PREFIX) || key.startsWith("draft:");
              const isTemplate = key.startsWith(TEMPLATE_PREFIX);
              const project = isProject ? record : isTemplate ? (record as { project?: unknown })?.project : undefined;
              if (isProject || isTemplate) {
                if (!project || typeof project !== "object" || (project as Project).version !== 1 || !Array.isArray((project as Project).shots)) throw new Error("A stored project is damaged or uses an unfamiliar format");
                for (const id of referencedMediaIds(project)) keep.add(id);
              }
            }
            // Unindexed records were already included above; index entries with missing records
            // instead indicate damaged storage, so give recovery priority over reclaiming bytes.
            for (const [indexKey, prefix] of [[INDEX_KEY, PROJECT_PREFIX], [TEMPLATE_INDEX_KEY, TEMPLATE_PREFIX]]) {
              const index = records.get(indexKey);
              if (index !== undefined && (!Array.isArray(index) || index.some((meta) => !meta || typeof meta.id !== "string" || !records.has(prefix + meta.id)))) throw new Error("A stored index is damaged");
            }
            for (const key of all) {
              if (key.startsWith(MEDIA_SESSION_PREFIX) && !sessions.has(key.slice(MEDIA_SESSION_PREFIX.length))) {
                const manifest = records.get(key);
                // A closed tab's lease may outlive its browser lock when pagehide could not finish.
                // Keep only the protocol evidence until that lease expires; its media pins are
                // already excluded above. No ownership lease is modified or extended by cleanup.
                if (!validMediaManifest(manifest, key.slice(MEDIA_SESSION_PREFIX.length)) || !manifest.tokens.some((token) => activeTokens.has(token))) store.delete(key);
              }
              if (key.startsWith(MEDIA_ORPHAN_PREFIX) && !keySet.has("media:" + key.slice(MEDIA_ORPHAN_PREFIX.length))) store.delete(key);
            }
            // An old application tab can still be writing without the new manifest protocol.
            if (unknownWriter) return;
            for (const key of all) {
              if (!key.startsWith("media:")) continue;
              const id = key.slice(6), orphanKey = MEDIA_ORPHAN_PREFIX + id;
              if (keep.has(id)) { if (records.has(orphanKey)) store.delete(orphanKey); continue; }
              const request = store.get(key);
              request.onsuccess = () => {
                try {
                  const record = request.result as { ref?: MediaRef; blob?: Blob; storedAt?: number; retentionVersion?: number } | undefined;
                  if (!record || record.ref?.id !== id || !(record.blob instanceof Blob)) throw new Error("A stored media record is damaged");
                  // Pre-protocol tabs cannot publish their private undo history. Only explicit new
                  // imports opt in; loading or inspecting legacy bytes must never retrofit a tag.
                  if (record.retentionVersion !== MEDIA_RETENTION_VERSION) { if (records.has(orphanKey)) store.delete(orphanKey); return; }
                  const candidate = { blob: record.blob, storedAt: record.storedAt, retentionVersion: record.retentionVersion };
                  const previous = records.get(orphanKey) as MediaOrphan | undefined;
                  if (oldOrphan(previous, candidate, now)) {
                    if (removed < 32 && (removed === 0 || deletedBytes + record.blob.size <= 128 * 1024 * 1024)) {
                      store.delete(key); store.delete(orphanKey); removed++; deletedBytes += record.blob.size;
                    }
                  } else if (marked < 512 && (!previous || previous.version !== 1 || !Number.isFinite(previous.observedAt) || previous.observedAt <= 0 || previous.observedAt > now || previous.observedAt < (record.storedAt ?? 0) || previous.storedAt !== (record.storedAt ?? null) || previous.size !== record.blob.size || previous.type !== record.blob.type)) {
                    const marker: MediaOrphan = { version: 1, observedAt: now, storedAt: record.storedAt ?? null, size: record.blob.size, type: record.blob.type };
                    store.put(marker, orphanKey); marked++;
                  }
                } catch { fail(); }
              };
            }
          } catch { fail(); }
        };
        if (!remaining) scan();
        for (const key of metadata) {
          const request = store.get(key);
          request.onsuccess = () => { records.set(key, request.result); if (--remaining === 0) scan(); };
        }
      };
    })), 0);
  } catch (e) {
    console.warn("media prune skipped", e);
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

/** What the template list can draw without reading a single stored template. */
export interface TemplateMeta {
  id: string;
  name: string;
  device: string;
  createdAt: number;
  /** small WebP data URL of the frame the template was saved on */
  thumb: string;
}

interface StoredTemplate extends TemplateMeta {
  project: Project;
}

/** The bare template index read; it throws for the same reason `readIndex` does. */
async function readTemplateIndex(): Promise<TemplateMeta[]> {
  await writeTail;
  const idx = ((await idbGet(TEMPLATE_INDEX_KEY)) as TemplateMeta[] | undefined) ?? [];
  if (!Array.isArray(idx)) throw new Error("Saved template index is damaged");
  return idx.filter((m) => m && typeof m.id === "string").sort((a, b) => b.createdAt - a.createdAt);
}

let lastTemplateListFailed = false;
/** True when the last listing came back empty because storage refused to be read, not because it is empty. */
export function templateListingFailed(): boolean { return lastTemplateListFailed; }

export async function listTemplates(): Promise<TemplateMeta[]> {
  try {
    lastTemplateListFailed = false;
    return await readTemplateIndex();
  } catch (e) {
    console.warn("Could not read your saved templates", e);
    lastTemplateListFailed = true;
    return [];
  }
}

/**
 * A template is a look to start from, so it keeps every setting and none of the media: the
 * screenshots and clips belong to the project they were dropped on, not to the template saved from
 * it, and copying them would double the storage every template costs.
 */
export async function saveTemplate(p: Project, name: string, thumb: string): Promise<TemplateMeta> {
  p = structuredClone(p);
  return writeInOrder(async () => {
    const meta: TemplateMeta = { id: uid(), name, device: p.mockup.device, createdAt: Date.now(), thumb };
    try {
      const record: StoredTemplate = { ...meta, project: withoutMedia(p, new Set(collectMedia(p).map((m) => m.id))) };
      await idbSet(TEMPLATE_PREFIX + meta.id, record);
      await idbUpdate<TemplateMeta[]>(TEMPLATE_INDEX_KEY, (idx = []) => [meta, ...idx]);
      lastFailure = { message: "", at: 0 };
      return meta;
    } catch (e) {
      reportStorageFailure(`Could not save “${name}” as a template`, e);
    }
  });
}

/** Read a template back as a fresh project, ready to replace whatever is open. */
export async function projectFromTemplate(id: string): Promise<Project | null> {
  await writeTail;
  const t = (await idbGet(TEMPLATE_PREFIX + id)) as StoredTemplate | undefined;
  if (!t) return null;
  return normalizeProject({ ...t.project, id: uid(), name: t.name, createdAt: Date.now(), updatedAt: Date.now() });
}

export async function deleteTemplate(id: string): Promise<void> {
  return writeInOrder(async () => {
    try {
      await idbDel(TEMPLATE_PREFIX + id);
      await idbUpdate<TemplateMeta[]>(TEMPLATE_INDEX_KEY, (idx = []) => idx.filter((m) => m.id !== id));
    } catch (e) {
      reportStorageFailure("Could not delete the template", e);
    }
  });
}

/** Serialise a project + its media to a portable JSON file. */
export async function exportProjectFile(p: Project): Promise<Blob> {
  p = structuredClone(p);
  try {
    const media: Record<string, { ref: MediaRef; data: string }> = {};
    const missing: MediaRef[] = [];
    for (const ref of collectMedia(p)) {
      const loaded = await ensureMedia(ref);
      if (loaded) media[ref.id] = { ref, data: await blobToDataURL(loaded.blob) };
      else missing.push(ref);
    }
    // Missing bytes must not erase the filename or clip settings needed to locate the source later.
    if (missing.length) onStorageError(`Exported with missing media: ${mediaNames(missing)} — locate ${missing.length === 1 ? "the file" : "those files"} after reopening to restore them`);
    const json = JSON.stringify({ format: "mok", version: 1, project: p, media });
    return new Blob([json], { type: "application/json" });
  } catch (e) {
    reportStorageFailure(`Could not export “${p.name}”`, e);
  }
}

export async function importProjectFile(file: Blob): Promise<Project> {
  let data: { format?: unknown; version?: unknown; project?: Project; media?: Record<string, { ref?: unknown; data?: unknown }> };
  try { data = JSON.parse(await file.text()); } catch { throw new Error("Not a readable mok project file"); }
  if (!data || data.format !== "mok" || !data.project) throw new Error("Not a mok project file");
  if (data.version !== undefined && data.version !== 1) throw new Error("This mok file uses an unsupported version");
  const p = normalizeProject(data.project);
  const missing: MediaRef[] = [];
  const animated: MediaRef[] = [];
  const replacements = new Map<string, MediaRef>();
  for (const ref of collectMedia(p)) {
    // Missing references need isolation too: reusing the portable id could silently attach an
    // unrelated cached upload, and would lose the missing-file repair state.
    const importedRef = { ...ref, id: uid() };
    replacements.set(ref.id, importedRef);
    const m = data.media && Object.hasOwn(data.media, ref.id) ? data.media[ref.id] : undefined;
    try {
      const embeddedRef = validateMediaRef(m?.ref);
      if (!embeddedRef || embeddedRef.id !== ref.id || embeddedRef.kind !== ref.kind || typeof m?.data !== "string") throw new Error("The embedded media is missing or invalid");
      const blob = await dataURLToBlob(m.data);
      // Portable files keep their source ids. Give every imported blob a new one so opening an
      // older export cannot replace media that a different saved project still references.
      const loaded = await registerMedia(importedRef, blob);
      replacements.set(ref.id, loaded.ref);
    } catch (e) {
      console.warn("media restore failed", e);
      if ((e as Error)?.message === ANIMATED_GIF_MESSAGE) animated.push(ref);
      missing.push(ref);
      useMediaStore.setState((s) => ({ missing: { ...s.missing, [importedRef.id]: true } }));
    }
  }
  const replace = (ref: MediaRef | null | undefined) => ref ? replacements.get(ref.id) ?? null : null;
  for (const shot of p.shots) { shot.media = replace(shot.media); if (shot.logo) shot.logo.media = replace(shot.logo.media); }
  p.scene.background.image = replace(p.scene.background.image);
  if (p.screen.bg) p.screen.bg.image = replace(p.screen.bg.image);
  if (p.audio) { const media = replace(p.audio.media); p.audio = media ? { ...p.audio, media } : null; }
  if (p.scene.background.type === "image" && !p.scene.background.image) p.scene.background.type = "color";
  if (p.screen.bg?.type === "image" && !p.screen.bg.image) p.screen.bg.type = "color";
  if (missing.length) {
    // the two reasons are tracked separately, so a file that simply would not decode is not
    // reported as an animated GIF just because another file in the same import was one
    const unreadable = missing.filter((m) => !animated.includes(m));
    const parts: string[] = [];
    if (animated.length) parts.push(`${mediaNames(animated)} — animated GIFs are not supported`);
    if (unreadable.length) parts.push(`${mediaNames(unreadable)} — ${unreadable.length === 1 ? "that file" : "those files"} could not be read`);
    const message = `Imported with missing media: ${parts.join("; ")}. Locate the source files to restore them.`;
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

export function downloadBlob(blob: Blob, filename: string, cleanup?: () => Promise<void>) {
  const a = document.createElement("a");
  let url: string | null = null;
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    a.remove();
    void cleanup?.().catch(() => {});
  };
  try {
    a.href = url = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(release, cleanup ? 60_000 : 1000);
  } catch (error) { release(); throw error; }
}
