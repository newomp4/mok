"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, pillGeometry, roundedPlaneGeometry } from "@/three/geometry";
import { contourProfile, domeProfile, sweepRoundedRect } from "@/three/sweep";
import type { FinishMaterials } from "@/three/materials";

const lensGeoCache = new THREE.CylinderGeometry(1, 1, 1, 48);
const holeGeo = new THREE.CylinderGeometry(1, 1, 1, 12);

function Holes({ count, spacing, radius, position, rotation, material, depth = 0.7 }: { count: number; spacing: number; radius: number; position: [number, number, number]; rotation?: [number, number, number]; material: THREE.Material; depth?: number }) {
  const inst = useMemo(() => {
    const m = new THREE.InstancedMesh(holeGeo, material, count);
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      o.position.set((i - (count - 1) / 2) * spacing * S, 0, 0);
      o.scale.set(radius * S, depth * S, radius * S);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [count, spacing, radius, material, depth]);
  return <primitive object={inst} position={position} rotation={rotation ?? [0, 0, 0]} />;
}

export function CameraBump({ spec, mats }: { spec: DeviceSpec; mats: FinishMaterials }) {
  const bump = spec.bump;
  const geo = useMemo(() => {
    if (!bump) return null;
    const r = bump.kind === "pill" ? Math.min(bump.w, bump.h) / 2 : bump.kind === "bar" ? bump.h / 2 : bump.kind === "square" ? 6.5 : 12;
    const g = sweepRoundedRect(bump.w * S, bump.h * S, r * S, domeProfile(bump.depth * S, Math.min(1.1, bump.depth * 0.45) * S), { cornerSegments: 14 });
    return g;
  }, [bump]);
  const lenses = useMemo(() => {
    if (!bump) return { lenses: [] as { x: number; y: number; r: number }[], flash: null as { x: number; y: number } | null, dots: [] as { x: number; y: number; r: number }[] };
    const big = spec.family === "tablet" ? 6.2 : bump.kind === "bar" ? 6.6 : 7.6;
    if (bump.kind === "pill") {
      return { lenses: [{ x: 0, y: bump.h / 4 + 0.5, r: big }, { x: 0, y: -bump.h / 4 - 0.5, r: big }], flash: { x: bump.w / 2 + 6, y: bump.h / 4 + 2 }, dots: [{ x: bump.w / 2 + 6, y: -1.5, r: 1 }] };
    }
    if (bump.kind === "plateau") {
      const cx = -bump.w / 2 + 12.5;
      return {
        lenses: [{ x: cx, y: bump.h / 4 + 0.5, r: big }, { x: cx, y: -bump.h / 4 - 0.5, r: big }, { x: cx + 15.5, y: 0, r: big }],
        flash: { x: bump.w / 2 - 10, y: bump.h / 4 + 1 },
        dots: [{ x: bump.w / 2 - 10, y: -bump.h / 4 - 1, r: 2.6 }, { x: bump.w / 2 - 20, y: -bump.h / 4 - 1, r: 1 }],
      };
    }
    if (bump.kind === "bar") return { lenses: [{ x: -bump.w / 2 + bump.h / 2, y: 0, r: big }], flash: { x: bump.w / 2 - 8, y: 0 }, dots: [{ x: 0, y: 0, r: 1 }] };
    return { lenses: [{ x: 0, y: 0, r: big }], flash: { x: bump.w / 2 + 5, y: 0 }, dots: [] };
  }, [bump, spec.family]);
  const lensElement = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#12101c", metalness: 0.4, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 }), []);
  const flashMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#f2e6c4", emissive: "#a89463", emissiveIntensity: 0.15, roughness: 0.25, clearcoat: 1 }), []);
  if (!bump || !geo) return null;
  const d = spec.body.d * S;
  const x = (spec.body.w / 2 - bump.left - bump.w / 2) * S;
  const y = (spec.body.h / 2 - bump.top - bump.h / 2) * S;
  const top = bump.depth * S;
  return (
    <group position={[x, y, -d / 2 + 0.01 * S]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={geo} material={bump.kind === "plateau" ? mats.frame : mats.back} castShadow />
      {lenses.lenses.map((l, i) => (
        <group key={i} position={[l.x * S, l.y * S, top]}>
          <mesh geometry={lensGeoCache} material={mats.lensRing} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * S, 1.7 * S, l.r * S]} position={[0, 0, 0.85 * S]} />
          <mesh geometry={lensGeoCache} material={mats.dark} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * 0.86 * S, 0.5 * S, l.r * 0.86 * S]} position={[0, 0, 1.7 * S]} />
          <mesh geometry={lensGeoCache} material={mats.lens} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * 0.74 * S, 0.5 * S, l.r * 0.74 * S]} position={[0, 0, 1.95 * S]} />
          <mesh geometry={lensGeoCache} material={lensElement} rotation={[Math.PI / 2, 0, 0]} scale={[l.r * 0.42 * S, 0.5 * S, l.r * 0.42 * S]} position={[0, 0, 2.1 * S]} />
        </group>
      ))}
      {lenses.flash && (
        <mesh geometry={lensGeoCache} material={flashMat} rotation={[Math.PI / 2, 0, 0]} scale={[3 * S, 0.5 * S, 3 * S]} position={[lenses.flash.x * S, lenses.flash.y * S, top + 0.2 * S]} />
      )}
      {lenses.dots.map((p, i) => (
        <mesh key={i} geometry={lensGeoCache} material={mats.dark} rotation={[Math.PI / 2, 0, 0]} scale={[p.r * S, 0.5 * S, p.r * S]} position={[p.x * S, p.y * S, top + 0.2 * S]} />
      ))}
    </group>
  );
}

export function SideButtons({ spec, mats }: { spec: DeviceSpec; mats: FinishMaterials }) {
  const { w, h, d } = spec.body;
  const thick = Math.min(3.6, d * 0.46);
  const geo = useMemo(() => sweepRoundedRect(thick * S, 1, 1.2 * S, domeProfile(0.9 * S, 0.5 * S), { cornerSegments: 8 }), [thick]);
  const flushGeo = useMemo(() => sweepRoundedRect(thick * 0.9 * S, 1, 1.0 * S, domeProfile(0.35 * S, 0.3 * S), { cornerSegments: 8 }), [thick]);
  const flushMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#1b1b1e", metalness: 0.3, roughness: 0.15, clearcoat: 1 }), []);
  if (!spec.buttons) return null;
  const tablet = spec.family === "tablet";
  const items: { side: 1 | -1; y: number; len: number; flush?: boolean }[] = tablet
    ? [{ side: 1, y: h / 2 - 28, len: 12 }, { side: 1, y: h / 2 - 44, len: 12 }]
    : [
        { side: 1, y: h / 2 - 39, len: 21 },
        { side: 1, y: h / 2 - 82, len: 12, flush: true },
        { side: -1, y: h / 2 - 34, len: 8 },
        { side: -1, y: h / 2 - 52, len: 14 },
        { side: -1, y: h / 2 - 70, len: 14 },
      ];
  return (
    <group>
      {items.map((b, i) => (
        <mesh
          key={i}
          geometry={b.flush ? flushGeo : geo}
          material={b.flush ? flushMat : mats.frame}
          position={[b.side * (w / 2 - 0.02) * S, b.y * S, 0]}
          rotation={[0, (b.side * Math.PI) / 2, 0]}
          scale={[1, b.len * S, 1]}
          castShadow
        />
      ))}
    </group>
  );
}

export function PhoneModel({ spec, mats, screen, tablet = false }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material; tablet?: boolean }) {
  const { w, h, d, r } = spec.body;
  const [sw, sh] = spec.screenMm;
  const e = spec.edge ?? (tablet ? 1.3 : 1.7);
  const geos = useMemo(() => {
    const body = sweepRoundedRect(w * S, h * S, r * S, contourProfile(d * S, e * S, e * S, 7), { cornerSegments: 16 });
    const glass = roundedPlaneGeometry((w - 2 * e + 0.5) * S, (h - 2 * e + 0.5) * S, (r - e + 0.25) * S, 24);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 28);
    const island = spec.island ? pillGeometry(spec.island.w * S, spec.island.h * S) : null;
    const earpiece = roundedPlaneGeometry((tablet ? 0 : 11) * S, 0.9 * S, 0.45 * S, 6);
    const port = roundedPlaneGeometry(8.9 * S, 3.2 * S, 1.5 * S, 10);
    port.rotateX(Math.PI / 2);
    const antenna = new THREE.BoxGeometry(0.55 * S, (d - 2 * e) * S, 0.12 * S);
    return { body, glass, scr, island, earpiece, port, antenna };
  }, [w, h, d, r, e, sw, sh, spec.screenRadius, spec.island, tablet]);
  const islandMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.3, metalness: 0.1 }), []);
  const portMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0a0a0b", roughness: 0.6 }), []);
  const antennaMat = useMemo(() => {
    const c = new THREE.Color(mats.frame.color);
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    c.lerp(new THREE.Color(l > 0.5 ? "#8a8a8c" : "#d0d0d2"), 0.55);
    return new THREE.MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.6 });
  }, [mats.frame.color]);
  const frontZ = (d / 2) * S;
  const antennaY = (h / 2 - (tablet ? 30 : 18)) * S;
  return (
    <group>
      <mesh geometry={geos.body} material={mats.frame} castShadow receiveShadow />
      <mesh geometry={geos.glass} material={mats.glass} position={[0, 0, frontZ + 0.05 * S]} />
      <mesh geometry={geos.scr} material={screen} position={[0, 0, frontZ + 0.32 * S]} />
      {geos.island && spec.island && (
        <mesh geometry={geos.island} material={islandMat} position={[0, (sh / 2 - spec.island.top - spec.island.h / 2) * S, frontZ + 0.55 * S]} />
      )}
      {!tablet && <mesh geometry={geos.earpiece} material={portMat} position={[0, (h / 2 - 2.2) * S, frontZ + 0.45 * S]} />}
      {tablet && (
        <mesh geometry={lensGeoCache} material={islandMat} rotation={[Math.PI / 2, 0, 0]} scale={[1.6 * S, 0.3 * S, 1.6 * S]} position={[0, (h / 2 - 4.5) * S, frontZ + 0.45 * S]} />
      )}
      <mesh geometry={geos.glass} material={mats.back} position={[0, 0, -frontZ - 0.05 * S]} rotation={[0, Math.PI, 0]} />
      <CameraBump spec={spec} mats={mats} />
      <SideButtons spec={spec} mats={mats} />
      {/* bottom edge: port + speaker / mic holes */}
      <mesh geometry={geos.port} material={portMat} position={[0, -(h / 2) * S - 0.03 * S, 0]} />
      <Holes count={6} spacing={2.1} radius={0.55} position={[13 * S, -(h / 2) * S - 0.01 * S, 0]} material={portMat} />
      <Holes count={6} spacing={2.1} radius={0.55} position={[-13 * S, -(h / 2) * S - 0.01 * S, 0]} material={portMat} />
      {tablet && (
        <>
          <Holes count={6} spacing={2.1} radius={0.55} position={[(w / 2 - 22) * S, (h / 2) * S + 0.01 * S, 0]} material={portMat} />
          <Holes count={6} spacing={2.1} radius={0.55} position={[-(w / 2 - 22) * S, (h / 2) * S + 0.01 * S, 0]} material={portMat} />
        </>
      )}
      {/* antenna lines */}
      {!tablet && [1, -1].map((sx) => [1, -1].map((sy) => (
        <mesh key={`${sx}${sy}`} geometry={geos.antenna} material={antennaMat} position={[sx * (w / 2) * S, sy * antennaY, 0]} rotation={[0, Math.PI / 2, 0]} />
      )))}
    </group>
  );
}
