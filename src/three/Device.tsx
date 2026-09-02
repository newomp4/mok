"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { getDevice, getFinish } from "@/lib/devices";
import { useMedia } from "@/lib/media";
import { ScreenSurface } from "@/three/screen";
import { createFinishMaterials, createScreenMaterial, disposeMaterials } from "@/three/materials";
import { anim } from "@/three/anim";
import { deviceLayout, type DeviceLayout } from "@/three/devices/layout";
import { PhoneModel } from "@/three/devices/Phone";
import { LaptopModel } from "@/three/devices/Laptop";
import { WatchModel } from "@/three/devices/Watch";
import { DesktopModel } from "@/three/devices/Desktop";
import { FlatModel } from "@/three/devices/Flat";
import { GlbDevice } from "@/three/devices/GlbModel";
import { useModelBounds } from "@/three/registry";
import { Suspense } from "react";

const DEG = Math.PI / 180;

export function useActiveShot() {
  const activeId = useUI((s) => s.activeShotId);
  return useEditor((s) => s.project.shots.find((x) => x.id === activeId) ?? s.project.shots[0] ?? null);
}

export function Device({ layout }: { layout: DeviceLayout }) {
  const deviceId = useEditor((s) => s.project.mockup.device);
  const finishId = useEditor((s) => s.project.mockup.finish);
  const reflection = useEditor((s) => s.project.mockup.reflection);
  const gloss = useEditor((s) => s.project.mockup.gloss ?? 1.3);
  const borderRadius = useEditor((s) => s.project.mockup.borderRadius);
  const scenePreset = useEditor((s) => s.project.scene.preset);
  const shot = useActiveShot();
  const media = useMedia(shot?.media);
  const invalidate = useThree((s) => s.invalidate);
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  const spec = getDevice(deviceId);
  const finish = getFinish(spec, finishId);
  const mats = useMemo(() => createFinishMaterials(finish), [finish]);
  useEffect(() => () => disposeMaterials(mats), [mats]);

  const surface = useMemo(() => new ScreenSurface(maxAniso), [maxAniso]);
  useEffect(() => () => surface.dispose(), [surface]);
  const screenMat = useMemo(() => createScreenMaterial(surface.texture), [surface]);
  useEffect(() => () => screenMat.dispose(), [screenMat]);

  // size the screen canvas to the device's native resolution (or the media for flat devices)
  useEffect(() => {
    if (spec.family === "flat" && layout.flat) surface.setSize(layout.flat.px[0], layout.flat.px[1]);
    else surface.setSize(spec.screenPx[0], spec.screenPx[1]);
    invalidate();
  }, [spec, surface, layout.flat, invalidate]);

  useEffect(() => {
    surface.setMedia(media, shot?.fit ?? "cover", { kind: spec.id === "browser" ? "browser" : "none", dark: finish.id === "dark" });
    invalidate();
    const el = media?.element;
    if (el && media.kind === "video") {
      const v = el as HTMLVideoElement;
      const onSeeked = () => { surface.draw(); invalidate(); };
      v.addEventListener("seeked", onSeeked);
      return () => v.removeEventListener("seeked", onSeeked);
    }
  }, [media, shot?.fit, spec.id, finish.id, surface, invalidate]);

  useEffect(() => {
    screenMat.clearcoat = reflection;
    screenMat.envMapIntensity = reflection;
    screenMat.needsUpdate = true;
    invalidate();
  }, [reflection, screenMat, invalidate]);

  const group = useRef<THREE.Group>(null);
  const standing = scenePreset !== "custom" && !spec.model && (spec.family === "phone" || spec.family === "tablet");

  useFrame(() => {
    const v = anim.values;
    if (!v || !group.current) return;
    group.current.rotation.set((v["mockup.rotX"] + (standing ? -layout.lean : 0)) * DEG, v["mockup.rotY"] * DEG, v["mockup.rotZ"] * DEG);
    screenMat.emissiveIntensity = v["screen.brightness"] * anim.screenFade;
    if (media?.kind === "video") {
      const vid = media.element as HTMLVideoElement;
      const dur = vid.duration || 1;
      const t = anim.localT % dur;
      const playing = useUI.getState().playing && !anim.exporting;
      if (playing) {
        if (vid.paused) vid.play().catch(() => {});
        if (Math.abs(vid.currentTime - t) > 0.35) vid.currentTime = t;
      } else {
        if (!vid.paused) vid.pause();
        if (!anim.exporting && Math.abs(vid.currentTime - t) > 0.04) vid.currentTime = t;
      }
      surface.draw();
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
    case "phone": model = <PhoneModel spec={spec} mats={mats} screen={screenMat} />; break;
    case "tablet": model = <PhoneModel spec={spec} mats={mats} screen={screenMat} tablet />; break;
    case "laptop": model = <LaptopModel spec={spec} mats={mats} screen={screenMat} />; break;
    case "watch": model = <WatchModel spec={spec} mats={mats} screen={screenMat} />; break;
    case "desktop": model = <DesktopModel spec={spec} mats={mats} screen={screenMat} />; break;
    default: model = <FlatModel spec={spec} mats={mats} screen={screenMat} size={layout.flat ?? { w: 192, h: 120 }} radius={borderRadius} finish={finish.id} />;
  }

  // procedural laptops are modelled from the floor up; glTF models are already centred
  const yOffset = !spec.model && spec.family === "laptop" ? -layout.height / 2 : 0;
  return (
    <group ref={group}>
      <group position={[0, yOffset, 0]}>{model}</group>
    </group>
  );
}

export function useDeviceLayout(): DeviceLayout {
  const deviceId = useEditor((s) => s.project.mockup.device);
  const shot = useActiveShot();
  const spec = getDevice(deviceId);
  const bounds = useModelBounds((s) => s.bounds[deviceId]);
  return useMemo(() => {
    const base = deviceLayout(spec, shot?.media ?? null);
    if (spec.model && bounds) {
      return { ...base, floorY: bounds.minY, height: bounds.height, lean: 0, fitSize: Math.max(bounds.width, bounds.height) * 1.04 };
    }
    return base;
  }, [spec, shot?.media, bounds]);
}
