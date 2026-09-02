"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { DeviceSpec } from "@/lib/devices";
import { S, roundedBoxGeometry, roundedPlaneGeometry } from "@/three/geometry";
import type { FinishMaterials } from "@/three/materials";

const DEG = Math.PI / 180;

function Keyboard({ spec, mats }: { spec: DeviceSpec; mats: FinishMaterials }) {
  const { w, h } = spec.body;
  const kbW = w * 0.85, kbH = h * 0.42;
  const cols = 14, rows = 6;
  const keyW = kbW / cols - 1.2, keyH = kbH / rows - 1.2;
  const geo = useMemo(() => roundedBoxGeometry(keyW * S, keyH * S, 0.9 * S, 1.2 * S, 0.3 * S, 6, 2), [keyW, keyH]);
  const inst = useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mats.keys, cols * rows);
    const o = new THREE.Object3D();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -kbW / 2 + (c + 0.5) * (kbW / cols);
        const z = -kbH / 2 + (r + 0.5) * (kbH / rows);
        const wide = r === rows - 1 && c >= 4 && c <= 9; // spacebar row
        if (wide && c !== 4) { o.scale.set(0, 0, 0); }
        else o.scale.set(wide ? 6 : 1, 1, 1);
        o.position.set((wide ? x + 2.5 * (kbW / cols) : x) * S, 0, z * S);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.updateMatrix();
        m.setMatrixAt(i++, o.matrix);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [geo, mats.keys, kbW, kbH]);
  return <primitive object={inst} />;
}

export function LaptopModel({ spec, mats, screen }: { spec: DeviceSpec; mats: FinishMaterials; screen: THREE.Material }) {
  const { w, h: depth, d: baseT, r } = spec.body;
  const lid = spec.lid!;
  const lidH = depth - 3;
  const [sw, sh] = spec.screenMm;
  const geos = useMemo(() => {
    const base = roundedBoxGeometry(w * S, depth * S, baseT * S, r * S, 1.6 * S, 24, 6);
    base.rotateX(-Math.PI / 2);
    const lidGeo = roundedBoxGeometry(w * S, lidH * S, lid.thickness * S, r * S, 1.2 * S, 24, 5);
    lidGeo.translate(0, (lidH / 2) * S, 0);
    const bezel = roundedPlaneGeometry((w - 2.4) * S, (lidH - 2.4) * S, (r - 1.2) * S, 24);
    bezel.translate(0, (lidH / 2) * S, 0);
    const scr = roundedPlaneGeometry(sw * S, sh * S, spec.screenRadius * S, 24);
    const trackW = w * 0.42, trackH = depth * 0.3;
    const trackpad = roundedPlaneGeometry(trackW * S, trackH * S, 3 * S, 12);
    trackpad.rotateX(-Math.PI / 2);
    const notch = spec.notch ? roundedPlaneGeometry(spec.notch.w * S, spec.notch.h * 2 * S, 4 * S, 12) : null;
    const hinge = new THREE.CylinderGeometry((baseT * 0.45) * S, (baseT * 0.45) * S, w * 0.72 * S, 24);
    hinge.rotateZ(Math.PI / 2);
    const deck = roundedPlaneGeometry(w * 0.86 * S, depth * 0.44 * S, 3 * S, 12);
    deck.rotateX(-Math.PI / 2);
    const feet = new THREE.CylinderGeometry(3.5 * S, 3.5 * S, 0.8 * S, 16);
    return { base, lidGeo, bezel, scr, trackpad, notch, hinge, deck, feet };
  }, [w, depth, baseT, r, lidH, lid.thickness, sw, sh, spec.screenRadius, spec.notch]);
  const deckMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0f0f11", roughness: 0.55, metalness: 0.2 }), []);
  const trackMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(mats.frame.color).multiplyScalar(0.92), roughness: 0.45, metalness: 0.8 }), [mats.frame.color]);
  const notchMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.4 }), []);
  const feetMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#222", roughness: 0.9 }), []);
  const baseY = (baseT / 2) * S;
  const screenY = (lidH - lid.screenTop - sh / 2) * S; // from lid bottom
  const notchTopY = (lidH - lid.screenTop + 0.4) * S;
  return (
    <group>
      {/* base */}
      <mesh geometry={geos.base} material={mats.frame} position={[0, baseY, 0]} castShadow receiveShadow />
      <mesh geometry={geos.deck} material={deckMat} position={[0, baseT * S + 0.03 * S, -depth * 0.12 * S]} />
      <group position={[0, baseT * S + 0.45 * S, -depth * 0.12 * S]}>
        <Keyboard spec={spec} mats={mats} />
      </group>
      <mesh geometry={geos.trackpad} material={trackMat} position={[0, baseT * S + 0.04 * S, depth * 0.27 * S]} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} geometry={geos.feet} material={feetMat} position={[sx * w * 0.42 * S, 0.3 * S, sz * depth * 0.4 * S]} />
      )))}
      {/* hinge */}
      <mesh geometry={geos.hinge} material={mats.dark} position={[0, baseT * S, -(depth / 2 - baseT * 0.5) * S]} />
      {/* lid */}
      <group position={[0, baseT * S, -(depth / 2 - lid.thickness * 0.5) * S]} rotation={[-(lid.angle - 90) * DEG, 0, 0]}>
        <mesh geometry={geos.lidGeo} material={mats.frame} castShadow />
        <mesh geometry={geos.bezel} material={mats.glass} position={[0, 0, (lid.thickness / 2) * S + 0.02 * S]} />
        <mesh geometry={geos.scr} material={screen} position={[0, screenY, (lid.thickness / 2) * S + 0.06 * S]} />
        {geos.notch && <mesh geometry={geos.notch} material={notchMat} position={[0, notchTopY, (lid.thickness / 2) * S + 0.09 * S]} />}
      </group>
    </group>
  );
}
