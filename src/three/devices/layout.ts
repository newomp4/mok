import type { DeviceSpec } from "@/lib/devices";
import { S } from "@/three/geometry";
import type { DeviceOrientation, MediaRef } from "@/lib/types";
import { deviceOrientation, orientationFitSize, orientationQuarterTurn } from "@/lib/orientation";

export interface DeviceLayout {
  /** total bounding height in scene units */
  height: number;
  /** y of the floor (lowest point) when the device is centered at the origin */
  floorY: number;
  /** lean (deg, about X) applied when standing in a 3D scene */
  lean: number;
  /** size used for camera fitting */
  fitSize: number;
  /** Physical scene/light/shadow scale, independent of camera framing and output aspect. */
  sceneSize: number;
  /** flat devices derive their size from the media */
  flat?: { w: number; h: number; px: [number, number] };
  /** the device this layout was measured from, which is the one actually on screen */
  spec: DeviceSpec;
  orientation: DeviceOrientation;
  quarterTurn: -1 | 0 | 1;
}

export function flatSize(spec: DeviceSpec, media: MediaRef | null): { w: number; h: number; px: [number, number] } {
  const px: [number, number] = media ? [media.width, media.height] : spec.screenPx;
  const aspect = px[0] / Math.max(1, px[1]);
  const isBrowser = spec.id === "browser";
  const chrome = isBrowser ? 0.045 : 0;
  const w = spec.screenMm[0];
  const h = w / aspect + w * chrome;
  return { w, h, px: [px[0], Math.round(px[0] / aspect + px[0] * chrome)] };
}

export function deviceLayout(spec: DeviceSpec, media: MediaRef | null = null, orientation?: DeviceOrientation, aspect = 1): DeviceLayout {
  const b = spec.body;
  const quarterTurn = orientationQuarterTurn(spec, orientation);
  const view = { orientation: deviceOrientation(spec, orientation), quarterTurn, sceneSize: spec.fitSize };
  switch (spec.family) {
    case "phone":
    case "tablet": {
      const lean = 6;
      const a = (lean * Math.PI) / 180;
      const h = (quarterTurn ? b.w : b.h) * S, w = (quarterTurn ? b.h : b.w) * S, d = b.d * S;
      return { ...view, spec, height: h, floorY: -(h / 2) * Math.cos(a) - (d / 2) * Math.sin(a), lean, fitSize: orientationFitSize(w, h, spec.fitSize, quarterTurn, aspect) };
    }
    case "laptop": {
      const lid = spec.lid!;
      const baseT = b.d * S;
      const lidH = (b.h - 3) * S;
      const a = (lid.angle * Math.PI) / 180;
      const height = baseT + Math.abs(Math.sin(a)) * lidH + lid.thickness * S * 0.5;
      return { ...view, spec, height, floorY: -height / 2, lean: 0, fitSize: spec.fitSize };
    }
    case "watch": {
      const height = (b.h + 2 * 42) * S;
      return { ...view, spec, height, floorY: -height / 2, lean: 0, fitSize: spec.fitSize };
    }
    case "desktop": {
      const standH = spec.chin ? 60 : 90;
      const height = (b.h + standH) * S;
      return { ...view, spec, height, floorY: -height / 2, lean: 0, fitSize: spec.fitSize };
    }
    case "flat":
    default: {
      const f = flatSize(spec, media);
      const h = f.h * S;
      const physicalSize = Math.max(f.w, f.h) * S * 1.02;
      return { ...view, spec, height: h, floorY: -h / 2, lean: 0, fitSize: physicalSize, sceneSize: physicalSize, flat: f };
    }
  }
}
