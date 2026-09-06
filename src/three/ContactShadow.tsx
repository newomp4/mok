"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import { anim } from "@/three/anim";
import { disposeResources } from "@/three/resources";
import { isEffectivelyVisible, withHiddenObjects, withOffscreenPass } from "@/three/renderPass";
import { useRenderFlags } from "@/three/registry";

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

/** Render only the model's depth; camera-mounted cards/fades never cast a contact shadow. */
export function renderContactShadow(gl: THREE.WebGLRenderer, scene: THREE.Scene, mainCamera: THREE.Camera, shadow: THREE.Object3D, camera: THREE.OrthographicCamera, resources: ReturnType<typeof createContactShadowResources>, blur: number): void {
  if (!isEffectivelyVisible(shadow)) return;
  const background = scene.background, override = scene.overrideMaterial;
  const { target, blurred, depth, plane, horizontal, vertical } = resources;
  withHiddenObjects([shadow, ...mainCamera.children], () => {
    try {
      scene.background = null;
      scene.overrideMaterial = depth;
      withOffscreenPass(gl, () => {
        gl.setRenderTarget(target);
        gl.render(scene, camera);
        const soften = (amount: number) => {
          plane.material = horizontal;
          horizontal.uniforms.tDiffuse.value = target.texture;
          horizontal.uniforms.h.value = amount / 256;
          gl.setRenderTarget(blurred);
          gl.render(plane, camera);
          plane.material = vertical;
          vertical.uniforms.tDiffuse.value = blurred.texture;
          vertical.uniforms.v.value = amount / 256;
          gl.setRenderTarget(target);
          gl.render(plane, camera);
        };
        soften(blur);
        soften(blur * 0.4);
      }, true);
    } finally {
      scene.background = background;
      scene.overrideMaterial = override;
    }
  });
}

export function ContactShadow({ position, scale, blur, opacity, far, resolution }: {
  position: [number, number, number]; scale: number; blur: number; opacity: number; far: number; resolution: number;
}) {
  const group = useRef<THREE.Group>(null);
  const camera = useRef<THREE.OrthographicCamera>(null);
  const transparent = useRenderFlags((s) => s.transparent);
  const resources = useMemo(() => createContactShadowResources(scale, resolution), [scale, resolution]);
  useEffect(() => () => disposeResources(resources), [resources]);
  useEffect(() => { resources.catcher.opacity = opacity; }, [resources, opacity]);
  useFrame(({ gl, scene, camera: mainCamera }) => {
    const shadow = group.current, cam = camera.current;
    if (!shadow || !cam || anim.card || transparent) return;
    renderContactShadow(gl, scene, mainCamera, shadow, cam, resources, blur);
  });
  return (
    <group ref={group} visible={!transparent} rotation-x={Math.PI / 2} position={position} dispose={null}>
      <mesh geometry={resources.geometry} material={resources.catcher} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]} />
      <orthographicCamera ref={camera} args={[-scale / 2, scale / 2, scale / 2, -scale / 2, 0, far]} />
    </group>
  );
}
