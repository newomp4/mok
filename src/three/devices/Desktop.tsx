"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedBoxGeometry, roundedPlaneGeometry } from "@/three/geometry";
import type { FinishMaterials } from "@/three/materials";

export function DesktopModel({ spec, mats, screen }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material }) {
  const { w, h, d, r } = spec.body;
  const [sw, sh] = spec.screenMm;
  const imac = !!spec.chin;
  const standH = imac ? 60 : 90;
  const geos = useMemo(() => {
    const panel = roundedBoxGeometry(w * S, h * S, d * S, r * S, 1.6 * S, 16, 5);
    const bezel = roundedPlaneGeometry((w - 2) * S, (h - 2) * S, (r - 1) * S, 16);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 8);
    const armW = imac ? 150 : 170, armH = imac ? 120 : 130, armT = imac ? 6 : 10;
    const arm = roundedBoxGeometry(armW * S, armH * S, armT * S, 4 * S, 1 * S, 8, 3);
    const footW = imac ? 340 : 240, footD = imac ? 170 : 165;
    const foot = roundedBoxGeometry(footW * S, footD * S, 6 * S, 4 * S, 1 * S, 8, 3);
    foot.rotateX(-Math.PI / 2);
    const chin = spec.chin ? roundedPlaneGeometry((w - 2) * S, (spec.chin - 6) * S, 2 * S, 6) : null;
    return { panel, bezel, scr, arm, foot, chin, armH, armT };
  }, [w, h, d, r, sw, sh, spec.screenRadius, spec.chin, imac]);
  const chinMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(mats.frame.color).lerp(new THREE.Color("#ffffff"), 0.35), roughness: 0.5, metalness: 0.6 }), [mats.frame.color]);
  const total = (h + standH) * S;
  const panelY = total - (h / 2) * S; // panel center from floor
  const front = (d / 2) * S;
  const screenY = imac ? (h / 2 - 9 - sh / 2) * S : 0;
  return (
    <group position={[0, -total / 2, 0]}>
      {/* stand */}
      <mesh geometry={geos.foot} material={mats.frame} position={[0, 3 * S, -(imac ? 30 : 10) * S]} receiveShadow castShadow />
      <mesh geometry={geos.arm} material={mats.frame} position={[0, (geos.armH / 2 + 4) * S, -(d / 2 + geos.armT / 2 - 2) * S]} rotation={[imac ? 0 : -0.06, 0, 0]} castShadow />
      {/* panel */}
      <group position={[0, panelY, 0]}>
        <mesh geometry={geos.panel} material={imac ? mats.back : mats.frame} castShadow receiveShadow />
        <mesh geometry={geos.bezel} material={mats.glass} position={[0, 0, front + 0.02 * S]} />
        <mesh geometry={geos.scr} material={screen} position={[0, screenY, front + 0.06 * S]} />
        {geos.chin && spec.chin && (
          <mesh geometry={geos.chin} material={chinMat} position={[0, (-h / 2 + spec.chin / 2) * S, front + 0.05 * S]} />
        )}
      </group>
    </group>
  );
}
