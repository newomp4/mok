import * as THREE from "three";

const pending = new Set<Promise<unknown>>();
const environments = new WeakMap<THREE.WebGLRenderer, Promise<unknown>>();
let sequence = 0;

export function setEnvironmentPreparation(gl: THREE.WebGLRenderer, task: Promise<unknown>): void { environments.set(gl, task); }

/** Extends the normal loading indicator through CPU-to-GPU upload and shader preparation. */
export function trackGpuPreparation<T>(work: () => Promise<T>): Promise<T> {
  const id = `mok:gpu-preparation:${++sequence}`;
  THREE.DefaultLoadingManager.itemStart(id);
  const task = Promise.resolve().then(work);
  pending.add(task);
  void task.finally(() => { pending.delete(task); THREE.DefaultLoadingManager.itemEnd(id); }).catch(() => {});
  return task;
}

export async function waitForGpuPreparation(signal?: AbortSignal): Promise<void> {
  while (pending.size) {
    signal?.throwIfAborted();
    const task = Promise.all([...pending]);
    if (!signal) await task;
    else await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      void task.then(() => resolve(), reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  signal?.throwIfAborted();
}

/** Upload source textures and compile the actual customized materials against the live light rig.
 * Three cannot abort an in-flight compile. Callers must retain resources until this settles and
 * check their signal before promoting a model. Offscreen effect buffers remain a separate warmup.
 */
export function prepareModelGpu(gl: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, signal: AbortSignal): Promise<void> {
  return trackGpuPreparation(async () => {
    await environments.get(gl);
    signal.throwIfAborted();
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
      }
    });
    for (const texture of textures) { signal.throwIfAborted(); gl.initTexture(texture); }
    await gl.compileAsync(root, camera, scene);
    signal.throwIfAborted();
  });
}
