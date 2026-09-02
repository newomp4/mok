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

/**
 * Find the mesh that should carry the screen: an exact name/material match first,
 * then a keyword match, then the largest thin mesh (a display panel) as a fallback.
 */
export function findScreenMesh(root: THREE.Object3D, hint?: string): THREE.Mesh | null {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const matsOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
  const matNames = (m: THREE.Mesh) => matsOf(m).map((x) => x.name);
  if (hint) {
    const exact = meshes.find((m) => m.name === hint || matNames(m).includes(hint));
    if (exact) return exact;
    const h = hint.toLowerCase();
    const loose = meshes.find((m) => m.name.toLowerCase().includes(h) || matNames(m).some((n) => n.toLowerCase().includes(h)));
    if (loose) return loose;
  }
  root.updateWorldMatrix(true, true);
  const whole = new THREE.Box3().setFromObject(root);
  const wholeSize = new THREE.Vector3();
  whole.getSize(wholeSize);
  const maxDim = Math.max(wholeSize.x, wholeSize.y, wholeSize.z);
  const scored = meshes.map((m) => {
    m.geometry.computeBoundingBox();
    const lb = m.geometry.boundingBox!;
    const ls = new THREE.Vector3();
    lb.getSize(ls);
    const ldims = [ls.x, ls.y, ls.z];
    const thinAxis = ldims.indexOf(Math.min(...ldims));
    const sorted = [...ldims].sort((a, c) => a - c);
    const thin = sorted[0] / Math.max(1e-9, sorted[2]);
    const wb = new THREE.Box3().setFromObject(m);
    const ws = new THREE.Vector3();
    wb.getSize(ws);
    const area = [ws.x, ws.y, ws.z].sort((a, c) => c - a).slice(0, 2).reduce((a, c) => a * c, 1);
    // world-space normal of the thin axis
    const n = new THREE.Vector3(thinAxis === 0 ? 1 : 0, thinAxis === 1 ? 1 : 0, thinAxis === 2 ? 1 : 0).transformDirection(m.matrixWorld);
    const horizontal = Math.abs(n.y) > 0.8; // lying flat like a keyboard deck or a foot
    const kw = SCREEN_RE.test(m.name) || matNames(m).some((x) => SCREEN_RE.test(x));
    const textured = matsOf(m).some((x) => !!(x as THREE.MeshStandardMaterial).map);
    const big = area > maxDim * maxDim * 0.04;
    let score = 0;
    if (thin < 0.08 && big && !horizontal) score = area * (1 + (textured ? 0.5 : 0));
    if (kw) score += area * 3;
    return { m, score };
  }).sort((a, c) => c.score - a.score);
  return scored[0] && scored[0].score > 0 ? scored[0].m : null;
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
  const model = spec.model!;
  const gltf = useGLTF(model.url, true, true, (loader) => {
    if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl);
    loader.setKTX2Loader(ktx2 as never);
  });
  const root = useMemo(() => {
    const clone = gltf.scene.clone(true);
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
    if (!root.userData.screenMesh) {
      root.userData.screenMesh = findScreenMesh(root, model.screenMesh);
      if (root.userData.screenMesh && model.hideOverlays !== false) root.userData.hidden = hideScreenOverlays(root, root.userData.screenMesh as THREE.Mesh);
    }
    const screenMesh = root.userData.screenMesh as THREE.Mesh | null;
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
        const tex = mats.map((x) => { const im = x.map?.image as { width?: number; height?: number } | undefined; return x.map ? `${im?.width ?? "?"}x${im?.height ?? "?"}` : "-"; }).join(",");
        const color = mats.map((x) => (x.color ? "#" + x.color.getHexString() : "-")).join(",");
        mesh.geometry.computeBoundingBox();
        const lsz = new THREE.Vector3(); mesh.geometry.boundingBox!.getSize(lsz);
        const ld = [lsz.x, lsz.y, lsz.z].sort((a, c) => a - c);
        out.push({ name: mesh.name, material: mats.map((x) => x.name).join(","), tex, color, thin: +(ld[0] / Math.max(1e-9, ld[2])).toFixed(3), transparent: mats.some((x) => x.transparent), size: [sz.x, sz.y, sz.z].map((v) => +v.toFixed(3)), center: [c.x, c.y, c.z].map((v) => +v.toFixed(3)), screen: mesh === screenMesh, tris: (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 });
      });
      const whole = new THREE.Box3().setFromObject(root); const ws = new THREE.Vector3(); whole.getSize(ws);
      return { size: [ws.x, ws.y, ws.z].map((v) => +v.toFixed(3)), meshes: out };
    };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.userData.originalMaterial) mesh.userData.originalMaterial = mesh.material;
      const original = mesh.userData.originalMaterial as THREE.Material | THREE.Material[];
      if (mesh === screenMesh) {
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
  }, [root, model.screenMesh, model.finishMaterials, finish.color, screen]);

  return <primitive object={root} rotation={model.rotation ?? [0, 0, 0]} position={model.position ?? [0, 0, 0]} />;
}
