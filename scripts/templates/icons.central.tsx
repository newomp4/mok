"use client";
import type { ComponentType, CSSProperties, SVGProps } from "react";
import { LEGACY_PATHS } from "./icons.legacy";
import { IconArrowDown } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowDown";
import { IconArrowInbox } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowInbox";
import { IconArrowLeft } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowLeft";
import { IconArrowRedoDown } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowRedoDown";
import { IconArrowRight } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowRight";
import { IconArrowUndoUp } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowUndoUp";
import { IconArrowUp } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowUp";
import { IconArrowsAllSides } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowsAllSides";
import { IconArrowsRepeatRightLeft } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconArrowsRepeatRightLeft";
import { IconBarsThree } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconBarsThree";
import { IconBlur } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconBlur";
import { IconBox2 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconBox2";
import { IconCamera1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconCamera1";
import { IconCheckmark1Medium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconCheckmark1Medium";
import { IconChevronDownMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconChevronDownMedium";
import { IconChevronGrabberVertical } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconChevronGrabberVertical";
import { IconChevronLeftMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconChevronLeftMedium";
import { IconChevronRightMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconChevronRightMedium";
import { IconChevronTopMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconChevronTopMedium";
import { IconCircle } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconCircle";
import { IconClock } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconClock";
import { IconCode } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconCode";
import { IconColorPalette } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconColorPalette";
import { IconColors } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconColors";
import { IconCrop } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconCrop";
import { IconCrossMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconCrossMedium";
import { IconDiamond } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconDiamond";
import { IconDiamondShine } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconDiamondShine";
import { IconDotGrid2x3 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconDotGrid2x3";
import { IconDotGrid3x3 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconDotGrid3x3";
import { IconEyeOpen } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconEyeOpen";
import { IconEyeSlash } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconEyeSlash";
import { IconFloppyDisk1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconFloppyDisk1";
import { IconFocusMacro } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconFocusMacro";
import { IconFolder1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconFolder1";
import { IconFullscreen1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconFullscreen1";
import { IconGithub } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconGithub";
import { IconGlass } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconGlass";
import { IconGrid } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconGrid";
import { IconHand5Finger } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconHand5Finger";
import { IconHistory } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconHistory";
import { IconImac } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconImac";
import { IconImages1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconImages1";
import { IconInfoSimple } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconInfoSimple";
import { IconKeyboard } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconKeyboard";
import { IconLayersThree } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconLayersThree";
import { IconLens } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconLens";
import { IconLoader } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconLoader";
import { IconLock } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconLock";
import { IconMacbook } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconMacbook";
import { IconMagicWand } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconMagicWand";
import { IconMagnifyingGlass } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconMagnifyingGlass";
import { IconMinimize } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconMinimize";
import { IconMinusMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconMinusMedium";
import { IconMoon } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconMoon";
import { IconNoiseReduction } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconNoiseReduction";
import { IconPause } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPause";
import { IconPhone } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPhone";
import { IconPhoneDynamicIsland } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPhoneDynamicIsland";
import { IconPin } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPin";
import { IconPlay } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPlay";
import { IconPlayCircle } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPlayCircle";
import { IconPlusMedium } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconPlusMedium";
import { IconQuestionmarkCircle } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconQuestionmarkCircle";
import { IconRecord } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconRecord";
import { IconRepeat } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconRepeat";
import { IconRotate360Left } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconRotate360Left";
import { IconScissors1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconScissors1";
import { IconSettingsGear1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSettingsGear1";
import { IconSettingsSliderHor } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSettingsSliderHor";
import { IconShadows } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconShadows";
import { IconShareOs } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconShareOs";
import { IconShuffle } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconShuffle";
import { IconSkip } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSkip";
import { IconSmartwatch1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSmartwatch1";
import { IconSparklesTwo } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSparklesTwo";
import { IconSquareArrowTopRight } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSquareArrowTopRight";
import { IconSquareArrowTopRight2 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSquareArrowTopRight2";
import { IconSquareBehindSquare1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSquareBehindSquare1";
import { IconSquareLinesBottom } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSquareLinesBottom";
import { IconSquarePlaceholder } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSquarePlaceholder";
import { IconSun } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSun";
import { IconSunHigh } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconSunHigh";
import { IconTablet } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconTablet";
import { IconTarget1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconTarget1";
import { IconText1 } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconText1";
import { IconTextSelect } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconTextSelect";
import { IconTrashCan } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconTrashCan";
import { IconVideo } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconVideo";
import { IconVideoClip } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconVideoClip";
import { IconVideoRoll } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconVideoRoll";
import { IconVignette } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconVignette";
import { IconWindowApp } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconWindowApp";
import { IconZoomIn } from "@central-icons-react/round-outlined-radius-2-stroke-1.5/IconZoomIn";

/**
 * Central Icon System (round · outlined · radius 2 · stroke 1.5) via the
 * @central-icons-react package. Names below are the editor's semantic names;
 * anything unmapped falls back to the hand-drawn glyphs in icons.legacy.ts.
 * The Central packages are distributed under the Iconists license (see the
 * LICENSE.md inside the installed package).
 */
type CentralIcon = ComponentType<{ size?: number | string; color?: string; className?: string; style?: CSSProperties; mode?: "masked" | "raw" }>;

const CENTRAL: Record<string, CentralIcon> = {
  "menu": IconBarsThree,
  "x": IconCrossMedium,
  "check": IconCheckmark1Medium,
  "plus": IconPlusMedium,
  "minus": IconMinusMedium,
  "chevron-down": IconChevronDownMedium,
  "chevron-up": IconChevronTopMedium,
  "chevron-right": IconChevronRightMedium,
  "chevron-left": IconChevronLeftMedium,
  "chevrons-up-down": IconChevronGrabberVertical,
  "arrow-left": IconArrowLeft,
  "arrow-right": IconArrowRight,
  "arrow-up": IconArrowUp,
  "arrow-down": IconArrowDown,
  "info": IconInfoSimple,
  "help-circle": IconQuestionmarkCircle,
  "camera": IconCamera1,
  "upload": IconShareOs,
  "download": IconArrowInbox,
  "export": IconSquareArrowTopRight2,
  "undo": IconArrowUndoUp,
  "redo": IconArrowRedoDown,
  "rotate-ccw": IconRotate360Left,
  "moon": IconMoon,
  "sun": IconSun,
  "play": IconPlay,
  "pause": IconPause,
  "skip-back": IconSkip,
  "skip-forward": IconSkip,
  "repeat": IconRepeat,
  "diamond": IconDiamond,
  "record": IconRecord,
  "sliders": IconSettingsSliderHor,
  "image": IconImages1,
  "video": IconVideo,
  "phone": IconPhoneDynamicIsland,
  "tablet": IconTablet,
  "laptop": IconMacbook,
  "watch": IconSmartwatch1,
  "monitor": IconImac,
  "square": IconSquarePlaceholder,
  "browser": IconWindowApp,
  "grid": IconGrid,
  "clock": IconClock,
  "save": IconFloppyDisk1,
  "folder": IconFolder1,
  "trash": IconTrashCan,
  "copy": IconSquareBehindSquare1,
  "lock": IconLock,
  "sparkles": IconSparklesTwo,
  "target": IconTarget1,
  "zoom-in": IconZoomIn,
  "maximize": IconFullscreen1,
  "minimize": IconMinimize,
  "layers": IconLayersThree,
  "palette": IconColorPalette,
  "shadow": IconShadows,
  "eye": IconEyeOpen,
  "eye-off": IconEyeSlash,
  "settings": IconSettingsGear1,
  "keyboard": IconKeyboard,
  "external-link": IconSquareArrowTopRight,
  "search": IconMagnifyingGlass,
  "shuffle": IconShuffle,
  "film": IconVideoRoll,
  "aperture": IconLens,
  "grip": IconDotGrid2x3,
  "move": IconArrowsAllSides,
  "blur": IconBlur,
  "grain": IconNoiseReduction,
  "vignette": IconVignette,
  "bloom": IconSunHigh,
  "chromatic": IconColors,
  "pixel": IconDotGrid3x3,
  "fisheye": IconFocusMacro,
  "sharpen": IconDiamondShine,
  "glass": IconGlass,
  "fade": IconSquareLinesBottom,
  "cube": IconBox2,
  "landscape": IconTablet,
  "portrait": IconPhone,
  "square-outline": IconSquarePlaceholder,
  "flip": IconArrowsRepeatRightLeft,
  "code": IconCode,
  "type": IconText1,
  "crop": IconCrop,
  "history": IconHistory,
  "scissors": IconScissors1,
  "text-cursor": IconTextSelect,
  "wand": IconMagicWand,
  "hand": IconHand5Finger,
  "pin": IconPin,
  "spinner": IconLoader,
  "play-circle": IconPlayCircle,
  "shot": IconVideoClip,
  "dot": IconCircle,
  "github": IconGithub,
};

/** icons that reuse a Central glyph mirrored horizontally */
const FLIP_X = new Set(["skip-back"]);

export type IconName = string;
export const ICON_NAMES = Array.from(new Set([...Object.keys(CENTRAL), ...Object.keys(LEGACY_PATHS)]));

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.5, className, style, ...rest }: IconProps) {
  const C = CENTRAL[name];
  if (C) {
    const s: CSSProperties = { ...(style as CSSProperties), flexShrink: 0, ...(FLIP_X.has(name) ? { transform: "scaleX(-1)" } : {}) };
    return <C size={size} mode="raw" className={className} style={s} />;
  }
  const d = LEGACY_PATHS[name] ?? LEGACY_PATHS["square-outline"];
  const filled = name === "diamond-filled";
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
      style={style}
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <Icon name="spinner" size={size} className={`spin ${className}`} />;
}
