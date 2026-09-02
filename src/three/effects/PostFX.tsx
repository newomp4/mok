"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom, ChromaticAberration, DepthOfField, Noise, Pixelation, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { anim } from "@/three/anim";
import { viewport } from "@/three/registry";
import { FocusBlurEffect, GlassBorderEffect, SharpenEffect, createLensDistortion } from "./effects";
import { getEffectDef } from "@/lib/presets";

export function PostFX() {
  const blurMode = useEditor((s) => s.project.blur.mode);
  const bokeh = useEditor((s) => s.project.blur.bokeh);
  const effects = useEditor((s) => s.project.effects);
  const composerRef = useRef<EffectComposerImpl>(null);

  const focus = useMemo(() => new FocusBlurEffect(), []);
  const sharpen = useMemo(() => new SharpenEffect(), []);
  const glass = useMemo(() => new GlassBorderEffect(), []);
  const lens = useMemo(() => createLensDistortion(), []);
  const dofRef = useRef<DepthOfFieldEffect>(null);

  useEffect(() => () => { focus.dispose(); sharpen.dispose(); glass.dispose(); lens.dispose(); }, [focus, sharpen, glass, lens]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effects, sharpen, glass, lens]);

  useFrame(() => {
    const v = anim.values;
    if (!v) return;
    focus.setParams(v["blur.focusX"], 1 - v["blur.focusY"], v["blur.focusSize"], v["blur.falloff"], blurMode === "linear" ? "linear" : "radial", v["blur.strength"], bokeh);
    const dof = dofRef.current;
    if (dof) {
      dof.cocMaterial.worldFocusDistance = anim.camDist;
      dof.cocMaterial.worldFocusRange = Math.max(0.05, v["blur.focusSize"] * anim.camDist * 0.8);
      dof.bokehScale = v["blur.strength"] * 0.6;
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

  return (
    <EffectComposer ref={composerRef} multisampling={4} frameBufferType={THREE.HalfFloatType}>
      {blurMode === "depth" ? <DepthOfField ref={dofRef} worldFocusDistance={5} worldFocusRange={1} bokehScale={4} resolutionScale={0.75} /> : <></>}
      {blurMode === "radial" || blurMode === "linear" ? <primitive object={focus} /> : <></>}
      {bloomOn ? <Bloom mipmapBlur intensity={param("bloom", "intensity")} luminanceThreshold={param("bloom", "threshold")} radius={param("bloom", "radius")} levels={6} /> : <></>}
      {chromaOn ? <ChromaticAberration offset={new THREE.Vector2(chromaAmt, chromaAmt)} radialModulation modulationOffset={0.3} /> : <></>}
      {fisheyeOn ? <primitive object={lens} /> : <></>}
      {pixelOn ? <Pixelation granularity={param("pixel", "size")} /> : <></>}
      {sharpenOn ? <primitive object={sharpen} /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {glassOn ? <primitive object={glass} /> : <></>}
      {grainOn ? <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={param("grain", "amount") * 0.9} /> : <></>}
      {vignetteOn ? <Vignette darkness={param("vignette", "darkness")} offset={param("vignette", "offset")} eskil={false} /> : <></>}
    </EffectComposer>
  );
}
