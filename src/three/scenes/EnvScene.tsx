"use client";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import { anim } from "@/three/anim";
import type { ScenePresetId } from "@/lib/types";

/**
 * Infinite sweep: a radial gradient floor that fades into fog of the same colour, so the horizon
 * has no seam. The gradient is tight enough around the device to read as a lit sweep rather than
 * flat paper, and the fog starts well past the subject so the shadow is never washed out.
 */
function SoftFloor({ size, center, edge, roughness = 0.96 }: { size: number; center: string; edge: string; roughness?: number }) {
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
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={tex} roughness={roughness} metalness={0} envMapIntensity={0.3} />
    </mesh>
  );
}

/** Fog plus a fog-coloured dome beyond it, so the floor, horizon and sky tone-map together. */
function SceneFog({ color, near, far }: { color: string; near: number; far: number }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.fog = new THREE.Fog(color, near, far);
    return () => { scene.fog = null; };
  }, [scene, color, near, far]);
  return (
    <mesh>
      <sphereGeometry args={[far * 1.6, 32, 16]} />
      <meshBasicMaterial color={color} side={THREE.BackSide} fog={false} />
    </mesh>
  );
}

function ConcreteFloor({ size }: { size: number }) {
  const [diff, nor, rough, ao] = useLoader(THREE.TextureLoader, [
    "/textures/concrete/diff.jpg", "/textures/concrete/nor_gl.jpg", "/textures/concrete/rough.jpg", "/textures/concrete/ao.jpg",
  ]);
  useMemo(() => {
    diff.colorSpace = THREE.SRGBColorSpace;
    for (const t of [diff, nor, rough, ao]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // one tile per ~1.2 world units keeps the aggregate visible without turning to noise
      t.repeat.set(size / 3.4, size / 3.4);
      t.anisotropy = 16;
    }
  }, [diff, nor, rough, ao, size]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={diff} normalMap={nor} roughnessMap={rough} aoMap={ao} color="#8e8e90" roughness={0.9} metalness={0} normalScale={new THREE.Vector2(0.7, 0.7)} />
    </mesh>
  );
}

/**
 * The light the screen throws into the room. The colour follows whatever is on the screen (so a
 * video lights the scene as it plays) and eases between frames instead of jumping.
 */
function ScreenGlow({ distance, intensity, height }: { distance: number; intensity: number; height: number }) {
  const light = useRef<THREE.PointLight>(null);
  const target = useMemo(() => new THREE.Color("#ffffff"), []);
  useFrame((state, delta) => {
    const l = light.current;
    if (!l) return;
    const c = anim.screenColor;
    if (c) target.setRGB(c[0], c[1], c[2]);
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 6);
    const converged = Math.abs(l.color.r - target.r) + Math.abs(l.color.g - target.g) + Math.abs(l.color.b - target.b) < 0.004;
    if (converged || anim.exporting) l.color.copy(target);
    else l.color.lerp(target, k);
    // sit the glow just in front of the device, following its yaw so it always faces the screen
    const yaw = (anim.values?.["mockup.rotY"] ?? 0) * (Math.PI / 180);
    l.position.set(Math.sin(yaw) * distance, height, Math.cos(yaw) * distance);
    l.intensity = intensity * (anim.values?.["screen.brightness"] ?? 1);
    // only keep rendering while the glow is still easing toward the new screen colour
    if (!converged && !anim.exporting) state.invalidate();
  }, -18);
  return <pointLight ref={light} distance={distance * 14} decay={2} />;
}

export function EnvScene({ preset, floorY, fitSize }: { preset: ScenePresetId; floorY: number; fitSize: number }) {
  const f = fitSize;
  if (preset === "custom") return null;
  const shadow = { left: -f * 1.6, right: f * 1.6, top: f * 1.6, bottom: -f * 1.6, near: 0.1, far: f * 22 };
  return (
    <group position={[0, floorY, 0]}>
      {preset === "studio" && (
        // light tent: a big soft key from behind-left throws a long shadow across a grey sweep
        <>
          <SoftFloor size={f * 40} center="#eeeef0" edge="#b0b0b6" />
          <SceneFog color="#d5d5d8" near={f * 7} far={f * 26} />
          <directionalLight position={[-f * 2.2, f * 3.4, -f * 2.6]} intensity={2.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={14}>
            <orthographicCamera attach="shadow-camera" args={[shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far]} />
          </directionalLight>
          <directionalLight position={[f * 3, f * 2, f * 3]} intensity={0.8} color="#ffffff" />
          <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#c8c8cc" />
        </>
      )}
      {preset === "gallery" && (
        // high key: near-white sweep, a soft shadow pooling under the device
        <>
          <SoftFloor size={f * 40} center="#fcfcfd" edge="#d4d4da" />
          <SceneFog color="#f2f2f4" near={f * 8} far={f * 28} />
          <directionalLight position={[-f * 1.6, f * 4.2, f * 2.2]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={16}>
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
          <SceneFog color="#0f1013" near={f * 8} far={f * 24} />
          <directionalLight position={[f * 3.4, f * 2.6, f * 1.6]} intensity={3.4} color="#ffeedd" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.02} shadow-radius={4}>
            <orthographicCamera attach="shadow-camera" args={[shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far]} />
          </directionalLight>
          <directionalLight position={[-f * 2.6, f * 1.6, -f * 3]} intensity={1.2} color="#93b0e8" />
          <ScreenGlow distance={f * 0.9} intensity={f * f * 2.2} height={f * 0.35} />
          <hemisphereLight intensity={0.26} color="#8fa0bd" groundColor="#332f2a" />
        </>
      )}
      {preset === "darkroom" && (
        // black mirror floor, one cool rim, and the screen lighting its own surroundings
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[f * 30, f * 30]} />
            <MeshReflectorMaterial
              blur={[300, 90]}
              resolution={1024}
              mixBlur={1}
              mixStrength={34}
              depthScale={1.1}
              minDepthThreshold={0.4}
              maxDepthThreshold={1.35}
              roughness={0.85}
              color="#0a0a0c"
              metalness={0.35}
              mirror={0.6}
            />
          </mesh>
          <SceneFog color="#050506" near={f * 6} far={f * 20} />
          <spotLight position={[-f * 2, f * 3.6, -f * 2.2]} intensity={f * f * 30} angle={0.6} penumbra={0.95} distance={f * 22} color="#eaf0fb" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} />
          <spotLight position={[f * 2.8, f * 1.6, f * 2.4]} intensity={f * f * 13} angle={0.8} penumbra={1} distance={f * 22} color="#ffe2c6" />
          <ScreenGlow distance={f * 0.8} intensity={f * f * 8} height={f * 0.32} />
          <hemisphereLight intensity={0.08} color="#8fa8d0" groundColor="#000000" />
        </>
      )}
    </group>
  );
}
