import { ANIM_PROPS, type MediaRef, type Project, type Shot, type Keyframe, type AnimProp, type TextStyle, type CaptionStyle, type TextOverlay } from "./types";
import { DEVICES } from "./devices";
import { ASPECTS, EFFECT_DEFS, LIGHTINGS, SCENES } from "./presets";
import { EASES, MAX_PROJECT_DURATION } from "./animation";
import { uid } from "./ids";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, fallback: string): string => typeof v === "string" ? v : fallback;
const choice = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => options.includes(v as T) ? v as T : fallback;
const blurModes = ["off", "radial", "directional", "linear", "depth"] as const;
const validId = (v: unknown) => typeof v === "string" && v.length > 0 && v.length < 256 && !["__proto__", "constructor", "prototype"].includes(v);
function animationValue(prop: AnimProp, v: number): number {
  if (prop === "camera.fov") return num(v, 30, 1, 150);
  if (prop === "camera.zoom") return num(v, 1, 0.01, 100);
  if (prop === "mockup.lid") return num(v, 110, 0, 180);
  if (["blur.focusX", "blur.focusY", "blur.focusSize", "blur.falloff"].includes(prop)) return num(v, 0.5, 0, 1);
  if (["screen.brightness", "scene.lightIntensity", "blur.strength", "blur.focusDistance"].includes(prop)) return num(v, 0, 0, 100);
  return num(v, 0, -1e6, 1e6);
}

/** Rebuild known fields only, retaining valid older fields while replacing broken values. */
function fields<T extends object>(value: unknown, defaults: T): T {
  const src = object(value);
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const v = src[key];
    return [key, typeof fallback === "number" ? num(v, fallback) : typeof fallback === "string" ? str(v, fallback) : typeof fallback === "boolean" ? (typeof v === "boolean" ? v : fallback) : fallback];
  })) as T;
}

export function validateMediaRef(value: unknown): MediaRef | null {
  const m = object(value);
  if (!validId(m.id) || !["image", "video", "audio"].includes(String(m.kind))) return null;
  const kind = m.kind as MediaRef["kind"];
  const width = num(m.width, 0, 0, 100000), height = num(m.height, 0, 0, 100000);
  if (kind !== "audio" && (!width || !height)) return null;
  const duration = num(m.duration, 0, 0, 86400);
  return { id: m.id as string, kind, width, height, name: str(m.name, "media"), ...(duration > 0 ? { duration } : {}) };
}


function validateEffects(value: unknown): Project["effects"] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const e = object(raw), def = EFFECT_DEFS.find((d) => d.id === e.id);
    if (!def || seen.has(def.id)) return [];
    seen.add(def.id);
    return [{ id: def.id, enabled: e.enabled !== false, params: Object.fromEntries(def.params.map((d) => [d.key, num(object(e.params)[d.key], d.default, d.min, d.max)])) }];
  });
}

/** Shared by file imports, autosave, saved projects and replaceProject. Never mutates its input. */
function validateCaption(raw: unknown, clipDuration: number): CaptionStyle {
  const c = object(raw), text = object(c.text), timing = object(c.timing);
  const duration = num(timing.duration, clipDuration, .1, 86400);
  const style: TextStyle = fields(text, { text: "Your caption", font: "Geist", weight: 600, size: .065, color: "#111111", align: "center" as const, background: "#f2f2f2", lineHeight: 1.15, letterSpacing: -.02 });
  style.align = choice(text.align, ["left", "center", "right"], "center");
  style.size = num(text.size, .065, .001, 5); style.weight = num(text.weight, 600, 100, 900);
  style.lineHeight = num(text.lineHeight, 1.15, .1, 10); style.letterSpacing = num(text.letterSpacing, -.02, -1, 5);
  const result: CaptionStyle = { enabled: c.enabled !== false, text: style, x: num(c.x, 0, -1, 1), y: num(c.y, .3, -1, 1), layer: choice(c.layer, ["front", "behind"], "front") };
  if (c.timing) result.timing = { offset: num(timing.offset, 0, 0, duration), duration };
  for (const key of ["enter", "exit"] as const) if (c[key]) result[key] = { effect: choice(object(c[key]).effect, ["none", "fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "blur"], "fade"), duration: num(object(c[key]).duration, .3, 0, c.timing ? duration : clipDuration) };
  return result;
}

export function validateProject(value: unknown, defaults: Project): Project {
  const src = object(value);
  if (!Array.isArray(src.shots)) throw new Error("Invalid project: the shot list is missing");
  if (src.version !== undefined && src.version !== 1) throw new Error("This project was created by an unsupported version of mok");
  const p = fields(src, defaults);
  p.id = validId(src.id) ? src.id as string : uid();
  p.version = 1;
  p.aspect = choice(src.aspect, ASPECTS.map((x) => x.id), defaults.aspect);
  p.scene = fields(src.scene, defaults.scene);
  p.scene.preset = choice(object(src.scene).preset, SCENES.map((x) => x.id), defaults.scene.preset);
  p.scene.lighting = choice(object(src.scene).lighting, LIGHTINGS.map((x) => x.id), defaults.scene.lighting);
  p.scene.detailShadows = num(object(src.scene).detailShadows, 0, 0, 1);
  p.scene.lightIntensity = num(p.scene.lightIntensity, 1, 0, 10);
  p.scene.background = fields(object(src.scene).background, defaults.scene.background);
  p.scene.background.type = choice(p.scene.background.type, ["color", "preset", "image", "transparent"], "color");
  p.scene.background.image = validateMediaRef(object(object(src.scene).background).image);
  p.scene.background.blur = num(p.scene.background.blur, 0.6, 0, 1);
  p.mockup = fields(src.mockup, defaults.mockup);
  p.mockup.device = choice(p.mockup.device, DEVICES.map((x) => x.id), defaults.mockup.device);
  const orientation = object(src.mockup).orientation;
  if (orientation === "portrait" || orientation === "landscape") p.mockup.orientation = orientation;
  else delete p.mockup.orientation;
  p.mockup.bandColor = typeof object(src.mockup).bandColor === "string" ? object(src.mockup).bandColor as string : null;
  p.mockup.reflection = num(p.mockup.reflection, 0.35, 0, 1);
  p.mockup.gloss = num(p.mockup.gloss, 1, 0.2, 3);
  p.mockup.borderRadius = num(p.mockup.borderRadius, 0.04, 0, 1);
  p.camera = fields(src.camera, defaults.camera);
  p.camera.fov = num(p.camera.fov, 30, 1, 150);
  p.camera.zoom = num(p.camera.zoom, 1, 0.01, 100);
  p.blur = fields(src.blur, defaults.blur);
  p.blur.mode = choice(p.blur.mode, blurModes, "off");
  for (const prop of ANIM_PROPS) {
    const [group, key] = prop.split(".");
    if (group === "blur") { const blur = p.blur as unknown as Record<string, number>; blur[key] = animationValue(prop, blur[key]); }
  }
  p.screen = fields(src.screen, defaults.screen);
  p.screen.padding = num(p.screen.padding, 0, 0, 0.45);
  p.screen.brightness = num(p.screen.brightness, 1, 0, 10);
  p.screen.spill = num(p.screen.spill, 1, 0, 2);
  p.screen.bg = fields(object(src.screen).bg, { type: "color" as const, color: "#000000", image: null, preset: "whisp" });
  p.screen.bg.type = choice(object(object(src.screen).bg).type, ["color", "image", "gradient"], "color");
  p.screen.bg.image = validateMediaRef(object(object(src.screen).bg).image);
  p.fps = num(src.fps, 30, 1, 120);
  p.fade = fields(src.fade, { in: 0, out: 0, color: "#000000" });
  p.fade.in = Math.max(0, p.fade.in); p.fade.out = Math.max(0, p.fade.out);
  const audio = object(src.audio), audioMedia = validateMediaRef(audio.media);
  p.audio = audioMedia?.kind === "audio" ? { media: audioMedia, start: num(audio.start, 0, 0), trimStart: num(audio.trimStart, 0, 0, audioMedia.duration ?? 86400), volume: num(audio.volume, 1, 0, 1), fadeIn: num(audio.fadeIn, 0, 0), fadeOut: num(audio.fadeOut, 0, 0) } : null;
  const ids = new Set<string>();
  p.shots = src.shots.map((raw, index): Shot => {
    const s = object(raw);
    const id = validId(s.id) && !ids.has(s.id as string) ? s.id as string : uid(); ids.add(id);
    const shot: Shot = { id, name: str(s.name, `Shot ${index + 1}`), duration: num(s.duration, 3, 0.1, 86400), media: validateMediaRef(s.media), fit: choice(s.fit, ["cover", "contain", "stretch"], "cover"), kind: choice(s.kind, ["media", "text", "logo"] as const, "media"), keyframes: {}, focusAreas: [] };
    if (shot.media?.kind === "audio") shot.media = null;
    if (Array.isArray(s.effects)) shot.effects = validateEffects(s.effects);
    if (typeof s.screenPadding === "number" && Number.isFinite(s.screenPadding)) shot.screenPadding = num(s.screenPadding, 0, 0, 0.45);
    if (s.audio && typeof s.audio === "object") {
      const audio = object(s.audio);
      const rawEnvelope = object(audio.envelope);
      const envelopeDuration = num(rawEnvelope.duration, shot.duration, 0.1, 86400);
      const envelope = audio.envelope ? { offset: num(rawEnvelope.offset, 0, 0, envelopeDuration), duration: envelopeDuration } : undefined;
      const fadeLength = envelope?.duration ?? shot.duration;
      shot.audio = { enabled: audio.enabled === true, volume: num(audio.volume, 1, 0, 1), fadeIn: num(audio.fadeIn, 0, 0, fadeLength), fadeOut: num(audio.fadeOut, 0, 0, fadeLength), ...(envelope ? { envelope } : {}) };
    }
    shot.speed = num(s.speed, 1, 0.25, 4);
    shot.trimStart = num(s.trimStart, 0, 0, shot.media?.duration ?? 86400);
    if (typeof s.gap === "number" && s.gap > 0) shot.gap = num(s.gap, 0, 0, 86400);
    const props = object(s.keyframes);
    for (const prop of ANIM_PROPS) {
      const keys = props[prop];
      if (!Array.isArray(keys)) continue;
      const seen = new Map<number, Keyframe>();
      for (const rawKey of keys) {
        const k = object(rawKey);
        if (typeof k.t !== "number" || !Number.isFinite(k.t) || typeof k.v !== "number" || !Number.isFinite(k.v)) continue;
        const key: Keyframe = { t: num(k.t, 0, -86400, 86400), v: animationValue(prop, k.v), ease: choice(k.ease, [...EASES.map((x) => x.id), "expoIn", "backIn", "holdStart"], "smooth") };
        if (Array.isArray(k.cp) && k.cp.length === 4 && k.cp.every((v) => typeof v === "number" && Number.isFinite(v))) key.cp = [num(k.cp[0], 0, 0, 1), num(k.cp[1], 0, -10, 10), num(k.cp[2], 1, 0, 1), num(k.cp[3], 1, -10, 10)];
        if (Array.isArray(k.cpIn) && k.cpIn.length === 2 && k.cpIn.every((v) => typeof v === "number" && Number.isFinite(v))) key.cpIn = [num(k.cpIn[0], 1, 0, 1), num(k.cpIn[1], 1, -10, 10)];
        seen.set(key.t, key);
      }
      if (seen.size) shot.keyframes[prop] = [...seen.values()].sort((a, b) => a.t - b.t);
    }
    const pose: Partial<Record<AnimProp, number>> = {};
    for (const prop of ANIM_PROPS) { const v = object(s.pose)[prop]; if (typeof v === "number" && Number.isFinite(v)) pose[prop] = animationValue(prop, v); }
    if (Object.keys(pose).length) shot.pose = pose;
    if (Array.isArray(s.focusAreas)) shot.focusAreas = s.focusAreas.map((v) => { const f = object(v); return { id: validId(f.id) ? f.id as string : uid(), x: num(f.x, 0, 0, 1), y: num(f.y, 0, 0, 1), w: num(f.w, 0.2, 0.001, 1), h: num(f.h, 0.2, 0.001, 1) }; });
    if (DEVICES.some((x) => x.id === s.device)) shot.device = s.device as string;
    if (s.orientation === "portrait" || s.orientation === "landscape") shot.orientation = s.orientation;
    if (typeof s.finish === "string") shot.finish = s.finish;
    if (SCENES.some((x) => x.id === s.scene)) shot.scene = s.scene as Shot["scene"];
    if (LIGHTINGS.some((x) => x.id === s.lighting)) shot.lighting = s.lighting as Shot["lighting"];
    if (blurModes.includes(s.blurMode as typeof blurModes[number])) shot.blurMode = s.blurMode as Shot["blurMode"];
    if (typeof s.bokeh === "boolean") shot.bokeh = s.bokeh;
    if (typeof s.notch === "boolean") shot.notch = s.notch;
    if (shot.kind === "media" && s.caption && typeof s.caption === "object") shot.caption = validateCaption(s.caption, shot.duration);
    if (typeof s.cameraPoseCount === "number") shot.cameraPoseCount = Math.round(num(s.cameraPoseCount, 3, 2, 12));
    if (shot.kind === "text") {
      shot.text = fields(s.text, { text: "Your headline here", font: "Geist", weight: 600, size: 0.09, color: "#111111", align: "center" as const, background: "#f2f2f2", lineHeight: 1.15, letterSpacing: -0.02 });
      shot.text.align = choice(object(s.text).align, ["left", "center", "right"], "center");
      shot.text.size = num(shot.text.size, 0.09, 0.001, 5); shot.text.lineHeight = num(shot.text.lineHeight, 1.15, 0.1, 10);
    }
    if (shot.kind === "logo") shot.logo = { media: validateMediaRef(object(s.logo).media), scale: num(object(s.logo).scale, 0.35, 0.01, 5), background: str(object(s.logo).background, "#f2f2f2"), effect: choice(object(s.logo).effect, ["none", "liquidMetal", "gemSmoke", "heatmap"], "none") };
    for (const key of ["enter", "exit"] as const) if (s[key]) shot[key] = { effect: choice(object(s[key]).effect, ["none", "fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "blur"], "fade"), duration: num(object(s[key]).duration, 0.4, 0, shot.duration) };
    if (s.transitionOut) shot.transitionOut = { type: choice(object(s.transitionOut).type, ["cut", "fade"], "cut"), duration: num(object(s.transitionOut).duration, 0.4, 0, shot.duration), color: str(object(s.transitionOut).color, "#000000") };
    return shot;
  });
  if (Array.isArray(src.textOverlays)) p.textOverlays = src.textOverlays.filter((v) => v && typeof v === "object").map((raw, index): TextOverlay => {
    const t = object(raw), id = validId(t.id) && !ids.has(t.id as string) ? t.id as string : uid(); ids.add(id);
    const start = num(t.start, 0, 0, MAX_PROJECT_DURATION - .1), duration = num(t.duration, 3, .1, MAX_PROJECT_DURATION - start);
    return { ...validateCaption(t, duration), id, name: str(t.name, `Text ${index + 1}`), start, duration };
  });
  const contentLength = Math.max(.1, p.shots.reduce((sum, shot) => sum + (shot.gap ?? 0) + shot.duration, 0), ...(p.textOverlays ?? []).map((t) => t.start + t.duration));
  p.duration = num(src.duration, Math.min(MAX_PROJECT_DURATION, contentLength), 0.1, MAX_PROJECT_DURATION);
  p.effects = validateEffects(src.effects);
  return p;
}
