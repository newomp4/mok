"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedPlaneGeometry } from "@/three/geometry";
import { bulgeProfile, contourProfile, pillProfile, sweepRoundedRect } from "@/three/sweep";
import type { FinishMaterials } from "@/three/materials";

function knurledCrown(radius: number, length: number, teeth = 36): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0, -length / 2));
  pts.push(new THREE.Vector2(radius * 0.86, -length / 2));
  pts.push(new THREE.Vector2(radius, -length / 2 + length * 0.12));
  pts.push(new THREE.Vector2(radius, length / 2 - length * 0.12));
  pts.push(new THREE.Vector2(radius * 0.86, length / 2));
  pts.push(new THREE.Vector2(0, length / 2));
  const geo = new THREE.LatheGeometry(pts, teeth);
  // pinch every other segment to fake knurling
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / pts.length);
    if (seg % 2 === 1) {
      const x = pos.getX(i), z = pos.getZ(i);
      const rr = Math.hypot(x, z);
      if (rr > radius * 0.9) { const k = 0.93; pos.setX(i, x * k); pos.setZ(i, z * k); }
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function WatchModel({ spec, mats, screen }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material }) {
  const { w, h, d, r } = spec.body;
  const [sw, sh] = spec.screenMm;
  const ultra = spec.id.includes("ultra");
  const geos = useMemo(() => {
    const body = ultra
      ? sweepRoundedRect(w * S, h * S, r * S, contourProfile(d * S, 1.2 * S, 2.6 * S, 6), { cornerSegments: 16 })
      : sweepRoundedRect(w * S, h * S, r * S, bulgeProfile(d * S, 1.4 * S, 0.55 * S, 3.6 * S, 12), { cornerSegments: 16 });
    const glass = roundedPlaneGeometry((w - 2.4) * S, (h - 2.4) * S, (r - 1.2) * S, 28);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 28);
    const strapLen = 44;
    const strap = sweepRoundedRect(w * 0.58 * S, strapLen * S, 5 * S, pillProfile(3.4 * S, 8), { cornerSegments: 10 });
    const lug = sweepRoundedRect(w * 0.6 * S, 5 * S, 1.5 * S, contourProfile(4 * S, 1 * S, 1 * S, 4), { cornerSegments: 6 });
    const crown = knurledCrown(3.3 * S, 2.8 * S);
    crown.rotateZ(Math.PI / 2);
    const crownCap = new THREE.CylinderGeometry(2.4 * S, 2.4 * S, 0.5 * S, 32);
    crownCap.rotateZ(Math.PI / 2);
    const btn = sweepRoundedRect(3.6 * S, 12 * S, 1.2 * S, [{ o: -0.5 * S, z: 1.1 * S }, { o: 0, z: 0.6 * S }, { o: 0, z: 0 }], { cornerSegments: 6 });
    const sensor = new THREE.SphereGeometry(w * 0.34 * S, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.3);
    sensor.rotateX(-Math.PI / 2);
    sensor.translate(0, 0, w * 0.34 * S * (1 - Math.cos(Math.PI * 0.3)) - w * 0.34 * S * 0.1);
    const ring = new THREE.TorusGeometry(w * 0.3 * S, 0.4 * S, 10, 48);
    const hole = new THREE.CylinderGeometry(1.1 * S, 1.1 * S, 4 * S, 12);
    hole.rotateX(Math.PI / 2);
    return { body, glass, scr, strap, lug, crown, crownCap, btn, sensor, ring, hole, strapLen };
  }, [w, h, d, r, sw, sh, spec.screenRadius, ultra]);
  const crownMat = useMemo(() => new THREE.MeshStandardMaterial({ color: ultra ? "#e0632f" : mats.frame.color, metalness: 1, roughness: 0.28 }), [ultra, mats.frame.color]);
  const sensorMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#0b0b0d", roughness: 0.08, clearcoat: 1, metalness: 0.2 }), []);
  const holeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.9 }), []);
  const front = (d / 2) * S;
  const strapY = (h / 2 + geos.strapLen / 2 - 1) * S;
  return (
    <group>
      <mesh geometry={geos.body} material={mats.frame} castShadow receiveShadow />
      <mesh geometry={geos.glass} material={mats.glass} position={[0, 0, front + 0.05 * S]} />
      <mesh geometry={geos.scr} material={screen} position={[0, 0, front + 0.3 * S]} />
      <mesh geometry={geos.sensor} material={sensorMat} position={[0, 0, -front - w * 0.34 * S * (1 - Math.cos(Math.PI * 0.3)) + 1.2 * S]} />
      <mesh geometry={geos.ring} material={mats.lensRing} position={[0, 0, -front - 0.15 * S]} />
      {/* lugs + straps */}
      {[1, -1].map((sy) => (
        <group key={sy} position={[0, sy * (h / 2 - 1) * S, -0.6 * S]}>
          <mesh geometry={geos.lug} material={mats.frame} position={[0, sy * 2.5 * S, 0]} />
          <mesh geometry={geos.strap} material={mats.band} position={[0, sy * (geos.strapLen / 2 + 1) * S, 0]} rotation={[-sy * 0.07, 0, 0]} castShadow />
          {sy < 0 && [0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} geometry={geos.hole} material={holeMat} position={[0, -(14 + i * 5.5) * S, 0]} />
          ))}
        </group>
      ))}
      {/* crown + button */}
      <mesh geometry={geos.crown} material={crownMat} position={[(w / 2 + 0.9) * S, (ultra ? 6 : 8) * S, 0]} />
      <mesh geometry={geos.crownCap} material={mats.dark} position={[(w / 2 + 2.5) * S, (ultra ? 6 : 8) * S, 0]} />
      <mesh geometry={geos.btn} material={mats.frame} position={[(w / 2 - 0.1) * S, -5 * S, 0]} rotation={[0, Math.PI / 2, 0]} />
      {ultra && <mesh geometry={geos.btn} material={crownMat} position={[-(w / 2 - 0.1) * S, 3 * S, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[1.2, 1.4, 1.3]} />}
    </group>
  );
}
