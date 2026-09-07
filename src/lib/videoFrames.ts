/** Export owns one upright decoded canvas. ScreenSurface borrows it for the current frame. */
export interface DecodedVideoFrame {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  version: number;
}
let current: { id: string; frame: DecodedVideoFrame } | null = null;
let version = 0;
export function getVideoFrame(id: string): DecodedVideoFrame | null { return current?.id === id ? current.frame : null; }
export function publishVideoFrame(id: string, image: HTMLCanvasElement, width: number, height: number) {
  current = { id, frame: { image, width, height, version: ++version } };
}
export function clearVideoFrame() { current = null; }
