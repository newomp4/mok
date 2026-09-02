"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, pillGeometry, roundedBoxGeometry, roundedPlaneGeometry } from "@/three/geometry";
import type { FinishMaterials } from "@/three/materials";

export function CameraBump({ spec, mats }: { spec: DeviceSpec; mats: FinishMaterials }) {
  const bump = spec.bump;
  const geo = useMemo(() => {
    if (!bump) return null;
    const r = bump.kind === "pill" ? Math.min(bump.w, bump.h) / 2 : bump.kind === "bar" ? bump.h / 2 : bump.kind === "square" ? 7 : 12;
    return roundedBoxGeometry(bump.w * S, bump.h * S, bump.depth * S, r * S, 0.8 * S, 24, 4);
  }, [bump]);
  const lenses = useMemo(() => {
    if (!bump) return [];
    const list: { x: number; y: number; r: number }[] = [];
    const big = spec.family === "tablet" ? 6 : bump.kind === "bar" ? 6.5 : 7.5;
    if (bump.kind === "pill") {
      list.push({ x: 0, y: bump.h / 4, r: big }, { x: 0, y: -bump.h / 4, r: big });
    } else if (bump.kind === "plateau") {
      const cx = -bump.w / 2 + 13;
      list.push({ x: cx, y: bump.h / 4 + 1, r: big }, { x: cx, y: -bump.h / 4 - 1, r: big }, { x: cx + 15, y: 0, r: big });
    } else if (bump.kind === "bar") {
      list.push({ x: -bump.w / 2 + bump.h / 2, y: 0, r: big });
    } else {
      list.push({ x: 0, y: 0, r: big });
    }
    return list;
  }, [bump, spec.family]);
  const lensGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 40), []);
  if (!bump || !geo) return null;
  const d = spec.body.d * S;
  const x = (spec.body.w / 2 - bump.left - bump.w / 2) * S;
  const y = (spec.body.h / 2 - bump.top - bump.h / 2) * S;
  const z = -d / 2 - (bump.depth * S) / 2;
  return (
    <group position={[x, y, z]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={geo} material={mats.back} castShadow />
      {lenses.map((l, i) => (
        <group key={i} position={[l.x * S, l.y * S, (bump.depth * S) / 2]}>
          <mesh geometry={lensGeo} material={mats.lensRing} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * S, 1.6 * S, l.r * S]} position={[0, 0, 0.8 * S]} />
          <mesh geometry={lensGeo} material={mats.lens} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * 0.72 * S, 0.6 * S, l.r * 0.72 * S]} position={[0, 0, 1.9 * S]} />
          <mesh geometry={lensGeo} material={mats.dark} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * 0.42 * S, 0.3 * S, l.r * 0.42 * S]} position={[0, 0, 2.15 * S]} />
        </group>
      ))}
      {bump.kind === "plateau" && (
        <mesh position={[(bump.w / 2 - 9) * S, (bump.h / 4) * S, (bump.depth * S) / 2 + 0.2 * S]} rotation={[Math.PI / 2, 0, 0]} geometry={lensGeo} scale={[3 * S, 0.4 * S, 3 * S]}>
          <meshStandardMaterial color="#f4e9c8" emissive="#c9b68a" emissiveIntensity={0.2} roughness={0.4} />
        </mesh>
      )}
    </group>
  );
}

export function SideButtons({ spec, mats }: { spec: DeviceSpec; mats: FinishMaterials }) {
  const geo = useMemo(() => roundedBoxGeometry(1, 1, 1, 0.3, 0.12, 8, 2), []);
  if (!spec.buttons) return null;
  const { w, h, d } = spec.body;
  const items: { side: 1 | -1; y: number; len: number }[] = [
    { side: 1, y: h / 2 - 40, len: 22 },
    { side: 1, y: h / 2 - 78, len: 11 },
    { side: -1, y: h / 2 - 32, len: 8 },
    { side: -1, y: h / 2 - 48, len: 15 },
    { side: -1, y: h / 2 - 67, len: 15 },
  ];
  return (
    <group>
      {items.map((b, i) => (
        <mesh
          key={i}
          geometry={geo}
          material={mats.frame}
          position={[b.side * (w / 2 + 0.25) * S, b.y * S, 0]}
          scale={[1.4 * S, b.len * S, (d * 0.55) * S]}
          castShadow
        />
      ))}
    </group>
  );
}

export function PhoneModel({ spec, mats, screen, tablet = false }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material; tablet?: boolean }) {
  const { w, h, d, r } = spec.body;
  const [sw, sh] = spec.screenMm;
  const geos = useMemo(() => {
    const bevel = tablet ? 1.4 : 1.15;
    const body = roundedBoxGeometry(w * S, h * S, d * S, r * S, bevel * S, 32, 8);
    const front = roundedPlaneGeometry((w - 1.6) * S, (h - 1.6) * S, (r - 0.8) * S, 32);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 32);
    const island = spec.island ? pillGeometry(spec.island.w * S, spec.island.h * S) : null;
    return { body, front, scr, island };
  }, [w, h, d, r, sw, sh, spec.screenRadius, spec.island, tablet]);
  const islandMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#030304", roughness: 0.35, metalness: 0.1 }), []);
  const frontZ = (d / 2) * S;
  return (
    <group>
      <mesh geometry={geos.body} material={mats.frame} castShadow receiveShadow />
      <mesh geometry={geos.front} material={mats.glass} position={[0, 0, frontZ + 0.02 * S]} />
      <mesh geometry={geos.scr} material={screen} position={[0, 0, frontZ + 0.06 * S]} />
      {geos.island && spec.island && (
        <mesh geometry={geos.island} material={islandMat} position={[0, (sh / 2 - spec.island.top - spec.island.h / 2) * S, frontZ + 0.09 * S]} />
      )}
      {tablet && (
        <mesh position={[0, (h / 2 - 5) * S, frontZ + 0.09 * S]}>
          <circleGeometry args={[1.6 * S, 24]} />
          <meshStandardMaterial color="#0a0a0c" roughness={0.3} />
        </mesh>
      )}
      <mesh geometry={geos.front} material={mats.back} position={[0, 0, -frontZ - 0.02 * S]} rotation={[0, Math.PI, 0]} />
      <CameraBump spec={spec} mats={mats} />
      <SideButtons spec={spec} mats={mats} />
    </group>
  );
}
