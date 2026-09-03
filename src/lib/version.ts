export const APP_VERSION = "0.3.0";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.0",
    date: "Sep 2, 2026",
    title: "Sample screens, cleaner materials, a calmer default",
    items: [
      "Six built-in sample screens (Finance dark and light, Music, Messages, Analytics, Landing page) drawn procedurally at any resolution: pick one from the Source panel, and every starter template now opens with one already on the device.",
      "Fixed the sparkle speckle on device bodies: normal maps are now mip-filtered and anisotropically sampled, and Body gloss no longer polishes a textured surface down to a mirror.",
      "The default project no longer ships with camera keyframes, so dragging the camera edits the pose itself and a refresh brings back exactly what you left.",
      "Scene picker rebuilt as full-width preview cards.",
      "Applying a template parks the playhead past its fade-in, so you see the shot instead of a black frame.",
      "iPhone 17 Pro finishes: Silver, Cosmic Orange, Deep Blue.",
      "Blur focus guides while you adjust: a circle for radial (solid where the blur starts, dashed for the falloff), paired lines for tilt shift, an angled line for directional.",
      "Lens blur gains Auto focus / Manual, with a keyframeable Focus distance for pulling focus between subjects.",
      "Four more starters in a plain-ground, tight-crop style: Watch detail, iPhone top, iPhone angle and MacBook 1, bringing the gallery to 24.",
    ],
  },
  {
    version: "0.2.0",
    date: "Sep 2, 2026",
    title: "Text, logos, audio and a calibrated camera",
    items: [
      "Text shots: Geist or 20 Google fonts, weight, size, colour, alignment, line height and letter spacing, with enter / exit animations.",
      "Logo shots: drop a PNG or SVG mark on a colour, with Liquid metal, Gem smoke and Heatmap shader looks.",
      "Audio lane: music or voiceover with volume, fades, trim and drag-to-offset; mixed into MP4 and WebM exports.",
      "Transitions: click the marker between two shots to turn the cut into a fade of any colour; whole-video fade in and out.",
      "Timeline: right-click menus (rename, split at playhead, reverse, copy / paste, duplicate), drag to reorder shots, snapping to half seconds and the playhead, pinch or ⌘-scroll zoom, resizable height.",
      "Camera rig, presets, drag and wheel feel matched numerically to Ultramock; the default project opens with the same settle move.",
      "Video shots: playback speed and trim start; per-shot media is honoured in exports.",
      "Centre guides, snap-to-centre panning, keyboard K to stamp camera keyframes, interface sounds, preferences.",
    ],
  },
  {
    version: "0.1.0",
    date: "Sep 1, 2026",
    title: "First release",
    items: [
      "Ten photoreal glTF devices plus flat and browser cards, five scenes, six lighting rigs, twelve background presets.",
      "Keyframe timeline with shots, motion presets and auto-motion.",
      "Image export to 8K (PNG / WebP / JPG, transparent) and video export to 4K 60 fps with motion blur.",
      "Radial, directional, tilt-shift and lens blur with a placeable focal point; vignette, grain, bloom, chromatic aberration, sharpen, pixel grid, fish eye, glass border, ghost, liquid glass and screen fade effects.",
      "Local projects (IndexedDB), autosave and portable .mok files.",
    ],
  },
];
