import type { DeviceSpec } from "./devices";
import type { DeviceOrientation, MediaRef } from "./types";
import { orientedScreenPixels } from "./orientation";
import { deviceLayout } from "@/three/devices/layout";
import { screenContentRect } from "./screenLayout";

/** The actual upright content area, including browser chrome and uniform screen padding. */
export function cropScreenAspect(spec: DeviceSpec, media: MediaRef, orientation: DeviceOrientation, padding: number): number {
  const [width, height] = deviceLayout(spec, media, orientation).flat?.px ?? orientedScreenPixels(spec, orientation);
  const rect = screenContentRect({ width, height, padding, chromeHeight: spec.id === "browser" ? Math.round(width * .045) : 0 });
  return rect.width / rect.height;
}
