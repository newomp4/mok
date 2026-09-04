export const APP_VERSION = "0.7.0";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.7.0",
    date: "Sep 4, 2026",
    title: "A shot owns its framing, its lens and its place on the ruler",
    items: [
      "Move the camera while parked on a shot and only that shot re-frames. The same goes for the lens: focus point, strength, range, angle, mode and bokeh all belong to the shot now. Camera and Blur each gained an Apply to all shots action, and a row holding its own value says so and can be handed back to the project.",
      "Shots sit anywhere on the ruler. Drag one along it to open a gap, shown as an orange band that names the two shots it sits between; the sequence holds the previous frame through it. Right-click a gap to close it.",
      "Marquee or shift-click several shots and move them as a group.",
      "The simple timeline is a real editing model: every shot on one row with a single shared keyframe lane, and moving the camera on a shot animates the sequence into that framing instead of cutting to it.",
      "Every keyframe carries its own in and out curves, shaped independently in the easing graph, with a tracing dot that runs the timing as you set it.",
      "A real mirror in the glass: the keyboard and the floor below actually reflect in the display, with the deck blocking the room behind it, on top of the environment sheen that was already there.",
      "Switching a 3D device keeps the one you are looking at on screen, at its own size, until the new model is ready — and a device you have already used comes back instantly.",
      "Eight backgrounds that read as wallpaper rather than as gradients, with bokeh, light leaks and depth, available for the scene and for the device screen alike.",
      "Save any project as a template and start from it later, from the Templates menu or the Projects window.",
      "Shadow softness and opacity reach the lit scenes; the studio backdrop casts a real key shadow, and the floor no longer draws a hard line where its shadow map ends.",
      "A keyframe dragged onto another is held a frame away instead of replacing it, and Delete no longer spends a keyframe selection and a shot selection in one press.",
      "Also: the iPad Air in its four colourways, Android phones under their own heading, an export that keeps running in a background tab, transparent background previewed live in the viewport, upload buttons that take several files, and a right-click on any number row to put it back.",
    ],
  },
  {
    version: "0.6.0",
    date: "Sep 3, 2026",
    title: "Android devices, real colourways and shadows that answer to their controls",
    items: [
      "Two Android phones: Pixel 9 Pro with its camera bar, and Galaxy S25 Ultra with bare lens rings on the back glass. Play Store output sizes sit beside the App Store ones.",
      "The photoscanned devices now change colour: MacBook Pro 14\" and 16\" in Silver and Space Black, iPad Pro 13\" in Silver and Space Black with its keyboard case following along, and Apple Watch Ultra in Natural or Black Titanium.",
      "Shadow softness and opacity finally do something in the lit scenes — they were being applied to a shadow map that ignored them. Every scene also gets the tight contact occlusion that stops the device looking like it hovers.",
      "Light rotation and Light intensity swing and dim the scene's own lights, so the cast shadow follows the control instead of only the reflections.",
      "A transparent export from a lit scene now really is transparent: the floor, fog and sky come out for that render and only the device is left.",
      "The floor blends into whatever backdrop colour you pick rather than ending on a hard horizon.",
      "Blur angle is animatable and the focus point can be keyframed, so a rack focus can pull between two subjects.",
      "Editing an animated property between keyframes moves the whole move instead of dropping a keyframe you did not ask for.",
      "The screen behind a transparent screenshot can use any of the twenty background gradients.",
      "Dropping several clips at once builds a sequence, and dropping a video opens the timeline.",
      "A shot has a numeric duration field, colour pickers write one undo step per drag, and typing no longer floods the undo stack.",
      "Fixes throughout: material and geometry leaks on the glTF devices and the flat mockup, unreferenced media swept out of storage, storage failures surfaced instead of swallowed, named projects saved back to their own record, and a group keyframe move that no longer merges keyframes on top of each other.",
    ],
  },
  {
    version: "0.5.0",
    date: "Sep 3, 2026",
    title: "Designed backgrounds and a timeline that edits like an NLE",
    items: [
      "Backgrounds rebuilt as layered mesh gradients with a raking sheen, a soft highlight, a vignette and fine grain. Fifteen presets, including Crystal, Spectrum and Sundrape.",
      "The background preset list is now a grid of real previews rather than a text list.",
      "Timeline clips show a frame of their own media; shots trim from the head as well as the tail, taking the video's trim point and the shot's keyframes with them.",
      "Keyframes follow the cursor while you drag, with a guide line when they snap. Right-click a lane for select whole track, add keyframe here and clear track.",
      "Number rows nudge with the arrow keys, ten steps at a time with shift.",
      "Contact shadow gains Soft and Opacity controls; two more lighting rigs, Lightbox and Dramatic key.",
      "Dropping a file now asks what it should do: replace this shot's source, add it as a new shot, or become the audio track.",
      "Add › Shot from camera appends a shot that starts from wherever the sequence ends and parks the playhead on its closing keyframe, so moving the camera sets where the shot lands.",
    ],
  },
  {
    version: "0.4.0",
    date: "Sep 3, 2026",
    title: "Easing graph, marquee selection and rebuilt scenes",
    items: [
      "Easing graph editor: select a keyframe and drag either bezier handle, or take one of eight preset curves. Applies across a whole selection or a whole track, with a live cubic-bezier readout.",
      "Marquee-select keyframes by dragging across the tracks; shift adds. Dragging any selected diamond moves the group, and holding alt retimes it proportionally.",
      "⌘⌥A selects every keyframe; arrow up and down nudge the selection by a frame (shift ×10, alt retimes).",
      "Keyframes can now sit before a shot starts or after it ends, so a move carries motion through a cut. Lanes open automatically for shots that have keyframes.",
      "The 3D scenes were rebuilt: fog no longer swallows the floor, so Studio, Bright studio, Concrete and Dark room all show a lit sweep with real shadows. Dark room has a reflective floor again.",
      "New: the screen throws its own light into lit scenes, coloured by whatever is on the display and following video as it plays.",
      "Wheel zoom recalibrated to Ultramock's measured rate; a single notch no longer flies across the range.",
      "More Central glyphs: distinct upload, download, transport, focus, audio and effect icons.",
    ],
  },
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
