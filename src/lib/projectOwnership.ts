"use client";
import { create } from "zustand";
import { createStore } from "idb-keyval";
import type { Project } from "./types";
import { referencedMediaIds, retainMedia } from "./mediaRetention";

export const LEASE_MS = 30_000;
export const leaseKey = (id: string) => `ownership:${id}`;
export const draftKey = (id: string) => `draft:${id}`;
export interface ProjectLease { token: string; expires: number }
export interface WriteTicket { projectId: string; token: string }
type Mode = "checking" | "editing" | "readonly" | "session";
export const useProjectOwnership = create<{ enabled: boolean; projectId: string | null; mode: Mode; token: string | null; expires: number; reason: string }>(() => ({ enabled: false, projectId: null, mode: "checking", token: null, expires: 0, reason: "" }));
const db = createStore("keyval-store", "keyval");
const markerKey = "mok:ownership-change";
let channel: BroadcastChannel | null = null;
let generation = 0;
let callbacks: { current: () => Project; restore: (p: Project) => void; flush: (p: Project, ticket: WriteTicket) => Promise<void>; stopEditing: () => void } | null = null;
let pending: Promise<boolean> = Promise.resolve(true);
const resumeKey = (id: string) => `mok:lease:${id}`;
const recoveryKey = "mok:reload-recovery";
function reloadToken(id: string): string | null {
  try { return (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.type === "reload" ? sessionStorage.getItem(resumeKey(id)) : null; } catch { return null; }
}
function reloadRecovery(id: string, lease: ProjectLease | undefined): Project | null {
  try {
    if (!lease || !reloadToken(id)) return null;
    const recovery = JSON.parse(sessionStorage.getItem(recoveryKey) ?? "null");
    return recovery?.token === lease.token && recovery.project?.id === id ? recovery.project : null;
  } catch { return null; }
}
function rememberPendingDraft() {
  const s = useProjectOwnership.getState(), p = callbacks?.current();
  // pagehide cannot reliably finish an asynchronous IndexedDB transaction. This snapshot is
  // tab-local, contains media references only, and is accepted only against its original lease.
  if (s.token && p?.id === s.projectId) {
    try { sessionStorage.setItem(recoveryKey, JSON.stringify({ token: s.token, project: p })); } catch {}
  }
}

export function validLease(lease: ProjectLease | undefined, token: string, now = Date.now()): boolean {
  return !!lease && lease.token === token && lease.expires > now;
}
export class ProjectOwnershipError extends Error { constructor() { super("This project is read-only in this tab. Choose Edit here before saving changes."); this.name = "ProjectOwnershipError"; } }

/** A synchronous edit guard; storage writes independently recheck the token atomically. */
export function canEditProject(id: string): boolean {
  const s = useProjectOwnership.getState();
  if (!s.enabled) return true;
  if (s.projectId !== id) return false;
  if (s.mode === "session") return true;
  if (s.mode !== "editing" || s.expires <= Date.now()) return false;
  try {
    const notice = JSON.parse(localStorage.getItem(markerKey) ?? "null");
    if (notice?.id === id && notice.token && notice.token !== s.token) return false;
  } catch { /* IndexedDB remains the authority when localStorage is unavailable. */ }
  return true;
}
export function writeTicket(id: string): WriteTicket | null | undefined {
  const s = useProjectOwnership.getState();
  if (!s.enabled) return undefined; // Node consumers and migration checks have no browser session.
  return canEditProject(id) && s.mode === "editing" && s.token ? { projectId: id, token: s.token } : null;
}

/** The lease check and caller's writes share a transaction: an expired writer cannot win a race. */
export function ownedTransaction<T>(id: string, ticket: WriteTicket | null | undefined, write: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  if (ticket === null) return Promise.reject(new ProjectOwnershipError());
  return db("readwrite", (store) => new Promise<T>((resolve, reject) => {
    let value: T;
    const tx = store.transaction;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new ProjectOwnershipError());
    const apply = () => { try { write(store, (v) => { value = v; }); } catch (error) { tx.abort(); reject(error); } };
    if (ticket === undefined) { apply(); return; }
    const request = store.get(leaseKey(id));
    request.onsuccess = () => {
      if (ticket.projectId !== id || !validLease(request.result, ticket.token)) { tx.abort(); reject(new ProjectOwnershipError()); return; }
      apply();
    };
  }));
}

function announce(id: string, token: string | null) {
  const message = { type: "changed", id, token, at: Date.now() };
  channel?.postMessage(message);
  try { localStorage.setItem(markerKey, JSON.stringify(message)); } catch {}
}
function leaseTransaction<T>(id: string, act: (store: IDBObjectStore, lease: ProjectLease | undefined) => T): Promise<T> {
  return db("readwrite", (store) => new Promise<T>((resolve, reject) => {
    let result: T;
    const tx = store.transaction;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Project ownership storage is unavailable"));
    const request = store.get(leaseKey(id));
    request.onsuccess = () => { try { result = act(store, request.result); } catch (error) { tx.abort(); reject(error); } };
  }));
}

async function relinquish(project: Project, ticket: WriteTicket) {
  await callbacks?.flush(project, ticket).catch(() => {});
  // Retain the last token as an expired lease so reload recovery can distinguish this owner
  // from a different tab that subsequently edited and released the same project.
  await leaseTransaction(ticket.projectId, (store, lease) => { if (lease?.token === ticket.token) store.put({ token: ticket.token, expires: 0 }, leaseKey(ticket.projectId)); }).catch(() => {});
  announce(ticket.projectId, null);
}
export async function releaseProjectOwnership() {
  rememberPendingDraft();
  const s = useProjectOwnership.getState(), p = callbacks?.current();
  generation++;
  useProjectOwnership.setState({ mode: "readonly", reason: "Editing was released from this tab.", token: null, expires: 0 });
  callbacks?.stopEditing();
  if (s.token && p?.id === s.projectId) await relinquish(p, { projectId: p.id, token: s.token });
}

export function openProjectOwnership(project: Project, previous?: Project): Promise<boolean> {
  const before = useProjectOwnership.getState();
  if (!before.enabled) return Promise.resolve(true);
  if (before.projectId === project.id) return pending;
  if (before.token && previous?.id === before.projectId) void relinquish(previous, { projectId: previous.id, token: before.token });
  useProjectOwnership.setState({ projectId: project.id, mode: "checking", reason: "Checking which tab can edit…", token: null, expires: 0 });
  pending = claim(project, false);
  return pending;
}

async function claim(project: Project, force: boolean): Promise<boolean> {
  const request = ++generation, token = crypto.randomUUID();
  useProjectOwnership.setState({ mode: "checking", reason: "Opening the latest saved draft…" });
  try {
    // Publishing the future token before its lease commits lets cleanup distinguish this tab
    // from a pre-manifest writer. This does not grant access; the transaction below still does.
    await retainMedia(referencedMediaIds(project), token);
    const result = await db("readwrite", (store) => new Promise<{ owned: boolean; lease: ProjectLease; draft: Project }>((resolve, reject) => {
      const tx = store.transaction;
      let result: { owned: boolean; lease: ProjectLease; draft: Project };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Project storage is unavailable"));
      const lease = store.get(leaseKey(project.id)), draft = store.get(draftKey(project.id)), saved = store.get(`project:${project.id}`);
      let reads = 0;
      const done = () => {
        if (++reads !== 3) return;
        if (request !== generation) { tx.abort(); return; }
        const old = lease.result as ProjectLease | undefined;
        // Only a real reload may resume this tab's previous token. A duplicated tab copies
        // sessionStorage too, but is a new navigation and must obtain its own lease.
        const owned = force || !old || old.expires <= Date.now() || old.token === reloadToken(project.id);
        const next = owned ? { token, expires: Date.now() + LEASE_MS } : old!;
        // A draft is transactionally newer than the saved record. Undo intentionally restores
        // old document timestamps, so comparing updatedAt would resurrect the undone revision.
        const recovered = owned ? reloadRecovery(project.id, old) : null;
        const latest = (recovered ?? draft.result ?? saved.result ?? project) as Project;
        if (owned) { store.put(next, leaseKey(project.id)); store.put(latest, draftKey(project.id)); }
        result = { owned, lease: next, draft: latest };
      };
      lease.onsuccess = draft.onsuccess = saved.onsuccess = done;
    }));
    if (request !== generation || callbacks?.current().id !== project.id) return false;
    await retainMedia(referencedMediaIds(result.draft));
    if (request !== generation || callbacks?.current().id !== project.id) return false;
    callbacks?.restore(result.draft);
    useProjectOwnership.setState({ projectId: project.id, mode: result.owned ? "editing" : "readonly", token: result.owned ? token : null, expires: result.owned ? result.lease.expires : 0, reason: result.owned ? "" : "Another tab is editing this project." });
    if (result.owned) {
      try { sessionStorage.setItem(resumeKey(project.id), token); sessionStorage.removeItem(recoveryKey); } catch {}
      announce(project.id, token);
    } else callbacks?.stopEditing();
    return result.owned;
  } catch {
    if (request !== generation) return false;
    useProjectOwnership.setState({ mode: "session", token: null, expires: 0, reason: "Project storage is unavailable. Changes stay in this tab; download a project file to keep them." });
    return true;
  }
}

/** Takeover requests a cooperative flush, then atomically replaces the lease if the tab is asleep. */
export async function takeOverProjectOwnership(): Promise<boolean> {
  const p = callbacks?.current();
  if (!p) return false;
  channel?.postMessage({ type: "release", id: p.id });
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (callbacks?.current().id !== p.id) return false;
  pending = claim(p, true);
  return pending;
}

export async function refreshProjectOwnership() {
  const s = useProjectOwnership.getState();
  if (!s.enabled || !s.projectId || s.mode === "checking" || !s.token) return;
  const ticket = { projectId: s.projectId, token: s.token }, request = generation;
  if (s.expires <= Date.now()) useProjectOwnership.setState({ mode: "checking", reason: "Checking editing access after sleep…" });
  try {
    const expires = await leaseTransaction(s.projectId, (store, lease) => {
      if (lease?.token !== ticket.token) return 0;
      const expires = Date.now() + LEASE_MS;
      store.put({ token: ticket.token, expires }, leaseKey(ticket.projectId));
      return expires;
    });
    if (request !== generation || useProjectOwnership.getState().token !== ticket.token) return;
    useProjectOwnership.setState({ mode: expires ? "editing" : "readonly", expires, token: expires ? ticket.token : null, reason: expires ? "" : "Editing moved to another tab. Your local view is preserved." });
    if (!expires) callbacks?.stopEditing();
    else {
      // A delayed notice cannot overrule the lease just verified in IndexedDB.
      try { const notice = JSON.parse(localStorage.getItem(markerKey) ?? "null"); if (notice?.id === ticket.projectId && notice.token && notice.token !== ticket.token) announce(ticket.projectId, ticket.token); } catch {}
    }
  } catch {
    if (request === generation) { useProjectOwnership.setState({ mode: "readonly", reason: "Editing access could not be verified. Retry before changing this project." }); callbacks?.stopEditing(); }
  }
}

export function startProjectOwnership(handlers: NonNullable<typeof callbacks>) {
  callbacks = handlers;
  void retainMedia(referencedMediaIds(handlers.current()));
  useProjectOwnership.setState({ enabled: true });
  try { channel = new BroadcastChannel("mok-project-ownership"); } catch {}
  if (channel) channel.onmessage = (event) => {
    const s = useProjectOwnership.getState(), message = event.data;
    if (message?.id !== s.projectId) return;
    if (message.type === "release" && s.mode === "editing") void releaseProjectOwnership();
    else if (message.type === "changed") void refreshProjectOwnership();
  };
  const notice = (event: StorageEvent) => { if (event.key === markerKey) void refreshProjectOwnership(); };
  const wake = () => { void refreshProjectOwnership(); };
  const returnToPage = (event: PageTransitionEvent) => {
    if (event.persisted && useProjectOwnership.getState().mode === "readonly") pending = claim(handlers.current(), false);
    else wake();
  };
  const leaving = () => { void releaseProjectOwnership(); };
  window.addEventListener("storage", notice);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", returnToPage);
  window.addEventListener("pagehide", leaving);
  document.addEventListener("visibilitychange", wake);
  const interval = window.setInterval(wake, 4000);
  void openProjectOwnership(handlers.current());
  return () => {
    void releaseProjectOwnership();
    window.clearInterval(interval);
    window.removeEventListener("storage", notice); window.removeEventListener("focus", wake); window.removeEventListener("pageshow", returnToPage); window.removeEventListener("pagehide", leaving); document.removeEventListener("visibilitychange", wake);
    channel?.close(); channel = null;
    useProjectOwnership.setState({ enabled: false, projectId: null });
    callbacks = null;
  };
}

export async function ownershipReady(id: string): Promise<boolean> {
  if (!useProjectOwnership.getState().enabled) return true;
  await pending;
  return canEditProject(id);
}
