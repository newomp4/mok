"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial as FloorMaterial } from "@react-three/drei/materials/MeshReflectorMaterial.js";
import { BlurPass } from "@react-three/drei/materials/BlurPass.js";
import { anim } from "@/three/anim";
import { useRenderFlags } from "@/three/registry";
import { useEditor } from "@/store/editor";
import type { ScenePresetId } from "@/lib/types";
import { findDisplay, readScreenPlane } from "@/three/screenPlane";
import { addScreenGlow, screenGlow } from "@/three/screenGlow";
import { addEnvironmentGain } from "@/three/environmentGain";
import { resizeShadowMap, useRenderQuality } from "@/three/renderQuality";
import { clipReflectionCamera, isEffectivelyVisible, withHiddenObjects, withOffscreenPass } from "@/three/renderPass";
import { reflectionSamples } from "@/three/reflectionSamples";
import { createReceiverOnlyShadowMaterial } from "@/three/shadowCalibration";
import { acquireConcrete, configureConcreteMaps, type ConcreteMaps } from "@/three/concreteAssets";

/**
 * A transparent export asks for the device on an empty frame. The lights still belong there, but
 * the floor, the fog and the sky sphere would fill every pixel, so they come out for that render.
 */
function useNoRoom(): boolean {
  return useRenderFlags((s) => s.transparent);
}

/** Every key in here shares one shadow camera, so its depth range is authored once. */
const SHADOW_NEAR = 0.1;
const SHADOW_FAR = 22;
/** the widest penumbra each key can throw, in texels of its 2048² shadow map */
const SHADOW_SPREAD: Record<ScenePresetId, number> = {
  custom: 0,
  studio: 104,
  gallery: 100,
  concrete: 52,
  darkroom: 80,
};

/**
 * Shadow softness and opacity for the lit scenes. These sliders used to move nothing outside the
 * studio backdrop: `shadow.radius` is ignored under PCFSoftShadowMap, so the authored blur never
 * applied. The renderer now uses variance shadow maps, where both actually take effect. Softness
 * stands for the size of the source, so it sets the widest penumbra the key can throw; the floors
 * pull that back in again wherever the caster is close to them.
 */
function useSceneShadow(spread: number, resolution: number) {
  const soft = useEditor((s) => s.project.scene.shadowSoft ?? 0.5);
  const opacity = useEditor((s) => s.project.scene.shadowOpacity ?? 0.5);
  // the variance blur is measured in shadow-map texels, so it takes a wide radius on a 2048 map
  // before the penumbra reads as soft at all
  return {
    "shadow-radius": Math.max(1, soft * spread) * resolution / 2048,
    "shadow-blurSamples": Math.round(8 + soft * 24),
    "shadow-intensity": Math.max(0.05, Math.min(1, 0.15 + opacity * 1.7)),
  } as const;
}


/**
 * Infinite sweep: a radial gradient floor that fades into fog of the same colour, so the horizon
 * has no seam. The gradient is tight enough around the device to read as a lit sweep rather than
 * flat paper, and the fog starts well past the subject so the shadow is never washed out.
 */
function SoftFloor({ size, center, edge, roughness = 0.96 }: { size: number; center: string; edge: string; roughness?: number }) {
  const noRoom = useNoRoom();
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
    g.addColorStop(0, center);
    g.addColorStop(0.32, center);
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [center, edge]);
  useEffect(() => () => tex.dispose(), [tex]);
  if (noRoom) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial ref={(m) => { if (m) addEnvironmentGain(m); }} map={tex} roughness={roughness} metalness={0} envMapIntensity={0.3} />
    </mesh>
  );
}

/** Fog plus a fog-coloured dome beyond it, so the floor, horizon and sky tone-map together. */
function SceneFog({ color, near, far }: { color: string; near: number; far: number }) {
  const scene = useThree((s) => s.scene);
  const noRoom = useNoRoom();
  useEffect(() => {
    if (noRoom) { scene.fog = null; return; }
    scene.fog = new THREE.Fog(color, near, far);
    return () => { scene.fog = null; };
  }, [scene, color, near, far, noRoom]);
  if (noRoom) return null;
  return (
    <mesh>
      <sphereGeometry args={[far * 1.6, 32, 16]} />
      <meshBasicMaterial color={color} side={THREE.BackSide} fog={false} />
    </mesh>
  );
}

function ConcreteFloor({ size }: { size: number }) {
  const noRoom = useNoRoom();
  const gl = useThree((s) => s.gl), invalidate = useThree((s) => s.invalidate);
  const quality = useRenderQuality();
  const [maps, setMaps] = useState<ConcreteMaps | null>(null);
  const displayed = useRef<(() => void) | null>(null);
  const receiverShadow = useMemo(() => createReceiverOnlyShadowMaterial(), []);
  useEffect(() => {
    const incoming = acquireConcrete(gl, quality.hdrTier);
    let cancelled = false, promoted = false;
    void incoming.promise.then((loaded) => {
      if (cancelled) return;
      promoted = true; displayed.current?.(); displayed.current = incoming.release;
      setMaps(loaded); invalidate();
    }, () => {});
    return () => { cancelled = true; if (!promoted) incoming.release(); };
  }, [gl, quality.hdrTier, invalidate]);
  useEffect(() => () => { displayed.current?.(); displayed.current = null; receiverShadow.dispose(); }, [receiverShadow]);
  useMemo(() => { if (maps) configureConcreteMaps(maps, size, gl.capabilities.getMaxAnisotropy()); }, [maps, size, gl]);
  if (noRoom) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow customDepthMaterial={receiverShadow} customDistanceMaterial={receiverShadow}>
      <planeGeometry args={[size, size]} />
      {/* A ready tier adds map shader defines to the initially untextured floor. */}
      <meshStandardMaterial key={maps?.tier ?? "pending"} ref={(m) => { if (m) { addScreenGlow(m); addEnvironmentGain(m); } }} map={maps?.diff} normalMap={maps?.normal} roughnessMap={maps?.rough} aoMap={maps?.ao} color="#bababc" roughness={0.95} metalness={0} normalScale={new THREE.Vector2(0.65, 0.65)} />
    </mesh>
  );
}

/**
 * The light the screen throws into the room. The colour follows whatever is on the screen (so a
 * video lights the scene as it plays) and eases between frames instead of jumping.
 */
function ScreenGlow({ distance, intensity, height }: { distance: number; intensity: number; height: number }) {
  const color = useMemo(() => new THREE.Color(), []);
  const target = useMemo(() => new THREE.Color("#ffffff"), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);
  const initialized = useRef(false);
  useEffect(() => () => { screenGlow.intensity.value = 0; }, []);
  useFrame((state, delta) => {
    if (anim.card) { screenGlow.intensity.value = 0; return; }
    const c = anim.screenColor;
    if (c) target.setRGB(c[0], c[1], c[2]);
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 6);
    const converged = Math.abs(color.r - target.r) + Math.abs(color.g - target.g) + Math.abs(color.b - target.b) < 0.004;
    if (!initialized.current || converged || anim.exporting) { color.copy(target); initialized.current = true; }
    else color.lerp(target, k);
    screenGlow.color.value.copy(color);
    // Read the rendered screen itself so pitch, roll, a moving lid and device changes all move
    // its light with it. The old cached frame only followed yaw and could belong to another model.
    const device = state.scene.getObjectByName("device");
    device?.updateWorldMatrix(true, true);
    const display = device ? findDisplay(device) : null;
    if (display) {
      readScreenPlane(display, pos, normal);
      pos.addScaledVector(normal, distance);
      pos.y -= height;
      screenGlow.position.value.copy(pos);
      screenGlow.direction.value.copy(normal);
    }
    screenGlow.intensity.value = display ? intensity * (anim.values?.["screen.brightness"] ?? 1) * anim.screenFade : 0;
    // only keep rendering while the glow is still easing toward the new screen colour
    if (!converged && !anim.exporting) state.invalidate();
  }, -18);
  return null;
}

/**
 * Own the reflector's buffers so leaving the darkroom stops its render pass and releases them.
 * Drei's component restores its parent's visibility every frame, even when mounted hidden.
 */
function MirrorFloor({ size }: { size: number }) {
  const gl = useThree((s) => s.gl);
  const mesh = useRef<THREE.Mesh>(null);
  const quality = useRenderQuality();
  const resolution = quality.floor;
  const samples = reflectionSamples(gl, quality.reflectionSamples);
  const buffers = useMemo(() => {
    const options = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const raw = new THREE.WebGLRenderTarget(resolution, resolution, { ...options, samples });
    raw.depthTexture = new THREE.DepthTexture(resolution, resolution, THREE.UnsignedIntType);
    const blurred = new THREE.WebGLRenderTarget(resolution, resolution, { ...options, depthBuffer: false });
    const blur = new BlurPass({ gl, resolution, width: 300, height: 90, minDepthThreshold: 0.4, maxDepthThreshold: 1.35, depthScale: 1.1 });
    const matrix = new THREE.Matrix4();
    const material = new FloorMaterial();
    material.color.set("#0a0a0c");
    material.roughness = 0.85;
    material.metalness = 0.35;
    material.mirror = 0.6;
    material.mixBlur = 1;
    material.mixStrength = 34;
    material.depthScale = 1.1;
    material.minDepthThreshold = 0.4;
    material.maxDepthThreshold = 1.35;
    material.hasBlur = true;
    material.tDiffuse = raw.texture;
    material.tDepth = raw.depthTexture;
    material.tDiffuseBlur = blurred.texture;
    material.textureMatrix = matrix;
    material.defines = { ...material.defines, USE_BLUR: "", USE_DEPTH: "" };
    addScreenGlow(material);
    const receiverShadow = createReceiverOnlyShadowMaterial();
    return { raw, blurred, blur, material, matrix, receiverShadow };
  }, [gl, resolution, samples]);
  useEffect(() => () => {
    buffers.raw.dispose(); buffers.blurred.dispose();
    buffers.blur.renderTargetA.dispose(); buffers.blur.renderTargetB.dispose();
    buffers.blur.convolutionMaterial.dispose(); buffers.blur.screen.geometry.dispose();
    buffers.material.dispose();
    buffers.receiverShadow.dispose();
  }, [buffers]);
  const rig = useMemo(() => ({
    camera: new THREE.PerspectiveCamera(), center: new THREE.Vector3(), eye: new THREE.Vector3(),
    view: new THREE.Vector3(), look: new THREE.Vector3(), target: new THREE.Vector3(),
    normal: new THREE.Vector3(), rotation: new THREE.Matrix4(), normalMatrix: new THREE.Matrix3(),
    plane: new THREE.Plane(),
  }), []);
  useFrame((state) => {
    const floor = mesh.current;
    if (!floor || anim.card || !isEffectivelyVisible(floor)) return;
    floor.updateWorldMatrix(true, false);
    const camera = state.camera;
    camera.updateWorldMatrix(true, false);
    const r = rig, virtual = r.camera;
    r.center.setFromMatrixPosition(floor.matrixWorld);
    r.eye.setFromMatrixPosition(camera.matrixWorld);
    r.normal.set(0, 0, 1).applyNormalMatrix(r.normalMatrix.getNormalMatrix(floor.matrixWorld));
    r.view.subVectors(r.center, r.eye);
    if (r.view.dot(r.normal) >= -1e-4) return;
    virtual.position.copy(r.view.reflect(r.normal).negate().add(r.center));
    r.rotation.extractRotation(camera.matrixWorld);
    r.look.set(0, 0, -1).applyMatrix4(r.rotation).add(r.eye);
    r.target.subVectors(r.center, r.look).reflect(r.normal).negate().add(r.center);
    virtual.up.set(0, 1, 0).applyMatrix4(r.rotation).reflect(r.normal);
    virtual.lookAt(r.target);
    virtual.near = camera.near; virtual.far = camera.far;
    virtual.layers.mask = camera.layers.mask;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    buffers.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse).multiply(floor.matrixWorld);
    r.plane.setFromNormalAndCoplanarPoint(r.normal, r.center).applyMatrix4(virtual.matrixWorldInverse);
    if (!clipReflectionCamera(virtual, r.plane)) return;
    withHiddenObjects([floor, ...camera.children], () => withOffscreenPass(gl, () => {
      gl.setRenderTarget(buffers.raw);
      gl.render(state.scene, virtual);
      buffers.blur.render(gl, buffers.raw, buffers.blurred);
    }));
  }, 0.6);
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} receiveShadow customDepthMaterial={buffers.receiverShadow} customDistanceMaterial={buffers.receiverShadow}>
      <planeGeometry args={[size, size]} />
      <primitive object={buffers.material} attach="material" />
    </mesh>
  );
}

export function EnvScene({ preset, floorY, fitSize, backdrop }: { preset: ScenePresetId; floorY: number; fitSize: number; backdrop?: string }) {
  const noRoom = useNoRoom();
  const quality = useRenderQuality();
  const keyShadow = useSceneShadow(SHADOW_SPREAD[preset], quality.shadow);
  const shadowRef = useCallback((light: THREE.DirectionalLight | THREE.SpotLight | null) => { if (light) resizeShadowMap(light.shadow, quality.shadow); }, [quality.shadow]);
  const f = fitSize;
  if (preset === "custom") return null;
  const shadow = { left: -f * 1.6, right: f * 1.6, top: f * 1.6, bottom: -f * 1.6, near: SHADOW_NEAR, far: f * SHADOW_FAR };
  return (
    <group position={[0, floorY, 0]}>
      {preset === "studio" && (
        // light tent: a big soft key from behind-left throws a long shadow across a grey sweep
        <>
          <SoftFloor size={f * 40} center="#eeeef0" edge={backdrop ?? "#b0b0b6"} />
          <SceneFog color={backdrop ?? "#d5d5d8"} near={f * 7} far={f * 26} />
          <directionalLight ref={shadowRef} position={[-f * 2.2, f * 3.4, -f * 2.6]} intensity={2.6} castShadow shadow-mapSize={[quality.shadow, quality.shadow]} shadow-bias={-0.0004} shadow-normalBias={0.02} {...keyShadow}>
            <orthographicCamera attach="shadow-camera" args={[shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far]} />
          </directionalLight>
          <directionalLight position={[f * 3, f * 2, f * 3]} intensity={0.8} color="#ffffff" />
          <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#c8c8cc" />
        </>
      )}
      {preset === "gallery" && (
        // high key: near-white sweep, a soft shadow pooling under the device
        <>
          <SoftFloor size={f * 40} center="#fcfcfd" edge={backdrop ?? "#d4d4da"} />
          <SceneFog color={backdrop ?? "#f2f2f4"} near={f * 8} far={f * 28} />
          <directionalLight ref={shadowRef} position={[-f * 1.6, f * 4.2, f * 2.2]} intensity={2.1} castShadow shadow-mapSize={[quality.shadow, quality.shadow]} shadow-bias={-0.0004} shadow-normalBias={0.02} {...keyShadow}>
            <orthographicCamera attach="shadow-camera" args={[shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far]} />
          </directionalLight>
          <directionalLight position={[f * 2.4, f * 2.4, -f * 2]} intensity={0.7} />
          <hemisphereLight intensity={0.7} color="#ffffff" groundColor="#e6e6ea" />
        </>
      )}
      {preset === "concrete" && (
        // a single raking key and a cool back rim over polished concrete in a dark room
        <>
          <ConcreteFloor size={f * 26} />
          <SceneFog color={backdrop ?? "#0f1013"} near={f * 8} far={f * 24} />
          <directionalLight ref={shadowRef} position={[f * 3.4, f * 2.6, f * 1.6]} intensity={3.4} color="#ffeedd" castShadow shadow-mapSize={[quality.shadow, quality.shadow]} shadow-bias={-0.0005} shadow-normalBias={0.02} {...keyShadow}>
            <orthographicCamera attach="shadow-camera" args={[shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far]} />
          </directionalLight>
          <directionalLight position={[-f * 2.6, f * 1.6, -f * 3]} intensity={1.2} color="#93b0e8" />
          <ScreenGlow distance={f * 0.6} intensity={f * f * 3.2} height={f * 0.3} />
          <hemisphereLight intensity={0.26} color="#8fa0bd" groundColor="#332f2a" />
        </>
      )}
      {preset === "darkroom" && !noRoom && <MirrorFloor size={f * 30} />}
      {preset === "darkroom" && (
        // black mirror floor, one cool rim, and the screen lighting its own surroundings
        <>
          <SceneFog color={backdrop ?? "#050506"} near={f * 6} far={f * 20} />
          <spotLight ref={shadowRef} position={[-f * 2, f * 3.6, -f * 2.2]} intensity={f * f * 30} angle={0.6} penumbra={0.95} distance={f * 22} color="#eaf0fb" castShadow shadow-mapSize={[quality.shadow, quality.shadow]} shadow-bias={-0.0004} shadow-normalBias={0.02} {...keyShadow} />
          <spotLight position={[f * 2.8, f * 1.6, f * 2.4]} intensity={f * f * 13} angle={0.8} penumbra={1} distance={f * 22} color="#ffe2c6" />
          <ScreenGlow distance={f * 0.55} intensity={f * f * 6} height={f * 0.28} />
          <hemisphereLight intensity={0.08} color="#8fa8d0" groundColor="#000000" />
        </>
      )}
    </group>
  );
}
