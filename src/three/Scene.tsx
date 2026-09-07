"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
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
import { CARD_Z, CardLayer, FadeOverlay, setToneMapped } from "@/three/CardLayer";
import { rasterSize } from "@/three/raster";
import { ContactShadow } from "@/three/ContactShadow";
import { resizeShadowMap, useRenderQuality } from "@/three/renderQuality";
import { acquireEnvironment } from "@/three/environmentAssets";
import { resolveShotEffects } from "@/lib/shotView";
import { calibrateShadow } from "@/three/shadowCalibration";

const DEG = Math.PI / 180;

/** Evaluates the timeline into `anim` once per frame and drives playback. */
function Driver() {
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);

  useEffect(() => {
    viewport.get = get;
    const unsubs = [
      useEditor.subscribe((s) => s.project, () => invalidate()),
      useUI.subscribe((s) => s.time, () => invalidate()),
      useUI.subscribe((s) => s.playing, () => invalidate()),
      useRenderFlags.subscribe(() => invalidate()),
    ];
    invalidate();
    return () => { unsubs.forEach((u) => u()); viewport.get = null; };
  }, [get, invalidate]);

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
    const fade = resolveShotEffects(p, loc.shot).find((e) => e.id === "screenFade" && e.enabled);
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

/** Keep camera-mounted title/fade planes inside the frustum at every subject distance. */
export function cameraClipRange(distance: number) {
  return { near: Math.min(CARD_Z * 0.25, Math.max(0.05, distance * 0.03)), far: Math.max(50, distance * 40) };
}

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
    // Card and fade planes travel with the camera, so zooming away from a large device must not
    // move the near plane through those overlays.
    const { near, far } = cameraClipRange(dist);
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
  const tier = useRenderQuality().hdrTier;
  const displayed = useRef<{ texture: THREE.Texture; release: () => void } | null>(null);
  useEffect(() => {
    const incoming = acquireEnvironment(gl, preset.file, tier);
    let cancelled = false, promoted = false;
    void incoming.promise.then((rt) => {
      if (cancelled) return;
      const previous = displayed.current;
      displayed.current = { texture: rt.texture, release: incoming.release };
      scene.environment = rt.texture;
      promoted = true;
      previous?.release();
      invalidate();
    }, () => { if (!cancelled) useUI.getState().showToast("Lighting could not load. The previous lighting is still in use."); });
    return () => { cancelled = true; if (!promoted) incoming.release(); };
  }, [preset.file, tier, gl, scene, invalidate]);
  useEffect(() => () => {
    const current = displayed.current;
    if (scene.environment === current?.texture) scene.environment = null;
    current?.release(); displayed.current = null;
  }, [scene]);
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
    const edge = Math.min(gl.capabilities.maxTextureSize, anim.exporting ? 4096 : 2048, Math.max(size.width, size.height));
    if (bg.type === "image" && media) {
      return rasterSize(media.width, media.height, edge);
    }
    return rasterSize(Math.max(1024, edge), Math.max(1024, edge), Math.max(1024, edge));
  }, [bg.type, media, gl, size.width, size.height]);

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
      paintImage(ctx, media.element as CanvasImageSource, media.width, media.height, tw, th, bg.blur, bg.color);
    } else {
      paintPreset(ctx, tw, th, getBgPreset(bg.preset), bg.blur);
    }
    texture.needsUpdate = true;
    scene.background = texture;
    invalidate();
  }, [bg, preset, transparent, media, tw, th, scene, gl, canvas, texture, bgColor, invalidate]);

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

function ShadowCalibration({ floorY, fitSize }: { floorY: number; fitSize: number }) {
  const resolution = useRenderQuality().shadow;
  useFrame(({ scene }) => {
    const device = scene.getObjectByName("device");
    if (!device || anim.card) return;
    device.updateWorldMatrix(true, true);
    scene.traverseVisible((object) => {
      const light = object as THREE.DirectionalLight;
      if (light.castShadow && (light.isDirectionalLight || (object as THREE.SpotLight).isSpotLight)) calibrateShadow(light, device, floorY, fitSize, resolution);
    });
  }, -16);
  return null;
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
  const quality = useRenderQuality();
  const shadowRef = useCallback((light: THREE.DirectionalLight | null) => { if (light) resizeShadowMap(light.shadow, quality.shadow); }, [quality.shadow]);
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
        ref={shadowRef}
        position={[-f * 1.5, f * 3.1, f * 1.5]}
        intensity={0.7}
        castShadow
        shadow-mapSize={[quality.shadow, quality.shadow]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={Math.max(1, 1 + soft * 120) * quality.shadow / 2048}
        shadow-blurSamples={Math.round(8 + soft * 16)}
      >
        <orthographicCamera attach="shadow-camera" args={[-f * 1.6, f * 1.6, f * 1.6, -f * 1.6, 0.1, f * 22]} />
      </directionalLight>
      {!transparent && (
        // Sits just under the contact blob and writes no depth, so the two shadows blend instead of
        // clipping each other, and is double-sided so it still reads from the low camera angles most
        // presets use. It is sized to the shadow camera above: past that boundary the shadow lookup
        // clamps to the edge of the map and paints a flat tint with a hard straight edge, which on a
        // smooth backdrop shows up as a line ruled across the frame.
        <mesh position={[0, -0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[f * 3.2, f * 3.2]} />
          <shadowMaterial ref={mat} transparent depthWrite={false} opacity={base} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

export function SceneRoot() {
  const quality = useRenderQuality();
  const layout = useDeviceLayout();
  // Framing can shrink for a landscape canvas; room and shadow bounds follow physical size.
  const sceneSize = layout.sceneSize;
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
          <EnvScene preset={scenePreset} floorY={layout.floorY} fitSize={sceneSize} backdrop={backdrop} />
          {scenePreset === "custom" && contactShadow && <BackdropKey floorY={layout.floorY} fitSize={sceneSize} soft={shadowSoft} opacity={shadowOpacity} />}
        </SceneLightRig>
      </Suspense>
      <Device layout={layout} />
      <ShadowCalibration floorY={layout.floorY} fitSize={sceneSize} />
      {shadowsOn && (
        // A key light alone leaves the device looking like it hovers. This is the tight occlusion
        // right under it, which is what actually sits it on the ground.
        <DeviceOnly>
          <ContactShadow position={[0, layout.floorY + 0.0015, 0]} scale={sceneSize * 1.45} blur={2.4} opacity={Math.min(0.85, 0.28 + shadowOpacity * 0.5)} far={sceneSize * 0.4} resolution={quality.contact} />
        </DeviceOnly>
      )}
      {!shadowsOn && contactShadow && (
        <DeviceOnly>
          <ContactShadow position={[0, layout.floorY - 0.004, 0]} scale={sceneSize * (2.2 + shadowSoft * 1.4)} blur={0.6 + shadowSoft * 4} opacity={shadowOpacity} far={sceneSize * (0.8 + shadowSoft * 1.2)} resolution={quality.contact} />
        </DeviceOnly>
      )}
      <PostFX />
    </>
  );
}
