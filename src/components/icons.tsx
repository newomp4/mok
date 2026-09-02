import type { SVGProps } from "react";

/**
 * Icon set drawn on a 24px grid in the Central Icon System style
 * (round caps/joins, 1.5px stroke, 2px corner radius).
 * Swap any glyph for the licensed @central-icons-react equivalent by
 * editing the path map below — names follow Central's naming.
 */
const P: Record<string, string> = {
  menu: "M4 7h16M4 12h16M4 17h16",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-up": "M6 15l6-6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevrons-up-down": "M8 9l4-4 4 4M8 15l4 4 4-4",
  "arrow-left": "M19 12H5M12 5l-7 7 7 7",
  "arrow-right": "M5 12h14M12 5l7 7-7 7",
  "arrow-up": "M12 19V5M5 12l7-7 7 7",
  "arrow-down": "M12 5v14M5 12l7 7 7-7",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  "help-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.7M12 17h.01",
  camera: "M4 9a2 2 0 0 1 2-2h2l1.4-2h5.2L16 7h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  download: "M12 4v12M7 11l5 5 5-5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  export: "M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  "rotate-ccw": "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  play: "M7 5.5v13a1 1 0 0 0 1.5.9l10.5-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5z",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
  "skip-back": "M5 5v14M19 6.5v11a1 1 0 0 1-1.6.8L9.6 12.8a1 1 0 0 1 0-1.6l7.8-5.5A1 1 0 0 1 19 6.5z",
  "skip-forward": "M19 5v14M5 6.5v11a1 1 0 0 0 1.6.8l7.8-5.5a1 1 0 0 0 0-1.6L6.6 5.7A1 1 0 0 0 5 6.5z",
  repeat: "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  diamond: "M12 3l9 9-9 9-9-9z",
  record: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  image: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-4.5-4.5L8 19",
  video: "M3 9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 11l5-2.5v7L16 13",
  phone: "M7 5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3zM10.5 5h3",
  tablet: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17h.01",
  laptop: "M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9H5zM2 18h20M3 15h18l1 3H2z",
  watch: "M7 10a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3zM9.5 7L10 3h4l.5 4M9.5 17l.5 4h4l.5-4M17 11h1v2h-1",
  monitor: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 21h8M12 17v4",
  square: "M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z",
  browser: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M6.5 6.5h.01M9.5 6.5h.01",
  grid: "M4 5a1 1 0 0 1 1-1h5v6H4zM14 4h5a1 1 0 0 1 1 1v5h-6zM4 14h6v6H5a1 1 0 0 1-1-1zM14 14h6v5a1 1 0 0 1-1 1h-5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  save: "M5 3h10.5L19 6.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v5h7V3M8 21v-6h8v6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  trash: "M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v6M14 11v6",
  copy: "M9 11a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  lock: "M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 11V7a4 4 0 0 1 8 0v4",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z",
  target: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v2M12 20v2M2 12h2M20 12h2",
  "zoom-in": "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.5-4.5M11 8v6M8 11h6",
  maximize: "M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4M21 16v4a1 1 0 0 1-1 1h-4",
  minimize: "M3 9h5a1 1 0 0 0 1-1V3M21 9h-5a1 1 0 0 1-1-1V3M9 21v-5a1 1 0 0 0-1-1H3M15 21v-5a1 1 0 0 1 1-1h5",
  layers: "M12 3l9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5",
  palette: "M12 3a9 9 0 1 0 0 18c1.4 0 2.2-.9 2.2-1.9 0-.9-.6-1.2-.6-2.1a2 2 0 0 1 2-2h1.8A3.6 3.6 0 0 0 21 11.4 9 9 0 0 0 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01",
  shadow: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM6 19c0 1.1 2.7 2 6 2s6-.9 6-2-2.7-2-6-2-6 .9-6 2z",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-off": "M3 3l18 18M10.6 5.7A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.6 6.6C4 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  settings: "M6 4v5M6 13v7M12 4v10M12 18v2M18 4v2M18 10v10M4 9h4M10 14h4M16 6h4",
  keyboard: "M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6",
  "external-link": "M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.5-4.5",
  shuffle: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  film: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4",
  aperture: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.3 20.7L9.5 8.4M20.7 14.3L8.4 9.5M19.1 5.8L11 15.6M3 9.6l12.3 4.8M4.9 18.2l8.1-9.8",
  grip: "M9 5.5h.01M9 12h.01M9 18.5h.01M15 5.5h.01M15 12h.01M15 18.5h.01",
  move: "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
  blur: "M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z",
  grain: "M5 5h.01M9 8h.01M13 5h.01M18 7h.01M6 12h.01M11 12h.01M16 12h.01M20 11h.01M4 17h.01M8 19h.01M13 16h.01M18 18h.01",
  vignette: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 16.5c3 0 5.5-2 5.5-4.5S15 7.5 12 7.5 6.5 9.5 6.5 12s2.5 4.5 5.5 4.5z",
  bloom: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2",
  chromatic: "M9 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM15 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 19a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  pixel: "M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z",
  fisheye: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18M3.5 9.5c3-1.5 14-1.5 17 0M3.5 14.5c3 1.5 14 1.5 17 0",
  sharpen: "M12 4l8 16H4zM12 10v6",
  glass: "M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM7.5 10.5a3 3 0 0 1 3-3",
  fade: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 12h16M12 4v16M8 8h.01M8 16h.01M16 8h.01M16 16h.01",
  cube: "M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM12 12l8.5-4.7M12 12v9.5M12 12L3.5 7.3",
  landscape: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  portrait: "M7 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z",
  "square-outline": "M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z",
  flip: "M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2",
  type: "M4 7V4h16v3M12 4v16M9 20h6",
  crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  history: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12",
  "text-cursor": "M12 4v16M8 4h8M8 20h8",
  wand: "M15 4l5 5L7 22H2v-5zM14 5l5 5M5 2l.7 1.8M2 5l1.8.7M9 2l-.7 1.8",
  hand: "M18 11V6a2 2 0 1 0-4 0v5M14 10V4a2 2 0 1 0-4 0v6M10 10.5V6a2 2 0 1 0-4 0v9l-2-2.5a2 2 0 0 0-3 2.7L5 20a5 5 0 0 0 4 2h6a5 5 0 0 0 5-5v-6a2 2 0 1 0-4 0",
  pin: "M12 21v-6M8 15h8l-1-4V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4z",
  spinner: "M12 3a9 9 0 0 1 9 9",
  "play-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l6-3.5z",
  "shot": "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 9h16M4 15h16",
  "dot": "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
};

export type IconName = keyof typeof P;
export const ICON_NAMES = Object.keys(P) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.5, className, ...rest }: IconProps) {
  const d = P[name] ?? P["square-outline"];
  const filled = name === "play" || name === "pause" || name === "record" || name === "diamond-filled" || name === "dot";
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
