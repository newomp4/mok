"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { anim } from "./anim";
import { CARD_Z, cardFrag, cardVert, drawText, enterExitAt } from "./CardLayer";
import { useRenderShot } from "./Device";
import { rasterSize } from "./raster";
import { ensureFont, isFontReady, onFontsReady } from "@/lib/fonts";
import { shotKind } from "@/lib/defaults";

/** Camera-mounted caption. Room meshes sort before -50; devices remain at their normal order. */
export function CaptionLayer() {
  const mesh = useRef<THREE.Mesh>(null), last = useRef("");
  const shot = useRenderShot(), invalidate = useThree((s) => s.invalidate);
  const canvas = useMemo(() => { const c = document.createElement("canvas"); c.width = c.height = 16; return c; }, []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
    return t;
  }, [canvas]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    name: "Caption overlay",
    uniforms: { map: { value: texture }, opacity: { value: 1 }, blurRadius: { value: 0 }, time: { value: 0 }, effect: { value: 0 }, res: { value: new THREE.Vector2(16, 16) } },
    vertexShader: cardVert, fragmentShader: cardFrag, transparent: true, depthWrite: false, depthTest: false,
    blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }), [texture]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => { texture.dispose(); material.dispose(); geometry.dispose(); }, [texture, material, geometry]);
  useEffect(() => onFontsReady(() => { last.current = ""; invalidate(); }), [invalidate]);
  const caption = shot?.caption;
  useEffect(() => {
    if (!caption?.enabled) return;
    let alive = true;
    void ensureFont(caption.text.font, caption.text.weight).then(() => { if (alive) { last.current = ""; invalidate(); } });
    return () => { alive = false; };
  }, [caption?.enabled, caption?.text.font, caption?.text.weight, invalidate]);
  useFrame((state) => {
    const m = mesh.current, current = anim.shot, c = current?.caption;
    if (!m) return;
    m.visible = !!current && shotKind(current) === "media" && !!c?.enabled && !!c.text.text.trim();
    if (!m.visible || !current || !c) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const viewH = 2 * CARD_Z * Math.tan(cam.fov * Math.PI / 360), viewW = viewH * state.size.width / Math.max(1, state.size.height);
    const dpr = anim.exporting ? 1 : Math.min(2, state.viewport.dpr);
    const [w, h] = rasterSize(state.size.width * dpr, state.size.height * dpr, Math.min(state.gl.capabilities.maxTextureSize, anim.exporting ? 4096 : 2048));
    const signature = `${w}x${h}|${JSON.stringify(c.text)}|${isFontReady(c.text.font, c.text.weight)}`;
    if (signature !== last.current) {
      last.current = signature;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; texture.dispose(); texture.source = new THREE.Source(canvas); }
      drawText(canvas.getContext("2d")!, w, h, c.text); texture.needsUpdate = true;
      (material.uniforms.res.value as THREE.Vector2).set(w, h);
    }
    const timing = c.timing ?? { offset: 0, duration: current.duration };
    const fx = enterExitAt({ duration: timing.duration, enter: c.enter, exit: c.exit }, timing.offset + anim.localT);
    const front = c.layer !== "behind";
    if (material.transparent !== front) { material.transparent = front; material.blending = front ? THREE.NormalBlending : THREE.CustomBlending; material.needsUpdate = true; }
    m.renderOrder = front ? 902 : -50;
    m.position.set((c.x + fx.dx) * viewW, (c.y + fx.dy) * viewH, -CARD_Z);
    m.scale.set(viewW * fx.scale, viewH * fx.scale, 1);
    material.uniforms.opacity.value = fx.opacity; material.uniforms.blurRadius.value = fx.blur; material.uniforms.time.value = anim.localT;
  }, -10);
  return <mesh ref={mesh} name="caption-overlay" geometry={geometry} material={material} frustumCulled={false} visible={false} />;
}
