import type { WebGLRenderer } from "three";

const limits = new WeakMap<WebGLRenderer, number[]>();
/** The global MAX_SAMPLES is insufficient: half-float color and depth must support the same count. */
export function reflectionSamples(gl: WebGLRenderer, requested: number): number {
  if (requested < 2) return 0;
  let supported = limits.get(gl);
  if (supported === undefined) {
    supported = [];
    try {
      const context = gl.getContext() as WebGL2RenderingContext;
      const color = Array.from(context.getInternalformatParameter(context.RENDERBUFFER, context.RGBA16F, context.SAMPLES) as Int32Array);
      const depth = Array.from(context.getInternalformatParameter(context.RENDERBUFFER, context.DEPTH_COMPONENT24, context.SAMPLES) as Int32Array);
      // A request for 2 may round up to 4 on some GPUs. Avoid silently doubling the planned budget.
      supported = color.filter((n) => (n === 2 || n === 4) && depth.includes(n));
    } catch { /* Some software WebGL implementations cannot multisample RGBA16F. */ }
    limits.set(gl, supported);
  }
  return supported.includes(requested) ? requested : 0;
}
