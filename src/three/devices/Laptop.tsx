"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedPlaneGeometry } from "@/three/geometry";
import { contourProfile, sweepRoundedRect } from "@/three/sweep";
import type { FinishMaterials } from "@/three/materials";

const DEG = Math.PI / 180;

/** Physical-style key layout in key units (u). */
const ROWS: { h: number; keys: number[] }[] = [
  { h: 0.55, keys: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  { h: 1, keys: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.55] },
  { h: 1, keys: [1.55, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  { h: 1, keys: [1.85, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.7] },
  { h: 1, keys: [2.4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.15] },
  { h: 1, keys: [1, 1, 1, 1.3, 5.6, 1.3, 1, 1, 1] },
];

function Keyboard({ width, mats }: { width: number; mats: FinishMaterials }) {
  const inst = useMemo(() => {
    const u = width / 14.55;
    const gap = 0.12 * u;
    const geo = sweepRoundedRect(1, 1, 0.09, [{ o: -0.06, z: 1 }, { o: 0, z: 0.94 }, { o: 0, z: 0 }], { cornerSegments: 5 });
    const total = ROWS.reduce((a, r) => a + r.keys.length, 0);
    const m = new THREE.InstancedMesh(geo, mats.keys, total);
    const o = new THREE.Object3D();
    let i = 0;
    let z = 0;
    for (const row of ROWS) {
      const rh = row.h * u;
      const rowW = row.keys.reduce((a, k) => a + k * u, 0);
      let x = -rowW / 2;
      for (const k of row.keys) {
        const kw = k * u;
        o.position.set((x + kw / 2) * S, 0, (z + rh / 2) * S);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.set((kw - gap) * S, (rh - gap) * S, 0.9 * S);
        o.updateMatrix();
        m.setMatrixAt(i++, o.matrix);
        x += kw;
      }
      z += rh;
    }
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true;
    return { mesh: m, height: z, u };
  }, [width, mats.keys]);
  return <primitive object={inst.mesh} position={[0, 0, -(inst.height / 2) * S]} />;
}

function useGrilleMaterial() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = "#000";
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      ctx.beginPath();
      ctx.arc(8 + x * 16 + (y % 2) * 8, 8 + y * 16, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 20);
    return new THREE.MeshStandardMaterial({ color: "#050505", alphaMap: tex, transparent: true, roughness: 0.8, depthWrite: false });
  }, []);
}

export function LaptopModel({ spec, mats, screen }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material }) {
  const { w, h: depth, d: baseT, r } = spec.body;
  const lid = spec.lid!;
  const lidH = depth - 3;
  const [sw, sh] = spec.screenMm;
  const air = spec.id.includes("air");
  const geos = useMemo(() => {
    const base = sweepRoundedRect(w * S, depth * S, r * S, contourProfile(baseT * S, 1.1 * S, Math.min(3.2, baseT * 0.4) * S, 6), { cornerSegments: 14 });
    base.rotateX(-Math.PI / 2);
    const lidGeo = sweepRoundedRect(w * S, lidH * S, r * S, contourProfile(lid.thickness * S, 0.9 * S, 1.3 * S, 5), { cornerSegments: 14 });
    lidGeo.translate(0, (lidH / 2) * S, 0);
    const bezel = roundedPlaneGeometry((w - 2.6) * S, (lidH - 2.6) * S, (r - 1.3) * S, 20);
    bezel.translate(0, (lidH / 2) * S, 0);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 20);
    const trackW = Math.min(w * 0.42, 130), trackH = Math.min(depth * 0.36, 82);
    const trackpad = roundedPlaneGeometry(trackW * S, trackH * S, 3 * S, 10);
    trackpad.rotateX(-Math.PI / 2);
    const notch = spec.notch ? roundedPlaneGeometry(spec.notch.w * S, spec.notch.h * 2 * S, 3.5 * S, 10) : null;
    const hinge = new THREE.CylinderGeometry(baseT * 0.42 * S, baseT * 0.42 * S, w * 0.68 * S, 28);
    hinge.rotateZ(Math.PI / 2);
    const kbW = w * 0.875, kbH = kbW / 14.55 * 5.55;
    const well = roundedPlaneGeometry((kbW + 4) * S, (kbH + 4) * S, 3 * S, 8);
    well.rotateX(-Math.PI / 2);
    const grille = new THREE.PlaneGeometry(((w - kbW) / 2 - 12) * S, kbH * S);
    grille.rotateX(-Math.PI / 2);
    const feet = new THREE.CylinderGeometry(4 * S, 4 * S, 1 * S, 16);
    const lip = roundedPlaneGeometry(40 * S, 3 * S, 1.5 * S, 8);
    lip.rotateX(Math.PI / 2);
    return { base, lidGeo, bezel, scr, trackpad, notch, hinge, well, grille, feet, lip, kbW, kbH, trackH };
  }, [w, depth, baseT, r, lidH, lid.thickness, sw, sh, spec.screenRadius, spec.notch]);
  const wellMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0d0d0f", roughness: 0.6, metalness: 0.15 }), []);
  const trackMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(mats.frame.color).multiplyScalar(0.9), roughness: 0.42, metalness: 0.85 }), [mats.frame.color]);
  const notchMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.4 }), []);
  const feetMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.9 }), []);
  const grilleMat = useGrilleMaterial();
  const top = baseT * S;
  const kbZ = -depth * 0.5 + 14 + geos.kbH / 2; // keyboard centre from base centre (mm)
  const screenY = (lidH - lid.screenTop - sh / 2) * S;
  const notchTopY = (lidH - lid.screenTop + 0.3) * S;
  return (
    <group>
      <mesh geometry={geos.base} material={mats.frame} position={[0, top / 2, 0]} castShadow receiveShadow />
      {/* keyboard well, keys, grilles, trackpad */}
      <mesh geometry={geos.well} material={wellMat} position={[0, top + 0.08 * S, kbZ * S]} />
      <group position={[0, top + 0.3 * S, kbZ * S]}>
        <Keyboard width={geos.kbW} mats={mats} />
      </group>
      {!air && [1, -1].map((sx) => (
        <mesh key={sx} geometry={geos.grille} material={grilleMat} position={[sx * (w / 2 - ((w - geos.kbW) / 2 - 12) / 2 - 8) * S, top + 0.25 * S, kbZ * S]} />
      ))}
      <mesh geometry={geos.trackpad} material={trackMat} position={[0, top + 0.2 * S, (depth / 2 - 12 - geos.trackH / 2) * S]} />
      <mesh geometry={geos.lip} material={wellMat} position={[0, top - 1.2 * S, (depth / 2) * S + 0.02 * S]} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} geometry={geos.feet} material={feetMat} position={[sx * w * 0.43 * S, 0.4 * S, sz * depth * 0.42 * S]} />
      )))}
      <mesh geometry={geos.hinge} material={mats.dark} position={[0, top - 0.5 * S, -(depth / 2 - baseT * 0.45) * S]} />
      <group position={[0, top - 0.3 * S, -(depth / 2 - lid.thickness * 0.55) * S]} rotation={[-(lid.angle - 90) * DEG, 0, 0]}>
        <mesh geometry={geos.lidGeo} material={mats.frame} castShadow receiveShadow />
        <mesh geometry={geos.bezel} material={mats.glass} position={[0, 0, (lid.thickness / 2) * S + 0.05 * S]} />
        <mesh geometry={geos.scr} material={screen} position={[0, screenY, (lid.thickness / 2) * S + 0.32 * S]} />
        {geos.notch && <mesh geometry={geos.notch} material={notchMat} position={[0, notchTopY, (lid.thickness / 2) * S + 0.55 * S]} />}
      </group>
    </group>
  );
}
