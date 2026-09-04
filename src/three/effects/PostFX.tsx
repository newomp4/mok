"use client";
import { useEffect, useMemo, useRef } from "react";
import { useShotView } from "@/three/Device";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, ChromaticAberration, DepthOfField, Noise, Pixelation, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { anim } from "@/three/anim";
import { viewport } from "@/three/registry";
import { FocusBlurEffect, GhostEffect, GlassBorderEffect, LiquidGlassEffect, SharpenEffect, createLensDistortion } from "./effects";
import { getEffectDef } from "@/lib/presets";
import { CARD_Z } from "@/three/CardLayer";

export function PostFX() {
  const view = useShotView();
  const blurMode = view.blurMode;
  const bokeh = view.bokeh;
  const effects = useEditor((s) => s.project.effects);
  const borderRadius = useEditor((s) => s.project.mockup.borderRadius);
  const composerRef = useRef<EffectComposerImpl>(null);

  const focus = useMemo(() => new FocusBlurEffect(), []);
  const sharpen = useMemo(() => new SharpenEffect(), []);
  const glass = useMemo(() => new GlassBorderEffect(), []);
  const lens = useMemo(() => createLensDistortion(), []);
  const ghost = useMemo(() => new GhostEffect(), []);
  const liquid = useMemo(() => new LiquidGlassEffect(), []);
  const dofRef = useRef<DepthOfFieldEffect>(null);
  const scene = useThree((s) => s.scene);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const coverFor = useRef<THREE.Object3D | null>(null);
  const coverInv = useMemo(() => new THREE.Matrix4(), []);
  const focusNdc = useMemo(() => new THREE.Vector2(), []);
  const focusHits = useRef<THREE.Intersection[]>([]);
  const coverBox = useMemo(() => new THREE.Box3(), []);
  const coverPoint = useMemo(() => new THREE.Vector3(), []);
  const lastFocusKey = useRef("");
  const focusRayWait = useRef(0);
  const focusTarget = useRef<number | null>(null);

  useEffect(() => () => { focus.dispose(); sharpen.dispose(); glass.dispose(); lens.dispose(); ghost.dispose(); liquid.dispose(); }, [focus, sharpen, glass, lens, ghost, liquid]);

  useEffect(() => {
    viewport.composer = composerRef.current;
    return () => { viewport.composer = null; };
  });

  // the composer only resizes when the CSS size changes, so a pixel-ratio change (a different
  // monitor, browser zoom) would otherwise leave every pass at the old buffer resolution
  const dpr = useThree((s) => s.viewport.dpr);
  const size = useThree((s) => s.size);
  useEffect(() => {
    composerRef.current?.setSize(size.width, size.height);
  }, [dpr, size.width, size.height]);

  const on = (id: string) => effects.find((e) => e.id === id && e.enabled);
  const param = (id: string, key: string, fallback = 0) => {
    const e = on(id);
    const def = getEffectDef(id as never).params.find((p) => p.key === key);
    return e?.params[key] ?? def?.default ?? fallback;
  };

  useEffect(() => {
    sharpen.amount = param("sharpen", "amount");
    glass.width = param("glassBorder", "width");
    glass.opacity = param("glassBorder", "opacity");
    const k = param("fisheye", "amount");
    lens.distortion.set(k, k);
    ghost.set(param("ghost", "offset"), param("ghost", "angle"), param("ghost", "opacity"), param("ghost", "blur"));
    // the pane is glass laid over the mockup, so by default its corners are the mockup's corners
    const follow = param("liquidGlass", "follow") >= 0.5;
    const radius = follow ? Math.min(0.5, borderRadius * 4) : param("liquidGlass", "radius");
    liquid.set(param("liquidGlass", "x"), param("liquidGlass", "y"), param("liquidGlass", "width"), param("liquidGlass", "height"), radius, param("liquidGlass", "refraction"), param("liquidGlass", "tint"), param("liquidGlass", "dispersion"), param("liquidGlass", "shine"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effects, sharpen, glass, lens, ghost, liquid, borderRadius]);

  useFrame((state) => {
    const v = anim.values;
    if (!v) return;
    focus.setParams(v["blur.focusX"], 1 - v["blur.focusY"], v["blur.focusSize"], v["blur.falloff"], blurMode === "linear" ? "linear" : blurMode === "directional" ? "directional" : "radial", v["blur.strength"], bokeh, v["blur.angle"]);
    const dof = dofRef.current;
    if (dof) {
      // focal point: the surface under the focus position (autofocus), smoothed so it never pops
      const cam = state.camera;
      cam.updateWorldMatrix(true, false); // the rig moved it this frame; matrices are otherwise refreshed at render time
      // a recursive raycast through the whole device model is far too heavy to run on every
      // camera move, so compare a coarse pose (position and view direction) and leave a few
      // frames between casts; an export pays for every frame so its focus never lags
      // the right vector is part of the pose too: rolling the camera leaves its position and its
      // view direction alone, but an off-centre focus point then lands somewhere else entirely
      const m = cam.matrixWorld.elements;
      const key = `${v["blur.focusX"].toFixed(2)}|${v["blur.focusY"].toFixed(2)}|${m[12].toFixed(2)},${m[13].toFixed(2)},${m[14].toFixed(2)},${m[8].toFixed(2)},${m[9].toFixed(2)},${m[10].toFixed(2)},${m[0].toFixed(2)},${m[1].toFixed(2)},${m[2].toFixed(2)}`;
      if (focusRayWait.current > 0) focusRayWait.current--;
      if (key !== lastFocusKey.current) {
        if (focusRayWait.current > 0) state.invalidate(); // come back for the cast being skipped
        else {
          lastFocusKey.current = key;
          focusRayWait.current = anim.exporting ? 0 : 4;
          focusNdc.set(v["blur.focusX"] * 2 - 1, 1 - v["blur.focusY"] * 2);
          raycaster.setFromCamera(focusNdc, cam);
          const device = scene.getObjectByName("device");
          const hits = focusHits.current;
          if (device) raycaster.intersectObject(device, true, hits);
          const hit = hits.find((h) => h.object.visible);
          focusTarget.current = hit ? hit.distance : anim.camDist;
          hits.length = 0; // the intersections hold scene objects; do not keep them alive between casts
        }
      }
      const manual = v["blur.focusDistance"] ?? 0;
      const target = manual > 0.001 ? manual : (focusTarget.current ?? anim.camDist);
      if (anim.exporting || Math.abs(target - anim.focusDist) < 1e-3) anim.focusDist = target;
      else { anim.focusDist += (target - anim.focusDist) * 0.35; state.invalidate(); }
      // the CoC pass caches camera near/far; refresh it since the rig adapts them per frame
      dof.cocMaterial.adoptCameraSettings(cam);
      (viewport as unknown as { dof: unknown }).dof = dof; // debug handle for QA
      if (anim.card) {
        // text / logo cards sit right in front of the lens: keep them sharp
        dof.cocMaterial.worldFocusDistance = CARD_Z;
        dof.cocMaterial.worldFocusRange = 10;
      } else {
        dof.cocMaterial.worldFocusDistance = anim.focusDist;
        dof.cocMaterial.worldFocusRange = Math.max(0.02, v["blur.focusSize"] * anim.camDist * 0.5);
      }
      dof.bokehScale = v["blur.strength"] * 0.35;
    }
    // a card shot draws with the depth test off, so the echo has no surface to sit behind
    ghost.ignoreDepth = anim.card;
    // cover mode drops the placement sliders and lays the pane over the mockup's own footprint,
    // which has to be measured every frame because both the camera and the device keep moving
    const coverMode = on("liquidGlass") ? Math.round(param("liquidGlass", "cover")) : 0;
    // 2 is the whole frame, which needs no measurement at all
    if (coverMode === 2) liquid.setRect(0.5, 0.5, 1, 1);
    if (coverMode === 1) {
      const device = anim.card ? null : scene.getObjectByName("device");
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ok = false;
      if (device) {
        const cam = state.camera;
        cam.updateWorldMatrix(true, false); // the rig moved both this frame; matrices are otherwise refreshed at render time
        device.updateWorldMatrix(true, false);
        // measured once in the device's own frame and then carried by its matrix: traversing every
        // mesh each frame is what the autofocus raycast above is throttled to avoid, and the
        // oriented box also hugs a rotated mockup far more closely than a world one
        if (coverFor.current !== device) {
          coverFor.current = device;
          device.updateMatrixWorld(true);
          coverBox.setFromObject(device);
          coverBox.applyMatrix4(coverInv.copy(device.matrixWorld).invert());
        }
        ok = !coverBox.isEmpty();
        for (let i = 0; i < 8 && ok; i++) {
          coverPoint.set(i & 1 ? coverBox.max.x : coverBox.min.x, i & 2 ? coverBox.max.y : coverBox.min.y, i & 4 ? coverBox.max.z : coverBox.min.z);
          coverPoint.applyMatrix4(device.matrixWorld);
          coverPoint.project(cam);
          // a corner behind the lens projects to nonsense, so take the fallback rather than a wild pane
          if (!(coverPoint.z >= -1 && coverPoint.z <= 1)) { ok = false; break; }
          minX = Math.min(minX, coverPoint.x); maxX = Math.max(maxX, coverPoint.x);
          minY = Math.min(minY, coverPoint.y); maxY = Math.max(maxY, coverPoint.y);
        }
      }
      // a little air around the mockup so the pane's lit edge reads as glass laid over it, and a pane
      // that runs past the frame stays that way rather than drawing its rim across the picture
      if (ok) liquid.setRect((minX + maxX) / 4 + 0.5, (minY + maxY) / 4 + 0.5, Math.min(1, (maxX - minX) / 4 + 0.02), Math.min(1, (maxY - minY) / 4 + 0.02));
      else liquid.setRect(0.5, 0.5, 0.34, 0.34);
    }
  }, -5);

  const bloomOn = !!on("bloom");
  const chromaOn = !!on("chromatic");
  const chromaAmt = param("chromatic", "amount") * 0.004;
  const grainOn = !!on("grain");
  const vignetteOn = !!on("vignette");
  const pixelOn = !!on("pixel");
  const fisheyeOn = !!on("fisheye");
  const sharpenOn = !!on("sharpen");
  const glassOn = !!on("glassBorder");
  const ghostOn = !!on("ghost");
  const liquidOn = !!on("liquidGlass");

  return (
    <EffectComposer ref={composerRef} multisampling={blurMode === "depth" ? 0 : 4} frameBufferType={THREE.HalfFloatType}>
      {blurMode === "depth" ? <SMAA /> : <></>}
      {blurMode === "depth" ? <DepthOfField ref={dofRef} worldFocusDistance={5} worldFocusRange={1} bokehScale={4} resolutionScale={0.75} /> : <></>}
      {blurMode === "radial" || blurMode === "linear" || blurMode === "directional" ? <primitive object={focus} /> : <></>}
      {chromaOn ? <ChromaticAberration offset={new THREE.Vector2(chromaAmt, chromaAmt)} radialModulation modulationOffset={0.3} /> : <></>}
      {fisheyeOn ? <primitive object={lens} /> : <></>}
      {pixelOn ? <Pixelation granularity={param("pixel", "size")} /> : <></>}
      {sharpenOn ? <primitive object={sharpen} /> : <></>}
      {ghostOn ? <primitive object={ghost} /> : <></>}
      {liquidOn ? <primitive object={liquid} /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {bloomOn ? <Bloom mipmapBlur intensity={param("bloom", "intensity")} luminanceThreshold={param("bloom", "threshold")} radius={param("bloom", "radius")} levels={6} /> : <></>}
      {glassOn ? <primitive object={glass} /> : <></>}
      {grainOn ? <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={param("grain", "amount") * 0.9} /> : <></>}
      {vignetteOn ? <Vignette darkness={param("vignette", "darkness")} offset={param("vignette", "offset")} eskil={false} /> : <></>}
    </EffectComposer>
  );
}
