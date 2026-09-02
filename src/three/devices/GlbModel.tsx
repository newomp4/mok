"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { DeviceSpec, Finish } from "@/lib/devices";
import { S } from "@/three/geometry";

let ktx2: KTX2Loader | null = null;

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
    const scale = model.scale ?? (spec.body.h * S) / Math.max(1e-6, size.y);
    const holder = new THREE.Group();
    clone.position.sub(center);
    holder.add(clone);
    holder.scale.setScalar(scale);
    return holder;
  }, [gltf.scene, model.scale, spec.body.h]);

  useEffect(() => {
    const finishNames = new Set(model.finishMaterials ?? []);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isScreen = mesh.name === model.screenMesh || mats.some((m) => m.name === model.screenMesh);
      if (isScreen) {
        mesh.material = screen;
        return;
      }
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
