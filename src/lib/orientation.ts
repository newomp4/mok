import type { DeviceSpec } from "./devices";
import type { DeviceOrientation } from "./types";

export const supportsOrientation = (spec: DeviceSpec) => spec.family === "phone" || spec.family === "tablet";
export const nativeOrientation = (spec: DeviceSpec): DeviceOrientation => spec.screenPx[0] > spec.screenPx[1] ? "landscape" : "portrait";

/** Older projects keep the device's authored orientation, including landscape iPads. */
export function deviceOrientation(spec: DeviceSpec, requested?: DeviceOrientation): DeviceOrientation {
  return supportsOrientation(spec) && requested ? requested : nativeOrientation(spec);
}

/** Keyboard attachments only support the tablet's authored docking orientation. */
export function keyboardCaseAvailable(spec: DeviceSpec, requested?: DeviceOrientation): boolean {
  return spec.family !== "tablet" || deviceOrientation(spec, requested) === nativeOrientation(spec);
}

/** Keep the saved preference intact while a turned tablet temporarily hides its attachment. */
export function effectiveKeyboardCase(spec: DeviceSpec, requested?: DeviceOrientation, enabled = true): boolean {
  return enabled && keyboardCaseAvailable(spec, requested);
}

/** Applied inside user rotation, outside the authored model. Canvas coordinates use the same sign. */
export function orientationQuarterTurn(spec: DeviceSpec, requested?: DeviceOrientation): -1 | 0 | 1 {
  const native = nativeOrientation(spec);
  if (deviceOrientation(spec, requested) === native) return 0;
  return native === "portrait" ? -1 : 1;
}

export function orientedScreenPixels(spec: DeviceSpec, requested?: DeviceOrientation): [number, number] {
  return orientationQuarterTurn(spec, requested) ? [spec.screenPx[1], spec.screenPx[0]] : [...spec.screenPx];
}

export function orientedScreenMillimeters(spec: DeviceSpec, requested?: DeviceOrientation): [number, number] {
  return orientationQuarterTurn(spec, requested) ? [spec.screenMm[1], spec.screenMm[0]] : [...spec.screenMm];
}

/** Native model measurements stay cached independently of the selected orientation. */
export function orientedBounds(bounds: { width: number; height: number; minY: number; maxY: number; minX?: number; maxX?: number }, quarterTurn: -1 | 0 | 1) {
  if (!quarterTurn) return { width: bounds.width, height: bounds.height, floorY: bounds.minY };
  return { width: bounds.height, height: bounds.width, floorY: quarterTurn < 0 ? -(bounds.maxX ?? bounds.width / 2) : (bounds.minX ?? -bounds.width / 2) };
}

/** Refit a turned device to both axes; retain existing framing when no turn was requested. */
export function orientationFitSize(width: number, height: number, legacyFit: number, quarterTurn: number, aspect = 1): number {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return Math.max(quarterTurn ? height * 1.04 : legacyFit, width / ratio * 1.04);
}
