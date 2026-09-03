"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { anim } from "@/three/anim";
import { useGLTF } from "@react-three/drei";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { DeviceSpec, Finish } from "@/lib/devices";
import { S } from "@/three/geometry";
import { useModelBounds, viewport, type ModelFeatures } from "@/three/registry";
import { useEditor } from "@/store/editor";

let ktx2: KTX2Loader | null = null;

const SCREEN_RE = /screen|display|wallpaper|lcd|oled|panel|glass_front|front_glass/i;

/** Jacobi eigen-decomposition of a symmetric 3×3 matrix → eigenvalues (desc) and unit eigenvectors. */
function eigen3(m: number[][]): { values: number[]; vectors: THREE.Vector3[] } {
  const a = m.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 32; iter++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { p = 0; q = 2; max = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > max) { p = 1; q = 2; max = Math.abs(a[1][2]); }
    if (max < 1e-12) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - sn * akq; a[k][q] = sn * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - sn * aqk; a[q][k] = sn * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - sn * vkq; v[k][q] = sn * vkp + c * vkq;
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize()) };
}

export interface MeshFrame {
  center: THREE.Vector3;
  /** principal axes in world space, largest extent first */
  axes: THREE.Vector3[];
  /** min/max projections along each axis */
  ranges: [number, number][];
  extents: number[];
  thin: number;
}

/** Principal-axis frame of a mesh in world space (robust to tilted / baked transforms). */
export function meshFrame(mesh: THREE.Mesh): MeshFrame {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const step = Math.max(1, Math.floor(n / 6000));
  const v = new THREE.Vector3();
  const mean = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < n; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); mean.add(v); count++; }
  mean.divideScalar(Math.max(1, count));
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(mean);
    xx += v.x * v.x; xy += v.x * v.y; xz += v.x * v.z; yy += v.y * v.y; yz += v.y * v.z; zz += v.z * v.z;
  }
  const c = Math.max(1, count);
  const { vectors } = eigen3([[xx / c, xy / c, xz / c], [xy / c, yy / c, yz / c], [xz / c, yz / c, zz / c]]);
  const ranges: [number, number][] = vectors.map(() => [Infinity, -Infinity]);
  for (let i = 0; i < n; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(mean);
    for (let k = 0; k < 3; k++) { const d = v.dot(vectors[k]); if (d < ranges[k][0]) ranges[k][0] = d; if (d > ranges[k][1]) ranges[k][1] = d; }
  }
  const extents = ranges.map((r) => Math.max(0, r[1] - r[0]));
  return { center: mean, axes: vectors, ranges, extents, thin: extents[2] / Math.max(1e-9, extents[0]) };
}

/**
 * Find the mesh that should carry the screen: an exact name/material match first,
 * then a keyword match, then the largest thin, non-horizontal surface.
 */
/** All meshes named in a comma-separated hint list (name or material name, exact then loose). */
export function findScreenMeshes(root: THREE.Object3D, hint?: string): THREE.Mesh[] {
  if (!hint) { const m = findScreenMesh(root); return m ? [m] : []; }
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const matNames = (m: THREE.Mesh) => ((Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[]).map((x) => x.name);
  const out: THREE.Mesh[] = [];
  for (const token of hint.split(",").map((t) => t.trim()).filter(Boolean)) {
    const exact = meshes.filter((m) => m.name === token || matNames(m).includes(token));
    const h = token.toLowerCase();
    const found = exact.length ? exact : meshes.filter((m) => m.name.toLowerCase().includes(h) || matNames(m).some((x) => x.toLowerCase().includes(h)));
    for (const m of found) if (!out.includes(m)) out.push(m);
  }
  if (out.length) return out;
  const m = findScreenMesh(root);
  return m ? [m] : [];
}

export function findScreenMesh(root: THREE.Object3D, hint?: string): THREE.Mesh | null {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const matsOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
  const matNames = (m: THREE.Mesh) => matsOf(m).map((x) => x.name);
  if (hint) {
    const exact = meshes.find((m) => m.name === hint || matNames(m).includes(hint));
    if (exact) return exact;
    const h = hint.toLowerCase();
    const loose = meshes.find((m) => m.name.toLowerCase().includes(h) || matNames(m).some((x) => x.toLowerCase().includes(h)));
    if (loose) return loose;
  }
  root.updateWorldMatrix(true, true);
  const whole = new THREE.Box3().setFromObject(root);
  const wholeSize = new THREE.Vector3();
  whole.getSize(wholeSize);
  const maxDim = Math.max(wholeSize.x, wholeSize.y, wholeSize.z);
  const scored = meshes.map((m) => {
    const f = meshFrame(m);
    const area = f.extents[0] * f.extents[1];
    const horizontal = Math.abs(f.axes[2].y) > 0.85;
    const kw = SCREEN_RE.test(m.name) || matNames(m).some((x) => SCREEN_RE.test(x));
    const textured = matsOf(m).some((x) => !!(x as THREE.MeshStandardMaterial).map || !!(x as THREE.MeshStandardMaterial).emissiveMap);
    const big = area > maxDim * maxDim * 0.04;
    let score = 0;
    if (f.thin < 0.06 && big && !horizontal) score = area * (1 + (textured ? 0.5 : 0));
    if (kw) score += area * 3;
    return { m, score };
  }).sort((a, c) => c.score - a.score);
  return scored[0] && scored[0].score > 0 ? scored[0].m : null;
}

/** Area-weighted average of the triangle normals in world space (respects winding). */
function averageFaceNormal(mesh: THREE.Mesh): THREE.Vector3 {
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const step = Math.max(3, Math.floor(n / 3000) * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const m = mesh.matrixWorld;
  let areaSum = 0;
  for (let i = 0; i + 2 < n; i += step) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m);
    b.fromBufferAttribute(pos, ib).applyMatrix4(m);
    c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    tmp.crossVectors(b.sub(a), c.sub(a));
    areaSum += tmp.length();
    acc.add(tmp);
  }
  // a closed/boxy mesh has normals pointing everywhere: report "unknown" so callers fall back
  if (areaSum <= 0 || acc.length() / areaSum < 0.5) return new THREE.Vector3();
  return acc.normalize();
}

/**
 * Replace the screen mesh's UVs with a planar projection along its principal axes
 * (u → right, v → up, facing outward) so uploaded media fills it edge to edge even
 * when the source model uses atlas UVs.
 */
export function planarizeScreenUVs(mesh: THREE.Mesh, root: THREE.Object3D, targetAspect?: number, extra: [number, number, number, number] = [0, 0, 0, 0]) {
  root.updateWorldMatrix(true, true);
  const f = meshFrame(mesh);
  // The plane normal comes from PCA (robust); the in-plane axes are locked to the world so the
  // content is never rotated by an asymmetric vertex distribution (e.g. an island cut-out).
  const n = f.axes[2].clone();
  if (n.z < 0) n.negate(); // face the camera (+z) whenever the plane is not lying flat
  let u = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x); // world X projected onto the plane
  if (u.lengthSq() < 1e-4) u = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z);
  u.normalize();
  const vv = new THREE.Vector3().crossVectors(n, u).normalize(); // in-plane "up"
  if (vv.y < -0.05 || (Math.abs(vv.y) <= 0.05 && vv.z > 0)) { vv.negate(); u.negate(); } // keep v pointing up (and cross consistent)
  if (new THREE.Vector3().crossVectors(u, vv).dot(n) < 0) u.negate(); // (u × v) must equal the facing normal
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(f.center);
    const du = p.dot(u), dv = p.dot(vv);
    if (du < minU) minU = du; if (du > maxU) maxU = du;
    if (dv < minV) minV = dv; if (dv > maxV) maxV = dv;
  }
  const geometry = mesh.geometry.clone();
  const uvs = new Float32Array(pos.count * 2);
  const lenU = Math.max(1e-9, maxU - minU), lenV = Math.max(1e-9, maxV - minV);
  // centre a rectangle with the device's true screen aspect inside the mesh; whatever is left
  // over maps outside 0..1 and is rendered black by the screen material (reads as bezel)
  let [il, it, ir, ib] = extra;
  if (targetAspect) {
    const meshAspect = (lenU * (1 - il - ir)) / (lenV * (1 - it - ib));
    if (meshAspect > targetAspect) { const cut = (1 - il - ir) * (1 - targetAspect / meshAspect) / 2; il += cut; ir += cut; }
    else if (meshAspect < targetAspect) { const cut = (1 - it - ib) * (1 - meshAspect / targetAspect) / 2; it += cut; ib += cut; }
  }
  const spanU = Math.max(1e-6, 1 - il - ir), spanV = Math.max(1e-6, 1 - it - ib);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(f.center);
    uvs[i * 2] = ((p.dot(u) - minU) / lenU - il) / spanU;
    uvs[i * 2 + 1] = ((p.dot(vv) - minV) / lenV - ib) / spanV;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  mesh.geometry = geometry;
  mesh.userData.screenAspect = (lenU * spanU) / (lenV * spanV);
}

/**
 * Transparent "cover glass" meshes that sit over the screen tint or block the
 * live content, so they are hidden once a screen mesh has been chosen (the
 * screen material carries its own clear coat).
 */

export interface DeviceFeatures {
  lid: { pivot: THREE.Group; natural: number } | null;
  island: THREE.Mesh[];
  caseParts: THREE.Mesh[];
  /** iPad screen tilt from the camera axis (rad), undone when the case is removed */
  tilt: number;
  band: THREE.Mesh[];
}

/** Orthonormal frame of the screen: n faces the camera (+z), up is the in-plane vertical, right = up × n. */
function screenFrame(screen: THREE.Mesh) {
  const f = meshFrame(screen);
  const n = f.axes[2].clone();
  if (n.z < 0) n.negate();
  const up = new THREE.Vector3(0, 1, 0).projectOnPlane(n);
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1).projectOnPlane(n);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  // geometric centre (the vertex mean is skewed by dense cut-outs such as the Dynamic Island)
  const center = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3());
  return { center, n, up, right };
}

function meshBox(m: THREE.Mesh): { box: THREE.Box3; center: THREE.Vector3; size: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(m);
  return { box, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
}

/**
 * Finds the parts a device can toggle or move — purely from geometry, since Sketchfab
 * node names are obfuscated: the laptop lid (everything in the screen's slab above the deck),
 * the phone's Dynamic Island (a small part at the top-centre of the screen), a tablet's
 * keyboard case (everything outside the tablet's slab) and a watch band (outside the case box).
 */
export function detectFeatures(root: THREE.Object3D, screen: THREE.Mesh | null, spec: DeviceSpec, scene: THREE.Scene): DeviceFeatures {
  const out: DeviceFeatures = { lid: null, island: [], caseParts: [], tilt: 0, band: [] };
  if (!screen) return out;
  root.updateWorldMatrix(true, true);
  const { center: sc, n, up, right } = screenFrame(screen);
  const H = spec.screenMm[1] * S, W = spec.screenMm[0] * S;
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m !== screen && m.visible) meshes.push(m); });
  const rel = (c: THREE.Vector3) => { const d = c.clone().sub(sc); return { u: d.dot(right), v: d.dot(up), w: d.dot(n) }; };

  if (spec.family === "laptop") {
    // deck top: the largest near-horizontal mesh
    let deckY = -Infinity, deckArea = 0;
    for (const m of meshes) {
      const { size, center } = meshBox(m);
      if (size.y < H * 0.05 && size.x * size.z > deckArea) { deckArea = size.x * size.z; deckY = center.y; }
    }
    const lid: THREE.Mesh[] = [];
    let minUp = Infinity;
    for (const m of [screen, ...meshes]) {
      const { box, center } = meshBox(m);
      const { w } = rel(center);
      if (Math.abs(w) > H * 0.12 || center.y < deckY + H * 0.1) continue;
      lid.push(m);
      for (let i = 0; i < 8; i++) {
        const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        minUp = Math.min(minUp, corner.sub(sc).dot(up));
      }
    }
    if (lid.length >= 2 && Number.isFinite(minUp)) {
      const yawGroup = root.getObjectByName("autoYaw") as THREE.Group | undefined;
      if (yawGroup) {
        const hinge = sc.clone().add(up.clone().multiplyScalar(minUp));
        const pivot = new THREE.Group();
        pivot.name = "lidPivot";
        pivot.position.copy(hinge);
        pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
        scene.add(pivot);
        pivot.updateMatrixWorld(true);
        yawGroup.attach(pivot);
        for (const m of lid) pivot.attach(m);
        const tilt = (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
        out.lid = { pivot, natural: n.y > 0 ? 90 + tilt : 90 - tilt };
      }
    }
  }

  if (spec.family === "phone") {
    for (const m of meshes) {
      const { size, center } = meshBox(m);
      const { u, v, w } = rel(center);
      const along = Math.abs(size.x * right.x + size.y * right.y + size.z * right.z);
      const tall = Math.abs(size.x * up.x + size.y * up.y + size.z * up.z);
      if (Math.abs(w) < H * 0.05 && Math.abs(u) < W * 0.3 && v > H * 0.5 - H * 0.16 && v < H * 0.5 && along < W * 0.45 && tall > H * 0.02 && tall < H * 0.1) out.island.push(m);
    }
  }

  if (spec.family === "tablet") {
    for (const m of meshes) {
      const { w } = rel(meshBox(m).center);
      if (Math.abs(w) > H * 0.08) out.caseParts.push(m);
    }
    if (out.caseParts.length < 3) out.caseParts = [];
    out.tilt = Math.atan2(n.y, n.z);
  }

  if (spec.family === "watch") {
    const sb = new THREE.Box3().setFromObject(screen);
    const ssz = sb.getSize(new THREE.Vector3());
    // bands reach well beyond the case (loops even wrap around its centre), so test the whole box
    const caseBox = sb.clone().expandByVector(ssz.clone().multiplyScalar(0.6));
    for (const m of meshes) {
      const { box } = meshBox(m);
      if (!caseBox.containsBox(box)) out.band.push(m);
    }
  }
  return out;
}

export function hideScreenOverlays(root: THREE.Object3D, screen: THREE.Mesh): THREE.Mesh[] {
  root.updateWorldMatrix(true, true);
  const sb = new THREE.Box3().setFromObject(screen);
  const ss = new THREE.Vector3(); sb.getSize(ss);
  const sArea = [ss.x, ss.y, ss.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
  const hidden: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === screen) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
    if (!mats.some((x) => x.transparent || (x as THREE.MeshPhysicalMaterial).transmission > 0)) return;
    const b = new THREE.Box3().setFromObject(m);
    const bs = new THREE.Vector3(); b.getSize(bs);
    const area = [bs.x, bs.y, bs.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
    const inter = b.clone().intersect(sb);
    if (inter.isEmpty()) return;
    const is = new THREE.Vector3(); inter.getSize(is);
    const interArea = [is.x, is.y, is.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
    // covers most of the screen and is not much bigger than it (a whole-body glass shell would be)
    if (interArea > sArea * 0.6 && area < sArea * 1.8) { m.visible = false; hidden.push(m); }
  });
  return hidden;
}

/**
 * Renders a real glTF model. The mesh named `spec.model.screenMesh` gets the
 * live screen material; materials listed in `finishMaterials` are tinted with
 * the chosen finish. Supports meshopt + KTX2-compressed assets out of the box.
 */
export function GlbDevice({ spec, finish, screen, gloss = 1.3 }: { spec: DeviceSpec; finish: Finish; screen: THREE.Material; gloss?: number }) {
  const gl = useThree((s) => s.gl);
  const maxAniso = gl.capabilities.getMaxAnisotropy();
  const invalidate = useThree((s) => s.invalidate);
  const model = spec.model!;
  const gltf = useGLTF(model.url, true, true, (loader) => {
    if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl);
    loader.setKTX2Loader(ktx2 as never);
  });
  const root = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const target = (model.size ?? Math.max(spec.body.w, spec.body.h)) * S;
    const scale = model.scale ?? target / Math.max(1e-6, Math.max(size.x, size.y, size.z));
    const holder = new THREE.Group();
    clone.position.sub(center);
    const yawGroup = new THREE.Group();
    yawGroup.name = "autoYaw";
    yawGroup.add(clone);
    holder.add(yawGroup);
    holder.scale.setScalar(scale);
    return holder;
  }, [gltf.scene, model.scale, model.size, spec.body.h, spec.body.w]);

  const notch = useEditor((s) => s.project.mockup.notch ?? true);
  const caseKeyboard = useEditor((s) => s.project.mockup.caseKeyboard ?? true);
  const bandColor = useEditor((s) => s.project.mockup.bandColor ?? null);
  const scene = useThree((s) => s.scene);

  // publish the real footprint (after rotation + auto-yaw) so floors, shadows and framing use it
  const yawApplied = (root.getObjectByName("autoYaw") as THREE.Group | undefined)?.rotation.y ?? 0;
  useEffect(() => {
    const r = model.rotation ?? [0, 0, 0];
    const probe = new THREE.Group();
    probe.rotation.set(r[0], r[1], r[2]);
    const parent = root.parent;
    probe.add(root);
    probe.updateWorldMatrix(true, true);
    const b = new THREE.Box3();
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible) b.expandByObject(m); });
    probe.remove(root);
    if (parent) parent.add(root);
    const sz = new THREE.Vector3();
    b.getSize(sz);
    useModelBounds.getState().set(spec.id, { minY: b.min.y, maxY: b.max.y, width: sz.x, height: sz.y });
  }, [root, model.rotation, spec.id, yawApplied, caseKeyboard]);

  // laptop lid follows the (keyframeable) lid angle
  useFrame(() => {
    const f = root.userData.features as DeviceFeatures | undefined;
    if (!f?.lid) return;
    const v = anim.values?.["mockup.lid"] ?? f.lid.natural;
    const rot = ((f.lid.natural - v) * Math.PI) / 180;
    if (Math.abs(f.lid.pivot.rotation.x - rot) > 1e-5) f.lid.pivot.rotation.x = rot;
  }, -25);

  useEffect(() => {
    // "model" keeps the authored colour; any other finish tints the listed materials
    const finishNames = new Set(finish.id === "model" ? [] : model.finishMaterials ?? []);
    if (!root.userData.screens) {
      root.updateWorldMatrix(true, true);
      // mirrored nodes (negative scale) render inside-out; draw both faces for those
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.matrixWorld.determinant() >= 0) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
        const fixed = mats.map((x) => { const c = x.clone(); c.side = THREE.DoubleSide; return c; });
        m.material = Array.isArray(m.material) ? fixed : fixed[0];
        m.userData.mirrored = true;
      });
      // baked shadow catchers: large, flat, horizontal quads lying at the very bottom of the model
      const whole = new THREE.Box3().setFromObject(root);
      const wsz = new THREE.Vector3(); whole.getSize(wsz);
      const explicitHide = new Set(model.hide ?? []);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (explicitHide.has(m.name)) { m.visible = false; return; }
        const b = new THREE.Box3().setFromObject(m);
        const sz = new THREE.Vector3(); b.getSize(sz);
        const tris = (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
        const flat = sz.y < wsz.y * 0.004;
        const atBottom = b.min.y < whole.min.y + wsz.y * 0.02;
        const large = sz.x * sz.z > wsz.x * wsz.z * 0.2;
        if (flat && atBottom && large && tris <= 12) m.visible = false;
      });
      const screens = findScreenMeshes(root, model.screenMesh);
      root.userData.screens = screens;
      root.userData.screenMesh = screens[0] ?? null;
      // align the screen's normal with the camera axis (+z) so content is never seen skewed at rotation 0
      if (screens[0] && model.autoYaw !== false) {
        const r = model.rotation ?? [0, 0, 0];
        root.rotation.set(r[0], r[1], r[2]);
        root.updateWorldMatrix(true, true);
        const n = meshFrame(screens[0]).axes[2].clone();
        if (n.z < 0) n.negate();
        const yaw = Math.atan2(n.x, n.z);
        const yawGroup = root.getObjectByName("autoYaw");
        if (yawGroup && Math.abs(yaw) > 0.002) { yawGroup.rotation.y = -yaw; root.updateWorldMatrix(true, true); }
      }
      for (const sm of screens) planarizeScreenUVs(sm, root, spec.screenPx[0] / spec.screenPx[1], model.screenInset);
      if (screens[0]?.userData.screenAspect) useModelBounds.getState().set(spec.id, { screenAspect: screens[0].userData.screenAspect as number });
      if (screens[0] && model.hideOverlays !== false) {
        const hidden = hideScreenOverlays(root, screens[0]).filter((h) => !screens.includes(h));
        for (const h of hidden) h.visible = false;
        for (const sm of screens) sm.visible = true;
        root.userData.hidden = hidden;
      }
      if (screens[0]) {
        // where the display sits and which way it faces, so a lit scene can put its glow there
        const f = screenFrame(screens[0]);
        anim.screenPos = [f.center.x, f.center.y, f.center.z];
        anim.screenDir = [f.n.x, f.n.y, f.n.z];
      }
      const features = detectFeatures(root, screens[0] ?? null, spec, scene);
      root.userData.features = features;
      const flags: ModelFeatures = { lid: !!features.lid, island: features.island.length > 0, caseParts: features.caseParts.length > 0, band: features.band.length > 0 };
      useModelBounds.getState().set(spec.id, { features: flags });
    }
    const screens = root.userData.screens as THREE.Mesh[];
    const features = root.userData.features as DeviceFeatures;
    // toggles: Dynamic Island, keyboard case (tablet lies flat facing the camera without it), band tint
    for (const m of features.island) m.visible = notch;
    for (const m of features.caseParts) m.visible = caseKeyboard;
    const yawGroup = root.getObjectByName("autoYaw") as THREE.Group | undefined;
    if (yawGroup && features.tilt) {
      yawGroup.rotation.order = "XYZ";
      yawGroup.rotation.x = caseKeyboard ? 0 : features.tilt;
      // keep the visible part centred on the origin
      yawGroup.position.set(0, 0, 0);
      root.updateWorldMatrix(true, true);
      const vb = new THREE.Box3();
      root.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && mm.visible) vb.expandByObject(mm); });
      if (!vb.isEmpty()) {
        const c = vb.getCenter(new THREE.Vector3());
        const local = root.worldToLocal(c.clone());
        yawGroup.position.sub(local);
      }
    }
    viewport.glbInfo = () => {
      root.updateWorldMatrix(true, true);
      const out: Record<string, unknown>[] = [];
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const b = new THREE.Box3().setFromObject(mesh);
        const sz = new THREE.Vector3(), c = new THREE.Vector3();
        b.getSize(sz); b.getCenter(c);
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
        const tex = mats.map((x) => { const im = (x.map ?? x.emissiveMap)?.image as { width?: number; height?: number } | undefined; return x.map || x.emissiveMap ? `${x.map ? "m" : "e"}${im?.width ?? "?"}x${im?.height ?? "?"}` : "-"; }).join(",");
        const color = mats.map((x) => (x.color ? "#" + x.color.getHexString() : "-")).join(",");
        mesh.geometry.computeBoundingBox();
        const lsz = new THREE.Vector3(); mesh.geometry.boundingBox!.getSize(lsz);
        const ld = [lsz.x, lsz.y, lsz.z].sort((a, c) => a - c);
        out.push({ name: mesh.name, material: mats.map((x) => x.name).join(","), tex, color, det: +mesh.matrixWorld.determinant().toFixed(4), thin: +(ld[0] / Math.max(1e-9, ld[2])).toFixed(3), transparent: mats.some((x) => x.transparent), size: [sz.x, sz.y, sz.z].map((v) => +v.toFixed(3)), center: [c.x, c.y, c.z].map((v) => +v.toFixed(3)), screen: screens.includes(mesh), tris: (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 });
      });
      const whole = new THREE.Box3().setFromObject(root); const ws = new THREE.Vector3(); whole.getSize(ws);
      return { size: [ws.x, ws.y, ws.z].map((v) => +v.toFixed(3)), hidden: ((root.userData.hidden as THREE.Mesh[] | undefined) ?? []).map((h) => h.name), meshes: out };
    };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.userData.originalMaterial) mesh.userData.originalMaterial = mesh.material;
      const original = mesh.userData.originalMaterial as THREE.Material | THREE.Material[];
      if (screens.includes(mesh)) {
        mesh.material = screen;
        return;
      }
      mesh.material = original;
      if (features.band.includes(mesh) && bandColor) {
        const cache = (mesh.userData.bandTint ??= new Map<string, THREE.Material | THREE.Material[]>()) as Map<string, THREE.Material | THREE.Material[]>;
        let tinted = cache.get(bandColor);
        if (!tinted) {
          const src = (Array.isArray(original) ? original : [original]) as THREE.MeshStandardMaterial[];
          const list = src.map((x) => { const c = x.clone(); if ("color" in c) c.color.set(bandColor); c.fog = false; return c; });
          tinted = list.length === 1 ? list[0] : list;
          cache.set(bandColor, tinted);
        }
        mesh.material = tinted;
        return;
      }
      // body gloss: scale environment reflections and polish the authored roughness
      const tuned = ((Array.isArray(original) ? original : [original]) as THREE.Material[]).map((x) => {
        const std = x as THREE.MeshStandardMaterial;
        if (!("envMapIntensity" in std)) return x;
        const cache = (mesh.userData.tuned ??= new Map<THREE.Material, THREE.MeshStandardMaterial>()) as Map<THREE.Material, THREE.MeshStandardMaterial>;
        let t = cache.get(x);
        if (!t) {
          t = std.clone();
          t.userData.baseRoughness = std.roughness;
          // photogrammetry-style normal maps are high-frequency noise; without mip filtering they
          // alias into sparkles under a bright HDRI, so filter them properly and tame the strength
          for (const map of [t.normalMap, t.map, t.roughnessMap, t.metalnessMap, t.aoMap]) {
            if (!map) continue;
            map.anisotropy = maxAniso;
            map.minFilter = THREE.LinearMipmapLinearFilter;
            map.magFilter = THREE.LinearFilter;
            map.generateMipmaps = true;
            map.needsUpdate = true;
          }
          if (t.normalMap) t.normalScale = t.normalScale.clone().multiplyScalar(0.65);
          cache.set(x, t);
        }
        t.envMapIntensity = gloss;
        t.fog = false;
        const base = t.userData.baseRoughness as number;
        // gloss polishes the surface a little, never to a mirror: a noisy normal map on a near-mirror
        // surface is what produces speckle, so keep a floor when one is present
        const polished = base * Math.max(0.7, 1.08 - gloss * 0.12);
        t.roughness = Math.max(t.normalMap ? 0.22 : 0.05, Math.min(1, polished));
        return t;
      });
      mesh.material = tuned.length === 1 ? tuned[0] : tuned;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = mats.map((m) => {
        if (finishNames.has(m.name) && "color" in m) {
          const c = (m as THREE.MeshStandardMaterial).clone();
          c.color.set(finish.color);
          return c;
        }
        return m;
      }).length === 1 ? (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) : mesh.material;
      // re-run tint on single material
      if (!Array.isArray(mesh.material) && finishNames.has(mesh.material.name) && "color" in mesh.material) {
        const c = (mesh.material as THREE.MeshStandardMaterial).clone();
        c.color.set(finish.color);
        mesh.material = c;
      }
    });
    invalidate();
  }, [root, model.screenMesh, model.screenInset, model.finishMaterials, model.hide, finish.color, screen, invalidate, gloss, spec.id, spec.screenPx, spec, scene, notch, caseKeyboard, bandColor, maxAniso]);

  return <primitive object={root} rotation={model.rotation ?? [0, 0, 0]} position={model.position ?? [0, 0, 0]} />;
}
