"use client";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShotView } from "@/three/Device";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { anim } from "@/three/anim";
import type { DeviceSpec, Finish } from "@/lib/devices";
import { S } from "@/three/geometry";
import { useModelBounds, viewport, type ModelFeatures, useShownDevice } from "@/three/registry";
import { useEditor } from "@/store/editor";
import { disposeModelResources, ownModelResource, tintBandMaterials } from "@/three/resources";
import { visibleBounds } from "@/three/bounds";
import { addMetalSurfaceDetail } from "@/three/surfaceDetail";
import { addEnvironmentGain } from "@/three/environmentGain";
import { effectiveKeyboardCase } from "@/lib/orientation";
import { installScreenSpill, laptopReceivers, updateScreenReceiver } from "@/three/screenSpill";
import { acquireModel, readModel, retainModel } from "@/three/modelAssets";
import { prepareModelGpu } from "@/three/gpuPreparation";
import { applyMaterialProfile } from "@/three/materialProfiles";
import { useUI } from "@/store/ui";
import { addDisplaySeamBacking } from "@/three/displaySeams";

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
  // measured in the device's own frame: a world box grows with whatever rotation the mockup happens
  // to be holding, and the size threshold below would move with it
  const whole = new THREE.Box3().setFromObject(root).applyMatrix4(deviceInverse(root));
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

/**
 * Replace the screen mesh's UVs with a planar projection along its principal axes
 * (u → right, v → up, facing outward) so uploaded media fills it edge to edge even
 * when the source model uses atlas UVs.
 */
export function planarizeScreenUVs(mesh: THREE.Mesh, root: THREE.Object3D, targetAspect?: number, extra: [number, number, number, number] = [0, 0, 0, 0]) {
  root.updateWorldMatrix(true, true);
  const f = meshFrame(mesh);
  // The plane normal comes from PCA (robust); the in-plane axes are locked to the device's own
  // right and up, so the content is never rotated by an asymmetric vertex distribution (e.g. an
  // island cut-out), nor by the mockup rotation the user happens to have set while it loads.
  const dev = deviceInverse(mesh).invert();
  const dx = new THREE.Vector3(1, 0, 0).transformDirection(dev);
  const dy = new THREE.Vector3(0, 1, 0).transformDirection(dev);
  const dz = new THREE.Vector3(0, 0, 1).transformDirection(dev);
  const n = f.axes[2].clone();
  if (n.dot(dz) < 0) n.negate(); // face the camera (+z) whenever the plane is not lying flat
  let u = dx.clone().addScaledVector(n, -dx.dot(n)); // the device's right, projected onto the plane
  if (u.lengthSq() < 1e-4) u = dz.clone().addScaledVector(n, -dz.dot(n));
  u.normalize();
  const vv = new THREE.Vector3().crossVectors(n, u).normalize(); // in-plane "up"
  const vy = vv.dot(dy), vz = vv.dot(dz);
  if (vy < -0.05 || (Math.abs(vy) <= 0.05 && vz > 0)) { vv.negate(); u.negate(); } // keep v pointing up (and cross consistent)
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
  const geometry = ownModelResource(root, mesh.geometry.clone());
  stabilizeScreenNormals(geometry, mesh.matrixWorld, f);
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
 * Quantized imported normals can turn a flat display into small reflective facets.
 * Repair only an almost perfectly planar, consistently facing surface, and only
 * on the instance-owned geometry. Curved glass, bevels and opposing faces retain
 * their authored normals. Position/index data and the cached source stay intact.
 */
export function stabilizeScreenNormals(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4, frame: MeshFrame): boolean {
  const normals = geometry.getAttribute("normal"), positions = geometry.getAttribute("position");
  if (!normals || !positions || positions.count < 3 || normals.count !== positions.count || frame.extents[0] <= 1e-9 || frame.thin > 0.0002) return false;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const n = frame.axes[2].clone(), p = new THREE.Vector3();
  p.fromBufferAttribute(normals, 0).applyMatrix3(normalMatrix).normalize();
  if (p.dot(n) < 0) n.negate();
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    if (p.dot(n) < Math.cos(2 * Math.PI / 180)) return false;
    p.fromBufferAttribute(positions, i).applyMatrix4(matrixWorld).sub(frame.center);
    const depth = p.dot(n); min = Math.min(min, depth); max = Math.max(max, depth);
  }
  // PCA samples large meshes; check every vertex before flattening any normals.
  if (max - min > frame.extents[0] * 0.0002) return false;
  const local = n.applyMatrix3(new THREE.Matrix3().setFromMatrix4(matrixWorld).transpose()).normalize();
  const repaired = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) local.toArray(repaired, i * 3);
  geometry.setAttribute("normal", new THREE.BufferAttribute(repaired, 3));
  return true;
}

/**
 * Transparent "cover glass" meshes that sit over the screen tint or block the
 * live content, so they are hidden once a screen mesh has been chosen (the
 * screen material carries its own clear coat).
 */

export interface DeviceFeatures {
  lid: { pivot: THREE.Group; natural: number; rest: THREE.Quaternion } | null;
  island: THREE.Mesh[];
  caseParts: THREE.Mesh[];
  /** iPad screen tilt from the camera axis (rad), undone when the case is removed */
  tilt: number;
  band: THREE.Mesh[];
}

const lidAxis = new THREE.Vector3(1, 0, 0), lidRotation = new THREE.Quaternion();

/** The pivot already carries its authored tilt; animate relative to that basis, never replace it. */
export function setLidAngle(lid: NonNullable<DeviceFeatures["lid"]>, angle: number): void {
  const degrees = Number.isFinite(angle) ? Math.max(0, Math.min(135, angle)) : lid.natural;
  lidRotation.setFromAxisAngle(lidAxis, (lid.natural - degrees) * Math.PI / 180).premultiply(lid.rest);
  if (lid.pivot.quaternion.angleTo(lidRotation) > 1e-8) lid.pivot.quaternion.copy(lidRotation);
}

/** Reproject real vertices: a tilted mesh's axis-aligned box cannot locate its closing surface. */
function vertexBounds(meshes: readonly THREE.Mesh[], inverse: THREE.Matrix4): THREE.Box3 {
  const box = new THREE.Box3(), transform = new THREE.Matrix4(), point = new THREE.Vector3();
  for (const mesh of meshes) {
    transform.multiplyMatrices(inverse, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(transform));
  }
  return box;
}

/**
 * The inverse of the transform the user's own rotation applies, so geometry measured in world space
 * can be expressed in the device's own frame. Without this, loading a model while the mockup is
 * yawed bakes that yaw into the model's alignment and into the published screen frame.
 */
function deviceInverse(o: THREE.Object3D): THREE.Matrix4 {
  let n: THREE.Object3D | null = o;
  while (n && n.name !== "device-orientation" && n.name !== "device") n = n.parent;
  const m = new THREE.Matrix4();
  if (n) { n.updateWorldMatrix(true, false); m.copy(n.matrixWorld).invert(); }
  return m;
}

/** Orthonormal frame of the screen in the device's own space: n faces the camera (+z), up is the in-plane vertical, right = up × n. */
/** Maps a point from the device's own frame into `root`'s local space. */
function deviceLocal(root: THREE.Object3D): THREE.Matrix4 {
  let n: THREE.Object3D | null = root;
  while (n && n.name !== "device-orientation" && n.name !== "device") n = n.parent;
  const m = new THREE.Matrix4();
  if (n) { n.updateWorldMatrix(true, false); root.updateWorldMatrix(true, false); m.copy(root.matrixWorld).invert().multiply(n.matrixWorld); }
  return m;
}

/** Visibility, display tilt and centering share one effective attachment state. */
export function applyKeyboardCase(root: THREE.Object3D, parts: readonly THREE.Object3D[], tilt: number, enabled: boolean): void {
  for (const part of parts) part.visible = enabled;
  const yawGroup = root.getObjectByName("autoYaw");
  if (!yawGroup || !tilt) return;
  yawGroup.rotation.order = "XYZ";
  yawGroup.rotation.x = enabled ? 0 : tilt;
  yawGroup.position.set(0, 0, 0);
  root.updateWorldMatrix(true, true);
  const bounds = visibleBounds(root, deviceInverse(root), new THREE.Box3(), true);
  if (!bounds.isEmpty()) {
    // Measure in the native device frame so user rotation never shifts the tablet's centre.
    const center = bounds.getCenter(new THREE.Vector3()).applyMatrix4(deviceLocal(root));
    yawGroup.position.sub(center);
  }
}

function screenFrame(screen: THREE.Mesh) {
  const inv = deviceInverse(screen);
  const f = meshFrame(screen);
  const n = f.axes[2].clone().transformDirection(inv).normalize();
  if (n.z < 0) n.negate();
  const up = new THREE.Vector3(0, 1, 0).projectOnPlane(n);
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1).projectOnPlane(n);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  // geometric centre (the vertex mean is skewed by dense cut-outs such as the Dynamic Island)
  const center = meshBox(screen, inv).center;
  return { center, n, up, right, inv };
}

/** Axis-aligned box of an object in the space `inv` maps the world into (the device's own, here). */
function meshBox(m: THREE.Object3D, inv: THREE.Matrix4): { box: THREE.Box3; center: THREE.Vector3; size: THREE.Vector3 } {
  const box = new THREE.Box3();
  const local = new THREE.Matrix4();
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(new THREE.Box3().copy(mesh.geometry.boundingBox!).applyMatrix4(local.multiplyMatrices(inv, mesh.matrixWorld)));
  });
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
  const { center: sc, n, up, right, inv } = screenFrame(screen);
  const H = spec.screenMm[1] * S, W = spec.screenMm[0] * S;
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m !== screen && m.visible) meshes.push(m); });
  const rel = (c: THREE.Vector3) => { const d = c.clone().sub(sc); return { u: d.dot(right), v: d.dot(up), w: d.dot(n) }; };

  if (spec.family === "laptop") {
    // deck top: the largest near-horizontal mesh
    let deckY = -Infinity, deckArea = 0;
    const deckCandidates: { mesh: THREE.Mesh; box: THREE.Box3; area: number }[] = [];
    for (const m of meshes) {
      const { box, size, center } = meshBox(m, inv);
      if (size.y < H * 0.05) {
        const area = size.x * size.z;
        deckCandidates.push({ mesh: m, box, area });
        if (area > deckArea) { deckArea = area; deckY = center.y; }
      }
    }
    const lid: THREE.Mesh[] = [];
    let minUp = Infinity;
    for (const m of [screen, ...meshes]) {
      const { box, center } = meshBox(m, inv);
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
        const tilt = (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
        const natural = n.y > 0 ? 90 + tilt : 90 - tilt;
        const hinge = sc.clone().addScaledVector(up, minUp);
        // A lid includes its hinge barrel, so the slab's bottom alone sits below the real axis.
        // Solve the hinge that closes the display just above the key tops and aligns the front rim.
        const tops = deckCandidates.filter((c) => !lid.includes(c.mesh) && c.area >= deckArea * 0.3);
        if (tops.length) {
          const top = Math.max(...tops.map((c) => c.box.max.y));
          const deck = meshes.filter((m) => !lid.includes(m));
          const front = vertexBounds(deck, inv).max.z;
          const rotation = new THREE.Matrix4().makeRotationAxis(right, natural * Math.PI / 180);
          const close = new THREE.Matrix4().makeTranslation(hinge.x, hinge.y, hinge.z)
            .multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z)).multiply(inv);
          const display = vertexBounds([screen], close), closedLid = vertexBounds(lid, close);
          const gap = Math.max(0.001, (spec.lid?.thickness ?? 4) * S * 0.06);
          const shift = new THREE.Vector3(0, top + gap - (display.min.y + display.max.y) / 2, front - closedLid.max.z);
          // Invert (I - R) in the plane perpendicular to the hinge axis.
          const correction = shift.clone().multiplyScalar(0.5)
            .addScaledVector(new THREE.Vector3().crossVectors(right, shift), 0.5 / Math.tan(natural * Math.PI / 360));
          if (correction.toArray().every(Number.isFinite)) hinge.add(correction);
        }
        // the pivot is parked in the scene before it is re-parented, so it is handed world values
        const dev = inv.clone().invert();
        const pivot = new THREE.Group();
        pivot.name = "lidPivot";
        pivot.position.copy(hinge).applyMatrix4(dev);
        pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n).premultiply(dev));
        scene.add(pivot);
        pivot.updateMatrixWorld(true);
        yawGroup.attach(pivot);
        for (const m of lid) pivot.attach(m);
        out.lid = { pivot, natural, rest: pivot.quaternion.clone() };
      }
    }
  }

  if (spec.family === "phone") {
    for (const m of meshes) {
      const { size, center } = meshBox(m, inv);
      const { u, v, w } = rel(center);
      const along = Math.abs(size.x * right.x + size.y * right.y + size.z * right.z);
      const tall = Math.abs(size.x * up.x + size.y * up.y + size.z * up.z);
      if (Math.abs(w) < H * 0.05 && Math.abs(u) < W * 0.3 && v > H * 0.5 - H * 0.16 && v < H * 0.5 && along < W * 0.45 && tall > H * 0.02 && tall < H * 0.1) out.island.push(m);
    }
  }

  if (spec.family === "tablet") {
    for (const m of meshes) {
      const { w } = rel(meshBox(m, inv).center);
      if (Math.abs(w) > H * 0.08) out.caseParts.push(m);
    }
    if (out.caseParts.length < 3) out.caseParts = [];
    out.tilt = Math.atan2(n.y, n.z);
  }

  if (spec.family === "watch") {
    const { box: sb, size: ssz } = meshBox(screen, inv);
    // bands reach well beyond the case (loops even wrap around its centre), so test the whole box
    const caseBox = sb.clone().expandByVector(ssz.clone().multiplyScalar(0.6));
    for (const m of meshes) {
      const { box } = meshBox(m, inv);
      if (!caseBox.containsBox(box)) out.band.push(m);
    }
  }
  return out;
}

export function hideScreenOverlays(root: THREE.Object3D, screen: THREE.Mesh): THREE.Mesh[] {
  root.updateWorldMatrix(true, true);
  // every box here is measured in the device's own frame, so whichever mockup rotation happens to
  // be in force while the model loads cannot change which meshes read as covering the screen
  const inv = deviceInverse(screen);
  const { box: sb, size: ss } = meshBox(screen, inv);
  const sArea = [ss.x, ss.y, ss.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
  // Some source cover glass sits just above the OLED, without intersecting its
  // zero-thickness box. Measure these separate sheets in the display's plane.
  const f = meshFrame(screen), n = f.axes[2].clone();
  const front = new THREE.Vector3(0, 0, 1).transformDirection(inv.clone().invert());
  if (n.dot(front) < 0) n.negate();
  const u = f.axes[0], v = new THREE.Vector3().crossVectors(n, u).normalize();
  const toScreen = new THREE.Matrix4().makeBasis(u, v, n).setPosition(f.center).invert();
  const screenBox = vertexBounds([screen], toScreen), screenSize = screenBox.getSize(new THREE.Vector3());
  const frontGap = Math.max(screenSize.x, screenSize.y) * 0.01;
  const hidden: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === screen) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
    if (!mats.some((x) => x.transparent || (x as THREE.MeshPhysicalMaterial).transmission > 0)) return;
    const { box: b, size: bs } = meshBox(m, inv);
    const area = [bs.x, bs.y, bs.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
    const inter = b.clone().intersect(sb);
    const is = new THREE.Vector3(); inter.getSize(is);
    const interArea = [is.x, is.y, is.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
    const cover = vertexBounds([m], toScreen), size = cover.getSize(new THREE.Vector3());
    // A tilted back or distant front sheet can intersect the device-axis box
    // without reaching the display plane. Keep existing overlapping covers only
    // when their depth really crosses the display.
    const overlaps = !inter.isEmpty() && interArea > sArea * 0.6 && area < sArea * 1.8
      && cover.min.z <= screenBox.max.z && cover.max.z >= screenBox.min.z;
    if (overlaps) { m.visible = false; hidden.push(m); return; }
    const overlapU = Math.max(0, Math.min(cover.max.x, screenBox.max.x) - Math.max(cover.min.x, screenBox.min.x));
    const overlapV = Math.max(0, Math.min(cover.max.y, screenBox.max.y) - Math.max(cover.min.y, screenBox.min.y));
    const flatFrontCover = cover.min.z >= screenBox.max.z - frontGap * 0.01
      && cover.max.z <= screenBox.max.z + frontGap
      && size.z < Math.min(screenSize.x, screenSize.y) * 0.02
      && overlapU * overlapV > screenSize.x * screenSize.y * 0.6
      && size.x * size.y < screenSize.x * screenSize.y * 1.8;
    if (flatFrontCover) { m.visible = false; hidden.push(m); }
  });
  return hidden;
}

/** Authoring helpers with no visible or transmitted contribution must not set
 * the model scale, attachment bounds or shadow silhouette. Keep live displays,
 * mixed material slots and zero-opacity transmitting glass. Never mutate a
 * source material: finish changes still need its original opacity/texture data.
 */
export function hideInvisibleModelMeshes(root: THREE.Object3D, screens: readonly THREE.Mesh[] = []): THREE.Mesh[] {
  const live = new Set(screens), hidden: THREE.Mesh[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    // Object visibility also hides descendants; leave grouping meshes intact.
    if (!mesh.isMesh || mesh.children.length || live.has(mesh)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.length || !materials.every(material => material.transparent && material.opacity === 0
      && !((material as THREE.MeshPhysicalMaterial).transmission > 0))) return;
    mesh.visible = false;
    hidden.push(mesh);
  });
  return hidden;
}

interface GlbProps {
  spec: DeviceSpec;
  finish: Finish;
  screen: THREE.Material;
  gloss?: number;
}

/**
 * Renders a real glTF model. The mesh named `spec.model.screenMesh` gets the
 * live screen material; materials listed in `finishMaterials` are tinted with
 * the chosen finish. Supports meshopt + KTX2-compressed assets out of the box.
 *
 * While it is the incoming half of a device swap it is mounted `hidden`, and reports through
 * `onReady` once it is not merely loaded but prepared.
 */
function GlbInstance({ spec, finish, screen, gloss = 1.3, hidden, onReady }: GlbProps & { hidden?: boolean; onReady?: () => void }) {
  const gl = useThree((s) => s.gl);
  const maxAniso = gl.capabilities.getMaxAnisotropy();
  const invalidate = useThree((s) => s.invalidate);
  const model = spec.model!;
  const asset = readModel(gl, model.url);
  const gltf = asset.gltf;
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => retainModel(gl, model.url, asset), [gl, model.url, asset]);
  const root = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.updateWorldMatrix(true, true);
    hideInvisibleModelMeshes(clone, findScreenMeshes(clone, model.screenMesh));
    const box = visibleBounds(clone, new THREE.Matrix4());
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
  }, [gltf.scene, model.scale, model.size, model.screenMesh, spec.body.h, spec.body.w]);
  const mounts = useMemo(() => ({ count: 0, root }), [root]);
  const compiling = useMemo(() => ({ tasks: new Set<Promise<unknown>>(), root }), [root]);

  useEffect(() => {
    mounts.count++;
    return () => {
      mounts.count--;
      // Three's compileAsync polls live material programs. Never dispose them under that poll.
      void Promise.allSettled([...compiling.tasks]).then(() => { if (!mounts.count) disposeModelResources(root); });
      if (viewport.glbInfo === root.userData.glbInfo) viewport.glbInfo = null;
    };
  }, [root, mounts, compiling]);

  const view = useShotView();
  const notch = view.notch;
  const casePreference = useEditor((s) => s.project.mockup.caseKeyboard ?? true);
  const caseKeyboard = effectiveKeyboardCase(spec, view.orientation, casePreference);
  const bandColor = useEditor((s) => s.project.mockup.bandColor ?? null);
  const scene = useThree((s) => s.scene);

  // laptop lid follows the (keyframeable) lid angle
  useFrame(() => {
    const f = root.userData.features as DeviceFeatures | undefined;
    if (!f?.lid) return;
    const v = anim.values?.["mockup.lid"] ?? f.lid.natural;
    setLidAngle(f.lid, v);
  }, -25);
  useFrame(() => {
    const info = root.userData.screenReceivers as ReturnType<typeof laptopReceivers> | undefined;
    if (info) updateScreenReceiver(info.receiver);
  }, -17);

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
        const fixed = mats.map((x) => { const c = ownModelResource(root, x.clone()); c.side = THREE.DoubleSide; return c; });
        m.material = Array.isArray(m.material) ? fixed : fixed[0];
        m.userData.mirrored = true;
      });
      // baked shadow catchers: large, flat, horizontal quads lying at the very bottom of the model.
      // Measured in the device's own frame, since the user may already have the mockup rolled and a
      // world-space box would then no longer see the ground quad as flat or as sitting at the bottom.
      const inv = deviceInverse(root);
      const { box: whole, size: wsz } = meshBox(root, inv);
      const explicitHide = new Set(model.hide ?? []);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (explicitHide.has(m.name)) { m.visible = false; return; }
        const { box: b, size: sz } = meshBox(m, inv);
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
        // measure in the device's own frame: the user may already have the mockup rotated
        const n = meshFrame(screens[0]).axes[2].clone().transformDirection(inv).normalize();
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
        // published in the device's own frame; the scene re-applies the live yaw itself
        const { center: c, n: d } = screenFrame(screens[0]);
        anim.screenPos = [c.x, c.y, c.z];
        anim.screenDir = [d.x, d.y, d.z];
      }
      const features = detectFeatures(root, screens[0] ?? null, spec, scene);
      root.userData.features = features;
      if (screens[0]) {
        const frame = screenFrame(screens[0]);
        const world = frame.inv.clone().invert().multiply(new THREE.Matrix4().makeBasis(frame.right, frame.up, frame.n).setPosition(frame.center));
        addDisplaySeamBacking(root, spec.id, screens[0], world);
      }
      if (spec.family === "laptop" && screens[0]) {
        let frame: THREE.Object3D = root;
        while (frame.parent && frame.name !== "device-orientation" && frame.name !== "device") frame = frame.parent;
        root.userData.screenReceivers = laptopReceivers(root, screens[0], features.lid?.pivot ?? null, frame);
      }
      const flags: ModelFeatures = { lid: !!features.lid, island: features.island.length > 0, caseParts: features.caseParts.length > 0, band: features.band.length > 0 };
      useModelBounds.getState().set(spec.id, { features: flags });
    }
    const screens = root.userData.screens as THREE.Mesh[];
    const features = root.userData.features as DeviceFeatures;
    const receivers = root.userData.screenReceivers as ReturnType<typeof laptopReceivers> | undefined;
    // toggles: Dynamic Island, keyboard case (tablet lies flat facing the camera without it), band tint
    for (const m of features.island) m.visible = notch;
    applyKeyboardCase(root, features.caseParts, features.tilt, caseKeyboard);
    viewport.glbInfo = root.userData.glbInfo = () => {
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
      if (mesh.userData.displaySeamBacking) return;
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
        mesh.material = tintBandMaterials(root, mesh, original, bandColor);
        return;
      }
      // Body gloss and finish colour, both written onto one clone per source material that is
      // cached on the mesh. The tint used to clone again on every pass, which leaked a material per
      // gloss step and skipped multi-material meshes entirely.
      const src = (Array.isArray(original) ? original : [original]) as THREE.Material[];
      const cache = (mesh.userData.tuned ??= new Map<THREE.Material, THREE.MeshStandardMaterial>()) as Map<THREE.Material, THREE.MeshStandardMaterial>;
      const tuned = src.map((x) => {
        const std = x as THREE.MeshStandardMaterial;
        const tintable = finishNames.has(std.name) && "color" in std;
        if (!("envMapIntensity" in std) && !tintable) return x;
        let t = cache.get(x);
        if (!t) {
          t = ownModelResource(root, std.clone());
          t.userData.baseRoughness = std.roughness;
          t.userData.baseEnvIntensity = std.envMapIntensity;
          t.userData.baseColor = "color" in std ? std.color.clone() : null;
          // Filter detail at grazing angles without requesting generated mip levels from KTX2
          // textures. Compressed textures carry their own chain; a single-level asset must use
          // linear sampling, otherwise WebGL can treat the texture as incomplete.
          for (const map of [t.normalMap, t.map, t.roughnessMap, t.metalnessMap, t.aoMap]) {
            if (!map) continue;
            const compressed = (map as THREE.CompressedTexture).isCompressedTexture;
            const canMip = !compressed || map.mipmaps.length > 1;
            const minFilter = canMip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
            const generateMipmaps = !compressed && map.mipmaps.length === 0;
            if (map.anisotropy !== maxAniso || map.minFilter !== minFilter ||
                map.magFilter !== THREE.LinearFilter || map.generateMipmaps !== generateMipmaps) {
              map.anisotropy = maxAniso;
              map.minFilter = minFilter;
              map.magFilter = THREE.LinearFilter;
              map.generateMipmaps = generateMipmaps;
              map.needsUpdate = true;
            }
          }
          applyMaterialProfile(spec.id, t);
          addMetalSurfaceDetail(t);
          addEnvironmentGain(t);
          if (receivers?.meshes.has(mesh)) installScreenSpill(t, receivers.receiver);
          cache.set(x, t);
        }
        const baseColor = t.userData.baseColor as THREE.Color | null;
        if (tintable) t.color.set(finish.color);
        else if (baseColor && "color" in t) t.color.copy(baseColor);
        if ("envMapIntensity" in t) {
          const base = t.userData.baseRoughness as number;
          const metal = t.metalness >= 0.45;
          const coated = (t as THREE.MeshPhysicalMaterial).clearcoat > 0;
          const glass = !metal && base < 0.14;
          const polishable = metal || coated || glass;
          // Body gloss controls reflective finishes. Keys, antenna strips and rubber retain their
          // authored roughness instead of becoming plastic-looking versions of the metal body.
          const envGain = polishable ? gloss : 1 + (gloss - 1) * 0.2;
          t.envMapIntensity = (t.userData.baseEnvIntensity as number) * envGain;
          const polished = base * (polishable ? Math.max(0.76, 1 - (gloss - 1) * 0.12) : 1);
          const floor = t.normalMap && metal ? Math.min(base, 0.22) : Math.min(base, 0.025);
          t.roughness = Math.max(floor, Math.min(1, polished));
        }
        t.fog = false;
        return t;
      });
      mesh.material = tuned.length === 1 ? tuned[0] : tuned;
    });
    invalidate();
  }, [root, model.screenMesh, model.screenInset, model.finishMaterials, model.hide, model.autoYaw, model.hideOverlays, model.rotation, finish.id, finish.color, screen, invalidate, gloss, spec.id, spec.screenPx, spec, scene, notch, caseKeyboard, bandColor, maxAniso]);

  // Publish the real footprint so floors, shadows and framing use it. It is declared after the
  // effect above because that one decides what is visible and how far a tablet leans back, and a
  // measurement taken before it would be one toggle behind.
  const yawApplied = (root.getObjectByName("autoYaw") as THREE.Group | undefined)?.rotation.y ?? 0;
  useEffect(() => {
    root.updateWorldMatrix(true, true);
    // in the device's own frame, so the mockup rotation the user set never moves the floor
    const inv = deviceInverse(root);
    const b = visibleBounds(root, inv, new THREE.Box3(), true);
    const sz = new THREE.Vector3();
    b.getSize(sz);
    useModelBounds.getState().set(spec.id, { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, width: sz.x, height: sz.y });
  }, [root, spec.id, yawApplied, caseKeyboard]);

  // Declared after both effects above, so a model is only ever announced once its screen, its
  // movable parts and its materials are in place — never as a frame of raw geometry.
  useEffect(() => {
    const controller = new AbortController();
    const release = retainModel(gl, model.url, asset);
    const task = prepareModelGpu(gl, root, camera, scene, controller.signal);
    compiling.tasks.add(task);
    void task.then(() => { if (!controller.signal.aborted) { onReady?.(); invalidate(); } }, (error: unknown) => {
      if (!controller.signal.aborted) useUI.getState().showToast(`Could not prepare ${spec.name}: ${error instanceof Error ? error.message : "GPU preparation failed"}`);
    }).finally(() => { compiling.tasks.delete(task); release(); });
    return () => controller.abort();
  }, [root, gl, camera, scene, asset, model.url, spec.name, onReady, invalidate, compiling]);

  return <primitive object={root} visible={!hidden} rotation={model.rotation ?? [0, 0, 0]} position={model.position ?? [0, 0, 0]} />;
}

/**
 * Picking a different device never empties the viewport: the model already on screen keeps
 * rendering while the incoming one downloads and prepares itself out of sight, and the two trade
 * places in a single commit once it is ready.
 */
export function GlbDevice({ spec, finish, screen, gloss = 1.3 }: GlbProps) {
  const gl = useThree((s) => s.gl);
  // the model the viewport is showing, and the one being brought in behind it; they differ only
  // for as long as a newly picked device takes to load
  const [shown, setShown] = useState(spec);
  const [staged, setStaged] = useState(spec);
  const requested = useRef(spec);
  useLayoutEffect(() => { requested.current = spec; }, [spec]);
  const promote = useCallback(() => { if (staged === requested.current) setShown(staged); }, [staged]);
  // the rest of the scene frames and sizes itself to whatever is actually on screen
  useEffect(() => { useShownDevice.getState().set(shown.id); }, [shown.id]);
  useEffect(() => () => useShownDevice.getState().set(null), []);

  useEffect(() => {
    if (staged === spec) return;
    // Start the download here rather than leaving it to the render below, so the loading manager —
    // which drives the viewport's pill and the wait an export does before it encodes — knows the
    // model is on its way the moment the device changes.
    const incoming = acquireModel(gl, spec.model!.url);
    // The incoming model suspends while it loads. Inside a transition React leaves the committed
    // scene alone until it resolves, instead of swapping in the empty Suspense fallback above us,
    // and that is what keeps the editor from going blank.
    let cancelled = false;
    void incoming.asset.promise.then(() => {
      if (cancelled) return;
      if (incoming.asset.error) { useUI.getState().showToast(`Could not load ${spec.name}. The previous device is still shown.`); return; }
      startTransition(() => setStaged(spec));
    });
    return () => { cancelled = true; incoming.release(); };
  }, [spec, staged, gl]);

  // The finish and gloss the visible model keeps on its way out. A newly picked device brings its
  // own finish with it, and re-tinting the outgoing model would flash a colour it never had.
  const held = useRef({ finish, gloss });
  useEffect(() => { if (shown === spec) held.current = { finish, gloss }; });
  const out = shown === spec ? { finish, gloss } : held.current;

  // One keyed list rather than two slots, so the prepared model is reused — not remounted and
  // loaded again — when it takes the visible place of the one it replaces.
  const models = [<GlbInstance key={shown.id} spec={shown} finish={out.finish} screen={screen} gloss={out.gloss} />];
  if (staged !== shown) models.push(<GlbInstance key={staged.id} spec={staged} finish={finish} screen={screen} gloss={gloss} hidden onReady={promote} />);
  return <>{models}</>;
}
