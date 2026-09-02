"use client";
import type { SVGProps } from "react";
import { LEGACY_PATHS } from "./icons.legacy";

/**
 * Editor icons. By default these are hand-drawn glyphs in the Central Icon
 * System style (24px grid, 1.5px round strokes). With a Central license,
 * run `scripts/use-central-icons.mjs` to swap in the real Central glyphs.
 */
export type IconName = keyof typeof LEGACY_PATHS;
export const ICON_NAMES = Object.keys(LEGACY_PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.5, className, ...rest }: IconProps) {
  const d = LEGACY_PATHS[name] ?? LEGACY_PATHS["square-outline"];
  const filled = name === "play" || name === "pause" || name === "record" || name === "dot";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <Icon name="spinner" size={size} className={`spin ${className}`} strokeWidth={2} />;
}
