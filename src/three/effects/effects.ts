import { Effect, KawaseBlurPass, KernelSize, LensDistortionEffect, Resolution } from "postprocessing";
import * as THREE from "three";

const focusFrag = /* glsl */ `
uniform sampler2D map;
uniform vec4 params;   // focusX, focusY, size, falloff
uniform float mode;    // 0 = radial, 1 = linear (tilt shift), 2 = directional
uniform float uAspect;
uniform vec2 dir;      // directional blur vector (texel units × strength)
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = (uv - params.xy) * vec2(uAspect, 1.0);
  float d = mode < 0.5 ? length(p) : (mode < 1.5 ? abs(p.y) : length(p));
  float m = smoothstep(params.z, params.z + max(params.w, 0.001), d);
  vec4 b;
  if (mode > 1.5) {
    // 1-D blur along dir, masked by the focus like the other modes
    vec4 acc = vec4(0.0);
    for (int i = -8; i <= 8; i++) { acc += texture2D(inputBuffer, clamp(uv + dir * (float(i) / 8.0), 0.0, 1.0)); }
    b = acc / 17.0;
  } else {
    b = texture2D(map, uv);
  }
  outputColor = mix(inputColor, b, m);
}`;

/**
 * Radial / linear focus blur (the "BLUR" section). Blurs a downsampled copy of
 * the frame with a Kawase kernel and masks it around a focus point.
 */
export class FocusBlurEffect extends Effect {
  renderTarget: THREE.WebGLRenderTarget;
  blurPass: KawaseBlurPass;
  resolution: Resolution;

  constructor() {
    super("FocusBlurEffect", focusFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ["map", new THREE.Uniform(null)],
        ["params", new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 0.4, 0.2))],
        ["mode", new THREE.Uniform(0)],
        ["uAspect", new THREE.Uniform(1)],
        ["dir", new THREE.Uniform(new THREE.Vector2(0, 0))],
      ]),
    });
    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.renderTarget.texture.name = "FocusBlur.Target";
    this.uniforms.get("map")!.value = this.renderTarget.texture;
    this.blurPass = new KawaseBlurPass({ kernelSize: KernelSize.LARGE, resolutionScale: 0.5 });
    this.resolution = new Resolution(this, Resolution.AUTO_SIZE, Resolution.AUTO_SIZE, 0.5);
    this.resolution.addEventListener("change", () => this.setSize(this.resolution.baseWidth, this.resolution.baseHeight));
  }

  setParams(focusX: number, focusY: number, size: number, falloff: number, mode: "radial" | "linear" | "directional", strength: number, bokeh: boolean, angleDeg = 0) {
    const u = this.uniforms.get("params")!.value as THREE.Vector4;
    u.set(focusX, focusY, size, falloff);
    this.uniforms.get("mode")!.value = mode === "linear" ? 1 : mode === "directional" ? 2 : 0;
    const a = (angleDeg * Math.PI) / 180;
    const len = (strength / 20) * 0.06;
    (this.uniforms.get("dir")!.value as THREE.Vector2).set(Math.cos(a) * len / Math.max(0.01, this.uniforms.get("uAspect")!.value as number), Math.sin(a) * len);
    const k = bokeh ? KernelSize.HUGE : KernelSize.LARGE;
    if (this.blurPass.kernelSize !== k) this.blurPass.kernelSize = k;
    this.blurPass.scale = Math.max(0.0001, (strength / 10) * (bokeh ? 1.2 : 1.6));
  }

  update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    this.blurPass.render(renderer, inputBuffer, this.renderTarget);
  }

  setSize(width: number, height: number) {
    const r = this.resolution;
    r.setBaseSize(width, height);
    this.renderTarget.setSize(r.width, r.height);
    this.blurPass.resolution.copy(r);
    this.uniforms.get("uAspect")!.value = width / Math.max(1, height);
  }

  initialize(renderer: THREE.WebGLRenderer, alpha: boolean, frameBufferType: THREE.TextureDataType) {
    this.blurPass.initialize(renderer, alpha, frameBufferType);
    if (frameBufferType !== undefined) {
      this.renderTarget.texture.type = frameBufferType;
      if (renderer !== null && renderer.outputColorSpace === THREE.SRGBColorSpace) {
        this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
      }
    }
  }

  dispose() {
    this.renderTarget.dispose();
    this.blurPass.dispose();
    super.dispose();
  }
}

const sharpenFrag = /* glsl */ `
uniform float amount;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  vec3 s = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
  vec3 blur = (n + s + e + w) * 0.25;
  outputColor = vec4(inputColor.rgb + (inputColor.rgb - blur) * amount * 2.5, inputColor.a);
}`;

export class SharpenEffect extends Effect {
  constructor() {
    super("SharpenEffect", sharpenFrag, { uniforms: new Map([["amount", new THREE.Uniform(0.3)]]) });
  }
  set amount(v: number) { this.uniforms.get("amount")!.value = v; }
}

const glassFrag = /* glsl */ `
uniform float width;
uniform float opacity;
uniform float uAspect;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = abs(uv - 0.5) * 2.0;
  float dx = (1.0 - p.x) * uAspect;
  float dy = 1.0 - p.y;
  float d = min(dx, dy);
  float band = 1.0 - smoothstep(0.0, max(width, 0.0005), d);
  float edge = 1.0 - smoothstep(0.0, max(width, 0.0005) * 0.12, d);
  float shade = 0.55 + 0.45 * (uv.x * 0.5 + (1.0 - uv.y) * 0.5);
  vec3 col = inputColor.rgb;
  col = mix(col, col * 0.92 + vec3(0.55) * shade, band * opacity * 0.5);
  col = mix(col, vec3(1.0), edge * opacity * 0.35);
  outputColor = vec4(col, inputColor.a);
}`;

export class GlassBorderEffect extends Effect {
  constructor() {
    super("GlassBorderEffect", glassFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ["width", new THREE.Uniform(0.04)],
        ["opacity", new THREE.Uniform(0.5)],
        ["uAspect", new THREE.Uniform(1)],
      ]),
    });
  }
  set width(v: number) { this.uniforms.get("width")!.value = v; }
  set opacity(v: number) { this.uniforms.get("opacity")!.value = v; }
  setSize(width: number, height: number) { this.uniforms.get("uAspect")!.value = width / Math.max(1, height); }
}

export function createLensDistortion(): LensDistortionEffect {
  return new LensDistortionEffect({
    distortion: new THREE.Vector2(0, 0),
    principalPoint: new THREE.Vector2(0, 0),
    focalLength: new THREE.Vector2(1, 1),
    skew: 0,
  });
}

const ghostFrag = /* glsl */ `
uniform vec2 offset;
uniform float opacity;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 g = texture2D(inputBuffer, clamp(uv + offset, 0.0, 1.0));
  outputColor = vec4(max(inputColor.rgb, g.rgb * opacity), inputColor.a);
}`;

/** Double-exposure echo of the frame, offset in a direction. */
export class GhostEffect extends Effect {
  constructor() {
    super("GhostEffect", ghostFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ["offset", new THREE.Uniform(new THREE.Vector2(0.014, 0.014))],
        ["opacity", new THREE.Uniform(0.35)],
      ]),
    });
  }
  set(offset: number, angleDeg: number, opacity: number) {
    const a = (angleDeg * Math.PI) / 180;
    (this.uniforms.get("offset")!.value as THREE.Vector2).set(Math.cos(a) * offset, Math.sin(a) * offset);
    this.uniforms.get("opacity")!.value = opacity;
  }
}

const liquidFrag = /* glsl */ `
uniform vec2 center;    // 0..1
uniform vec2 halfSize;  // 0..1 (of width / height)
uniform float radius;   // fraction of the shorter side
uniform float refraction;
uniform float tint;
uniform float uAspect;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - center) * asp;
  vec2 b = halfSize * asp;
  float r = radius * min(b.x, b.y) * 2.0;
  float d = sdRoundRect(p, b, r);
  if (d > 0.0) { outputColor = inputColor; return; }
  // edge band refracts strongly, the centre only slightly (like a thick glass slab)
  float edge = smoothstep(-0.12 * min(b.x, b.y) * 2.0, 0.0, d);
  float e = 0.002;
  vec2 grad = normalize(vec2(sdRoundRect(p + vec2(e, 0.0), b, r) - sdRoundRect(p - vec2(e, 0.0), b, r), sdRoundRect(p + vec2(0.0, e), b, r) - sdRoundRect(p - vec2(0.0, e), b, r)) + 1e-6);
  vec2 shift = (grad * (0.35 * edge + 0.08) + p * 0.06) * refraction * 0.06 / asp;
  vec3 col = texture2D(inputBuffer, clamp(uv - shift, 0.0, 1.0)).rgb;
  // subtle brightening + a highlight along the top-left edge, shadow along bottom-right
  float light = dot(grad, normalize(vec2(-0.6, 0.8)));
  col = mix(col, col * (1.0 + 0.35 * tint) + vec3(0.06) * tint, 0.5);
  col += vec3(0.28) * edge * max(light, 0.0) * (0.4 + tint);
  col -= vec3(0.12) * edge * max(-light, 0.0);
  float rim = 1.0 - smoothstep(0.0, 0.0035, -d);
  col += vec3(0.35) * rim;
  outputColor = vec4(col, inputColor.a);
}`;

/** A refractive rounded glass slab over the frame (Apple "liquid glass" look). */
export class LiquidGlassEffect extends Effect {
  constructor() {
    super("LiquidGlassEffect", liquidFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ["center", new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ["halfSize", new THREE.Uniform(new THREE.Vector2(0.21, 0.13))],
        ["radius", new THREE.Uniform(0.12)],
        ["refraction", new THREE.Uniform(0.5)],
        ["tint", new THREE.Uniform(0.12)],
        ["uAspect", new THREE.Uniform(1)],
      ]),
    });
  }
  set(x: number, y: number, w: number, h: number, radius: number, refraction: number, tint: number) {
    (this.uniforms.get("center")!.value as THREE.Vector2).set(x, 1 - y);
    (this.uniforms.get("halfSize")!.value as THREE.Vector2).set(w / 2, h / 2);
    this.uniforms.get("radius")!.value = radius;
    this.uniforms.get("refraction")!.value = refraction;
    this.uniforms.get("tint")!.value = tint;
  }
  setSize(width: number, height: number) { this.uniforms.get("uAspect")!.value = width / Math.max(1, height); }
}
