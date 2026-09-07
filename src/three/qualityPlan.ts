/** Conservative allocation planning, not a measurement of free GPU memory. */
export interface RenderQualityPlan {
  supported: boolean;
  reason?: string;
  samples: number;
  reflectionSamples: 0 | 2 | 4;
  hdrTier: "1k" | "2k";
  auxiliaryScale: number;
  screenMaxEdge: number;
  screenMaxPixels: number;
  estimatedBytes: number;
  budgetBytes: number;
  note: string | null;
}

export interface QualityPlanOptions {
  width: number;
  height: number;
  maxTextureSize: number;
  maxSamples?: number;
  supportedSamples?: number[];
  deviceMemoryGB?: number;
  motionSamples?: number;
  effectCount?: number;
  depth?: boolean;
  detailShadows?: boolean;
  /** Asset textures already retained by the scene. Defaults to a conservative reserve. */
  assetBytes?: number;
  budgetBytes?: number;
}

const MiB = 1024 * 1024;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(n) ? n : low));

export function deviceMemoryGB(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return Number.isFinite(memory) && memory! > 0 ? memory : undefined;
}

/** Do not interpret navigator.deviceMemory as available VRAM. Reserve most RAM for the browser. */
export function renderMemoryBudget(memory?: number): number {
  if (!memory || !Number.isFinite(memory)) return 768 * MiB;
  return (memory <= 2 ? 384 : memory <= 4 ? 768 : 1536) * MiB;
}

/** Drivers may round 2 up to 4; budget only sample counts advertised for both attachments. */
export function availableSampleCounts(gl: WebGL2RenderingContext): number[] {
  try {
    const color = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array);
    const depth = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) as Int32Array);
    // The composer attaches float depth when any pass samples it; mirrors use depth24.
    const depthFloat = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, gl.SAMPLES) as Int32Array);
    return [0, ...color.filter((n) => n > 0 && n <= 4 && depth.includes(n) && depthFloat.includes(n))];
  } catch { return [0]; }
}

export function planRenderQuality(options: QualityPlanOptions): RenderQualityPlan {
  const { width, height } = options;
  const budgetBytes = Math.max(128 * MiB, Number.isFinite(options.budgetBytes) ? options.budgetBytes! : renderMemoryBudget(options.deviceMemoryGB));
  const limit = Math.max(1, Math.floor(options.maxTextureSize || 1));
  const maxSamples = Math.floor(clamp(options.maxSamples ?? 4, 0, 4));
  const sampleCounts = (options.supportedSamples ?? [0, 2, 4]).filter((n) => n <= maxSamples);
  const pixels = width * height;
  const effects = clamp(options.effectCount ?? 0, 0, 16);
  const motion = (options.motionSamples ?? 1) > 1;
  const assets = clamp(options.assetBytes ?? 160 * MiB, 32 * MiB, 2048 * MiB);
  const valid = [width, height].every((n) => Number.isInteger(n) && n > 0 && n <= Math.min(limit, 8192));
  let last: RenderQualityPlan | null = null;
  // Reduce AA and auxiliary targets before refusing an output; dimensions never change.
  for (const [requestedSamples, auxiliaryScale] of [[4, 1], [2, 1], [0, 1], [0, 0.5], [0, 0.25]]) {
    const samples = options.depth ? 0 : Math.max(0, ...sampleCounts.filter((n) => n <= requestedSamples));
    const hdrTier = auxiliaryScale < 1 || budgetBytes <= 384 * MiB ? "1k" : "2k";
    const mirrorSamples = sampleCounts.includes(2) ? 2 : sampleCounts.includes(4) ? 4 : 0;
    const reflectionSamples = (auxiliaryScale === 1 && pixels <= 9_000_000 ? mirrorSamples : 0) as 0 | 2 | 4;
    const screenMaxEdge = Math.min(limit, auxiliaryScale < 1 ? 4096 : Math.max(width, height) > 4096 ? 8192 : 4096);
    const screenMaxPixels = auxiliaryScale < 1 ? 8_000_000 : Math.max(width, height) > 4096 ? 24_000_000 : 12_000_000;
    // Two resolved RGBA16F targets, depth, optional MSAA color/depth. Effects reuse the pair,
    // with a reserve for blur pyramids, lens CoC and full-resolution silhouette intermediates.
    const composer = pixels * 2 * 12 * (1 + samples);
    const effectTargets = pixels * 8 * ((effects > 0 ? 0.5 + Math.min(effects, 12) / 8 : 0) + (options.depth ? 2 : 0));
    const detail = options.detailShadows ? pixels * 8 + 1024 * 1024 * 8 : 0;
    const accumulation = motion ? pixels * 8 : 0;
    const screen = Math.min(screenMaxPixels, screenMaxEdge ** 2, Math.max(pixels, 2_000_000)) * 4 * 4 / 3;
    const auxiliary = 112 * MiB * auxiliaryScale ** 2 + Math.min(pixels * 0.85 ** 2, 4_000_000) * 8 * reflectionSamples * auxiliaryScale ** 2;
    const environment = (hdrTier === "2k" ? 64 : 16) * MiB; // includes generation scratch
    const estimatedBytes = Math.ceil(composer + effectTargets + detail + accumulation + screen + auxiliary + environment + assets);
    const supported = valid && estimatedBytes <= budgetBytes;
    const reduced = samples < Math.min(maxSamples, options.depth ? 0 : 4) || auxiliaryScale < 1;
    last = {
      supported, samples, reflectionSamples, hdrTier, auxiliaryScale, screenMaxEdge, screenMaxPixels,
      estimatedBytes, budgetBytes,
      note: reduced ? `Uses lighter antialiasing${auxiliaryScale < 1 ? " and reflection buffers" : ""} to fit this device. Output dimensions stay unchanged.` : null,
      ...(!valid ? { reason: `Choose whole-pixel dimensions up to ${Math.min(limit, 8192)} per side.` }
        : !supported ? { reason: "This size and effect combination exceeds the estimated memory budget. Reduce the size or simplify the effects." } : {}),
    };
    if (supported || !valid) return last;
  }
  return last!;
}
