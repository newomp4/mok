import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { AssetCache } from "@/three/assetCache";

interface ModelAsset { promise: Promise<void>; gltf?: GLTF; error?: unknown }
const owners = new WeakMap<THREE.WebGLRenderer, { cache: AssetCache<ModelAsset>; loader: GLTFLoader }>();

function disposeSource(asset: ModelAsset): void {
  const resources = new Set<THREE.Material | THREE.BufferGeometry | THREE.Texture>();
  asset.gltf?.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      resources.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) resources.add(value as THREE.Texture);
    }
  });
  // Do not close ImageBitmaps: a concurrent, not-yet-committed React clone may still borrow the CPU
  // source. GPU resources can be recreated by Three from that data; mounted instances are leased.
  resources.forEach((resource) => resource.dispose());
}

function owner(gl: THREE.WebGLRenderer) {
  let entry = owners.get(gl);
  if (!entry) {
    const ktx = new KTX2Loader().setTranscoderPath("/basis/").setWorkerLimit(2).detectSupport(gl);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
    entry = { loader, cache: new AssetCache<ModelAsset>(3, (asset) => { void asset.promise.then(() => disposeSource(asset), () => {}); }) };
    owners.set(gl, entry);
    const release = () => { ktx.dispose(); gl.domElement.removeEventListener("webglcontextlost", release); owners.delete(gl); };
    gl.domElement.addEventListener("webglcontextlost", release, { once: true });
  }
  return entry;
}

/** Starts a cancellable ownership lease before React begins a possibly suspended device swap. */
export function acquireModel(gl: THREE.WebGLRenderer, url: string) {
  const { cache, loader } = owner(gl);
  let asset = cache.get(url);
  if (!asset) {
    asset = { promise: Promise.resolve() };
    const current = asset;
    asset.promise = loader.loadAsync(url).then((gltf) => { current.gltf = gltf; }, (error: unknown) => { current.error = error; });
    cache.put(url, asset);
    // Give Suspense's initial commit a chance to retain the asset. Abandoned loads are still bounded.
    void asset.promise.then(() => { setTimeout(() => cache.trim(), 1000); });
  }
  const retained = cache.retain(url), current = asset;
  return { asset, release: () => { retained(); if (current.error) cache.forget(url); } };
}

export function readModel(gl: THREE.WebGLRenderer, url: string): ModelAsset & { gltf: GLTF } {
  const lease = acquireModel(gl, url);
  // Render-time reads are not persistent ownership; committed mounts and explicit staging are.
  setTimeout(lease.release, 1000);
  if (lease.asset.error) throw lease.asset.error;
  if (!lease.asset.gltf) throw lease.asset.promise;
  return lease.asset as ModelAsset & { gltf: GLTF };
}

export function retainModel(gl: THREE.WebGLRenderer, url: string, asset: ModelAsset): () => void {
  const { cache } = owner(gl);
  // A concurrent render may finish after an unpinned entry was evicted. Its borrowed CPU data is
  // still intact; restore ownership without replacing a newer independently loaded entry.
  if (!cache.get(url)) cache.put(url, asset);
  const key = cache.get(url) === asset ? url : `${url}#${asset.gltf?.scene.uuid}`;
  if (key !== url && !cache.get(key)) cache.put(key, asset);
  return cache.retain(key);
}
