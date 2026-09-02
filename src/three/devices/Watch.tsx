"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedBoxGeometry, roundedPlaneGeometry } from "@/three/geometry";
import type { FinishMaterials } from "@/three/materials";

export function WatchModel({ spec, mats, screen }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material }) {
  const { w, h, d, r } = spec.body;
  const [sw, sh] = spec.screenMm;
  const ultra = spec.id.includes("ultra");
  const geos = useMemo(() => {
    const body = roundedBoxGeometry(w * S, h * S, d * S, r * S, (ultra ? 1.6 : 3.2) * S, 32, 8);
    const glass = roundedPlaneGeometry((w - 1.2) * S, (h - 1.2) * S, (r - 0.6) * S, 32);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 32);
    const strapLen = 42;
    const strap = roundedBoxGeometry(w * 0.56 * S, strapLen * S, 3.2 * S, 5 * S, 1.2 * S, 16, 4);
    const crown = new THREE.CylinderGeometry(3.4 * S, 3.4 * S, 2.6 * S, 32);
    crown.rotateZ(Math.PI / 2);
    const crownRing = new THREE.CylinderGeometry(3.6 * S, 3.6 * S, 0.5 * S, 32);
    crownRing.rotateZ(Math.PI / 2);
    const btn = roundedBoxGeometry(1.4 * S, 12 * S, 3.5 * S, 0.6 * S, 0.3 * S, 8, 2);
    const back = new THREE.CylinderGeometry(w * 0.36 * S, w * 0.36 * S, 0.9 * S, 40);
    back.rotateX(Math.PI / 2);
    return { body, glass, scr, strap, crown, crownRing, btn, back, strapLen };
  }, [w, h, d, r, sw, sh, spec.screenRadius, ultra]);
  const crownMat = useMemo(() => new THREE.MeshStandardMaterial({ color: ultra ? "#e0632f" : mats.frame.color, metalness: 1, roughness: 0.3 }), [ultra, mats.frame.color]);
  const sensorMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#0b0b0d", roughness: 0.1, clearcoat: 1 }), []);
  const front = (d / 2) * S;
  return (
    <group>
      <mesh geometry={geos.body} material={mats.frame} castShadow receiveShadow />
      <mesh geometry={geos.glass} material={mats.glass} position={[0, 0, front + 0.02 * S]} />
      <mesh geometry={geos.scr} material={screen} position={[0, 0, front + 0.06 * S]} />
      <mesh geometry={geos.back} material={sensorMat} position={[0, 0, -front - 0.2 * S]} />
      {/* straps */}
      <mesh geometry={geos.strap} material={mats.band} position={[0, (h / 2 + geos.strapLen / 2 - 3) * S, 0]} rotation={[-0.06, 0, 0]} castShadow />
      <mesh geometry={geos.strap} material={mats.band} position={[0, -(h / 2 + geos.strapLen / 2 - 3) * S, 0]} rotation={[0.06, 0, 0]} castShadow />
      {/* crown + button */}
      <mesh geometry={geos.crown} material={crownMat} position={[(w / 2 + 1.1) * S, 8 * S, 0]} />
      <mesh geometry={geos.crownRing} material={mats.dark} position={[(w / 2 + 2.5) * S, 8 * S, 0]} />
      <mesh geometry={geos.btn} material={mats.frame} position={[(w / 2 + 0.5) * S, -5 * S, 0]} />
      {ultra && <mesh geometry={geos.btn} material={crownMat} position={[-(w / 2 + 0.6) * S, 2 * S, 0]} scale={[1.2, 1.3, 1]} />}
    </group>
  );
}
