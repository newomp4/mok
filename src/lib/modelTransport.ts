import generated from "./modelTransportManifest.json" with { type: "json" };
export interface ModelTransportEntry { hash: string; bytes: number; br: { file: string; bytes: number }; gzip: { file: string; bytes: number } }
export const modelTransportManifest = generated as Record<string, ModelTransportEntry>;
export type ModelEncoding = "br" | "gzip" | "identity";

/** Honor explicit q=0 exclusions; never send compressed bytes to an unsupported client. */
export function chooseModelEncoding(header: string | null): ModelEncoding | null {
  if (!header?.trim()) return "identity";
  const values = new Map<string, number>();
  for (const entry of header.split(",")) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(";");
    const q = parameters.find((p) => p.trim().startsWith("q="));
    const value = q ? Number(q.trim().slice(2)) : 1;
    values.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  const quality = (name: ModelEncoding) => values.get(name) ?? (name === "identity" ? (values.get("*") === 0 ? 0 : 1) : values.get("*") ?? 0);
  const compressed = (["br", "gzip"] as const).filter((name) => quality(name) > 0).sort((a, b) => quality(b) - quality(a));
  // Identity is implicit unless excluded; prefer a supported compression at equal/default priority.
  if (compressed.length && (!values.has("identity") || quality(compressed[0]) >= quality("identity"))) return compressed[0];
  return quality("identity") > 0 ? "identity" : compressed[0] ?? null;
}

export function modelTransportURL(url: string): string {
  const match = /^\/models\/([^/]+\.glb)$/.exec(url);
  const entry = match ? modelTransportManifest[match[1]] : null;
  return entry ? `/api/models/${encodeURIComponent(match![1])}?v=${entry.hash}` : url;
}
