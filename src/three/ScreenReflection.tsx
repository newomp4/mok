"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { anim } from "@/three/anim";
import type { ScreenMaterial } from "@/three/materials";
import { readScreenPlane } from "@/three/screenPlane";
import { useRenderQuality } from "@/three/renderQuality";
import { clipReflectionCamera, isEffectivelyVisible, withHiddenObjects, withOffscreenPass } from "@/three/renderPass";
import { reflectionSamples } from "@/three/reflectionSamples";

/**
 * A true planar mirror for the display.
 *
 * The scene is rendered a second time from the camera mirrored through the screen's own plane,
 * with the near plane laid onto that plane. Everything behind the glass — the body, the lid, the
 * bezel — falls off the near plane, so what lands in the reflection is only what actually sits in
 * front of the display: the keyboard deck, the floor under it and the room beyond, each occluding
 * the next exactly as the depth buffer says it should. The result is projected back onto the glass
 * at the fragment's own screen position and added on top of the clear coat's environment
 * reflection, so turning Reflection up reads as more mirror.
 *
 * At Reflection 0 no render target is allocated and the second pass never runs.
 */
export function ScreenReflection({ material, amount }: { material: ScreenMaterial; amount: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const quality = useRenderQuality();
  const samples = reflectionSamples(gl, quality.reflectionSamples);
  const active = amount > 0.002;
  // the mirrored camera borrows the real one's projection, so the buffer has to share its aspect
  const [width, height] = active ? quality.reflection : [0, 0];

  const target = useMemo(() => {
    if (!active) return null;
    // the room is rendered before tone mapping, so the mirror has to carry the same open range
    const rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      samples,
    });
    rt.texture.name = "screenReflection";
    return rt;
  }, [active, width, height, samples]);
  useEffect(() => () => target?.dispose(), [target]);

  useEffect(() => {
    const u = material.reflection;
    u.map.value = target ? target.texture : null;
    if (!target) u.amount.value = 0;
    invalidate();
    return () => { u.map.value = null; u.amount.value = 0; };
  }, [material, target, invalidate]);

  const cam = useMemo(() => new THREE.PerspectiveCamera(), []);
  const v = useMemo(() => ({
    normal: new THREE.Vector3(),
    center: new THREE.Vector3(),
    localCenter: new THREE.Vector3(),
    localSize: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    view: new THREE.Vector3(),
    look: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    rot: new THREE.Matrix4(),
    plane: new THREE.Plane(),
    // clip space runs -1..1 and a texture 0..1, so the projection is halved and shifted
    bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1),
  }), []);
  const panels = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    const u = material.reflection;
    u.amount.value = 0;
    // a text or logo card hides the device, and with it the only surface this feeds
    if (!target || anim.card) return;
    const device = state.scene.getObjectByName("device");
    if (!device || !isEffectivelyVisible(device)) return;
    // the rig moved the device and the camera this frame; matrices are otherwise refreshed at render time
    device.updateWorldMatrix(true, true);
    const camera = state.camera;
    camera.updateWorldMatrix(true, false);

    const list = panels.current;
    list.length = 0;
    device.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.material === material || (Array.isArray(m.material) && m.material.includes(material))) list.push(m);
    });
    if (list.length === 0) return;
    // a model can carry more than one lit panel (a watch face, a second display); the biggest is the one
    let panel = list[0];
    let best = -1;
    for (const m of list) {
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const span = g.boundingBox!.getSize(v.localSize).length() * scaleOf(m.matrixWorld);
      if (span > best) { best = span; panel = m; }
    }

    readScreenPlane(panel, v.center, v.normal);

    v.camPos.setFromMatrixPosition(camera.matrixWorld);
    v.view.subVectors(v.center, v.camPos);
    // the mirror always reflects the half space the camera is standing in
    if (v.view.dot(v.normal) > 0) v.normal.negate();
    // edge on there is no reflection to take, and the mirrored camera degenerates
    if (v.view.dot(v.normal) > -1e-4) return;

    // mirror the camera through the plane: position, look-at target and up all reflect
    v.rot.extractRotation(camera.matrixWorld);
    v.view.reflect(v.normal).negate().add(v.center);
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.camPos);
    v.aim.subVectors(v.center, v.look).reflect(v.normal).negate().add(v.center);
    cam.position.copy(v.view);
    cam.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.normal);
    cam.lookAt(v.aim);
    cam.layers.mask = camera.layers.mask;
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    // world position -> the mirror's own pixel, taken before the near plane is skewed below
    u.matrix.value.copy(v.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // lay the near plane on the mirror, so everything behind the glass is clipped away
    // (http://www.terathon.com/code/oblique.html)
    v.plane.setFromNormalAndCoplanarPoint(v.normal, v.center).applyMatrix4(cam.matrixWorldInverse);
    if (!clipReflectionCamera(cam, v.plane)) return;

    const gl = state.gl;
    // ContactShadows has already refreshed this frame's shadow maps at priority 0. Reuse them
    // here, before the composer at priority 1, without paying for another shadow-map render.
    const bg = state.scene.background;
    // The panels lie on the mirror; camera-mounted fades and titles do not belong in this view.
    withHiddenObjects([...list, ...camera.children], () => {
      try {
        state.scene.background = null;
        withOffscreenPass(gl, () => { gl.setRenderTarget(target); gl.render(state.scene, cam); });
      } finally { state.scene.background = bg; }
    });
    u.amount.value = amount;
  }, 0.5);

  return null;
}

/** Largest scale the matrix applies to any axis, so panels in different local frames compare fairly. */
function scaleOf(m: THREE.Matrix4): number {
  const e = m.elements;
  return Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
}
