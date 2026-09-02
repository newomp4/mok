"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { anim } from "@/three/anim";
import { evaluate, locate, totalDuration } from "@/lib/animation";
import { getBgPreset, getLighting } from "@/lib/presets";
import { useMedia } from "@/lib/media";
import { paintImage, paintPreset } from "@/three/background";
import { useRenderFlags, viewport } from "@/three/registry";
import { Device, useDeviceLayout } from "@/three/Device";
import { EnvScene } from "@/three/scenes/EnvScene";
import { PostFX } from "@/three/effects/PostFX";

const DEG = Math.PI / 180;

/** Evaluates the timeline into `anim` once per frame and drives playback. */
function Driver() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);

  useEffect(() => {
    viewport.state = get();
    const unsubs = [
      useEditor.subscribe((s) => s.project, () => invalidate()),
      useUI.subscribe((s) => s.time, () => invalidate()),
      useUI.subscribe((s) => s.playing, (playing) => { setFrameloop(playing ? "always" : "demand"); invalidate(); }),
      useRenderFlags.subscribe(() => invalidate()),
    ];
    invalidate();
    return () => { unsubs.forEach((u) => u()); viewport.state = null; };
  }, [get, invalidate, setFrameloop]);

  useFrame((_, delta) => {
    const ui = useUI.getState();
    const p = useEditor.getState().project;
    let t = ui.time;
    if (anim.exportTime !== null) {
      t = anim.exportTime;
    } else if (ui.playing) {
      const total = Math.max(0.01, totalDuration(p));
      t += Math.min(delta, 0.1);
      if (t >= total) {
        if (ui.loop) t = t % total;
        else { t = total; ui.setPlaying(false); }
      }
      useUI.setState({ time: t });
    }
    const loc = locate(p, t);
    anim.project = p;
    anim.time = t;
    anim.localT = loc.localT;
    anim.shot = loc.shot;
    anim.values = evaluate(p, loc.shot, loc.localT);
    if (loc.shot && ui.activeShotId !== loc.shot.id && anim.exportTime === null) useUI.setState({ activeShotId: loc.shot.id });
    // screen fade effect
    const fade = p.effects.find((e) => e.id === "screenFade" && e.enabled);
    if (fade && loc.shot) {
      const fin = fade.params.in ?? 0.6, fout = fade.params.out ?? 0.6;
      const a = fin > 0 ? Math.min(1, loc.localT / fin) : 1;
      const b = fout > 0 ? Math.min(1, (loc.shot.duration - loc.localT) / fout) : 1;
      anim.screenFade = Math.max(0, Math.min(a, b));
    } else anim.screenFade = 1;
  }, -100);
  return null;
}

function CameraRig({ fitSize }: { fitSize: number }) {
  const yaw = useRef<THREE.Group>(null);
  const pitch = useRef<THREE.Group>(null);
  const roll = useRef<THREE.Group>(null);
  const cam = useRef<THREE.PerspectiveCamera>(null);
  useFrame(() => {
    const v = anim.values;
    const c = cam.current;
    if (!v || !c || !yaw.current || !pitch.current || !roll.current) return;
    yaw.current.rotation.y = v["camera.x"] * DEG;
    pitch.current.rotation.x = -v["camera.y"] * DEG;
    roll.current.rotation.z = v["camera.z"] * DEG;
    const fov = Math.max(5, Math.min(120, v["camera.fov"]));
    if (Math.abs(c.fov - fov) > 1e-4) { c.fov = fov; c.updateProjectionMatrix(); }
    const dist = ((fitSize / 2) / Math.tan((fov / 2) * DEG)) * 1.18 / Math.max(0.05, v["camera.zoom"]);
    const viewH = 2 * dist * Math.tan((fov / 2) * DEG);
    c.position.set(-v["camera.panX"] * viewH, -v["camera.panY"] * viewH, dist);
    anim.camDist = dist;
  }, -50);
  return (
    <group ref={yaw}>
      <group ref={pitch}>
        <group ref={roll}>
          <PerspectiveCamera ref={cam} makeDefault fov={24} near={0.02} far={400} position={[0, 0, 6]} />
        </group>
      </group>
    </group>
  );
}

function Lighting() {
  const lighting = useEditor((s) => s.project.scene.lighting);
  const preset = getLighting(lighting);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const hdr = useLoader(HDRLoader, preset.file);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(hdr);
    scene.environment = rt.texture;
    pmrem.dispose();
    invalidate();
    return () => { if (scene.environment === rt.texture) scene.environment = null; rt.dispose(); };
  }, [hdr, gl, scene, invalidate]);
  useFrame(() => {
    const v = anim.values;
    if (!v) return;
    scene.environmentRotation.set(v["scene.lightRotX"] * DEG, v["scene.lightRotY"] * DEG, 0);
    scene.environmentIntensity = v["scene.lightIntensity"] * preset.intensity;
  }, -40);
  return null;
}

function BackgroundLayer() {
  const bg = useEditor((s) => s.project.scene.background);
  const preset = useEditor((s) => s.project.scene.preset);
  const transparent = useRenderFlags((s) => s.transparent);
  const media = useMedia(bg.type === "image" ? bg.image : null);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useMemo(() => document.createElement("canvas"), []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    if (transparent || bg.type === "transparent") {
      scene.background = null;
      gl.setClearColor(0x000000, 0);
      invalidate();
      return;
    }
    gl.setClearColor(0x000000, 1);
    if (preset !== "custom" || bg.type === "color") {
      scene.background = new THREE.Color(bg.color);
      invalidate();
      return;
    }
    const ctx = canvas.getContext("2d")!;
    let tw = 1024, th = 1024;
    if (bg.type === "image" && media) {
      const ar = media.width / media.height;
      tw = ar >= 1 ? 1024 : Math.round(1024 * ar);
      th = ar >= 1 ? Math.round(1024 / ar) : 1024;
    }
    if (canvas.width !== tw || canvas.height !== th) { canvas.width = tw; canvas.height = th; texture.dispose(); }
    if (bg.type === "image") {
      if (!media) { scene.background = new THREE.Color(bg.color); invalidate(); return; }
      paintImage(ctx, media.element, media.width, media.height, tw, th, bg.blur);
    } else {
      paintPreset(ctx, tw, th, getBgPreset(bg.preset), bg.blur);
    }
    texture.needsUpdate = true;
    // cover-fit the texture to the viewport
    const A = size.width / Math.max(1, size.height);
    const T = tw / th;
    if (T > A) { texture.repeat.set(A / T, 1); texture.offset.set((1 - A / T) / 2, 0); }
    else { texture.repeat.set(1, T / A); texture.offset.set(0, (1 - T / A) / 2); }
    scene.background = texture;
    invalidate();
  }, [bg, preset, transparent, media, scene, gl, canvas, texture, size.width, size.height, invalidate]);
  return null;
}

function LoadingProbe() {
  return null;
}

export function SceneRoot() {
  const layout = useDeviceLayout();
  const scenePreset = useEditor((s) => s.project.scene.preset);
  const contactShadow = useEditor((s) => s.project.scene.contactShadow);
  const shadowsOn = scenePreset !== "custom";
  return (
    <>
      <Driver />
      <CameraRig fitSize={layout.fitSize} />
      <BackgroundLayer />
      <Suspense fallback={<LoadingProbe />}>
        <Lighting />
      </Suspense>
      <Suspense fallback={null}>
        <EnvScene preset={scenePreset} floorY={layout.floorY} fitSize={layout.fitSize} />
      </Suspense>
      <Device layout={layout} />
      {!shadowsOn && contactShadow && (
        <ContactShadows position={[0, layout.floorY - 0.004, 0]} scale={layout.fitSize * 2.8} blur={2.4} opacity={0.5} far={layout.fitSize * 1.4} resolution={1024} color="#000000" />
      )}
      <PostFX />
    </>
  );
}
