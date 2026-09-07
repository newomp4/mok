interface Box { type: string; start: number; end: number }
function boxes(data: Uint8Array, start = 0, end = data.length): Box[] {
  const result: Box[] = [], view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = start; at < end;) {
    if (at + 8 > end) throw new Error("Invalid MP4 metadata");
    const size = view.getUint32(at), type = String.fromCharCode(...data.subarray(at + 4, at + 8));
    if (size < 8 || at + size > end) throw new Error("Invalid MP4 metadata box");
    result.push({ type, start: at, end: at + size }); at += size;
  }
  return result;
}
function box(type: string, children: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(8 + children.reduce((n, child) => n + child.length, 0));
  new DataView(result.buffer).setUint32(0, result.length);
  [...type].forEach((letter, i) => result[4 + i] = letter.charCodeAt(0));
  let at = 8; for (const child of children) { result.set(child, at); at += child.length; }
  return result;
}
function duration(data: Uint8Array, type: 'mvhd' | 'tkhd', seconds: number, scale: number) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), version = data[8];
  const offset = (type === 'tkhd' ? 28 : 24) + (version === 1 ? 8 : 0), value = Math.round(seconds * scale);
  if (version === 1) view.setBigUint64(offset, BigInt(value)); else view.setUint32(offset, value);
}
function editList(seconds: number, delay: number, movieScale: number, audioScale: number) {
  const entry = new Uint8Array(20), view = new DataView(entry.buffer);
  view.setUint32(4, 1); view.setUint32(8, Math.round(seconds * movieScale)); view.setInt32(12, Math.round(delay * audioScale)); view.setInt16(16, 1);
  return box('edts', [box('elst', [entry])]);
}

/** Add the standard AAC priming edit, retaining decoder preroll instead of deleting compressed
 * packets. Only moov metadata is copied; the large disk-backed mdat stays a borrowed Blob slice. */
export function correctMp4AudioTiming(blob: Blob, metadata: { data: Uint8Array; position: number }, delay: number, seconds: number): Blob {
  const data = metadata.data;
  if (data.length > 8 * 1024 * 1024 || metadata.position < 0 || metadata.position + data.length > blob.size) throw new Error("MP4 timing metadata exceeds its bounded range");
  const top = boxes(data)[0]; if (!top || top.type !== 'moov' || top.end !== data.length) throw new Error("Missing MP4 movie metadata");
  const children = boxes(data, 8), header = children.find((entry) => entry.type === 'mvhd');
  if (!header) throw new Error("Missing MP4 timing header");
  const movie = data.slice(header.start, header.end), mv = new DataView(movie.buffer), movieScale = mv.getUint32(movie[8] === 1 ? 28 : 20);
  duration(movie, 'mvhd', seconds, movieScale);
  let edited = false;
  const updated = children.map((entry) => {
    if (entry.type === 'mvhd') return movie;
    if (entry.type !== 'trak') return data.slice(entry.start, entry.end);
    const contents = boxes(data, entry.start + 8, entry.end), media = contents.find((item) => item.type === 'mdia');
    if (!media) return data.slice(entry.start, entry.end);
    const details = boxes(data, media.start + 8, media.end), handler = details.find((item) => item.type === 'hdlr'), timing = details.find((item) => item.type === 'mdhd');
    if (!handler || !timing || String.fromCharCode(...data.subarray(handler.start + 16, handler.start + 20)) !== 'soun') return data.slice(entry.start, entry.end);
    const timingData = data.subarray(timing.start, timing.end), tv = new DataView(timingData.buffer, timingData.byteOffset, timingData.byteLength), audioScale = tv.getUint32(timingData[8] === 1 ? 28 : 20);
    const track = contents.filter((item) => item.type !== 'edts').map((item) => { const copy = data.slice(item.start, item.end); if (item.type === 'tkhd') duration(copy, 'tkhd', seconds, movieScale); return copy; });
    track.push(editList(seconds, Math.max(0, delay), movieScale, audioScale)); edited = true; return box('trak', track);
  });
  if (!edited) throw new Error("MP4 audio timing track is missing");
  const corrected = box('moov', updated);
  return new Blob([blob.slice(0, metadata.position), corrected, blob.slice(metadata.position + data.length)], { type: blob.type });
}
