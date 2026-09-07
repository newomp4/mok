import { CopyMaterial, Pass } from "postprocessing";
import * as THREE from "three";
import { withOffscreenPass } from "../renderPass";
import type { LinearCapture } from "../registry";

/** Integrates scene radiance before tone mapping. The final sample continues through output effects. */
export class LinearCapturePass extends Pass implements LinearCapture {
  private sum: THREE.WebGLRenderTarget | null = null;
  private copy = new CopyMaterial();
  private add = new CopyMaterial();
  private width = 1;
  private height = 1;
  private expected = 0;
  private received = 0;
  private samplePending = false;

  constructor() {
    super("Linear motion accumulation");
    this.enabled = false;
    this.copy.colorSpaceConversion = false;
    this.add.colorSpaceConversion = false;
    this.add.blending = THREE.CustomBlending;
    this.add.blendEquation = THREE.AddEquation;
    this.add.blendSrc = THREE.OneFactor;
    this.add.blendDst = THREE.OneFactor;
    this.add.blendEquationAlpha = THREE.AddEquation;
    this.add.blendSrcAlpha = THREE.OneFactor;
    this.add.blendDstAlpha = THREE.OneFactor;
    this.add.transparent = true;
    this.fullscreenMaterial = this.copy;
  }

  beginFrame(samples: number): void {
    if (!Number.isInteger(samples) || samples < 1 || samples > 32) throw new Error("Motion blur needs 1–32 samples.");
    if (this.enabled) throw new Error("The previous motion-blur frame is unfinished.");
    this.expected = samples;
    this.received = 0;
    this.samplePending = false;
    // CopyMaterial inherits Material.opacity, but its shader reads this separate uniform.
    this.add.uniforms.opacity.value = 1 / samples;
    this.enabled = true;
  }

  beginSample(): void {
    if (this.enabled) this.samplePending = true;
  }

  endFrame(): void {
    const complete = this.received === this.expected;
    this.enabled = false;
    this.samplePending = false;
    if (!complete) throw new Error("Motion blur did not render every requested sample.");
  }

  cancel(): void {
    this.enabled = false;
    this.expected = this.received = 0;
    this.samplePending = false;
    this.sum?.dispose();
    this.sum = null;
  }

  setSize(width: number, height: number): void {
    // One exposure owns a fixed raster. A late layout commit cannot discard earlier samples.
    if (this.enabled && (width !== this.width || height !== this.height)) return;
    this.width = width;
    this.height = height;
    this.sum?.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    if (!this.samplePending) {
      // React may commit while export is awaiting a decoder or a new shot. Display the current
      // sum, but only an explicitly armed timeline advance may contribute another exposure.
      withOffscreenPass(renderer, () => {
        this.copy.inputBuffer = this.received > 0 && this.sum ? this.sum.texture : inputBuffer.texture;
        this.fullscreenMaterial = this.copy;
        renderer.setRenderTarget(outputBuffer);
        renderer.render(this.scene, this.camera);
      });
      return;
    }
    this.samplePending = false;
    if (this.received >= this.expected) throw new Error("Too many motion-blur samples were rendered.");
    if (!this.sum) {
      this.sum = new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false,
      });
      this.sum.texture.name = "Linear motion radiance";
      this.sum.texture.generateMipmaps = false;
    }
    withOffscreenPass(renderer, () => {
      renderer.setRenderTarget(this.sum);
      if (this.received === 0) renderer.clear(true, false, false);
      renderer.autoClear = false;
      this.add.inputBuffer = inputBuffer.texture;
      this.fullscreenMaterial = this.add;
      renderer.render(this.scene, this.camera);
      this.copy.inputBuffer = this.sum!.texture;
      this.fullscreenMaterial = this.copy;
      renderer.setRenderTarget(outputBuffer);
      renderer.render(this.scene, this.camera);
    });
    this.received++;
  }

  dispose(): void {
    this.cancel();
    this.add.dispose();
    this.copy.dispose();
  }
}

/** A stable final pass keeps output conversion and half-step dithering after every effect stack. */
export class DitheredOutputPass extends Pass {
  private copy = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }",
    fragmentShader: /* glsl */`
      #include <common>
      #include <dithering_pars_fragment>
      uniform sampler2D inputBuffer;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(inputBuffer, vUv);
        #include <colorspace_fragment>
        #include <dithering_fragment>
        // Output conversion operates on straight color; the browser canvas expects premultiplied.
        gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 1.0) * gl_FragColor.a;
      }`,
    uniforms: { inputBuffer: { value: null } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  constructor() {
    super("Dithered output");
    this.copy.dithering = true;
    this.fullscreenMaterial = this.copy;
  }
  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    this.copy.uniforms.inputBuffer.value = inputBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }
  dispose(): void { this.copy.dispose(); }
}

/** Lighting/blur integrate premultiplied radiance; tone mapping needs straight, nonnegative light. */
export class StraightColorPass extends Pass {
  private shader = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }",
    fragmentShader: "uniform sampler2D inputBuffer; varying vec2 vUv; void main(){ vec4 c=texture2D(inputBuffer,vUv); gl_FragColor=vec4(c.a>0.00001 ? max(c.rgb,vec3(0.0))/c.a : vec3(0.0),c.a); }",
    uniforms: { inputBuffer: { value: null } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  constructor() { super("Straight color for tone mapping"); this.fullscreenMaterial = this.shader; }
  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    this.shader.uniforms.inputBuffer.value = inputBuffer.texture;
    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);
  }
  dispose(): void { this.shader.dispose(); }
}
