import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/** Decode the shipped model geometry in Node without image decoders or a GPU. */
export async function loadModelGeometry(path) {
  const source = readFileSync(path), jsonLength = source.readUInt32LE(12);
  const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
  json.materials = json.materials.map(({ name }) => ({ name }));
  delete json.textures; delete json.images; delete json.samplers;
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(padded);
  const binOffset = 20 + jsonLength, bin = source.subarray(binOffset);
  const glb = Buffer.alloc(20 + padded.length + bin.length);
  source.copy(glb, 0, 0, 12); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20); bin.copy(glb, 20 + padded.length);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return (await loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "")).scene;
}
