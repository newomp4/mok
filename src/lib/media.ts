"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { uid } from "./ids";
import type { MediaRef } from "./types";
import { MEDIA_RETENTION_VERSION, retainMedia } from "./mediaRetention";

export interface LoadedMedia {
  ref: MediaRef;
  blob: Blob;
  url: string;
  element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
  kind: MediaRef["kind"];
  width: number;
  height: number;
}

interface MediaState {
  items: Record<string, LoadedMedia>;
  loading: Record<string, boolean>;
  missing: Record<string, boolean>;
}

export const useMediaStore = create<MediaState>()(() => ({ items: {}, loading: {}, missing: {} }));
export type MediaStatus = "empty" | "loading" | "ready" | "missing";

function statusOf(ref: MediaRef | null | undefined, state: MediaState): MediaStatus {
  if (!ref) return "empty";
  if (state.items[ref.id]?.kind === ref.kind) return "ready";
  return state.missing[ref.id] ? "missing" : "loading";
}

export function getMediaStatus(ref: MediaRef | null | undefined): MediaStatus {
  return statusOf(ref, useMediaStore.getState());
}

const pending = new Map<string, Promise<LoadedMedia | null>>();
const revisions = new Map<string, number>();
function revision(id: string) { const v = (revisions.get(id) ?? 0) + 1; revisions.set(id, v); return v; }
function release(item: LoadedMedia) {
  if (item.kind !== "image") { const el = item.element as HTMLMediaElement; el.pause(); el.removeAttribute("src"); el.load(); }
  URL.revokeObjectURL(item.url);
}

/** Set by the app so a storage failure can surface as a toast instead of vanishing. */
export let mediaPersistFailed: (name: string, reason: "storage" | "animated-gif") => void = () => {};
export function onMediaPersistFailed(fn: (name: string, reason: "storage" | "animated-gif") => void) { mediaPersistFailed = fn; }

export const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime";
export const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";
export const ACCEPTED_AUDIO = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,audio/flac";

const EXT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" };
export function mediaType(file: Blob & { name?: string }) { return /^(image|video|audio)\//.test(file.type) ? file.type : EXT_TYPES[file.name?.split(".").pop()?.toLowerCase() ?? ""] ?? ""; }

export function isMediaFile(f: File): boolean {
  return !!mediaType(f);
}

function loadAudio(url: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "auto";
    a.crossOrigin = "anonymous";
    const timer = setTimeout(() => { cleanup(); a.removeAttribute("src"); a.load(); reject(new Error("Audio loading timed out")); }, 30000);
    const cleanup = () => { clearTimeout(timer); a.onloadedmetadata = null; a.onerror = null; };
    a.onloadedmetadata = () => { cleanup(); resolve(a); };
    a.onerror = () => { cleanup(); reject(new Error("Could not load audio")); };
    a.src = url;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { cleanup(); img.src = ""; reject(new Error("Image loading timed out")); }, 30000);
    const cleanup = () => { clearTimeout(timer); img.onload = null; img.onerror = null; };
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => { cleanup(); reject(new Error("Could not load image")); };
    img.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    const timer = setTimeout(() => { cleanup(); v.removeAttribute("src"); v.load(); reject(new Error("Video loading timed out")); }, 30000);
    const cleanup = () => { clearTimeout(timer); v.onloadeddata = null; v.onerror = null; };
    v.onloadeddata = () => { cleanup(); resolve(v); };
    v.onerror = () => { cleanup(); reject(new Error("Could not load video")); };
    v.src = url;
  });
}

async function decode(ref: MediaRef, blob: Blob): Promise<LoadedMedia> {
  const url = URL.createObjectURL(blob);
  let element: LoadedMedia["element"] | undefined;
  try {
    element = ref.kind === "video" ? await loadVideo(url) : ref.kind === "audio" ? await loadAudio(url) : await loadImage(url);
    const width = ref.kind === "video" ? (element as HTMLVideoElement).videoWidth : ref.kind === "image" ? (element as HTMLImageElement).naturalWidth : 0;
    const height = ref.kind === "video" ? (element as HTMLVideoElement).videoHeight : ref.kind === "image" ? (element as HTMLImageElement).naturalHeight : 0;
    const duration = ref.kind === "image" ? undefined : (element as HTMLMediaElement).duration;
    if (ref.kind !== "image" && (!Number.isFinite(duration) || !duration || duration <= 0)) throw new Error("This media has no readable duration. Re-export it as a standard MP4, WebM or audio file.");
    if (ref.kind !== "audio" && (!width || !height)) throw new Error("This image or video has no readable dimensions");
    const actualRef = { ...ref, width, height, ...(duration ? { duration } : {}) };
    return { ref: actualRef, blob, url, element, kind: ref.kind, width, height };
  } catch (e) {
    // nothing keeps the url once the decode fails, and an unrevoked one pins the blob for the tab's life
    URL.revokeObjectURL(url);
    if (element && ref.kind !== "image") { const el = element as HTMLMediaElement; el.pause(); el.removeAttribute("src"); el.load(); }
    throw e;
  }
}

/**
 * Said wherever a GIF turns out to hold more than one frame. The screen texture is only repainted
 * per frame for videos, so an animated GIF would show up as whichever frame it happened to be
 * decoded on and nothing would say so.
 */
export const ANIMATED_GIF_MESSAGE = "Animated GIFs are not supported — export the clip as MP4 or WebM";

// The second image descriptor sits just past the first frame's pixel data, so a prefix answers the
// question for all but freakishly large single frames. Buffering a whole GIF next to the blob it
// came from doubles its footprint on every import for nothing.
const GIF_SCAN_START = 64 * 1024;
const GIF_SCAN_MAX = 4 * 1024 * 1024;

/**
 * Walk a GIF's block structure far enough to know whether it holds more than one frame. Returns null
 * when the walk ran off the end of a prefix and the rest of the file could still settle it.
 */
function scanGifFrames(b: Uint8Array, complete: boolean): boolean | null {
  if (b.length < 14 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return false;
  const tableSize = (packed: number) => (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  // header and logical screen descriptor, then the optional global colour table
  let i = 10;
  i += 3 + tableSize(b[i]);
  const skipSubBlocks = () => {
    while (i < b.length) {
      const size = b[i++];
      if (!size) return true;
      i += size;
    }
    return false;
  };
  // a truncated file is as good as a still one; a truncated prefix is simply not an answer yet
  const ranOut = () => (complete ? false : null);
  let frames = 0;
  while (frames < 2) {
    if (i >= b.length) return ranOut();
    const marker = b[i++];
    if (marker === 0x2c) {
      frames++;
      if (frames > 1) break;
      i += 8;
      if (i >= b.length) return ranOut();
      const packed = b[i++];
      i += tableSize(packed) + 1;
      if (!skipSubBlocks()) return ranOut();
    } else if (marker === 0x21) {
      i++;
      if (!skipSubBlocks()) return ranOut();
    } else break;
  }
  return frames > 1;
}

async function gifIsAnimated(file: Blob): Promise<boolean> {
  let end = Math.min(GIF_SCAN_START, file.size);
  for (;;) {
    const complete = end >= file.size;
    const verdict = scanGifFrames(new Uint8Array(await file.slice(0, end).arrayBuffer()), complete);
    if (verdict !== null) return verdict;
    if (complete || end >= GIF_SCAN_MAX) return false;
    end = Math.min(end * 8, file.size, GIF_SCAN_MAX);
  }
}

/** Import a File/Blob: decodes it, stores the blob in IndexedDB and registers it in memory. */
export async function importMedia(file: Blob & { name?: string }): Promise<MediaRef> {
  const type = mediaType(file);
  if (!type || file.size === 0) throw new Error("Choose a readable image, video or audio file");
  if (file.type !== type) file = Object.assign(new Blob([file], { type }), { name: file.name });
  const kind: MediaRef["kind"] = type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : "image";
  // a still GIF makes a fine screen, an animated one would silently lose every frame but one
  if (file.type === "image/gif" && (await gifIsAnimated(file))) throw new Error(ANIMATED_GIF_MESSAGE);
  const id = uid();
  await retainMedia([id]);
  const url = URL.createObjectURL(file);
  let width = 0, height = 0, duration: number | undefined;
  let element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
  try {
    if (kind === "video") {
      const v = await loadVideo(url);
      width = v.videoWidth; height = v.videoHeight; duration = v.duration;
      element = v;
    } else if (kind === "audio") {
      const a = await loadAudio(url);
      duration = a.duration;
      element = a;
    } else {
      const img = await loadImage(url);
      width = img.naturalWidth; height = img.naturalHeight;
      element = img;
    }
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  if ((kind !== "audio" && (!width || !height)) || (kind !== "image" && (!Number.isFinite(duration) || !duration || duration <= 0))) {
    if (kind !== "image") { const el = element as HTMLMediaElement; el.pause(); el.removeAttribute("src"); el.load(); }
    URL.revokeObjectURL(url);
    throw new Error("This media has no readable dimensions or duration. Re-export the source file and try again.");
  }
  const ref: MediaRef = { id, kind, width, height, name: file.name ?? "media", duration };
  try {
    await idbSet(`media:${id}`, { ref, blob: file, storedAt: Date.now(), retentionVersion: MEDIA_RETENTION_VERSION });
  } catch (e) {
    // the media works this session but will not survive a reload — say so rather than losing it quietly
    console.warn("media persist failed", e);
    mediaPersistFailed(ref.name, "storage");
  }
  useMediaStore.setState((s) => ({ items: { ...s.items, [id]: { ref, blob: file, url, element, kind, width, height } } }));
  return ref;
}

export function getMedia(id: string | undefined | null): LoadedMedia | null {
  if (!id) return null;
  return useMediaStore.getState().items[id] ?? null;
}

/** Ensure a media ref is loaded into memory (from IndexedDB if needed). */
export function ensureMedia(ref: MediaRef | null | undefined): Promise<LoadedMedia | null> {
  if (!ref) return Promise.resolve(null);
  const retained = retainMedia([ref.id]);
  const existing = useMediaStore.getState().items[ref.id];
  if (existing?.kind === ref.kind) return retained.then(() => existing);
  const p = pending.get(ref.id);
  if (p) return p;
  if (useMediaStore.getState().missing[ref.id]) return Promise.resolve(null);
  const version = revisions.get(ref.id) ?? 0;
  const promise = (async () => {
    useMediaStore.setState((s) => ({ loading: { ...s.loading, [ref.id]: true } }));
    try {
      await retained;
      const rec = (await idbGet(`media:${ref.id}`)) as { ref: MediaRef; blob: Blob } | undefined;
      if (!rec) return null;
      if (rec.ref?.id !== ref.id || rec.ref.kind !== ref.kind || !(rec.blob instanceof Blob)) return null;
      // storage predates the import guard, so a project saved by an older build can still be
      // holding an animated GIF; it would come back as a single frozen frame with no explanation
      if (rec.blob.type === "image/gif" && (await gifIsAnimated(rec.blob))) {
        mediaPersistFailed(rec.ref.name, "animated-gif");
        return null;
      }
      const loaded = await decode(rec.ref, rec.blob);
      if (version !== (revisions.get(ref.id) ?? 0)) { release(loaded); return getMedia(ref.id); }
      useMediaStore.setState((s) => ({ items: { ...s.items, [ref.id]: loaded } }));
      return loaded;
    } catch (e) {
      console.warn("media load failed", e);
      return null;
    } finally {
      if (version === (revisions.get(ref.id) ?? 0)) {
        pending.delete(ref.id);
        useMediaStore.setState((s) => {
          const loading = { ...s.loading };
          delete loading[ref.id];
          return { loading, missing: { ...s.missing, [ref.id]: s.items[ref.id]?.kind !== ref.kind } };
        });
      }
    }
  })();
  pending.set(ref.id, promise);
  return promise;
}

export function useMedia(ref: MediaRef | null | undefined): LoadedMedia | null {
  return useMediaResource(ref).media;
}

/** A referenced file stays loading until storage and decoding finish; failure is persistent. */
export function useMediaResource(ref: MediaRef | null | undefined): { media: LoadedMedia | null; status: MediaStatus } {
  const item = useMediaStore((s) => (ref ? s.items[ref.id] : undefined));
  const status = useMediaStore((s) => statusOf(ref, s));
  useEffect(() => {
    if (ref && status === "loading") void ensureMedia(ref);
  }, [ref, item, status]);
  return { media: status === "ready" ? item ?? null : null, status };
}

/** Explicit retry avoids polling storage on every render for an unavailable file. */
export function retryMedia(ref: MediaRef): Promise<LoadedMedia | null> {
  useMediaStore.setState((s) => { const missing = { ...s.missing }; delete missing[ref.id]; return { missing }; });
  return ensureMedia(ref);
}

export async function deleteMedia(id: string) {
  revision(id);
  pending.delete(id);
  const item = useMediaStore.getState().items[id];
  if (item) release(item);
  useMediaStore.setState((s) => {
    const items = { ...s.items };
    delete items[id];
    const loading = { ...s.loading }; delete loading[id];
    return { items, loading, missing: { ...s.missing, [id]: true } };
  });
  try { await idbDel(`media:${id}`); } catch {}
}

export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(dataUrl: string): Promise<Blob> {
  if (!/^data:(?:image|video|audio)\/[^;,]+;base64,[a-z0-9+/=\s]*$/i.test(dataUrl)) throw new Error("Embedded media must be a local image, video or audio data URL");
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error("The embedded media could not be read");
  return res.blob();
}

/** Register a media blob under a given id (used when importing a .mok file). */
export async function registerMedia(ref: MediaRef, blob: Blob): Promise<LoadedMedia> {
  await retainMedia([ref.id]);
  // a file written before the import guard existed can still carry one, and it would restore frozen
  if (blob.type === "image/gif" && (await gifIsAnimated(blob))) throw new Error(ANIMATED_GIF_MESSAGE);
  const version = revision(ref.id);
  pending.delete(ref.id);
  useMediaStore.setState((s) => {
    const loading = { ...s.loading }; delete loading[ref.id];
    const missing = { ...s.missing }; delete missing[ref.id];
    return { loading, missing };
  });
  let loaded: LoadedMedia;
  try { loaded = await decode(ref, blob); }
  catch (error) {
    if (version === revisions.get(ref.id)) useMediaStore.setState((s) => ({ missing: { ...s.missing, [ref.id]: true } }));
    throw error;
  }
  if (version !== revisions.get(ref.id)) { release(loaded); throw new Error("This media was replaced while it was loading"); }
  try { await idbSet(`media:${ref.id}`, { ref: loaded.ref, blob, storedAt: Date.now(), retentionVersion: MEDIA_RETENTION_VERSION }); } catch { mediaPersistFailed(ref.name, "storage"); }
  if (version !== revisions.get(ref.id)) { release(loaded); throw new Error("This media was replaced while it was saving"); }
  // media ids survive an export, so re-importing the same file replaces an entry that owns a url
  const previous = useMediaStore.getState().items[ref.id];
  if (previous) release(previous);
  useMediaStore.setState((s) => ({ items: { ...s.items, [ref.id]: loaded } }));
  return loaded;
}

export function extractFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && isMediaFile(f)) files.push(f);
      }
    }
  } else {
    for (const f of Array.from(dt.files)) if (isMediaFile(f)) files.push(f);
  }
  return files;
}
