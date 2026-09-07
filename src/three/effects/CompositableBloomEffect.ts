import { BlendFunction, BloomEffect } from "postprocessing";

/** Screen blend in premultiplied linear light, with source-over coverage for the added glow. */
export const COMPOSITABLE_BLOOM_FRAGMENT = /* glsl */`
  uniform sampler2D map;
  uniform float intensity;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 glow = max(texture2D(map, uv).rgb * intensity, vec3(0.0));
    // A bloom texel carries radiance, not the surface coverage of the receiving shadow.
    // Giving it its own coverage prevents tone mapping RGB / tiny shadow alpha into a white ring.
    float glowAlpha = clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
    float coverage = inputColor.a + glowAlpha * (1.0 - inputColor.a);
    // This is the library's SCREEN expression on opaque pixels; retain that established look.
    vec3 color = inputColor.rgb + glow - min(inputColor.rgb * glow, vec3(1.0));
    outputColor = vec4(color, coverage);
  }
`;

/** Owns the same bounded luminance/MIP resources as BloomEffect; only final composition changes. */
export class CompositableBloomEffect extends BloomEffect {
  constructor() {
    super({ blendFunction: BlendFunction.SET, mipmapBlur: true, levels: 6 });
    this.setFragmentShader(COMPOSITABLE_BLOOM_FRAGMENT);
  }
}
