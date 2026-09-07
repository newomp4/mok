import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { chooseModelEncoding, modelTransportManifest } from "./modelTransport";

/** Only generated allowlisted files are streamed. No compression or full-buffer cache per request. */
export async function modelTransportResponse(request: Request, name: string, directory = process.cwd()): Promise<Response> {
  const entry = Object.prototype.hasOwnProperty.call(modelTransportManifest, name) ? modelTransportManifest[name] : null;
  if (!entry) return new Response("Unknown model", { status: 404 });
  const version = new URL(request.url).searchParams.get("v");
  if (version && version !== entry.hash) return new Response("Unknown model version", { status: 404 });
  const encoding = chooseModelEncoding(request.headers.get("accept-encoding"));
  if (!encoding) return new Response("No supported content encoding", { status: 406, headers: { Vary: "Accept-Encoding" } });
  const variant = encoding === "identity" ? { file: name, bytes: entry.bytes } : entry[encoding];
  const path = join(directory, "public", encoding === "identity" ? "models" : "model-transport", variant.file);
  const etag = `"${entry.hash}-${encoding}"`;
  const headers = new Headers({ "Content-Type": "model/gltf-binary", "Content-Length": String(variant.bytes), Vary: "Accept-Encoding", ETag: etag, "Cache-Control": version ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff" });
  if (encoding !== "identity") headers.set("Content-Encoding", encoding);
  if (request.headers.get("if-none-match")?.split(",").some((v) => v.trim() === "*" || v.trim().replace(/^W\//, "") === etag)) {
    headers.delete("Content-Length"); return new Response(null, { status: 304, headers });
  }
  try { await access(path); }
  catch { return new Response(null, { status: 307, headers: { Location: `/models/${encodeURIComponent(name)}`, "Cache-Control": "no-store" } }); }
  if (request.method === "HEAD") return new Response(null, { headers });
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, { headers });
}
