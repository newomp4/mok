import type { AnimValues } from "@/lib/animation";
import type { Project, Shot } from "@/lib/types";

/**
 * Shared, mutable per-frame animation state. The Driver evaluates the
 * timeline into this object each frame; scene components read from it
 * imperatively so playback never re-renders React.
 */
export const anim = {
  values: null as AnimValues | null,
  time: 0,
  localT: 0,
  shot: null as Shot | null,
  project: null as Project | null,
  /** true while the export pipeline drives frames deterministically */
  exporting: false,
  /** time-based effects (screen fade etc.) */
  screenFade: 1,
  /** when set, the driver evaluates this time instead of the UI clock */
  exportTime: null as number | null,
  /** current camera distance (world units), for depth of field */
  camDist: 5,
  /** smoothed distance to the depth-of-field focal point */
  focusDist: 5,
};
