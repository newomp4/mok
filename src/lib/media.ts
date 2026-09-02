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
  const element = ref.kind === "video" ? await loadVideo(url) : ref.kind === "audio" ? await loadAudio(url) : await loadImage(url);
  return { ref, blob, url, element, kind: ref.kind, width: ref.width, height: ref.height };
}

/** Import a File/Blob: decodes it, stores the blob in IndexedDB and registers it in memory. */
export async function importMedia(file: Blob & { name?: string }): Promise<MediaRef> {
  const kind: MediaRef["kind"] = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
  const id = uid();
  const url = URL.createObjectURL(file);
  let width = 0, height = 0, duration: number | undefined;
  let element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
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
  const ref: MediaRef = { id, kind, width, height, name: file.name ?? "media", duration };
  try {
    await idbSet(`media:${id}`, { ref, blob: file });
  } catch (e) {
    console.warn("media persist failed", e);
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
  const loaded = await decode(ref, blob);
  try { await idbSet(`media:${ref.id}`, { ref, blob }); } catch {}
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
