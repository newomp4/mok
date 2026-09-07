import type { Project } from "@/lib/types";
import { resolveShotEffects, resolveShotView } from "@/lib/shotView";
import { shotsInExport, type ExportScope } from "./assets";

/** The picker and capture must budget the same visible shots and enabled effects. */
export function exportQualityRequirements(project: Project, scope: ExportScope) {
  const shots = shotsInExport(project, scope);
  const views = shots.length ? shots : [null];
  return {
    detailShadows: (project.scene.detailShadows ?? 0) > 0,
    effectCount: Math.max(...views.map((shot) => resolveShotEffects(project, shot).filter((effect) => effect.enabled).length)),
    depth: views.some((shot) => resolveShotView(project, shot).blurMode === "depth"),
  };
}
