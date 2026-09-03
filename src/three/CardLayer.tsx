"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { anim } from "@/three/anim";
import { shotKind } from "@/lib/defaults";
import { getMedia } from "@/lib/media";
import { cssFamily, ensureFont, fontKey, getFont, isFontReady } from "@/lib/fonts";
import type { EnterExit, LogoStyle, Shot, TextStyle } from "@/lib/types";

const DEG = Math.PI / 180;
/** distance of the card plane in front of the camera */
export const CARD_Z = 0.6;

const EFFECT_INDEX = { none: 0, liquidMetal: 1, gemSmoke: 2, heatmap: 3 } as const;
const fontKeyOf = fontKey;

const cardFrag = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
uniform float time;
uniform int effect;
uniform vec2 res;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec4 tex = texture2D(map, vUv);
  vec3 col = tex.rgb;
  float a = tex.a;
  vec2 p = vUv * vec2(res.x / max(res.y, 1.0), 1.0);
  if (effect == 1) {
    // liquid metal: a chrome gradient warped by drifting noise
    float n = fbm(p * 3.0 + vec2(time * 0.25, -time * 0.15));
    float band = sin((p.y + p.x * 0.35 + n * 0.9) * 9.0 + time * 1.2);
    float v = smoothstep(-0.9, 0.9, band);
    vec3 dark = vec3(0.10, 0.10, 0.12), mid = vec3(0.58, 0.60, 0.66), light = vec3(0.98, 0.98, 1.0);
    col = mix(dark, mid, v);
    col = mix(col, light, pow(smoothstep(0.55, 1.0, v), 2.0));
    col += vec3(0.25) * pow(max(0.0, 1.0 - abs(band - 0.3)), 8.0);
    col = pow(col, vec3(2.2));
  } else if (effect == 2) {
    // gem smoke: layered fbm with a jewel palette
    float n1 = fbm(p * 2.2 + vec2(time * 0.12, time * 0.08));
    float n2 = fbm(p * 4.0 - vec2(time * 0.05, time * 0.16) + n1 * 1.5);
    vec3 c1 = vec3(0.45, 0.20, 0.95), c2 = vec3(0.10, 0.85, 0.95), c3 = vec3(0.98, 0.40, 0.75);
    col = mix(mix(c1, c2, smoothstep(0.3, 0.7, n1)), c3, smoothstep(0.55, 0.9, n2));
    col *= 0.55 + 0.7 * n2;
    col = pow(col, vec3(2.2));
  } else if (effect == 3) {
    // heatmap: thermal palette over slow noise
    float n = fbm(p * 2.6 + vec2(time * 0.10, -time * 0.07));
    n = smoothstep(0.2, 0.85, n);
    vec3 c;
    if (n < 0.25) c = mix(vec3(0.02, 0.02, 0.20), vec3(0.30, 0.0, 0.60), n * 4.0);
    else if (n < 0.5) c = mix(vec3(0.30, 0.0, 0.60), vec3(0.95, 0.20, 0.10), (n - 0.25) * 4.0);
    else if (n < 0.75) c = mix(vec3(0.95, 0.20, 0.10), vec3(1.0, 0.85, 0.10), (n - 0.5) * 4.0);
    else c = mix(vec3(1.0, 0.85, 0.10), vec3(1.0), (n - 0.75) * 4.0);
    col = pow(c, vec3(2.2));
  }
  gl_FragColor = vec4(col, a * opacity);
  #include <colorspace_fragment>
}`;

const cardVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

/** Opacity / offset / scale of the card content from its enter + exit animations. */
export function enterExitAt(shot: Shot, t: number): { opacity: number; dx: number; dy: number; scale: number } {
  let opacity = 1, dx = 0, dy = 0, scale = 1;
  const apply = (fx: EnterExit | undefined, p: number, dir: 1 | -1) => {
    if (!fx || fx.effect === "none" || p >= 1) return;
    const e = easeOutCubic(Math.max(0, p));
    const r = 1 - e;
    switch (fx.effect) {
      case "fade": opacity *= e; break;
      case "slideUp": opacity *= e; dy -= 0.12 * r * dir; break;
      case "slideDown": opacity *= e; dy += 0.12 * r * dir; break;
      case "slideLeft": opacity *= e; dx += 0.12 * r * dir; break;
      case "slideRight": opacity *= e; dx -= 0.12 * r * dir; break;
      case "scale": opacity *= e; scale *= 0.85 + 0.15 * e; break;
      case "blur": opacity *= e * e; scale *= 1 + 0.05 * r; break;
    }
  };
  if (shot.enter && shot.enter.duration > 0) apply(shot.enter, t / shot.enter.duration, 1);
  if (shot.exit && shot.exit.duration > 0) apply(shot.exit, (shot.duration - t) / shot.exit.duration, -1);
  return { opacity, dx, dy, scale };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width <= maxW) line = test;
      else { out.push(line); line = words[i]; }
    }
    out.push(line);
  }
  return out;
}

const fontsPending = new Set<string>();

function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, st: TextStyle) {
  ctx.clearRect(0, 0, W, H);
  const px = Math.max(4, st.size * H);
  ctx.font = `${st.weight} ${px}px ${cssFamily(st.font)}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = st.align;
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${st.letterSpacing}em`; } catch {}
  ctx.fillStyle = st.color;
  const pad = W * 0.08;
  const lines = wrapLines(ctx, st.text, W - pad * 2);
  const lh = px * st.lineHeight;
  const total = lh * lines.length;
  const x = st.align === "left" ? pad : st.align === "right" ? W - pad : W / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, H / 2 - total / 2 + lh * (i + 0.5)));
}

function drawLogo(ctx: CanvasRenderingContext2D, W: number, H: number, st: LogoStyle): boolean {
  ctx.clearRect(0, 0, W, H);
  const m = st.media ? getMedia(st.media.id) : null;
  if (!m || m.kind !== "image") {
    // placeholder mark, inked for contrast against the card colour
    const s = H * st.scale;
    const n = parseInt(st.background.replace("#", ""), 16);
    const lum = Number.isNaN(n) ? 255 : 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    const ink = lum > 140 ? "0,0,0" : "255,255,255";
    ctx.fillStyle = `rgba(${ink},0.12)`;
    ctx.beginPath();
    ctx.roundRect(W / 2 - s / 2, H / 2 - s / 2, s, s, s * 0.22);
    ctx.fill();
    ctx.fillStyle = `rgba(${ink},0.5)`;
    ctx.font = `700 ${s * 0.42}px ${cssFamily("Geist")}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("LOGO", W / 2, H / 2 + s * 0.02);
    return false;
  }
  const el = m.element as HTMLImageElement;
  const ar = m.width / Math.max(1, m.height);
  let h = H * st.scale, w = h * ar;
  if (w > W * 0.9) { w = W * 0.9; h = w / ar; }
  ctx.drawImage(el, W / 2 - w / 2, H / 2 - h / 2, w, h);
  return true;
}

/**
 * Text and logo shots render as a full-frame card that sits in front of the camera; the device is
 * hidden while one is on screen. Everything is driven from `anim` so playback and export agree.
 */
export function CardLayer() {
  const bgRef = useRef<THREE.Mesh>(null);
  const contentRef = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useMemo(() => { const c = document.createElement("canvas"); c.width = 16; c.height = 16; return c; }, []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  const bgMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#f2f2f2", toneMapped: false, depthTest: false, depthWrite: false }), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, opacity: { value: 1 }, time: { value: 0 }, effect: { value: 0 }, res: { value: new THREE.Vector2(16, 16) } },
    vertexShader: cardVert,
    fragmentShader: cardFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }), [texture]);
  useEffect(() => () => { texture.dispose(); mat.dispose(); bgMat.dispose(); }, [texture, mat, bgMat]);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const lastSig = useRef("");

  useFrame((state) => {
    const shot = anim.shot;
    const kind = shotKind(shot);
    const active = !!shot && kind !== "media";
    anim.card = active;
    const bg = bgRef.current, content = contentRef.current;
    if (!bg || !content) return;
    bg.visible = active;
    content.visible = active;
    if (!active || !shot) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const viewH = 2 * CARD_Z * Math.tan((cam.fov / 2) * DEG);
    const aspect = state.size.width / Math.max(1, state.size.height);
    const viewW = viewH * aspect;
    bg.scale.set(viewW * 1.04, viewH * 1.04, 1);
    bg.position.set(0, 0, -CARD_Z - 0.001);
    // canvas resolution follows the render size (export renders at full output size)
    const dpr = anim.exporting ? 1 : Math.min(2, state.viewport.dpr);
    const cap = anim.exporting ? 3840 : 2048;
    const W = Math.max(64, Math.min(cap, Math.round(state.size.width * dpr)));
    const H = Math.max(64, Math.round(W / aspect));
    let sig = `${kind}|${W}x${H}|`;
    let effect = 0;
    let fontKey = "";
    if (kind === "text" && shot.text) {
      const st = shot.text;
      const def = getFont(st.font);
      fontKey = def.builtin ? "" : fontKeyOf(st.font, st.weight);
      sig += `${st.text}|${st.font}|${st.weight}|${st.size}|${st.color}|${st.align}|${st.lineHeight}|${st.letterSpacing}|${isFontReady(st.font, st.weight) ? "ready" : "fallback"}`;
      bgMat.color.set(st.background);
    } else if (kind === "logo" && shot.logo) {
      const st = shot.logo;
      const loaded = st.media ? getMedia(st.media.id) : null;
      sig += `${st.media?.id ?? "none"}|${loaded ? "loaded" : "pending"}|${st.scale}`;
      bgMat.color.set(st.background);
      effect = EFFECT_INDEX[st.effect] ?? 0;
    }
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W; canvas.height = H;
        texture.dispose();
        texture.source = new THREE.Source(canvas);
      }
      const ctx = canvas.getContext("2d")!;
      if (kind === "text" && shot.text) {
        drawText(ctx, W, H, shot.text);
        if (fontKey && !isFontReady(shot.text.font, shot.text.weight) && !fontsPending.has(fontKey)) {
          fontsPending.add(fontKey);
          void ensureFont(shot.text.font, shot.text.weight).then(() => { fontsPending.delete(fontKey); lastSig.current = ""; invalidate(); });
        }
      } else if (kind === "logo" && shot.logo) {
        drawLogo(ctx, W, H, shot.logo);
      }
      texture.needsUpdate = true;
      (mat.uniforms.res.value as THREE.Vector2).set(W, H);
    }
    const fx = enterExitAt(shot, anim.localT);
    content.scale.set(viewW * fx.scale, viewH * fx.scale, 1);
    content.position.set(fx.dx * viewW, fx.dy * viewH, -CARD_Z);
    mat.uniforms.opacity.value = fx.opacity;
    mat.uniforms.time.value = anim.localT;
    mat.uniforms.effect.value = effect;
  }, -10);

  return (
    <>
      <mesh ref={bgRef} geometry={geo} material={bgMat} renderOrder={900} frustumCulled={false} visible={false} />
      <mesh ref={contentRef} geometry={geo} material={mat} renderOrder={901} frustumCulled={false} visible={false} />
    </>
  );
}

/** Full-frame colour overlay for fade-in / fade-out and dip-to-colour transitions. */
export function FadeOverlay() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0, toneMapped: false, depthTest: false, depthWrite: false }), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const a = anim.fade;
    m.visible = a > 0.001;
    if (!m.visible) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const z = CARD_Z * 0.8;
    const viewH = 2 * z * Math.tan((cam.fov / 2) * DEG);
    const aspect = state.size.width / Math.max(1, state.size.height);
    m.scale.set(viewH * aspect * 1.05, viewH * 1.05, 1);
    m.position.set(0, 0, -z);
    mat.opacity = a;
    mat.color.set(anim.fadeColor);
  }, -9);
  return <mesh ref={ref} geometry={geo} material={mat} renderOrder={1000} frustumCulled={false} visible={false} />;
}
