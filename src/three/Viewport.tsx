"use client";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { SceneRoot } from "@/three/Scene";

export function Viewport({ dpr = 2 }: { dpr?: number }) {
  return (
    <Canvas
      dpr={[1, dpr]}
      frameloop="demand"
      shadows={{ type: THREE.VSMShadowMap }}
      flat={false}
      gl={{
        antialias: false,
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
        toneMapping: THREE.NeutralToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ position: "absolute", inset: 0, background: "transparent" }}
    >
      <SceneRoot />
    </Canvas>
  );
}
