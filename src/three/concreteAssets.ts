import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { AssetCache } from "./assetCache";
import { trackGpuPreparation } from "./gpuPreparation";
import { rendererKtxLoader } from "./ktxLoader";

export type ConcreteTier = "1k" | "2k";
export interface ConcreteMaps { diff: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture; ao: THREE.Texture; tier: ConcreteTier | "legacy" }
const owners = new WeakMap<THREE.WebGLRenderer, { cache: AssetCache<Promise<ConcreteMaps>>; loader: KTX2Loader }>();
export function concretePaths(tier: ConcreteTier): string[] { return ["diff", "nor_gl", "arm"].map((name) => `/textures/concrete/${tier}/${name}.ktx2`); }
export const CONCRETE_TILE_WORLD = 20; // Poly Haven's original tile spans 2 metres; one world unit is 10 cm.

export function configureConcreteMaps(maps: ConcreteMaps, size: number, maxAnisotropy: number): void {
  maps.diff.colorSpace = THREE.SRGBColorSpace;
  for (const map of new Set([maps.diff, maps.normal, maps.rough, maps.ao])) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(size / CONCRETE_TILE_WORLD, size / CONCRETE_TILE_WORLD);
    map.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  }
}

async function completeSet(loader: THREE.Loader, paths: string[]): Promise<THREE.Texture[]> {
  const results = await Promise.allSettled(paths.map((path) => (loader as THREE.TextureLoader).loadAsync(path)));
  if (results.some((r) => r.status === "rejected")) {
    for (const r of results) if (r.status === "fulfilled") r.value.dispose();
    throw (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
  }
  return results.map((r) => (r as PromiseFulfilledResult<THREE.Texture>).value);
}

/** Renderer-local texture ownership. On failure, try the complete 1K set before legacy JPEGs. */
export function acquireConcrete(gl: THREE.WebGLRenderer, tier: ConcreteTier) {
  let owner = owners.get(gl);
  if (!owner) {
    const loader = rendererKtxLoader(gl);
    const cache = new AssetCache<Promise<ConcreteMaps>>(2, (task) => { void task.then((maps) => { for (const map of new Set([maps.diff, maps.normal, maps.rough, maps.ao])) map.dispose(); }, () => {}); });
    owner = { cache, loader }; owners.set(gl, owner);
    const release = () => { owners.delete(gl); gl.domElement.removeEventListener("webglcontextlost", release); };
    gl.domElement.addEventListener("webglcontextlost", release, { once: true });
  }
  const { cache, loader } = owner;
  let promise = cache.get(tier);
  if (!promise) {
    promise = trackGpuPreparation(async () => {
      for (const candidate of tier === "2k" ? ["2k", "1k"] as const : ["1k"] as const) {
        try { const [diff, normal, arm] = await completeSet(loader, concretePaths(candidate)); return { diff, normal, rough: arm, ao: arm, tier: candidate }; }
        catch { /* The complete lower tier prevents mixed dimensions or partial-map leaks. */ }
      }
      const [diff, normal, rough, ao] = await completeSet(new THREE.TextureLoader(), ["diff", "nor_gl", "rough", "ao"].map((name) => `/textures/concrete/${name}.jpg`));
      return { diff, normal, rough, ao, tier: "legacy" };
    });
    cache.put(tier, promise);
  }
  const release = cache.retain(tier);
  void promise.catch(() => { cache.forget(tier); });
  return { promise, release: () => { release(); void promise!.catch(() => { cache.forget(tier); }); } };
}
