/** Standard glossy cover glass, not the optional etched/nano-texture finish. Coating changes
 * normal-incidence reflection rather than blurring the image. F90 stays 1 so grazing reflections
 * remain possible. These are RGB-neutral approximations; thin-film interference is not modeled.
 */
export interface ScreenGlassProfile { f0: number; roughness: number }

const ordinary: Readonly<ScreenGlassProfile> = { f0: 0.04, roughness: 0.04 };
const profiles: Record<string, Readonly<ScreenGlassProfile>> = {
  // Apple, Pro Display XDR Technology Overview (February 2020), Cover Glass: 1.65% on-axis.
  // https://www.apple.com/pro-display-xdr/pdf/Pro_Display_White_Paper_Feb_2020.pdf
  "pro-display-xdr-glb": { f0: 0.0165, roughness: 0.04 },
  // M4 tech specs confirm an anti-reflective coating, but do not publish its reflectance.
  // 2% is an artist calibration, not a measured specification or the older iPad's 1.8% claim.
  // https://support.apple.com/en-us/119891
  "ipad-pro-13-glb": { f0: 0.02, roughness: 0.04 },
};

export function screenGlassProfile(deviceId: string): Readonly<ScreenGlassProfile> {
  return profiles[deviceId] ?? ordinary;
}

/** A mirror sample contains scene-linear premultiplied radiance and local-geometry coverage.
 * Replace the environment in covered directions BEFORE the shared physical glass BRDF. Adding
 * it afterwards lights the glass twice, and multiplying RGB by alpha again darkens AA edges.
 * The target itself has no background; uncovered directions keep the environment reflection.
 */
export const screenMirrorRadiance = /* glsl */ `
      #if defined( RE_IndirectSpecular )
      if ( reflectAmount > 0.0 && vReflectUv.w > 0.0 ) {
        vec2 mirrorUv = vReflectUv.xy / vReflectUv.w;
        vec2 mirrorEdge = smoothstep(vec2(0.0), vec2(0.01), mirrorUv) *
                          smoothstep(vec2(0.0), vec2(0.01), vec2(1.0) - mirrorUv);
        vec4 mirror = texture2D( reflectMap, mirrorUv );
        float edge = mirrorEdge.x * mirrorEdge.y;
        float coverage = clamp(mirror.a, 0.0, 1.0) * edge;
        vec3 localRadiance = mirror.rgb * clamp(reflectAmount, 0.0, 1.0) * edge;
        radiance = radiance * (1.0 - coverage) + localRadiance;
        #ifdef USE_CLEARCOAT
          clearcoatRadiance = clearcoatRadiance * (1.0 - coverage) + localRadiance;
        #endif
      }
      #endif
`;
