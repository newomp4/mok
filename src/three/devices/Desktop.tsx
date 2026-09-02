"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedPlaneGeometry } from "@/three/geometry";
import { contourProfile, pillProfile, sweepRoundedRect } from "@/three/sweep";
import type { FinishMaterials } from "@/three/materials";

export function DesktopModel({ spec, mats, screen }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material }) {
  const { w, h, d, r } = spec.body;
  const [sw, sh] = spec.screenMm;
  const imac = !!spec.chin;
  const standH = imac ? 60 : 90;
  const geos = useMemo(() => {
    const panel = sweepRoundedRect(w * S, h * S, r * S, contourProfile(d * S, 0.8 * S, Math.min(6, d * 0.4) * S, 6), { cornerSegments: 10 });
    const bezel = roundedPlaneGeometry((w - 1.6) * S, (h - 1.6) * S, Math.max(0.5, r - 0.8) * S, 10);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 6);
    const armW = imac ? 150 : 170, armH = imac ? 130 : 140, armT = imac ? 6 : 12;
    const arm = sweepRoundedRect(armW * S, armH * S, 4 * S, pillProfile(armT * S, 6), { cornerSegments: 6 });
    const footW = imac ? 340 : 240, footD = imac ? 170 : 165, footT = imac ? 5 : 6;
    const foot = sweepRoundedRect(footW * S, footD * S, 4 * S, pillProfile(footT * S, 6), { cornerSegments: 6 });
    foot.rotateX(-Math.PI / 2);
    const chin = spec.chin ? roundedPlaneGeometry((w - 1.6) * S, (spec.chin - 4) * S, 2 * S, 6) : null;
    const cam = new THREE.CylinderGeometry(1.4 * S, 1.4 * S, 0.3 * S, 20);
    cam.rotateX(Math.PI / 2);
    return { panel, bezel, scr, arm, foot, chin, cam, armH, armT, footD };
  }, [w, h, d, r, sw, sh, spec.screenRadius, spec.chin, imac]);
  const chinMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(mats.frame.color).lerp(new THREE.Color("#ffffff"), 0.42), roughness: 0.55, metalness: 0.5 }), [mats.frame.color]);
  const bezelLight = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#e4e4e6", roughness: 0.35, clearcoat: 0.6, metalness: 0.1 }), []);
  const camMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.3 }), []);
  const total = (h + standH) * S;
  const panelY = total - (h / 2) * S;
  const front = (d / 2) * S;
  const screenY = imac ? (h / 2 - 11 - sh / 2) * S : 0;
  return (
    <group position={[0, -total / 2, 0]}>
      <mesh geometry={geos.foot} material={mats.frame} position={[0, (imac ? 2.5 : 3) * S, -(imac ? 45 : 30) * S]} receiveShadow castShadow />
      <mesh geometry={geos.arm} material={mats.frame} position={[0, (geos.armH / 2 + 3) * S, -(d / 2 + geos.armT / 2 + 1) * S]} rotation={[imac ? 0 : -0.1, 0, 0]} castShadow />
      <group position={[0, panelY, 0]}>
        <mesh geometry={geos.panel} material={imac ? mats.back : mats.frame} castShadow receiveShadow />
        <mesh geometry={geos.bezel} material={imac ? bezelLight : mats.glass} position={[0, 0, front + 0.06 * S]} />
        <mesh geometry={geos.scr} material={screen} position={[0, screenY, front + 0.45 * S]} />
        <mesh geometry={geos.cam} material={camMat} position={[0, (h / 2 - (imac ? 5.5 : 6.5)) * S, front + 0.7 * S]} />
        {geos.chin && spec.chin && (
          <mesh geometry={geos.chin} material={chinMat} position={[0, (-h / 2 + spec.chin / 2) * S, front + 0.4 * S]} />
        )}
      </group>
    </group>
  );
}
