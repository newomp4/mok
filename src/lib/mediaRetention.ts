"use client";
import { createStore } from "idb-keyval";

export const MEDIA_MAINTENANCE_LOCK = "mok-media-maintenance-v1";
export const MEDIA_SESSION_LOCK = "mok-media-session-v1:";
export const MEDIA_UNSAFE_LOCK = "mok-media-unsafe-v1:";
export const MEDIA_SESSION_PREFIX = "media-session:";
export const MEDIA_ORPHAN_PREFIX = "media-orphan:";
export const MEDIA_ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const MEDIA_RETENTION_VERSION = 1;
export interface MediaManifest { version: 1; session: string; ids: string[]; tokens: string[] }
export interface MediaOrphan { version: 1; observedAt: number; storedAt: number | null; size: number; type: string }
const store = createStore("keyval-store", "keyval");
let session: string | null = null, ready: Promise<boolean> | null = null, unsafe = false;
const ids = new Set<string>(), tokens = new Set<string>();
let persistedIds = new Set<string>(), persistedTokens = new Set<string>();
let tail: Promise<unknown> = Promise.resolve();

function locks(): LockManager | null {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && typeof navigator.locks?.query === "function" ? navigator.locks : null;
}

/** Browser-owned lifetime, not a timer: a sleeping or read-only tab keeps its undo media pinned. */
function hold(manager: LockManager, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void manager.request(name, () => {
      resolve();
      // Closing this browsing context releases the lock, including a crash without pagehide.
      return new Promise<void>(() => {});
    }).catch(reject);
  });
}
function initialize(manager: LockManager): Promise<boolean> {
  if (!ready) {
    session = crypto.randomUUID();
    ready = (async () => await manager.request(MEDIA_MAINTENANCE_LOCK, { mode: "shared" }, async () => {
      await hold(manager, MEDIA_SESSION_LOCK + session);
      // A missing manifest for this live lock blocks cleanup if storage fails or the tab closes
      // between registration and commit. A later sweep removes the abandoned record.
      return true;
    }))().catch(() => false);
  }
  return ready;
}

/**
 * Pins are a union for this tab's lifetime, intentionally retaining undo/redo, clipboard sources
 * and imports that have not reached a shot yet. Failures never block ordinary editing; an extra
 * live lock makes every other tab fail closed until this context closes.
 */
export async function retainMedia(mediaIds: Iterable<string>, ownershipToken?: string): Promise<void> {
  for (const id of mediaIds) ids.add(id);
  if (ownershipToken) tokens.add(ownershipToken);
  const manager = locks();
  if (!manager) return;
  const next = tail.then(async () => {
    if (!await initialize(manager) || unsafe) return;
    if (ids.size === persistedIds.size && tokens.size === persistedTokens.size && persistedIds.size + persistedTokens.size > 0) return;
    try {
      await manager.request(MEDIA_MAINTENANCE_LOCK, { mode: "shared" }, async () => {
        const snapshot: MediaManifest = { version: 1, session: session!, ids: [...ids], tokens: [...tokens] };
        try {
          await store("readwrite", (s) => new Promise<void>((resolve, reject) => {
            s.transaction.oncomplete = () => resolve();
            s.transaction.onerror = s.transaction.onabort = () => reject(s.transaction.error ?? new Error("Media pin write failed"));
            // Reusing an orphan starts a fresh grace period after this tab closes. In particular,
            // a reload gap must not expose an old marker before tab-local draft recovery runs.
            try {
              for (const id of snapshot.ids) if (!persistedIds.has(id)) s.delete(MEDIA_ORPHAN_PREFIX + id);
              s.put(snapshot, MEDIA_SESSION_PREFIX + snapshot.session);
            } catch (error) { s.transaction.abort(); reject(error); }
          }));
          persistedIds = new Set(snapshot.ids); persistedTokens = new Set(snapshot.tokens);
        } catch (error) {
          unsafe = true;
          // Register the veto while still holding the shared maintenance gate, before a sweep can
          // observe an older valid manifest which lacks the new import's pin.
          await hold(manager, MEDIA_UNSAFE_LOCK + session);
          throw error;
        }
      });
    } catch { unsafe = true; }
  });
  tail = next.catch(() => {});
  await next;
}

/** Gather possible refs without normalizing away partial legacy sources or unfamiliar layers. */
export function referencedMediaIds(value: unknown): Set<string> {
  const found = new Set<string>(), seen = new Set<object>(), todo: unknown[] = [value];
  let visited = 0;
  while (todo.length) {
    const item = todo.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    if (++visited > 100_000) throw new Error("Project is too large to inspect safely");
    seen.add(item);
    const object = item as Record<string, unknown>;
    // A few extra project/shot IDs cost no media space. Dropping an ID because a damaged or older
    // source lacks its kind would instead destroy bytes that could still repair that document.
    if (typeof object.id === "string") found.add(object.id);
    for (const child of Object.values(object)) if (child && typeof child === "object") todo.push(child);
  }
  return found;
}

/** Exclusive snapshots cannot race a new tab's registration or a pending import's pin commit. */
export async function withMediaMaintenance<T>(run: (liveSessions: Set<string>) => Promise<T>, skipped: T): Promise<T> {
  const manager = locks();
  if (!manager || !await initialize(manager)) return skipped;
  await tail;
  if (unsafe) return skipped;
  return manager.request(MEDIA_MAINTENANCE_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return skipped;
    const snapshot = await manager.query();
    if (!snapshot.held || snapshot.held.some((entry) => entry.name?.startsWith(MEDIA_UNSAFE_LOCK))) return skipped;
    const sessions = new Set(snapshot.held.flatMap((entry) => entry.name?.startsWith(MEDIA_SESSION_LOCK) ? [entry.name.slice(MEDIA_SESSION_LOCK.length)] : []));
    if (!session || !sessions.has(session)) return skipped;
    return run(sessions);
  });
}

export function validMediaManifest(value: unknown, session: string): value is MediaManifest {
  const m = value as MediaManifest | null;
  return !!m && m.version === 1 && m.session === session && Array.isArray(m.ids) && m.ids.every((id) => typeof id === "string") && Array.isArray(m.tokens) && m.tokens.every((token) => typeof token === "string");
}

/** Two observations of the same stored bytes, at least a week apart, are required for removal. */
export function oldOrphan(marker: unknown, record: { blob: Blob; storedAt?: number; retentionVersion?: number }, now: number): boolean {
  if (record.retentionVersion !== MEDIA_RETENTION_VERSION) return false;
  const m = marker as MediaOrphan | null;
  return !!m && m.version === 1 && Number.isFinite(m.observedAt) && m.observedAt > 0 && now - m.observedAt >= MEDIA_ORPHAN_GRACE_MS &&
    m.storedAt === (record.storedAt ?? null) && m.size === record.blob.size && m.type === record.blob.type &&
    (record.storedAt === undefined || (Number.isFinite(record.storedAt) && record.storedAt <= m.observedAt));
}
