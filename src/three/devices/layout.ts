import type { DeviceSpec } from "@/lib/devices";
import { S } from "@/three/geometry";
import type { MediaRef } from "@/lib/types";

export interface DeviceLayout {
  /** total bounding height in scene units */
  height: number;
  /** y of the floor (lowest point) when the device is centered at the origin */
  floorY: number;
  /** lean (deg, about X) applied when standing in a 3D scene */
  lean: number;
  /** size used for camera fitting */
  fitSize: number;
  /** flat devices derive their size from the media */
  flat?: { w: number; h: number; px: [number, number] };
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

export function deviceLayout(spec: DeviceSpec, media: MediaRef | null = null): DeviceLayout {
  const b = spec.body;
  switch (spec.family) {
    case "phone":
    case "tablet": {
      const lean = 6;
      const a = (lean * Math.PI) / 180;
      const h = b.h * S, d = b.d * S;
      return { height: h, floorY: -(h / 2) * Math.cos(a) - (d / 2) * Math.sin(a), lean, fitSize: spec.fitSize };
    }
    case "laptop": {
      const lid = spec.lid!;
      const baseT = b.d * S;
      const lidH = (b.h - 3) * S;
      const a = (lid.angle * Math.PI) / 180;
      const height = baseT + Math.abs(Math.sin(a)) * lidH + lid.thickness * S * 0.5;
      return { height, floorY: -height / 2, lean: 0, fitSize: spec.fitSize };
    }
    case "watch": {
      const height = (b.h + 2 * 42) * S;
      return { height, floorY: -height / 2, lean: 0, fitSize: spec.fitSize };
    }
    case "desktop": {
      const standH = spec.chin ? 60 : 90;
      const height = (b.h + standH) * S;
      return { height, floorY: -height / 2, lean: 0, fitSize: spec.fitSize };
    }
    case "flat":
    default: {
      const f = flatSize(spec, media);
      const h = f.h * S;
      return { height: h, floorY: -h / 2, lean: 0, fitSize: Math.max(f.w, f.h) * S * 1.02, flat: f };
    }
  }
}
