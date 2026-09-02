import { Effect, KawaseBlurPass, KernelSize, LensDistortionEffect, Resolution } from "postprocessing";
import * as THREE from "three";

const focusFrag = /* glsl */ `
uniform sampler2D map;
uniform vec4 params;   // focusX, focusY, size, falloff
uniform float mode;    // 0 = radial, 1 = linear
uniform float uAspect;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = (uv - params.xy) * vec2(uAspect, 1.0);
  float d = mode < 0.5 ? length(p) : abs(p.y);
  float m = smoothstep(params.z, params.z + max(params.w, 0.001), d);
  vec4 b = texture2D(map, uv);
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
      ]),
    });
    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.renderTarget.texture.name = "FocusBlur.Target";
    this.uniforms.get("map")!.value = this.renderTarget.texture;
    this.blurPass = new KawaseBlurPass({ kernelSize: KernelSize.LARGE, resolutionScale: 0.5 });
    this.resolution = new Resolution(this, Resolution.AUTO_SIZE, Resolution.AUTO_SIZE, 0.5);
    this.resolution.addEventListener("change", () => this.setSize(this.resolution.baseWidth, this.resolution.baseHeight));
  }

  setParams(focusX: number, focusY: number, size: number, falloff: number, mode: "radial" | "linear", strength: number, bokeh: boolean) {
    const u = this.uniforms.get("params")!.value as THREE.Vector4;
    u.set(focusX, focusY, size, falloff);
    this.uniforms.get("mode")!.value = mode === "linear" ? 1 : 0;
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
