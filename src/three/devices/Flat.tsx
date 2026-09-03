"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedPlaneGeometry } from "@/three/geometry";
import { contourProfile, sweepRoundedRect } from "@/three/sweep";
import type { FinishMaterials } from "@/three/materials";

export function FlatModel({ spec, mats, screen, size, radius, finish }: {
  spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material; size: { w: number; h: number }; radius: number; finish: string;
}) {
  const { w, h } = size;
  const rMm = Math.min(w, h) * radius;
  const edge = finish !== "none";
  const geos = useMemo(() => {
    const t = spec.body.d;
    const body = sweepRoundedRect(w * S, h * S, Math.max(0.05, rMm) * S, contourProfile(t * S, 0.35 * S, 0.35 * S, 3), { cornerSegments: 12 });
    const scr = roundedPlaneGeometry(w * S, h * S, rMm * S, 24);
    return { body, scr, t };
  }, [w, h, rMm, spec.body.d]);
  const edgeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: mats.frame.color, roughness: 0.5, metalness: 0.1 }), [mats.frame.color]);
  // the corner radius rebuilds both meshes on every slider step; drop the old buffers with them
  useEffect(() => () => { geos.body.dispose(); geos.scr.dispose(); }, [geos]);
  useEffect(() => () => { edgeMat.dispose(); }, [edgeMat]);
  return (
    <group>
      {edge && <mesh geometry={geos.body} material={edgeMat} castShadow receiveShadow />}
      <mesh geometry={geos.scr} material={screen} position={[0, 0, (edge ? geos.t / 2 : 0) * S + 0.25 * S]} castShadow />
    </group>
  );
}
