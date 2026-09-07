import { DepthOfFieldEffect, MaskFunction } from "postprocessing";
import * as THREE from "three";

/** The React wrapper forces CoC into alpha, which fills transparent backgrounds with lens haze.
 * Keep the library's coverage-preserving mask and linear HDR intermediates instead. */
export class LinearDepthOfFieldEffect extends DepthOfFieldEffect {
  constructor(camera: THREE.Camera) {
    super(camera, { worldFocusDistance: 5, worldFocusRange: 1, bokehScale: 4, resolutionScale: 0.75 });
    this.maskFunction = MaskFunction.MULTIPLY_RGB;
  }

  initialize(renderer: THREE.WebGLRenderer, alpha: boolean, type: THREE.TextureDataType): void {
    super.initialize(renderer, alpha, type);
    // postprocessing 6.39.4 tags these color targets sRGB even when they store half floats.
    // CoC and depth targets are data textures and deliberately excluded.
    const targets = this as unknown as Record<string, THREE.WebGLRenderTarget>;
    for (const key of ["renderTarget", "renderTargetNear", "renderTargetFar", "renderTargetMasked"]) {
      targets[key].texture.colorSpace = type === THREE.UnsignedByteType && renderer.outputColorSpace === THREE.SRGBColorSpace
        ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    }
  }
}
