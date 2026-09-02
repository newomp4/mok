"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import type { ScenePresetId } from "@/lib/types";
import { cycloramaGeometry } from "@/three/geometry";

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
  const cyc = useMemo(() => cycloramaGeometry(f * 14, f * 6, f * 1.6, f * 8), [f]);
  if (preset === "custom") return null;
  const shadowCam = { left: -f * 1.8, right: f * 1.8, top: f * 1.8, bottom: -f * 1.8, near: 0.1, far: f * 20 };
  return (
    <group position={[0, floorY, 0]}>
      {preset === "studio" && (
        <>
          <mesh geometry={cyc} position={[0, 0, -f * 1.6]} receiveShadow>
            <meshStandardMaterial color="#d5d5d5" roughness={0.96} metalness={0} />
          </mesh>
          <directionalLight position={[f * 2.5, f * 4, f * 3]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={6}>
            <orthographicCamera attach="shadow-camera" args={[shadowCam.left, shadowCam.right, shadowCam.top, shadowCam.bottom, shadowCam.near, shadowCam.far]} />
          </directionalLight>
          <hemisphereLight intensity={0.35} color="#ffffff" groundColor="#bfbfbf" />
        </>
      )}
      {preset === "gallery" && (
        <>
          <mesh geometry={cyc} position={[0, 0, -f * 2.2]} receiveShadow>
            <meshStandardMaterial color="#f1f1f1" roughness={0.92} metalness={0} />
          </mesh>
          <directionalLight position={[-f * 2, f * 4.5, f * 2.5]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={5}>
            <orthographicCamera attach="shadow-camera" args={[shadowCam.left, shadowCam.right, shadowCam.top, shadowCam.bottom, shadowCam.near, shadowCam.far]} />
          </directionalLight>
          <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#dddddd" />
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
