"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import { anim } from "@/three/anim";
import { disposeResources } from "@/three/resources";

/** Same depth/blur construction as Drei ContactShadows, with explicit ownership on resize. */
export function createContactShadowResources(size: number, resolution: number) {
  const target = new THREE.WebGLRenderTarget(resolution, resolution);
  const blurred = new THREE.WebGLRenderTarget(resolution, resolution);
  target.texture.generateMipmaps = blurred.texture.generateMipmaps = false;
  const geometry = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2);
  const depth = new THREE.MeshDepthMaterial({ depthTest: false, depthWrite: false });
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "vec4( vec3(0.0), 1.0 - fragCoordZ );",
    );
  };
  const horizontal = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vertical = new THREE.ShaderMaterial(VerticalBlurShader);
  horizontal.depthTest = vertical.depthTest = false;
  const plane = new THREE.Mesh(geometry, horizontal);
  const catcher = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthWrite: false });
  return { target, blurred, geometry, depth, horizontal, vertical, plane, catcher };
}

export function ContactShadow({ position, scale, blur, opacity, far, resolution }: {
  position: [number, number, number]; scale: number; blur: number; opacity: number; far: number; resolution: number;
}) {
  const group = useRef<THREE.Group>(null);
  const camera = useRef<THREE.OrthographicCamera>(null);
  const resources = useMemo(() => createContactShadowResources(scale, resolution), [scale, resolution]);
  useEffect(() => () => disposeResources(resources), [resources]);
  useEffect(() => { resources.catcher.opacity = opacity; }, [resources, opacity]);
  useFrame(({ gl, scene }) => {
    const shadow = group.current, cam = camera.current;
    if (!shadow || !cam || anim.card) return;
    for (let parent: THREE.Object3D | null = shadow; parent; parent = parent.parent) if (!parent.visible) return;
    const previousTarget = gl.getRenderTarget();
    const previousBackground = scene.background, previousOverride = scene.overrideMaterial;
    const { target, blurred, depth, plane, horizontal, vertical } = resources;
    shadow.visible = false;
    try {
      scene.background = null;
      scene.overrideMaterial = depth;
      gl.setRenderTarget(target);
      gl.render(scene, cam);
      const soften = (amount: number) => {
        plane.material = horizontal;
        horizontal.uniforms.tDiffuse.value = target.texture;
        // Drei's blur radius is specified in UV units, so its appearance stays the same at 2K.
        horizontal.uniforms.h.value = amount / 256;
        gl.setRenderTarget(blurred);
        gl.render(plane, cam);
        plane.material = vertical;
        vertical.uniforms.tDiffuse.value = blurred.texture;
        vertical.uniforms.v.value = amount / 256;
        gl.setRenderTarget(target);
        gl.render(plane, cam);
      };
      soften(blur);
      soften(blur * 0.4);
    } finally {
      gl.setRenderTarget(previousTarget);
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      shadow.visible = true;
    }
  });
  return (
    <group ref={group} rotation-x={Math.PI / 2} position={position} dispose={null}>
      <mesh geometry={resources.geometry} material={resources.catcher} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]} />
      <orthographicCamera ref={camera} args={[-scale / 2, scale / 2, scale / 2, -scale / 2, 0, far]} />
    </group>
  );
}
