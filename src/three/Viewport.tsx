"use client";
import { Component, memo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { SceneRoot } from "@/three/Scene";
import { RendererMetrics } from "./RendererMetrics";
import { useRenderFlags } from "./registry";
import { useUI } from "@/store/ui";

function PreviewUnavailable({ retry }: { retry?: () => void }) {
  return (
    <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-panel px-8 text-center text-fg">
      <p className="text-sm font-medium">The 3D preview couldn’t load.</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted">Your project is still here. Try the preview again, or reload this page if it keeps happening.</p>
      {retry && <button type="button" onClick={retry} className="rounded-md border border-line bg-panel-2 px-3 py-2 text-xs font-medium hover:bg-fill">Retry preview</button>}
    </div>
  );
}

/** A failed asset or WebGL initialization must leave the editor and saved project accessible. */
export class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <PreviewUnavailable retry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

// Timeline commits must not reconfigure Canvas back to its CSS size during an exact-size export.
export const Viewport = memo(function Viewport({ dpr = 2 }: { dpr?: number }) {
  const exporting = useRenderFlags((s) => s.exporting);
  const playing = useUI((s) => s.playing);
  return (
    <PreviewBoundary>
    <Canvas
      role="img"
      aria-label="3D mockup preview"
      fallback="Interactive 3D mockup preview. WebGL support is required."
      dpr={exporting ? 1 : [1, dpr]}
      frameloop={exporting ? "never" : playing ? "always" : "demand"}
      shadows={{ type: THREE.VSMShadowMap }}
      flat={false}
      gl={{
        antialias: false,
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
        toneMapping: THREE.NeutralToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ position: "absolute", inset: 0, background: "transparent" }}
    >
      <SceneRoot />
      <RendererMetrics />
    </Canvas>
    </PreviewBoundary>
  );
});
