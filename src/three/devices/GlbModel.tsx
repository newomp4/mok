"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { DeviceSpec, Finish } from "@/lib/devices";
import { S } from "@/three/geometry";
import { viewport } from "@/three/registry";

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
  for (let i = 0; i + 2 < n; i += step) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m);
    b.fromBufferAttribute(pos, ib).applyMatrix4(m);
    c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    tmp.crossVectors(b.sub(a), c.sub(a));
    acc.add(tmp);
  }
  return acc.normalize();
}

/**
 * Replace the screen mesh's UVs with a planar projection along its principal axes
 * (u → right, v → up, facing outward) so uploaded media fills it edge to edge even
 * when the source model uses atlas UVs.
 */
export function planarizeScreenUVs(mesh: THREE.Mesh, root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const f = meshFrame(mesh);
  let u = f.axes[0].clone(), vv = f.axes[1].clone();
  let uRange = f.ranges[0], vRange = f.ranges[1];
  if (Math.abs(u.y) > Math.abs(vv.y)) { [u, vv] = [vv, u]; [uRange, vRange] = [vRange, uRange]; }
  let vSign = vv.y >= 0 ? 1 : -1;
  if (Math.abs(vv.y) < 0.15) vSign = 1; // flat-lying screens: keep as modelled
  // orient u so that (u × v) matches the geometry's own facing direction (winding normal)
  const facing = averageFaceNormal(mesh);
  const rootBox = new THREE.Box3().setFromObject(root);
  const rootCenter = new THREE.Vector3();
  rootBox.getCenter(rootCenter);
  if (facing.lengthSq() < 1e-6) facing.copy(f.center).sub(rootCenter); // fallback: outward from the model centre
  const normal = new THREE.Vector3().crossVectors(u, vv.clone().multiplyScalar(vSign));
  const uSign = normal.dot(facing) >= 0 ? 1 : -1;
  const geometry = mesh.geometry.clone();
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const uvs = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  const uLen = Math.max(1e-9, uRange[1] - uRange[0]), vLen = Math.max(1e-9, vRange[1] - vRange[0]);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(f.center);
    let uu = (p.dot(u) - uRange[0]) / uLen;
    let vvv = (p.dot(vv) - vRange[0]) / vLen;
    if (uSign < 0) uu = 1 - uu;
    if (vSign < 0) vvv = 1 - vvv;
    uvs[i * 2] = uu; uvs[i * 2 + 1] = vvv;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  mesh.geometry = geometry;
}

/**
 * Transparent "cover glass" meshes that sit over the screen tint or block the
 * live content, so they are hidden once a screen mesh has been chosen (the
 * screen material carries its own clear coat).
 */
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
export function GlbDevice({ spec, finish, screen }: { spec: DeviceSpec; finish: Finish; screen: THREE.Material }) {
  const gl = useThree((s) => s.gl);
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
    holder.add(clone);
    holder.scale.setScalar(scale);
    return holder;
  }, [gltf.scene, model.scale, spec.body.h]);

  useEffect(() => {
    const finishNames = new Set(model.finishMaterials ?? []);
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
      const screens = findScreenMeshes(root, model.screenMesh);
      root.userData.screens = screens;
      root.userData.screenMesh = screens[0] ?? null;
      for (const sm of screens) planarizeScreenUVs(sm, root);
      if (screens[0] && model.hideOverlays !== false) {
        const hidden = hideScreenOverlays(root, screens[0]).filter((h) => !screens.includes(h));
        for (const h of hidden) h.visible = false;
        for (const sm of screens) sm.visible = true;
        root.userData.hidden = hidden;
      }
    }
    const screens = root.userData.screens as THREE.Mesh[];
    const screenMesh = screens[0] ?? null;
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
  }, [root, model.screenMesh, model.finishMaterials, finish.color, screen, invalidate]);

  return <primitive object={root} rotation={model.rotation ?? [0, 0, 0]} position={model.position ?? [0, 0, 0]} />;
}
