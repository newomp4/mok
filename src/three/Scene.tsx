"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { anim } from "@/three/anim";
import { evaluate, fadeAt, locate, totalDuration } from "@/lib/animation";
import { getBgPreset, getLighting } from "@/lib/presets";
import { useMedia } from "@/lib/media";
import { paintImage, paintPreset } from "@/three/background";
import { useRenderFlags, viewport } from "@/three/registry";
import { Device, useDeviceLayout } from "@/three/Device";
import { EnvScene } from "@/three/scenes/EnvScene";
import { PostFX } from "@/three/effects/PostFX";
import { CardLayer, FadeOverlay } from "@/three/CardLayer";

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
    const overlay = fadeAt(p, t);
    anim.fade = overlay.alpha;
    anim.fadeColor = overlay.color;
  }, -100);
  return null;
}

const CAM_KEYS = ["camera.x", "camera.y", "camera.z", "camera.fov", "camera.zoom", "camera.panX", "camera.panY"] as const;

function CameraRig({ fitSize }: { fitSize: number }) {
  // Ultramock's rig order: the camera yaws around the device, then the whole orbit tilts about the
  // world X axis (so a yawed + pitched view leans the device on screen), then rolls about the view axis.
  const pitch = useRef<THREE.Group>(null);
  const yaw = useRef<THREE.Group>(null);
  const roll = useRef<THREE.Group>(null);
  const cam = useRef<THREE.PerspectiveCamera>(null);
  const smooth = useRef<Record<string, number> | null>(null);
  useFrame((state, delta) => {
    const raw = anim.values;
    const c = cam.current;
    if (!raw || !c || !yaw.current || !pitch.current || !roll.current) return;
    // Interactive changes ease toward their target (critically damped feel); playback and export are exact.
    const exact = anim.exporting || useUI.getState().playing;
    let v: Record<string, number> = raw;
    if (exact || !smooth.current) {
      smooth.current = Object.fromEntries(CAM_KEYS.map((k) => [k, raw[k]]));
    } else {
      const k = 1 - Math.exp(-Math.min(delta, 0.05) * 18);
      let moving = false;
      for (const key of CAM_KEYS) {
        const cur = smooth.current[key], target = raw[key];
        const d = target - cur;
        if (Math.abs(d) < (key === "camera.zoom" ? 0.0005 : key.startsWith("camera.pan") ? 0.0003 : 0.01)) smooth.current[key] = target;
        else { smooth.current[key] = cur + d * k; moving = true; }
      }
      if (moving) state.invalidate();
      v = smooth.current;
    }
    pitch.current.rotation.x = -v["camera.y"] * DEG; // positive = camera above the device
    yaw.current.rotation.y = v["camera.x"] * DEG; // positive = camera to the right
    roll.current.rotation.z = -v["camera.z"] * DEG; // positive = device leans left, as in Ultramock
    const fov = Math.max(5, Math.min(120, v["camera.fov"]));
    if (Math.abs(c.fov - fov) > 1e-4) { c.fov = fov; c.updateProjectionMatrix(); }
    const dist = ((fitSize / 2) / Math.tan((fov / 2) * DEG)) * 1.18 / Math.max(0.05, v["camera.zoom"]);
    const viewH = 2 * dist * Math.tan((fov / 2) * DEG);
    c.position.set(-v["camera.panX"] * viewH, -v["camera.panY"] * viewH, dist);
    anim.camDist = dist;
    // keep depth precision high for thin layered surfaces at any distance
    const near = Math.max(0.05, dist * 0.03), far = Math.max(50, dist * 40);
    if (Math.abs(c.near - near) > 1e-3 || Math.abs(c.far - far) > 1) { c.near = near; c.far = far; c.updateProjectionMatrix(); }
  }, -50);
  return (
    <group ref={pitch}>
      <group ref={yaw}>
        <group ref={roll}>
          <PerspectiveCamera ref={cam} makeDefault fov={24} near={0.02} far={400} position={[0, 0, 6]}>
            <CardLayer />
            <FadeOverlay />
          </PerspectiveCamera>
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
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw; canvas.height = th;
      texture.dispose();
      texture.source = new THREE.Source(canvas);
    }
    if (bg.type === "image") {
      if (!media) { scene.background = new THREE.Color(bg.color); invalidate(); return; }
      paintImage(ctx, media.element as CanvasImageSource, media.width, media.height, tw, th, bg.blur);
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

/** Hides its children while a text / logo card is on screen. */
function DeviceOnly({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => { if (ref.current) ref.current.visible = !anim.card; }, -15);
  return <group ref={ref}>{children}</group>;
}

export function SceneRoot() {
  const layout = useDeviceLayout();
  const scenePreset = useEditor((s) => s.project.scene.preset);
  const contactShadow = useEditor((s) => s.project.scene.contactShadow);
  const shadowSoft = useEditor((s) => s.project.scene.shadowSoft ?? 0.5);
  const shadowOpacity = useEditor((s) => s.project.scene.shadowOpacity ?? 0.5);
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
        <DeviceOnly>
          <ContactShadows position={[0, layout.floorY - 0.004, 0]} scale={layout.fitSize * (2.2 + shadowSoft * 1.4)} blur={0.6 + shadowSoft * 4} opacity={shadowOpacity} far={layout.fitSize * (0.8 + shadowSoft * 1.2)} resolution={1024} color="#000000" />
        </DeviceOnly>
      )}
      <PostFX />
    </>
  );
}
