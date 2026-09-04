"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { useEditor } from "@/store/editor";
import { useShallow } from "zustand/react/shallow";
import { useUI } from "@/store/ui";
import { anim } from "@/three/anim";
import { evaluate, fadeAt, locate, totalDuration } from "@/lib/animation";
import { getBgPreset, getLighting, getScene } from "@/lib/presets";
import type { ScenePresetId } from "@/lib/types";
import { useMedia } from "@/lib/media";
import { paintImage, paintPreset } from "@/three/background";
import { useRenderFlags, viewport } from "@/three/registry";
import { Device, useDeviceLayout, useShotView } from "@/three/Device";
import { EnvScene } from "@/three/scenes/EnvScene";
import { PostFX } from "@/three/effects/PostFX";
import { CardLayer, FadeOverlay, setToneMapped } from "@/three/CardLayer";

const DEG = Math.PI / 180;

/** Evaluates the timeline into `anim` once per frame and drives playback. */
function Driver() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);

  useEffect(() => {
    viewport.get = get;
    const unsubs = [
      useEditor.subscribe((s) => s.project, () => invalidate()),
      useUI.subscribe((s) => s.time, () => invalidate()),
      useUI.subscribe((s) => s.playing, (playing) => { setFrameloop(playing ? "always" : "demand"); invalidate(); }),
      useRenderFlags.subscribe(() => invalidate()),
    ];
    invalidate();
    return () => { unsubs.forEach((u) => u()); viewport.get = null; };
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
    // decided here, at the front of the frame, so Device and CardLayer never read it a frame late
    anim.card = !!loc.shot && (loc.shot.kind ?? "media") !== "media";
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
  const lighting = useShotView().lighting;
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
    // each rig has an authored orientation; the scene's Light rotation turns it from there
    scene.environmentRotation.set(v["scene.lightRotX"] * DEG, (preset.rotY + v["scene.lightRotY"]) * DEG, 0);
    scene.environmentIntensity = v["scene.lightIntensity"] * preset.intensity;
  }, -40);
  return null;
}

function BackgroundLayer() {
  // structuredClone gives every edit a fresh background object, so select the fields we actually use
  const bg = useEditor(useShallow((s) => {
    const b = s.project.scene.background;
    return { type: b.type, color: b.color, preset: b.preset, blur: b.blur };
  }));
  // the media ref is a nested object, so it needs a shallow selector of its own to stay stable
  const image = useEditor(useShallow((s) => s.project.scene.background.image));
  const preset = useShotView().scene;
  const transparent = useRenderFlags((s) => s.transparent);
  const media = useMedia(bg.type === "image" ? image : null);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useMemo(() => document.createElement("canvas"), []);
  const bgColor = useMemo(() => new THREE.Color(), []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  // an image background paints at its own aspect; presets stay square
  const [tw, th] = useMemo(() => {
    if (bg.type === "image" && media) {
      const ar = media.width / media.height;
      return ar >= 1 ? [1024, Math.round(1024 / ar)] : [Math.round(1024 * ar), 1024];
    }
    return [1024, 1024];
  }, [bg.type, media]);

  useEffect(() => {
    if (transparent || bg.type === "transparent") {
      scene.background = null;
      gl.setClearColor(0x000000, 0);
      invalidate();
      return;
    }
    gl.setClearColor(0x000000, 1);
    if (preset !== "custom" || bg.type === "color") {
      setToneMapped(bgColor, bg.color);
      scene.background = bgColor;
      invalidate();
      return;
    }
    const ctx = canvas.getContext("2d")!;
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw; canvas.height = th;
      texture.dispose();
      texture.source = new THREE.Source(canvas);
    }
    if (bg.type === "image") {
      if (!media) { setToneMapped(bgColor, bg.color); scene.background = bgColor; invalidate(); return; }
      paintImage(ctx, media.element as CanvasImageSource, media.width, media.height, tw, th, bg.blur);
    } else {
      paintPreset(ctx, tw, th, getBgPreset(bg.preset), bg.blur);
    }
    texture.needsUpdate = true;
    scene.background = texture;
    invalidate();
  }, [bg, preset, transparent, media, tw, th, scene, gl, canvas, texture, invalidate]);

  // cover-fit is its own pass: a canvas resize only re-frames the texture, it never repaints it
  useEffect(() => {
    const A = size.width / Math.max(1, size.height);
    const T = tw / th;
    if (T > A) { texture.repeat.set(A / T, 1); texture.offset.set((1 - A / T) / 2, 0); }
    else { texture.repeat.set(1, T / A); texture.offset.set(0, (1 - T / A) / 2); }
    invalidate();
  }, [size.width, size.height, tw, th, texture, invalidate]);
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

/** A scene light's authored rest pose, plus the values the rig last wrote to it. */
interface LightBase {
  pos: THREE.Vector3;
  intensity: number;
  setPos: THREE.Vector3;
  setIntensity: number;
}

/**
 * Turns the built-in scenes' lights with the Light rotation controls, so the cast shadow swings
 * with them instead of the HDRI moving on its own. Each scene preset authors its lights for the
 * rotation and intensity it ships with, so the controls are applied as a delta from those.
 */
function SceneLightRig({ preset, floorY, children }: { preset: ScenePresetId; floorY: number; children: React.ReactNode }) {
  const authored = getScene(preset);
  const group = useRef<THREE.Group>(null);
  const aim = useMemo(() => new THREE.Euler(), []);
  const swing = useMemo(() => new THREE.Vector3(), []);
  const base = useMemo(() => new WeakMap<THREE.Light, LightBase>(), []);
  useFrame(() => {
    const g = group.current, v = anim.values;
    if (!g || !v) return;
    aim.set(v["scene.lightRotX"] * DEG, (v["scene.lightRotY"] - authored.lightRotY) * DEG, 0);
    // at zero the control means "no rig of my own", not "no light at all", so the analytic lights
    // keep a floor and the device stays readable on the HDRI alone
    const gain = Math.max(0.15, v["scene.lightIntensity"] / Math.max(0.05, authored.lightIntensity));
    g.traverse((o) => {
      const light = o as THREE.Light;
      // the screen glow is the one point light, and it places and dims itself from the display
      if (!light.isLight || (light as THREE.PointLight).isPointLight) return;
      let b = base.get(light);
      // the scenes size their lights off the device, so anything we did not write ourselves is a
      // freshly authored value and becomes the new rest pose
      if (!b || b.setIntensity !== light.intensity || !b.setPos.equals(light.position)) {
        b = { pos: light.position.clone(), intensity: light.intensity, setPos: new THREE.Vector3(), setIntensity: NaN };
        base.set(light, b);
      }
      // the lights are parented to the floor, but they should orbit the device, so the swing is
      // taken in world space and put back into the group's frame afterwards
      swing.copy(b.pos).setY(b.pos.y + floorY).applyEuler(aim);
      light.position.set(swing.x, swing.y - floorY, swing.z);
      light.intensity = b.intensity * gain;
      b.setPos.copy(light.position);
      b.setIntensity = light.intensity;
    });
  }, -20);
  return <group ref={group}>{children}</group>;
}

/**
 * The studio backdrop ships with no room at all, so the Light controls had nothing analytic to
 * turn: the HDRI swung but nothing cast anything. This is its key — authored at the pose the
 * preset ships with, so SceneLightRig swings it from there — plus a shadow-only catcher that is
 * invisible everywhere the shadow does not land, which keeps the backdrop flat. The catcher drops
 * out of a transparent render the way the other scenes' floors do; the light stays.
 */
function BackdropKey({ floorY, fitSize, soft, opacity }: { floorY: number; fitSize: number; soft: number; opacity: number }) {
  const transparent = useRenderFlags((s) => s.transparent);
  const mat = useRef<THREE.ShadowMaterial>(null);
  const base = Math.min(0.8, 0.1 + opacity * 0.55);
  // dimming the key has to lighten what it casts too, or the shadow floats on at full strength
  // under a light that is no longer there
  useFrame(() => {
    const m = mat.current, v = anim.values;
    if (!m || !v) return;
    m.opacity = base * Math.min(1, Math.max(0.15, v["scene.lightIntensity"]));
  }, -19);
  const f = fitSize;
  return (
    <group position={[0, floorY, 0]}>
      <directionalLight
        position={[-f * 1.5, f * 3.1, f * 1.5]}
        intensity={0.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={Math.max(1, 1 + soft * 120)}
        shadow-blurSamples={Math.round(8 + soft * 16)}
      >
        <orthographicCamera attach="shadow-camera" args={[-f * 1.6, f * 1.6, f * 1.6, -f * 1.6, 0.1, f * 22]} />
      </directionalLight>
      {!transparent && (
        // sits just under the contact blob and writes no depth, so the two shadows blend instead of
        // clipping each other
        // double-sided so the shadow still reads from the low camera angles most presets use
        <mesh position={[0, -0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[f * 30, f * 30]} />
          <shadowMaterial ref={mat} transparent depthWrite={false} opacity={base} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

export function SceneRoot() {
  const layout = useDeviceLayout();
  const scenePreset = useShotView().scene;
  const contactShadow = useEditor((s) => s.project.scene.contactShadow);
  const shadowSoft = useEditor((s) => s.project.scene.shadowSoft ?? 0.5);
  const shadowOpacity = useEditor((s) => s.project.scene.shadowOpacity ?? 0.5);
  // a lit scene shows a flat colour behind it, and the floor terminates on that colour so the two
  // meet without a horizon line
  const backdrop = useEditor((s) => s.project.scene.background.color);
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
        <SceneLightRig preset={scenePreset} floorY={layout.floorY}>
          <EnvScene preset={scenePreset} floorY={layout.floorY} fitSize={layout.fitSize} backdrop={backdrop} />
          {scenePreset === "custom" && contactShadow && <BackdropKey floorY={layout.floorY} fitSize={layout.fitSize} soft={shadowSoft} opacity={shadowOpacity} />}
        </SceneLightRig>
      </Suspense>
      <Device layout={layout} />
      {shadowsOn && (
        // A key light alone leaves the device looking like it hovers. This is the tight occlusion
        // right under it, which is what actually sits it on the ground.
        <DeviceOnly>
          <ContactShadows position={[0, layout.floorY + 0.0015, 0]} scale={layout.fitSize * 1.45} blur={2.4} opacity={Math.min(0.85, 0.28 + shadowOpacity * 0.5)} far={layout.fitSize * 0.4} resolution={1024} color="#000000" />
        </DeviceOnly>
      )}
      {!shadowsOn && contactShadow && (
        <DeviceOnly>
          <ContactShadows position={[0, layout.floorY - 0.004, 0]} scale={layout.fitSize * (2.2 + shadowSoft * 1.4)} blur={0.6 + shadowSoft * 4} opacity={shadowOpacity} far={layout.fitSize * (0.8 + shadowSoft * 1.2)} resolution={1024} color="#000000" />
        </DeviceOnly>
      )}
      <PostFX />
    </>
  );
}
