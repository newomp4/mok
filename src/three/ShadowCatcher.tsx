"use client";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { anim } from "@/three/anim";
import { createReceiverOnlyShadowMaterial } from "@/three/shadowCalibration";

/** Black straight-alpha coverage, so the shadow darkens any later background correctly. */
export function createShadowCatcherMaterial(size: number) {
  const material = new THREE.ShadowMaterial({ color: 0x000000, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.catcherSize = { value: size };
    shader.vertexShader = "uniform float catcherSize; varying vec2 vCatcherUv;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvCatcherUv = position.xy / catcherSize + 0.5;");
    shader.fragmentShader = "varying vec2 vCatcherUv;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <premultiplied_alpha_fragment>", `
      vec2 edge = smoothstep(vec2(0.0), vec2(0.08), vCatcherUv) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), vCatcherUv));
      gl_FragColor.a *= edge.x * edge.y;
      #include <premultiplied_alpha_fragment>
    `);
  };
  material.customProgramCacheKey = () => "mok-shadow-catcher-v1";
  return material;
}

export function ShadowCatcher({ size, floorY, opacity, followLight = false }: { size: number; floorY: number; opacity: number; followLight?: boolean }) {
  const resources = useMemo(() => ({ material: createShadowCatcherMaterial(size), depth: createReceiverOnlyShadowMaterial() }), [size]);
  useEffect(() => () => { resources.material.dispose(); resources.depth.dispose(); }, [resources]);
  useFrame(() => {
    const intensity = followLight ? Math.min(1, Math.max(0.15, anim.values?.["scene.lightIntensity"] ?? 1)) : 1;
    resources.material.opacity = Math.max(0, Math.min(1, opacity * intensity));
  }, -19);
  return (
    <mesh name="ground-shadow-catcher" position={[0, floorY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow customDepthMaterial={resources.depth} customDistanceMaterial={resources.depth}>
      <planeGeometry args={[size, size]} />
      <primitive object={resources.material} attach="material" />
    </mesh>
  );
}
