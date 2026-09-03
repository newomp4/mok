"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { uid } from "./ids";
import type { MediaRef } from "./types";

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
}

export const useMediaStore = create<MediaState>()(() => ({ items: {}, loading: {} }));

const pending = new Map<string, Promise<LoadedMedia | null>>();

/** Set by the app so a storage failure can surface as a toast instead of vanishing. */
export let mediaPersistFailed: (name: string, reason: "storage" | "animated-gif") => void = () => {};
export function onMediaPersistFailed(fn: (name: string, reason: "storage" | "animated-gif") => void) { mediaPersistFailed = fn; }

export const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime";
export const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";
export const ACCEPTED_AUDIO = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,audio/flac";

export function isMediaFile(f: File): boolean {
  return f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/");
}

function loadAudio(url: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "auto";
    a.crossOrigin = "anonymous";
    a.onloadedmetadata = () => resolve(a);
    a.onerror = () => reject(new Error("Could not load audio"));
    a.src = url;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
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
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Could not load video"));
    v.src = url;
  });
}

async function decode(ref: MediaRef, blob: Blob): Promise<LoadedMedia> {
  const url = URL.createObjectURL(blob);
  try {
    const element = ref.kind === "video" ? await loadVideo(url) : ref.kind === "audio" ? await loadAudio(url) : await loadImage(url);
    return { ref, blob, url, element, kind: ref.kind, width: ref.width, height: ref.height };
  } catch (e) {
    // nothing keeps the url once the decode fails, and an unrevoked one pins the blob for the tab's life
    URL.revokeObjectURL(url);
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
  const kind: MediaRef["kind"] = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
  // a still GIF makes a fine screen, an animated one would silently lose every frame but one
  if (file.type === "image/gif" && (await gifIsAnimated(file))) throw new Error(ANIMATED_GIF_MESSAGE);
  const id = uid();
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
  const ref: MediaRef = { id, kind, width, height, name: file.name ?? "media", duration };
  try {
    await idbSet(`media:${id}`, { ref, blob: file });
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
  const existing = useMediaStore.getState().items[ref.id];
  if (existing) return Promise.resolve(existing);
  const p = pending.get(ref.id);
  if (p) return p;
  const promise = (async () => {
    useMediaStore.setState((s) => ({ loading: { ...s.loading, [ref.id]: true } }));
    try {
      const rec = (await idbGet(`media:${ref.id}`)) as { ref: MediaRef; blob: Blob } | undefined;
      if (!rec) return null;
      // storage predates the import guard, so a project saved by an older build can still be
      // holding an animated GIF; it would come back as a single frozen frame with no explanation
      if (rec.blob.type === "image/gif" && (await gifIsAnimated(rec.blob))) {
        mediaPersistFailed(rec.ref.name, "animated-gif");
        return null;
      }
      const loaded = await decode(rec.ref, rec.blob);
      useMediaStore.setState((s) => ({ items: { ...s.items, [ref.id]: loaded } }));
      return loaded;
    } catch (e) {
      console.warn("media load failed", e);
      return null;
    } finally {
      pending.delete(ref.id);
      useMediaStore.setState((s) => {
        const loading = { ...s.loading };
        delete loading[ref.id];
        return { loading };
      });
    }
  })();
  pending.set(ref.id, promise);
  return promise;
}

export function useMedia(ref: MediaRef | null | undefined): LoadedMedia | null {
  const item = useMediaStore((s) => (ref ? s.items[ref.id] : undefined));
  useEffect(() => {
    if (ref && !item) void ensureMedia(ref);
  }, [ref, item]);
  return item ?? null;
}

export async function deleteMedia(id: string) {
  const item = useMediaStore.getState().items[id];
  if (item) URL.revokeObjectURL(item.url);
  useMediaStore.setState((s) => {
    const items = { ...s.items };
    delete items[id];
    return { items };
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
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Register a media blob under a given id (used when importing a .mok file). */
export async function registerMedia(ref: MediaRef, blob: Blob): Promise<LoadedMedia> {
  // a file written before the import guard existed can still carry one, and it would restore frozen
  if (blob.type === "image/gif" && (await gifIsAnimated(blob))) throw new Error(ANIMATED_GIF_MESSAGE);
  const loaded = await decode(ref, blob);
  try { await idbSet(`media:${ref.id}`, { ref, blob }); } catch {}
  // media ids survive an export, so re-importing the same file replaces an entry that owns a url
  const previous = useMediaStore.getState().items[ref.id];
  if (previous) URL.revokeObjectURL(previous.url);
  useMediaStore.setState((s) => ({ items: { ...s.items, [ref.id]: loaded } }));
  return loaded;
}

export function extractFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.items) {
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
