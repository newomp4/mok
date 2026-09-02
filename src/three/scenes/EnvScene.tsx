"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useLoader, useThree } from "@react-three/fiber";
import type { ScenePresetId } from "@/lib/types";

/** Infinite soft floor: a radial gradient that fades into fog of the same colour, so there is no visible wall. */
function SoftFloor({ size, center, edge }: { size: number; center: string; edge: string }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
    g.addColorStop(0, center);
    g.addColorStop(0.55, center);
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [center, edge]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={tex} roughness={0.96} metalness={0} />
    </mesh>
  );
}

function SceneFog({ color, near, far }: { color: string; near: number; far: number }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.fog = new THREE.Fog(color, near, far);
    return () => { scene.fog = null; };
  }, [scene, color, near, far]);
  return null;
}

function ConcreteFloor({ size }: { size: number }) {
  const [diff, nor, rough, ao] = useLoader(THREE.TextureLoader, [
    "/textures/concrete/diff.jpg", "/textures/concrete/nor_gl.jpg", "/textures/concrete/rough.jpg", "/textures/concrete/ao.jpg",
  ]);
  useMemo(() => {
    diff.colorSpace = THREE.SRGBColorSpace;
    for (const t of [diff, nor, rough, ao]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(size / 2.2, size / 2.2);
      t.anisotropy = 8;
    }
  }, [diff, nor, rough, ao, size]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={diff} normalMap={nor} roughnessMap={rough} aoMap={ao} color="#8a8a8a" roughness={1} metalness={0} />
    </mesh>
  );
}

export function EnvScene({ preset, floorY, fitSize }: { preset: ScenePresetId; floorY: number; fitSize: number }) {
  const f = fitSize;
  if (preset === "custom") return null;
  const shadowCam = { left: -f * 1.8, right: f * 1.8, top: f * 1.8, bottom: -f * 1.8, near: 0.1, far: f * 20 };
  return (
    <group position={[0, floorY, 0]}>
      {preset === "studio" && (
        <>
          <SoftFloor size={f * 40} center="#e4e4e4" edge="#c9c9c9" />
          <SceneFog color="#dedede" near={f * 4} far={f * 18} />
          <directionalLight position={[f * 2.5, f * 4, f * 3]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={8}>
            <orthographicCamera attach="shadow-camera" args={[shadowCam.left, shadowCam.right, shadowCam.top, shadowCam.bottom, shadowCam.near, shadowCam.far]} />
          </directionalLight>
          <hemisphereLight intensity={0.4} color="#ffffff" groundColor="#c4c4c4" />
        </>
      )}
      {preset === "gallery" && (
        <>
          <SoftFloor size={f * 40} center="#f7f7f7" edge="#e2e2e2" />
          <SceneFog color="#f4f4f4" near={f * 4} far={f * 18} />
          <directionalLight position={[-f * 2, f * 4.5, f * 2.5]} intensity={1.9} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={8}>
            <orthographicCamera attach="shadow-camera" args={[shadowCam.left, shadowCam.right, shadowCam.top, shadowCam.bottom, shadowCam.near, shadowCam.far]} />
          </directionalLight>
          <hemisphereLight intensity={0.55} color="#ffffff" groundColor="#dcdcdc" />
        </>
      )}
      {preset === "concrete" && (
        <>
          <ConcreteFloor size={f * 14} />
          <mesh position={[0, f * 4, -f * 5]}>
            <planeGeometry args={[f * 30, f * 12]} />
            <meshStandardMaterial color="#141414" roughness={1} />
          </mesh>
          <directionalLight position={[f * 3, f * 5, f * 2]} intensity={3.2} color="#fff4e6" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.02} shadow-radius={3}>
            <orthographicCamera attach="shadow-camera" args={[shadowCam.left, shadowCam.right, shadowCam.top, shadowCam.bottom, shadowCam.near, shadowCam.far]} />
          </directionalLight>
          <hemisphereLight intensity={0.15} color="#ffffff" groundColor="#222" />
        </>
      )}
      {preset === "darkroom" && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[f * 16, f * 16]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.42} metalness={0.15} />
          </mesh>
          <spotLight position={[-f * 1.5, f * 4.5, -f * 2.5]} intensity={f * f * 60} angle={0.55} penumbra={0.9} distance={f * 20} color="#e8f0ff" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} />
          <spotLight position={[f * 2.5, f * 3, f * 3]} intensity={f * f * 14} angle={0.7} penumbra={1} distance={f * 20} color="#ffe6d0" />
        </>
      )}
    </group>
  );
}
