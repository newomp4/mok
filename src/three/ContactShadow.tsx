"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { anim } from "@/three/anim";
import { disposeResources } from "@/three/resources";
import { createContactShadowResources, renderContactShadow } from "@/three/contactShadowPass";
export { createContactShadowResources, renderContactShadow } from "@/three/contactShadowPass";
import { useRenderFlags } from "@/three/registry";

export function ContactShadow({ position, scale, blur, opacity, far, resolution }: {
  position: [number, number, number]; scale: number; blur: number; opacity: number; far: number; resolution: number;
}) {
  const group = useRef<THREE.Group>(null);
  const camera = useRef<THREE.OrthographicCamera>(null);
  const hidden = useRenderFlags((s) => s.transparent && !s.transparentShadows);
  const resources = useMemo(() => createContactShadowResources(scale, resolution), [scale, resolution]);
  useEffect(() => () => disposeResources(resources), [resources]);
  useEffect(() => { resources.catcher.opacity = opacity; }, [resources, opacity]);
  useFrame(({ gl, scene, camera: mainCamera }) => {
    const shadow = group.current, cam = camera.current;
    if (!shadow || !cam || anim.card || hidden) return;
    renderContactShadow(gl, scene, mainCamera, shadow, cam, resources, blur);
  });
  return (
    <group ref={group} visible={!hidden && opacity > 0} rotation-x={Math.PI / 2} position={position} dispose={null}>
      <mesh geometry={resources.geometry} material={resources.catcher} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]} />
      <orthographicCamera ref={camera} args={[-scale / 2, scale / 2, scale / 2, -scale / 2, 0, far]} />
    </group>
  );
}
