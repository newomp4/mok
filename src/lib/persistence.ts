"use client";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type { MediaRef, Project, ProjectMeta } from "./types";
import { blobToDataURL, dataURLToBlob, ensureMedia, registerMedia } from "./media";
import { uid } from "./ids";

const PROJECT_PREFIX = "project:";
const INDEX_KEY = "projects:index";
const AUTOSAVE_KEY = "autosave";

export async function listProjects(): Promise<ProjectMeta[]> {
  const idx = ((await idbGet(INDEX_KEY)) as ProjectMeta[] | undefined) ?? [];
  return idx.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(p: Project): Promise<void> {
  await idbSet(PROJECT_PREFIX + p.id, p);
  const idx = await listProjects();
  const meta: ProjectMeta = { id: p.id, name: p.name, updatedAt: p.updatedAt, device: p.mockup.device };
  const next = [meta, ...idx.filter((m) => m.id !== p.id)];
  await idbSet(INDEX_KEY, next);
}

export async function loadProject(id: string): Promise<Project | null> {
  const p = (await idbGet(PROJECT_PREFIX + id)) as Project | undefined;
  if (!p) return null;
  await Promise.all(collectMedia(p).map((m) => ensureMedia(m)));
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  await idbDel(PROJECT_PREFIX + id);
  const idx = await listProjects();
  await idbSet(INDEX_KEY, idx.filter((m) => m.id !== id));
}

export async function saveAutosave(p: Project): Promise<void> {
  try { await idbSet(AUTOSAVE_KEY, p); } catch {}
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    const p = (await idbGet(AUTOSAVE_KEY)) as Project | undefined;
    if (!p) return null;
    await Promise.all(collectMedia(p).map((m) => ensureMedia(m)));
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

/** Serialise a project + its media to a portable JSON file. */
export async function exportProjectFile(p: Project): Promise<Blob> {
  const media: Record<string, { ref: MediaRef; data: string }> = {};
  for (const ref of collectMedia(p)) {
    const loaded = await ensureMedia(ref);
    if (loaded) media[ref.id] = { ref, data: await blobToDataURL(loaded.blob) };
  }
  const json = JSON.stringify({ format: "mok", version: 1, project: p, media });
  return new Blob([json], { type: "application/json" });
}

export async function importProjectFile(file: Blob): Promise<Project> {
  const text = await file.text();
  const data = JSON.parse(text) as { format: string; project: Project; media: Record<string, { ref: MediaRef; data: string }> };
  if (data.format !== "mok" || !data.project) throw new Error("Not a mok project file");
  for (const m of Object.values(data.media ?? {})) {
    const blob = await dataURLToBlob(m.data);
    await registerMedia(m.ref, blob);
  }
  const p = data.project;
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
