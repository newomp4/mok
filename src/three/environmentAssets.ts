import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { AssetCache } from "@/three/assetCache";
import { setEnvironmentPreparation, trackGpuPreparation } from "@/three/gpuPreparation";

type Environment = Promise<THREE.WebGLRenderTarget>;
const caches = new WeakMap<THREE.WebGLRenderer, AssetCache<Environment>>();

export function environmentPath(file: string, tier: "1k" | "2k"): string {
  return tier === "2k" ? file.replace("/hdri/", "/hdri/2k/") : file;
}

/** At most two unpinned environments; a displayed map stays owned until its replacement is ready. */
export function acquireEnvironment(gl: THREE.WebGLRenderer, file: string, tier: "1k" | "2k") {
  let cache = caches.get(gl);
  if (!cache) {
    cache = new AssetCache<Environment>(2, (promise) => { void promise.then((rt) => rt.dispose(), () => {}); });
    caches.set(gl, cache);
  }
  const key = environmentPath(file, tier);
  let promise = cache.get(key);
  if (!promise) {
    promise = trackGpuPreparation(async () => {
      const loader = new HDRLoader();
      let hdr: THREE.DataTexture;
      try { hdr = await loader.loadAsync(key); }
      catch (error) { if (tier === "1k") throw error; hdr = await loader.loadAsync(file); }
      const pmrem = new THREE.PMREMGenerator(gl);
      try { pmrem.compileEquirectangularShader(); return pmrem.fromEquirectangular(hdr); }
      finally { hdr.dispose(); pmrem.dispose(); }
    });
    cache.put(key, promise);
  }
  const retained = cache.retain(key), currentCache = cache;
  let failed = false;
  void promise.catch(() => { failed = true; currentCache.forget(key); });
  const release = () => { retained(); if (failed) currentCache.forget(key); };
  setEnvironmentPreparation(gl, promise);
  cache.trim();
  return { promise, release };
}
