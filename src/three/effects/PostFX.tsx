"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, ChromaticAberration, DepthOfField, Noise, Pixelation, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { anim } from "@/three/anim";
import { viewport } from "@/three/registry";
import { FocusBlurEffect, GhostEffect, GlassBorderEffect, LiquidGlassEffect, SharpenEffect, createLensDistortion } from "./effects";
import { getEffectDef } from "@/lib/presets";

export function PostFX() {
  const blurMode = useEditor((s) => s.project.blur.mode);
  const bokeh = useEditor((s) => s.project.blur.bokeh);
  const blurAngle = useEditor((s) => s.project.blur.angle ?? 0);
  const effects = useEditor((s) => s.project.effects);
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
  const lastFocusKey = useRef("");
  const focusTarget = useRef<number | null>(null);

  useEffect(() => () => { focus.dispose(); sharpen.dispose(); glass.dispose(); lens.dispose(); ghost.dispose(); liquid.dispose(); }, [focus, sharpen, glass, lens, ghost, liquid]);

  useEffect(() => {
    viewport.composer = composerRef.current;
    return () => { viewport.composer = null; };
  });

  const on = (id: string) => effects.find((e) => e.id === id && e.enabled);
  const param = (id: string, key: string) => {
    const e = on(id);
    const def = getEffectDef(id as never).params.find((p) => p.key === key);
    return e?.params[key] ?? def?.default ?? 0;
  };

  useEffect(() => {
    sharpen.amount = param("sharpen", "amount");
    glass.width = param("glassBorder", "width");
    glass.opacity = param("glassBorder", "opacity");
    const k = param("fisheye", "amount");
    lens.distortion.set(k, k);
    ghost.set(param("ghost", "offset"), param("ghost", "angle"), param("ghost", "opacity"));
    liquid.set(param("liquidGlass", "x"), param("liquidGlass", "y"), param("liquidGlass", "width"), param("liquidGlass", "height"), param("liquidGlass", "radius"), param("liquidGlass", "refraction"), param("liquidGlass", "tint"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effects, sharpen, glass, lens, ghost, liquid]);

  useFrame((state) => {
    const v = anim.values;
    if (!v) return;
    focus.setParams(v["blur.focusX"], 1 - v["blur.focusY"], v["blur.focusSize"], v["blur.falloff"], blurMode === "linear" ? "linear" : blurMode === "directional" ? "directional" : "radial", v["blur.strength"], bokeh, blurAngle);
    const dof = dofRef.current;
    if (dof) {
      // focal point: the surface under the focus position (autofocus), smoothed so it never pops
      const cam = state.camera;
      cam.updateWorldMatrix(true, false); // the rig moved it this frame; matrices are otherwise refreshed at render time
      const key = `${v["blur.focusX"].toFixed(3)}|${v["blur.focusY"].toFixed(3)}|${cam.matrixWorld.elements.map((e) => e.toFixed(3)).join(",")}`;
      if (key !== lastFocusKey.current) {
        lastFocusKey.current = key;
        raycaster.setFromCamera(new THREE.Vector2(v["blur.focusX"] * 2 - 1, 1 - v["blur.focusY"] * 2), cam);
        const device = scene.getObjectByName("device");
        const hit = device ? raycaster.intersectObject(device, true).find((h) => h.object.visible) : undefined;
        focusTarget.current = hit ? hit.distance : anim.camDist;
      }
      const target = focusTarget.current ?? anim.camDist;
      if (anim.exporting || Math.abs(target - anim.focusDist) < 1e-3) anim.focusDist = target;
      else { anim.focusDist += (target - anim.focusDist) * 0.35; state.invalidate(); }
      // the CoC pass caches camera near/far; refresh it since the rig adapts them per frame
      dof.cocMaterial.adoptCameraSettings(cam);
      (viewport as unknown as { dof: unknown }).dof = dof; // debug handle for QA
      dof.cocMaterial.worldFocusDistance = anim.focusDist;
      dof.cocMaterial.worldFocusRange = Math.max(0.02, v["blur.focusSize"] * anim.camDist * 0.5);
      dof.bokehScale = v["blur.strength"] * 0.35;
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
      {bloomOn ? <Bloom mipmapBlur intensity={param("bloom", "intensity")} luminanceThreshold={param("bloom", "threshold")} radius={param("bloom", "radius")} levels={6} /> : <></>}
      {chromaOn ? <ChromaticAberration offset={new THREE.Vector2(chromaAmt, chromaAmt)} radialModulation modulationOffset={0.3} /> : <></>}
      {fisheyeOn ? <primitive object={lens} /> : <></>}
      {pixelOn ? <Pixelation granularity={param("pixel", "size")} /> : <></>}
      {sharpenOn ? <primitive object={sharpen} /> : <></>}
      {ghostOn ? <primitive object={ghost} /> : <></>}
      {liquidOn ? <primitive object={liquid} /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {glassOn ? <primitive object={glass} /> : <></>}
      {grainOn ? <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={param("grain", "amount") * 0.9} /> : <></>}
      {vignetteOn ? <Vignette darkness={param("vignette", "darkness")} offset={param("vignette", "offset")} eskil={false} /> : <></>}
    </EffectComposer>
  );
}
