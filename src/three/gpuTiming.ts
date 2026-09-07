interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface TimingState { pending: WebGLQuery[]; gpuMs: number | null }

/** Process in submission order so the final published duration is the newest completed sample. */
export function pollGpuQueries(gl: WebGL2RenderingContext, extension: TimerExtension, state: TimingState): void {
  const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
  if (disjoint) state.gpuMs = null;
  for (let i = 0; i < state.pending.length;) {
    const query = state.pending[i];
    if (disjoint || gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!disjoint) state.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query); state.pending.splice(i, 1);
    } else i++;
  }
}
