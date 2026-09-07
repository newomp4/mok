import type { WebGLRenderer } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

const loaders = new WeakMap<WebGLRenderer, KTX2Loader>();

/** Models and room textures share one bounded worker pool and one Basis WASM instance. */
export function rendererKtxLoader(gl: WebGLRenderer): KTX2Loader {
  let loader = loaders.get(gl);
  if (!loader) {
    loader = new KTX2Loader().setTranscoderPath("/basis/").setWorkerLimit(2).detectSupport(gl);
    loaders.set(gl, loader);
    const current = loader;
    const release = () => { current.dispose(); loaders.delete(gl); gl.domElement.removeEventListener("webglcontextlost", release); };
    gl.domElement.addEventListener("webglcontextlost", release, { once: true });
  }
  return loader;
}
