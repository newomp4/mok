import * as THREE from "three";

export interface DeckHeightField {
  texture: THREE.DataTexture;
  bounds: THREE.Vector4;
  height: THREE.Vector2;
  bias: number;
  triangles: number;
}

/** A top-down geometric height field: fixed deck/keys/hinge only, never the articulated lid.
 * Geometry stays untouched. The one-byte field is below 64 KiB and shared by every receiver.
 */
export function buildDeckHeightField(meshes: Iterable<THREE.Mesh>, frame: THREE.Object3D, minY: number, maxY: number, maxEdge = 256): DeckHeightField | null {
  frame.updateWorldMatrix(true, false);
  const inverse = frame.matrixWorld.clone().invert(), transform = new THREE.Matrix4(), instance = new THREE.Matrix4();
  const triangles: number[][] = [], bounds = new THREE.Box3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cross = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry, position = geometry.getAttribute("position"), index = geometry.index;
    if (!position) continue;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const count = index?.count ?? position.count, instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    for (let k = 0; k < instances; k++) {
      transform.multiplyMatrices(inverse, mesh.matrixWorld);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) { (mesh as THREE.InstancedMesh).getMatrixAt(k, instance); transform.multiply(instance); }
      const mirrored = transform.determinant() < 0;
      for (let i = 0; i + 2 < count; i += 3) {
        // Several source models carry fully transparent helper planes over the keyboard.
        // They are not physical blockers. Alpha-cutout textures remain an approximation here.
        const group = Array.isArray(mesh.material) ? geometry.groups.find((g) => i >= g.start && i < g.start + g.count) : null;
        const material = materials[group?.materialIndex ?? 0];
        if (!material || !material.visible || (material.transparent && material.opacity <= 0) || (material.alphaTest > 0 && material.opacity < material.alphaTest)) continue;
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(transform);
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(transform);
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(transform);
        if (Math.min(a.y, b.y, c.y) > maxY || Math.max(a.y, b.y, c.y) < minY) continue;
        cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        if (mirrored) cross.negate();
        // The field represents upper surfaces, not the underside of the enclosure.
        if (cross.y <= Math.max(1e-12, cross.length() * 0.05)) continue;
        triangles.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]);
        bounds.expandByPoint(a); bounds.expandByPoint(b); bounds.expandByPoint(c);
      }
    }
  }
  if (!triangles.length) return null;
  const span = bounds.getSize(new THREE.Vector3());
  if (span.x < 1e-6 || span.z < 1e-6) return null;
  const edge = Math.max(16, Math.min(256, Math.floor(maxEdge)));
  const width = Math.max(8, Math.round(edge * span.x / Math.max(span.x, span.z)));
  const height = Math.max(8, Math.round(edge * span.z / Math.max(span.x, span.z)));
  const values = new Float32Array(width * height).fill(minY), data = new Uint8Array(width * height);
  const yRange = Math.max(1e-5, maxY - minY);
  for (const t of triangles) {
    const ax = (t[0] - bounds.min.x) / span.x * width - 0.5, az = (t[2] - bounds.min.z) / span.z * height - 0.5;
    const bx = (t[3] - bounds.min.x) / span.x * width - 0.5, bz = (t[5] - bounds.min.z) / span.z * height - 0.5;
    const cx = (t[6] - bounds.min.x) / span.x * width - 0.5, cz = (t[8] - bounds.min.z) / span.z * height - 0.5;
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-10) continue;
    for (let z = Math.max(0, Math.ceil(Math.min(az, bz, cz))); z <= Math.min(height - 1, Math.floor(Math.max(az, bz, cz))); z++) {
      for (let x = Math.max(0, Math.ceil(Math.min(ax, bx, cx))); x <= Math.min(width - 1, Math.floor(Math.max(ax, bx, cx))); x++) {
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
        if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue;
        const y = u * t[1] + v * t[4] + (1 - u - v) * t[7];
        if (y >= minY && y <= maxY) values[z * width + x] = Math.max(values[z * width + x], y);
      }
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.max(0, Math.min(1, (values[i] - minY) / yRange)) * 255);
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = "Screen-light deck blockers";
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, bounds: new THREE.Vector4(bounds.min.x, bounds.min.z, 1 / span.x, 1 / span.z), height: new THREE.Vector2(minY, yRange), bias: Math.max(yRange / 255 * 2, Math.min(span.x / width, span.z / height) * 0.12), triangles: triangles.length };
}

/** Shared GLSL used by diffuse patches and the reflected ray. Six taps favor nearby key edges. */
export const screenOcclusionGLSL = /* glsl */`
  uniform sampler2D spillBlockers;
  uniform vec4 spillBlockerBounds;
  uniform vec2 spillBlockerHeight;
  uniform float spillBlockerBias, spillBlockersEnabled;
  float screenLightVisibility(vec3 sourceWorld) {
    if (spillBlockersEnabled < 0.5) return 1.0;
    vec3 start = (spillDeckInverse * vec4(vSpillWorld, 1.0)).xyz;
    vec3 end = (spillDeckInverse * vec4(sourceWorld, 1.0)).xyz;
    float visibility = 1.0;
    for (int i = 0; i < 6; i++) {
      float distanceFraction = (float(i) + 0.65) / 6.0;
      distanceFraction *= distanceFraction;
      vec3 point = mix(start, end, distanceFraction);
      vec2 uv = (point.xz - spillBlockerBounds.xy) * spillBlockerBounds.zw;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
      float surface = textureLod(spillBlockers, uv, 0.0).r * spillBlockerHeight.y + spillBlockerHeight.x;
      // Height quantization and bilinear edge filtering must not shadow a key's own upper face.
      visibility = min(visibility, smoothstep(-2.0 * spillBlockerBias, -spillBlockerBias, point.y - surface));
    }
    return visibility;
  }
`;
