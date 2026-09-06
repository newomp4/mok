"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { getDevice, getFinish } from "@/lib/devices";
import { getMedia, useMedia, type LoadedMedia } from "@/lib/media";
import { shotKind } from "@/lib/defaults";
import { ScreenSurface } from "@/three/screen";
import { createFinishMaterials, createScreenMaterial, disposeMaterials } from "@/three/materials";
import { ScreenReflection } from "@/three/ScreenReflection";
import { anim } from "@/three/anim";
import { paintPreset } from "@/three/background";
import { getBgPreset } from "@/lib/presets";
import { deviceLayout, type DeviceLayout } from "@/three/devices/layout";
import { PhoneModel } from "@/three/devices/Phone";
import { LaptopModel } from "@/three/devices/Laptop";
import { WatchModel } from "@/three/devices/Watch";
import { DesktopModel } from "@/three/devices/Desktop";
import { FlatModel } from "@/three/devices/Flat";
import { GlbDevice } from "@/three/devices/GlbModel";
import { useModelBounds, useShownDevice } from "@/three/registry";
import { useShallow } from "zustand/react/shallow";
import { locate } from "@/lib/animation";
import { resolveShotView, type ShotView } from "@/lib/shotView";
import { orientationFitSize, orientationQuarterTurn, orientedBounds, orientedScreenPixels, supportsOrientation } from "@/lib/orientation";
import { Suspense } from "react";
import type { Project } from "@/lib/types";

const DEG = Math.PI / 180;

/** Empty timeline gaps and an extended project tail hold a frame instead of playing its source. */
export function shouldPlayShotVideo(project: Project, time: number, playing: boolean, exporting = false): boolean {
  if (!playing || exporting) return false;
  const loc = locate(project, time);
  return !loc.inGap && !!loc.shot && shotKind(loc.shot) === "media" && loc.localT < loc.shot.duration;
}

export function useActiveShot() {
  const activeId = useUI((s) => s.activeShotId);
  return useEditor((s) => s.project.shots.find((x) => x.id === activeId) ?? s.project.shots[0] ?? null);
}

/** The shot the playhead sits on: what the viewport and an export are actually showing. */
export function useRenderShot() {
  const time = useUI((s) => s.time);
  return useEditor((s) => locate(s.project, time).shot);
}

/** Device, finish, scene and lighting for the shot on screen, falling back to the project. */
export function useShotView(): ShotView {
  const shot = useRenderShot();
  return useEditor(useShallow((s) => resolveShotView(s.project, shot)));
}

export function Device({ layout }: { layout: DeviceLayout }) {
  const view = useShotView();
  const deviceId = view.device;
  const finishId = view.finish;
  const reflection = useEditor((s) => s.project.mockup.reflection);
  const gloss = useEditor((s) => s.project.mockup.gloss ?? 1.3);
  const bandColor = useEditor((s) => s.project.mockup.bandColor);
  const borderRadius = useEditor((s) => s.project.mockup.borderRadius);
  const scenePreset = view.scene;
  const shot = useRenderShot() ?? null;
  const media = useMedia(shot?.media);
  const screenCfg = useEditor((s) => s.project.screen);
  const screenBgImage = useMedia(screenCfg.bg?.type === "image" ? screenCfg.bg.image : null);
  const invalidate = useThree((s) => s.invalidate);
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  const spec = getDevice(deviceId);
  const finish = getFinish(spec, finishId);
  const mats = useMemo(() => createFinishMaterials(finish), [finish]);
  useEffect(() => () => disposeMaterials(mats), [mats]);
  useEffect(() => {
    mats.band.color.set(bandColor ?? finish.band ?? "#2a2a2c");
    invalidate();
  }, [bandColor, finish.band, mats, invalidate]);
  useEffect(() => {
    if (!spec.model) useModelBounds.getState().set(spec.id, { features: {
      lid: spec.family === "laptop", island: !!(spec.island || spec.notch),
      caseParts: false, band: spec.family === "watch",
    } });
  }, [spec]);

  const surface = useMemo(() => new ScreenSurface(maxAniso), [maxAniso]);
  useEffect(() => () => surface.dispose(), [surface]);
  const applied = useRef<{ media: LoadedMedia | null; fit: string } | null>(null);
  const lastSample = useRef(-1);
  // re-sample the screen colour whenever the picture or the scene changes
  useEffect(() => { lastSample.current = -1; invalidate(); }, [media, scenePreset, shot?.fit, screenCfg.bg?.type, screenCfg.bg?.color, screenCfg.bg?.preset, screenBgImage, invalidate]);
  const screenMat = useMemo(() => createScreenMaterial(surface.texture), [surface]);
  useEffect(() => () => screenMat.dispose(), [screenMat]);

  // Size the screen canvas to the device's native resolution (or the media for flat devices). It
  // follows the layout's device rather than the picked one, so the model being held while a new one
  // loads keeps its own screen shape instead of being re-rasterised to the incoming aspect.
  useEffect(() => {
    surface.setQuarterTurn(layout.quarterTurn);
    if (layout.spec.family === "flat" && layout.flat) surface.setSize(layout.flat.px[0], layout.flat.px[1]);
    else surface.setSize(layout.spec.screenPx[0], layout.spec.screenPx[1]);
    invalidate();
  }, [layout.spec, surface, layout.flat, layout.quarterTurn, invalidate]);

  useEffect(() => {
    surface.setMedia(media, shot?.fit ?? "cover", { kind: spec.id === "browser" ? "browser" : "none", dark: finish.id === "dark" });
    applied.current = { media, fit: shot?.fit ?? "cover" };
    invalidate();
    const el = media?.element;
    if (el && media.kind === "video") {
      const v = el as HTMLVideoElement;
      const onSeeked = () => { surface.draw(); invalidate(); };
      v.addEventListener("seeked", onSeeked);
      return () => v.removeEventListener("seeked", onSeeked);
    }
  }, [media, shot?.fit, spec.id, finish.id, surface, invalidate]);

  // a gradient screen background is painted once into its own canvas and handed over like an upload
  const gradientCanvas = useMemo(() => document.createElement("canvas"), []);
  useEffect(() => {
    let img: HTMLImageElement | HTMLCanvasElement | null = null;
    if (screenCfg.bg?.type === "image" && screenBgImage?.kind === "image") img = screenBgImage.element as HTMLImageElement;
    else if (screenCfg.bg?.type === "gradient") {
      gradientCanvas.width = 1024;
      const [w, h] = orientedScreenPixels(layout.spec, layout.orientation);
      gradientCanvas.height = Math.round(1024 * (h / w));
      const ctx = gradientCanvas.getContext("2d");
      if (ctx) {
        paintPreset(ctx, gradientCanvas.width, gradientCanvas.height, getBgPreset(screenCfg.bg.preset ?? "whisp"), 0);
        img = gradientCanvas;
      }
    }
    surface.setBackground(screenCfg.bg?.color ?? "#000000", img);
    surface.setStatusBar(!!screenCfg.statusBar && spec.family === "phone");
    invalidate();
  }, [screenCfg.bg?.type, screenCfg.bg?.color, screenCfg.bg?.preset, screenCfg.statusBar, screenBgImage, spec.family, layout.spec, layout.orientation, surface, gradientCanvas, invalidate]);

  useEffect(() => {
    screenMat.clearcoat = reflection;
    screenMat.envMapIntensity = reflection;
    screenMat.needsUpdate = true;
    invalidate();
  }, [reflection, screenMat, invalidate]);

  const group = useRef<THREE.Group>(null);
  const orientationGroup = useRef<THREE.Group>(null);
  const standing = scenePreset !== "custom" && !spec.model && (spec.family === "phone" || spec.family === "tablet");
  const smoothRot = useRef<[number, number, number] | null>(null);

  useFrame((state, delta) => {
    const v = anim.values;
    if (!v || !group.current) return;
    const currentView = resolveShotView(anim.project ?? useEditor.getState().project, anim.shot);
    const quarterTurn = orientationQuarterTurn(layout.spec, currentView.orientation);
    if (orientationGroup.current) orientationGroup.current.rotation.z = quarterTurn * Math.PI / 2;
    surface.setQuarterTurn(quarterTurn);
    const pixels = layout.spec.family === "flat" && layout.flat ? layout.flat.px : layout.spec.screenPx;
    const exportEdge = Math.min(state.gl.capabilities.maxTextureSize, Math.max(state.size.width, state.size.height));
    surface.setSize(pixels[0], pixels[1], anim.exporting ? exportEdge : 2560, anim.exporting);
    const screenGrid = screenMat.userData.screenGrid;
    if (screenGrid) {
      const pixel = (anim.project ?? useEditor.getState().project).effects.find((effect) => effect.id === "pixel" && effect.enabled);
      screenGrid.strength.value = pixel ? (pixel.params.amount ?? 0.6) : 0;
      screenGrid.pitch.value = pixel?.params.size ?? 4;
      screenGrid.resolution.value.set(pixels[0], pixels[1]);
    }
    // the shot under the playhead decides what the screen shows (exports step through shots without React)
    const cur = anim.shot;
    group.current.visible = !anim.card;
    if (cur && shotKind(cur) === "media") {
      const m = cur.media ? getMedia(cur.media.id) : null;
      const fit = cur.fit ?? "cover";
      if (!applied.current || applied.current.media !== m || applied.current.fit !== fit) {
        applied.current = { media: m, fit };
        surface.setMedia(m, fit, { kind: spec.id === "browser" ? "browser" : "none", dark: finish.id === "dark" });
      }
    }
    const shotMedia = cur && shotKind(cur) === "media" && cur.media ? getMedia(cur.media.id) : media;
    // lit scenes take their screen glow from what is actually on the display, and scrubbing the
    // timeline moves through the video just as much as playing it does
    const liveScreen = shotMedia?.kind === "video";
    const target: [number, number, number] = [v["mockup.rotX"] + (standing ? -layout.lean : 0), v["mockup.rotY"], v["mockup.rotZ"]];
    const exact = anim.exporting || useUI.getState().playing;
    if (exact || !smoothRot.current) smoothRot.current = target;
    else {
      const k = 1 - Math.exp(-Math.min(delta, 0.05) * 18);
      let moving = false;
      const rot = smoothRot.current;
      for (let i = 0; i < 3; i++) {
        const d = target[i] - rot[i];
        if (Math.abs(d) < 0.01) rot[i] = target[i]; else { rot[i] += d * k; moving = true; }
      }
      if (moving) state.invalidate();
    }
    const r = smoothRot.current;
    group.current.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
    screenMat.emissiveIntensity = v["screen.brightness"] * anim.screenFade;
    if (shotMedia?.kind === "video") {
      const vid = shotMedia.element as HTMLVideoElement;
      const dur = vid.duration || 1;
      const speed = cur?.speed ?? 1;
      const t = ((cur?.trimStart ?? 0) + anim.localT * speed) % dur;
      const playing = shouldPlayShotVideo(anim.project ?? useEditor.getState().project, anim.time, useUI.getState().playing, anim.exporting);
      if (playing) {
        if (vid.playbackRate !== speed) vid.playbackRate = speed;
        if (vid.paused) vid.play().catch(() => {});
        if (Math.abs(vid.currentTime - t) > 0.35) vid.currentTime = t;
      } else {
        if (!vid.paused) vid.pause();
        if (!anim.exporting && Math.abs(vid.currentTime - t) > 0.04) vid.currentTime = t;
      }
      surface.draw();
    }
    // Sample after the current video frame is painted, including seeks and screen fades.
    if (scenePreset !== "custom" && (liveScreen || anim.exporting || lastSample.current < 0)) {
      lastSample.current = state.clock.elapsedTime;
      anim.screenColor = surface.averageColor();
    }
  }, -20);

  let model: React.ReactNode;
  if (spec.model) {
    model = (
      <Suspense fallback={null}>
        <GlbDevice spec={spec} finish={finish} screen={screenMat} gloss={gloss} />
      </Suspense>
    );
  } else switch (spec.family) {
    case "phone": model = <PhoneModel spec={spec} mats={mats} screen={screenMat} notch={view.notch} />; break;
    case "tablet": model = <PhoneModel spec={spec} mats={mats} screen={screenMat} tablet notch={view.notch} />; break;
    case "laptop": model = <LaptopModel spec={spec} mats={mats} screen={screenMat} notch={view.notch} />; break;
    case "watch": model = <WatchModel spec={spec} mats={mats} screen={screenMat} />; break;
    case "desktop": model = <DesktopModel spec={spec} mats={mats} screen={screenMat} />; break;
    default: model = <FlatModel spec={spec} mats={mats} screen={screenMat} size={layout.flat ?? { w: 192, h: 120 }} radius={borderRadius} finish={finish.id} />;
  }

  // procedural laptops are modelled from the floor up; glTF models are already centred
  const yOffset = !spec.model && spec.family === "laptop" ? -layout.height / 2 : 0;
  return (
    <>
      <group ref={group} name="device">
        <group ref={orientationGroup} name="device-orientation" rotation={[0, 0, layout.quarterTurn * Math.PI / 2]}>
          <group position={[0, yOffset, 0]}>{model}</group>
        </group>
      </group>
      <ScreenReflection material={screenMat} amount={reflection} />
    </>
  );
}

export function useDeviceLayout(): DeviceLayout {
  const view = useShotView();
  const deviceId = view.device;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const shot = useRenderShot();
  // while a newly picked glTF model prepares, the one still on screen keeps the framing: fitting the
  // camera to a device that has not arrived yet would shrink and re-frame the one you are looking at
  const shownId = useShownDevice((s) => s.id);
  const held = shownId && shownId !== deviceId && getDevice(deviceId).model && getDevice(shownId).model ? shownId : deviceId;
  const spec = getDevice(held);
  const bounds = useModelBounds((s) => s.bounds[held]);
  return useMemo(() => {
    const base = deviceLayout(spec, shot?.media ?? null, view.orientation, aspect);
    if (spec.model && bounds) {
      const oriented = orientedBounds(bounds, base.quarterTurn);
      const legacyFit = Math.max(bounds.width, bounds.height) * 1.04;
      return { ...base, floorY: oriented.floorY, height: oriented.height, lean: 0, sceneSize: legacyFit, fitSize: supportsOrientation(spec) ? orientationFitSize(oriented.width, oriented.height, legacyFit, base.quarterTurn, aspect) : legacyFit };
    }
    return base;
  }, [spec, shot?.media, bounds, view.orientation, aspect]);
}
