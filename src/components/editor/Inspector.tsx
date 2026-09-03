"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEditor, redo, undo, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ANIM_LABELS, type AnimProp, type BlurMode, type EffectId, type EnterExit, type EnterExitEffect, type FitMode, type LogoEffect, type Shot, type TextStyle } from "@/lib/types";
import { hasKeyframeAt, locate, sampleTrack } from "@/lib/animation";
import { DEVICES, FAMILY_LABELS, getDevice, getFinish, type DeviceFamily } from "@/lib/devices";
import { BG_PRESETS, CAMERA_PRESETS, EFFECT_DEFS, LIGHTINGS, SCENES, getBgPreset, getEffectDef, getScene } from "@/lib/presets";
import { paintPreset } from "@/three/background";
import { Button, ColorRow, IconButton, NumberRow, Section, Segmented, SelectRow, TextAreaRow, ToggleRow, type KeyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useMedia, ACCEPTED_TYPES, ACCEPTED_IMAGES } from "@/lib/media";
import { useModelBounds } from "@/three/registry";
import { useActiveShot } from "@/three/Device";
import { applyCameraPreset, importBackgroundImage, importFilesToShot, importLogo, importScreenBackground, resetBlur, resetCamera, setShotMedia, applySampleScreen } from "@/lib/actions";
import { SAMPLE_SCREENS, drawSampleScreen } from "@/lib/screens";
import { pickFiles } from "./hooks";
import { defaultLogoStyle, defaultTextStyle, shotKind } from "@/lib/defaults";
import { FONTS, cssFamily, ensureFont, getFont, nearestWeight } from "@/lib/fonts";
import { anim } from "@/three/anim";

/* ---------- animated value helpers ---------- */
function useAnimRow(prop: AnimProp) {
  const setValue = useEditor((s) => s.setValue);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const time = useUI((s) => s.time);
  const { value, keyState } = useEditor(useShallow((s) => {
    const loc = locate(s.project, time);
    const track = loc.shot?.keyframes[prop];
    const [g, k] = prop.split(".") as [keyof typeof s.project, string];
    const base = (s.project[g] as unknown as Record<string, number>)[k];
    const value = track && track.length ? sampleTrack(track, loc.localT) : base;
    const keyState: KeyState = track && track.length ? (hasKeyframeAt(track, loc.localT) ? "key" : "track") : "none";
    return { value, keyState };
  }));
  return { value, keyState, onChange: (v: number) => setValue(prop, v), onKey: () => toggleKeyframe(prop) };
}

function AnimRow({ prop, label, min, max, step, hint, unit, disabled, sensitivity }: { prop: AnimProp; label?: ReactNode; min: number; max: number; step?: number; hint?: string; unit?: string; disabled?: boolean; sensitivity?: number }) {
  const row = useAnimRow(prop);
  return (
    <NumberRow
      label={label ?? ANIM_LABELS[prop]}
      value={row.value}
      min={min}
      max={max}
      step={step}
      hint={hint}
      unit={unit}
      disabled={disabled}
      sensitivity={sensitivity}
      onChange={row.onChange}
      onDragStart={beginInteraction}
      onDragEnd={endInteraction}
      keyState={row.keyState}
      onKey={row.onKey}
    />
  );
}

/* ---------- Shot (source) ---------- */
function ShotSection() {
  const shot = useActiveShot();
  const [open, setOpen] = useState(true);
  const kind = shotKind(shot);
  const title = kind === "text" ? "Text" : kind === "logo" ? "Logo" : "Source";
  return (
    <Section title={title} sub={shot?.name} open={open} onToggle={() => setOpen((o) => !o)} tour="source">
      {shot && kind === "text" && <TextEditor shot={shot} />}
      {shot && kind === "logo" && <LogoEditor shot={shot} />}
      {(!shot || kind === "media") && <MediaEditor shot={shot} />}
    </Section>
  );
}

function MediaEditor({ shot }: { shot: Shot | null }) {
  const media = useMedia(shot?.media);
  const update = useEditor((s) => s.update);
  const updateShot = useEditor((s) => s.updateShot);
  const pick = () => void pickFiles(ACCEPTED_TYPES).then((f) => importFilesToShot(f, shot?.id));
  if (!media) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={pick} className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-2 bg-panel-2 text-fg-2 transition-colors hover:border-fg-2 hover:text-fg">
          <Icon name="upload" size={16} />
          <span className="label">Click to upload</span>
          <span className="label-sm text-muted">Drag & drop or paste</span>
        </button>
        <SampleScreens shotId={shot?.id ?? null} />
      </div>
    );
  }
  const isVideo = media.kind === "video";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="group relative overflow-hidden rounded-md border border-line bg-panel-2">
        {isVideo ? (
          <video src={media.url} muted className="h-28 w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.url} alt="" className="h-28 w-full object-contain" draggable={false} />
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
          <span className="label-sm truncate text-white/90">{media.ref.name}</span>
          <span className="label-sm text-white/70">{media.width} × {media.height}{isVideo && media.ref.duration ? ` · ${media.ref.duration.toFixed(1)}s` : ""}</span>
        </div>
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {!isVideo && shot && <IconButton icon="crop" label="Crop" onClick={() => useUI.getState().setCropShot(shot.id)} className="h-6 w-6 bg-panel/90" />}
          <IconButton icon="upload" label="Replace" onClick={pick} className="h-6 w-6 bg-panel/90" />
          <IconButton icon="trash" label="Remove" onClick={() => setShotMedia(shot?.id ?? null, null)} className="h-6 w-6 bg-panel/90" />
        </div>
      </div>
      <Segmented size="sm" value={shot?.fit ?? "cover"} onChange={(v: FitMode) => update((p) => { const s = p.shots.find((x) => x.id === shot?.id); if (s) s.fit = v; })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }, { value: "stretch", label: "Stretch" }]} />
      {isVideo && shot && (
        <>
          <NumberRow label={<span className="flex items-center gap-1.5"><Icon name="gauge" size={11} className="text-muted" />Speed</span>} value={shot.speed ?? 1} min={0.25} max={4} step={0.05} unit="×" onChange={(v) => updateShot(shot.id, (s) => { s.speed = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
          <NumberRow label={<span className="flex items-center gap-1.5"><Icon name="stopwatch" size={11} className="text-muted" />Trim start</span>} value={shot.trimStart ?? 0} min={0} max={Math.max(0, (media.ref.duration ?? 0) - 0.5)} step={0.1} unit="s" onChange={(v) => updateShot(shot.id, (s) => { s.trimStart = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
        </>
      )}
      <Button variant="ghost" size="sm" icon="copy" onClick={() => update((p) => { for (const s of p.shots) if (shotKind(s) === "media") s.media = shot?.media ?? null; })} className="justify-start text-muted">Use for all shots</Button>
      <SampleScreens shotId={shot?.id ?? null} collapsed />
    </div>
  );
}

/** Built-in demo screens, drawn live so they stay crisp at any size. */
function SampleScreens({ shotId, collapsed = false }: { shotId: string | null; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="label-sm flex items-center gap-1 px-0.5 pt-1 text-muted hover:text-fg">
        <Icon name={open ? "chevron-down" : "chevron-right"} size={10} />
        Sample screens
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-1.5">
          {SAMPLE_SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.name}
              onClick={() => void applySampleScreen(s.id, shotId)}
              className="group flex flex-col gap-1 overflow-hidden rounded-md border border-line bg-panel-2 p-1 text-left transition-colors hover:border-line-2"
            >
              <SampleThumb id={s.id} shape={s.shape} />
              <span className="label-sm truncate text-fg-2 group-hover:text-fg">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SampleThumb({ id, shape }: { id: string; shape: "portrait" | "landscape" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = 132, h = shape === "portrait" ? 220 : 84;
    drawSampleScreen(id, c, w, h);
    c.style.aspectRatio = `${w} / ${h}`;
  }, [id, shape]);
  return (
    <div className="flex h-11 w-full items-center justify-center overflow-hidden rounded-sm bg-fill">
      <canvas ref={ref} className={cn("block", shape === "portrait" ? "h-full w-auto" : "w-full h-auto")} />
    </div>
  );
}

const WEIGHT_NAMES: Record<number, string> = { 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extrabold", 900: "Black" };
const ENTER_EXIT: { value: EnterExitEffect; label: string }[] = [
  { value: "none", label: "None" }, { value: "fade", label: "Fade" }, { value: "slideUp", label: "Slide up" }, { value: "slideDown", label: "Slide down" },
  { value: "slideLeft", label: "Slide left" }, { value: "slideRight", label: "Slide right" }, { value: "scale", label: "Scale" }, { value: "blur", label: "Soft" },
];

function EnterExitRows({ shot }: { shot: Shot }) {
  const updateShot = useEditor((s) => s.updateShot);
  const row = (key: "enter" | "exit", label: string) => {
    const fx: EnterExit = shot[key] ?? { effect: "none", duration: 0.4 };
    const set = (mut: (f: EnterExit) => void) => updateShot(shot.id, (s) => { const f = s[key] ?? { effect: "fade", duration: 0.4 }; mut(f); s[key] = f; });
    return (
      <>
        <div className="label-sm px-0.5 pt-2 text-muted">{label}</div>
        <SelectRow label="Effect" value={fx.effect} onChange={(v) => set((f) => { f.effect = v; })} options={ENTER_EXIT} />
        <NumberRow label="Duration" value={fx.duration} min={0} max={Math.max(0.1, shot.duration / 2)} step={0.05} unit="s" disabled={fx.effect === "none"} onChange={(v) => set((f) => { f.duration = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      </>
    );
  };
  return <>{row("enter", "Enter")}{row("exit", "Exit")}</>;
}

function TextEditor({ shot }: { shot: Shot }) {
  const updateShot = useEditor((s) => s.updateShot);
  const st = shot.text ?? defaultTextStyle();
  const set = (mut: (t: TextStyle) => void) => updateShot(shot.id, (s) => { if (!s.text) s.text = defaultTextStyle(); mut(s.text); });
  // warm the picker so each family previews in its own face
  useEffect(() => { for (const f of FONTS) void ensureFont(f.family, 500); }, []);
  const font = getFont(st.font);
  return (
    <div className="flex flex-col gap-1">
      <TextAreaRow value={st.text} onChange={(v) => set((t) => { t.text = v; })} placeholder="Type your text" />
      <SelectRow label="Font" value={st.font} onChange={(v) => set((t) => { t.font = v; t.weight = nearestWeight(v, t.weight); })} options={FONTS.map((f) => ({ value: f.family, label: <span style={{ fontFamily: cssFamily(f.family) }}>{f.family}</span>, sub: f.category }))} />
      <SelectRow label="Weight" value={String(nearestWeight(st.font, st.weight))} onChange={(v) => set((t) => { t.weight = Number(v); })} options={font.weights.map((w) => ({ value: String(w), label: WEIGHT_NAMES[w] ?? String(w) }))} />
      <NumberRow label="Size" value={st.size} min={0.02} max={0.3} step={0.005} onChange={(v) => set((t) => { t.size = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <Segmented size="sm" value={st.align} onChange={(v) => set((t) => { t.align = v; })} options={[{ value: "left", label: "", icon: "align-left" }, { value: "center", label: "", icon: "align-center" }, { value: "right", label: "", icon: "align-right" }]} />
      <ColorRow label="Text colour" value={st.color} onChange={(v) => set((t) => { t.color = v; })} />
      <ColorRow label="Background" value={st.background} onChange={(v) => set((t) => { t.background = v; })} />
      <NumberRow label="Line height" value={st.lineHeight} min={0.8} max={2} step={0.05} onChange={(v) => set((t) => { t.lineHeight = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <NumberRow label="Letter spacing" value={st.letterSpacing} min={-0.1} max={0.3} step={0.005} unit="em" onChange={(v) => set((t) => { t.letterSpacing = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <EnterExitRows shot={shot} />
    </div>
  );
}

const LOGO_EFFECTS: { value: LogoEffect; label: string; preview: string }[] = [
  { value: "none", label: "None", preview: "linear-gradient(135deg, #e9e9ea, #cfcfd2)" },
  { value: "liquidMetal", label: "Liquid metal", preview: "linear-gradient(120deg, #2a2a2e 0%, #f4f4f6 35%, #8d8f96 55%, #ffffff 75%, #3a3a40 100%)" },
  { value: "gemSmoke", label: "Gem smoke", preview: "linear-gradient(135deg, #7333f2, #19d9f2 50%, #fa66bf)" },
  { value: "heatmap", label: "Heatmap", preview: "linear-gradient(135deg, #0a0a33, #4d0099 30%, #f2331a 60%, #ffd91a 85%, #ffffff)" },
];

function LogoEditor({ shot }: { shot: Shot }) {
  const updateShot = useEditor((s) => s.updateShot);
  const st = shot.logo ?? defaultLogoStyle();
  const media = useMedia(st.media);
  const set = (mut: (l: NonNullable<Shot["logo"]>) => void) => updateShot(shot.id, (s) => { if (!s.logo) s.logo = defaultLogoStyle(); mut(s.logo); });
  const pick = () => void pickFiles(ACCEPTED_IMAGES).then(([f]) => f && importLogo(f, shot.id));
  return (
    <div className="flex flex-col gap-1">
      {media ? (
        <div className="group relative flex h-24 items-center justify-center overflow-hidden rounded-md border border-line" style={{ background: st.background }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.url} alt="" className="max-h-16 max-w-[80%] object-contain" draggable={false} />
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <IconButton icon="upload" label="Replace" onClick={pick} className="h-6 w-6 bg-panel/90" />
            <IconButton icon="trash" label="Remove" onClick={() => set((l) => { l.media = null; })} className="h-6 w-6 bg-panel/90" />
          </div>
        </div>
      ) : (
        <button type="button" onClick={pick} className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-2 bg-panel-2 text-fg-2 transition-colors hover:border-fg-2 hover:text-fg">
          <Icon name="logo" size={16} />
          <span className="label">Upload your logo</span>
          <span className="label-sm text-muted">PNG with transparency or SVG</span>
        </button>
      )}
      <div className="label-sm px-0.5 pt-1 text-muted">Effect</div>
      <div className="grid grid-cols-2 gap-1.5">
        {LOGO_EFFECTS.map((e) => (
          <button key={e.value} type="button" onClick={() => set((l) => { l.effect = e.value; })} className={cn("flex flex-col gap-1 rounded-md border p-1 text-left transition-colors", st.effect === e.value ? "border-accent" : "border-line hover:border-line-2")}>
            <div className="h-9 rounded" style={{ background: e.preview }} />
            <span className="label px-0.5 text-fg">{e.label}</span>
          </button>
        ))}
      </div>
      <NumberRow label="Scale" value={st.scale} min={0.05} max={1} step={0.01} onChange={(v) => set((l) => { l.scale = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <ColorRow label="Background" value={st.background} onChange={(v) => set((l) => { l.background = v; })} />
      <EnterExitRows shot={shot} />
    </div>
  );
}

/* ---------- Scene ---------- */
function SceneSection() {
  const scene = useEditor((s) => s.project.scene);
  const update = useEditor((s) => s.update);
  const setPicker = useUI((s) => s.setPicker);
  const picker = useUI((s) => s.picker);
  const [open, setOpen] = useState(true);
  const preset = getScene(scene.preset);
  const custom = scene.preset === "custom";
  const bg = scene.background;
  if (picker === "scene") return <ScenePicker />;
  return (
    <Section title="Scene" open={open} onToggle={() => setOpen((o) => !o)} tour="scene">
      <div className="flex items-center gap-2.5 rounded-md border border-line bg-panel-2 p-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: preset.swatch }}>
          <Icon name={custom ? "sliders" : "cube"} size={14} className={preset.id === "darkroom" || preset.id === "concrete" ? "text-white/80" : "text-black/60"} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="label text-fg">{preset.name}</span>
          <span className="label-sm truncate text-muted">{preset.description}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPicker("scene")}>Change</Button>
      </div>
      <SelectRow label="Lighting" value={scene.lighting} onChange={(v) => update((p) => { p.scene.lighting = v; })} options={LIGHTINGS.map((l) => ({ value: l.id, label: l.name }))} />
      <AnimRow prop="scene.lightRotX" label="Light rotation X" min={-180} max={180} step={1} />
      <AnimRow prop="scene.lightRotY" label="Light rotation Y" min={0} max={360} step={1} />
      <AnimRow prop="scene.lightIntensity" label="Light intensity" min={0} max={3} step={0.01} />
      {custom && <ToggleRow label="Contact shadow" checked={scene.contactShadow} onChange={(v) => update((p) => { p.scene.contactShadow = v; })} />}
      {custom ? (
        <>
          <SelectRow label="Background" value={bg.type} onChange={(v) => update((p) => { p.scene.background.type = v; })} options={[{ value: "color", label: "Color" }, { value: "preset", label: "Preset" }, { value: "image", label: "Image" }, { value: "transparent", label: "Transparent" }]} />
          {bg.type === "color" && <ColorRow label="BG color" value={bg.color} onChange={(v) => update((p) => { p.scene.background.color = v; })} />}
          {bg.type === "preset" && <BackgroundGrid current={bg.preset} onPick={(v) => update((p) => { p.scene.background.preset = v; })} />}
          {bg.type === "image" && (
            <div className="flex h-8 items-center justify-between rounded-md bg-fill px-2.5">
              <span className="label text-fg-2">BG image</span>
              <span className="flex items-center gap-1.5">
                <span className="label-sm max-w-24 truncate text-muted">{bg.image?.name ?? "None"}</span>
                <Button variant="outline" size="sm" onClick={() => void pickFiles("image/*").then(([f]) => f && importBackgroundImage(f))}>{bg.image ? "Replace" : "Upload"}</Button>
              </span>
            </div>
          )}
          {(bg.type === "preset" || bg.type === "image") && (
            <NumberRow label="BG blur" value={bg.blur} min={0} max={1} step={0.01} onChange={(v) => update((p) => { p.scene.background.blur = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
          )}
        </>
      ) : (
        <ColorRow label="Backdrop" value={bg.color} onChange={(v) => update((p) => { p.scene.background.color = v; })} />
      )}
    </Section>
  );
}

function ScenePicker() {
  const current = useEditor((s) => s.project.scene.preset);
  const setScenePreset = useEditor((s) => s.setScenePreset);
  const setPicker = useUI((s) => s.setPicker);
  return (
    <Section title="Scene" right={<Button variant="ghost" size="sm" icon="arrow-left" onClick={() => setPicker(null)}>Back</Button>}>
      <div className="flex flex-col gap-2">
        {SCENES.map((s) => {
          const active = s.id === current;
          const custom = s.id === "custom";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => { setScenePreset(s.id); setPicker(null); }}
              className={cn("group flex flex-col overflow-hidden rounded-lg border text-left transition-colors", active ? "border-accent" : "border-line hover:border-line-2")}
            >
              {custom ? (
                <div className="flex items-center gap-2.5 p-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-fill text-fg-2"><Icon name="sliders" size={15} /></div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="label text-fg">{s.name}</span>
                    <span className="label-sm truncate text-muted">{s.description}</span>
                  </div>
                  {active && <span className="label-sm rounded bg-accent-soft px-1.5 py-0.5 text-accent">Current</span>}
                </div>
              ) : (
                <>
                  <div className="relative aspect-[16/10] overflow-hidden" style={{ background: `linear-gradient(160deg, ${s.swatch}, ${shade(s.swatch)})` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/scenes/${s.id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-[1.03]" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    {active && <span className="label-sm absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-white">Current</span>}
                  </div>
                  <div className="flex flex-col gap-0.5 px-2.5 py-2">
                    <span className="label text-fg">{s.name}</span>
                    <span className="label-sm truncate text-muted">{s.description}</span>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Background presets as a grid of real previews, painted with the same routine as the scene. */
function BackgroundGrid({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="label-sm px-0.5 pt-1 text-muted">Background preset</div>
      <div className="grid grid-cols-3 gap-1.5">
        {BG_PRESETS.map((b) => (
          <button
            key={b.id}
            type="button"
            title={b.name}
            onClick={() => onPick(b.id)}
            className={cn("group flex flex-col gap-1 overflow-hidden rounded-md border p-1 text-left transition-colors", b.id === current ? "border-accent" : "border-line hover:border-line-2")}
          >
            <BgThumb id={b.id} />
            <span className="label-sm truncate px-0.5 text-fg-2 group-hover:text-fg">{b.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BgThumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = 132, h = 84;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (ctx) paintPreset(ctx, w, h, getBgPreset(id), 0.2);
  }, [id]);
  return <canvas ref={ref} className="block h-9 w-full rounded-sm object-cover" />;
}

function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * 0.8)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, "0")).join("")}`;
}
function isDark(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l < 128;
}

/* ---------- Mockup ---------- */
function MockupSection() {
  const mockup = useEditor((s) => s.project.mockup);
  const screen = useEditor((s) => s.project.screen);
  const update = useEditor((s) => s.update);
  const picker = useUI((s) => s.picker);
  const setPicker = useUI((s) => s.setPicker);
  const [open, setOpen] = useState(true);
  const spec = getDevice(mockup.device);
  const finish = getFinish(spec, mockup.finish);
  const features = useModelBounds((s) => s.bounds[mockup.device]?.features);
  if (picker === "device") return <DevicePicker />;
  return (
    <Section title="Mockup" open={open} onToggle={() => setOpen((o) => !o)} tour="mockup">
      <div className="flex items-center gap-2.5 rounded-md border border-line bg-panel-2 p-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-fill text-fg-2">
          <Icon name={spec.icon} size={16} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="label truncate text-fg">{spec.name}</span>
          <span className="label-sm text-muted">{spec.screenPx[0].toLocaleString()} × {spec.screenPx[1].toLocaleString()}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPicker("device")}>Change</Button>
      </div>
      <SelectRow label="Finish" value={finish.id} onChange={(v) => update((p) => { p.mockup.finish = v; })} options={spec.finishes.map((f) => ({ value: f.id, label: f.name, swatch: f.color }))} />
      <NumberRow label="Reflection" value={mockup.reflection} min={0} max={1} step={0.01} onChange={(v) => update((p) => { p.mockup.reflection = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      {spec.model && (
        <NumberRow label="Body gloss" value={mockup.gloss ?? 1.3} min={0.2} max={3} step={0.05} onChange={(v) => update((p) => { p.mockup.gloss = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      )}
      <NumberRow label="Border radius" value={mockup.borderRadius} min={0} max={0.25} step={0.001} disabled={spec.family !== "flat"} onChange={(v) => update((p) => { p.mockup.borderRadius = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <AnimRow prop="mockup.rotY" label="Rotate Y" min={-180} max={180} step={1} />
      <AnimRow prop="mockup.rotX" label="Rotate X" min={-180} max={180} step={1} />
      <AnimRow prop="mockup.rotZ" label="Rotate Z" min={-180} max={180} step={1} />
      {features?.lid && <AnimRow prop="mockup.lid" label="Lid angle" min={0} max={135} step={1} unit="°" />}
      {features?.island && <ToggleRow label="Dynamic Island" checked={mockup.notch ?? true} onChange={(v) => update((p) => { p.mockup.notch = v; })} />}
      {features?.caseParts && <ToggleRow label="Case + keyboard" checked={mockup.caseKeyboard ?? true} onChange={(v) => update((p) => { p.mockup.caseKeyboard = v; })} />}
      {features?.band && (
        <div className="flex h-8 items-center justify-between rounded-md bg-fill px-2.5">
          <span className="label text-fg-2">Band colour</span>
          <span className="flex items-center gap-2">
            {mockup.bandColor && <button type="button" className="label-sm text-muted hover:text-fg" onClick={() => update((p) => { p.mockup.bandColor = null; })}>Reset</button>}
            <label className="relative h-4 w-4 cursor-pointer overflow-hidden rounded border border-black/10" style={{ background: mockup.bandColor ?? "linear-gradient(135deg,#ddd,#888)" }}>
              <input type="color" value={mockup.bandColor ?? "#2c2c2e"} onChange={(e) => update((p) => { p.mockup.bandColor = e.target.value; })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </span>
        </div>
      )}
      <div className="label-sm px-0.5 pt-2 text-muted">Screen</div>
      {spec.family === "phone" && <ToggleRow label="Status bar" checked={!!screen.statusBar} onChange={(v) => update((p) => { p.screen.statusBar = v; })} hint="9:41" />}
      <AnimRow prop="screen.brightness" label="Brightness" min={0} max={2} step={0.01} />
      <SelectRow label="Screen BG" value={screen.bg?.type ?? "color"} onChange={(v) => update((p) => { p.screen.bg = { type: v, color: p.screen.bg?.color ?? "#000000", image: p.screen.bg?.image ?? null }; })} options={[{ value: "color", label: "Color" }, { value: "image", label: "Image" }]} />
      {(screen.bg?.type ?? "color") === "color" ? (
        <ColorRow label="BG color" value={screen.bg?.color ?? "#000000"} onChange={(v) => update((p) => { p.screen.bg = { type: "color", color: v, image: p.screen.bg?.image ?? null }; })} />
      ) : (
        <div className="flex h-8 items-center justify-between rounded-md bg-fill px-2.5">
          <span className="label text-fg-2">BG image</span>
          <span className="flex items-center gap-1.5">
            <span className="label-sm max-w-24 truncate text-muted">{screen.bg?.image?.name ?? "None"}</span>
            <Button variant="outline" size="sm" onClick={() => void pickFiles(ACCEPTED_IMAGES).then(([f]) => f && importScreenBackground(f))}>{screen.bg?.image ? "Replace" : "Upload"}</Button>
          </span>
        </div>
      )}
    </Section>
  );
}

function DevicePicker() {
  const current = useEditor((s) => s.project.mockup.device);
  const setDevice = useEditor((s) => s.setDevice);
  const setPicker = useUI((s) => s.setPicker);
  const families = useMemo(() => {
    const out = new Map<DeviceFamily, typeof DEVICES>();
    for (const d of DEVICES) if (!d.hidden) out.set(d.family, [...(out.get(d.family) ?? []), d]);
    return out;
  }, []);
  return (
    <Section title="Mockup" right={<Button variant="ghost" size="sm" icon="arrow-left" onClick={() => setPicker(null)}>Back</Button>}>
      {[...families.entries()].map(([family, list]) => (
        <div key={family} className="flex flex-col gap-1.5">
          <div className="label-sm pt-1 text-muted">{FAMILY_LABELS[family]}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {list.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => { setDevice(d.id); setPicker(null); }}
                className={cn("flex flex-col items-center gap-1.5 rounded-md border bg-panel-2 px-2 pb-2.5 pt-2 transition-colors", d.id === current ? "border-accent" : "border-line hover:border-line-2")}
              >
                <div className="relative flex h-16 w-full items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/devices/${d.id}.webp`} alt="" className="h-16 w-full object-contain" draggable={false} onError={(e) => { const el = e.currentTarget as HTMLImageElement; el.style.display = "none"; (el.nextElementSibling as HTMLElement | null)?.classList.remove("hidden"); }} />
                  <span className="hidden text-fg-2"><Icon name={d.icon} size={22} strokeWidth={1.25} /></span>
                </div>
                <span className="label text-center text-fg">{d.name}</span>
                <span className="label-sm text-muted">{d.screenPx[0]} × {d.screenPx[1]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

/* ---------- Camera ---------- */
function CameraSection() {
  const [open, setOpen] = useState(true);
  const tab = useUI((s) => s.cameraTab);
  const setTab = useUI((s) => s.setCameraTab);
  return (
    <Section title="Camera" open={open} onToggle={() => setOpen((o) => !o)} tour="camera" right={<IconButton icon="rotate-ccw" size={12} label="Reset camera" onClick={resetCamera} className="h-6 w-6" />}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "manual", label: "Manual" }, { value: "presets", label: "Presets" }]} />
      {tab === "manual" ? (
        <>
          <AnimRow prop="camera.x" label="X axis" hint="Drag" min={-180} max={180} step={1} />
          <AnimRow prop="camera.y" label="Y axis" hint="Drag" min={-89} max={89} step={1} />
          <AnimRow prop="camera.z" label="Z axis" min={-180} max={180} step={1} />
          <AnimRow prop="camera.fov" label="FOV" min={8} max={100} step={1} />
          <AnimRow prop="camera.zoom" label="Zoom" hint="Scroll" min={0.2} max={6} step={0.01} />
          <AnimRow prop="camera.panX" label="Pan X" hint="Space drag" min={-1} max={1} step={0.01} />
          <AnimRow prop="camera.panY" label="Pan Y" hint="Space drag" min={-1} max={1} step={0.01} />
        </>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {CAMERA_PRESETS.map((c, i) => (
            <Button key={c.id} variant="soft" onClick={() => applyCameraPreset(c.id)} title={`Shortcut ${i + 1}`}>{c.name}</Button>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ---------- Blur ---------- */
function FocusPicker({ depth = false }: { depth?: boolean }) {
  const fx = useAnimRow("blur.focusX");
  const fy = useAnimRow("blur.focusY");
  const setValues = useEditor((s) => s.setValues);
  const dragging = useState(false);
  const set = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setValues({ "blur.focusX": Math.round(x * 1000) / 1000, "blur.focusY": Math.round(y * 1000) / 1000 });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="label-sm flex items-center justify-between px-0.5 pt-1 text-muted"><span>{depth ? "Focal point" : "Focus position"}</span><span className="normal-case">⌥ click the viewport</span></div>
      <div
        className="relative h-24 cursor-crosshair overflow-hidden rounded-md border border-line bg-panel-2"
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragging[1](true); beginInteraction(); set(e); }}
        onPointerMove={(e) => { if (dragging[0]) set(e); }}
        onPointerUp={() => { dragging[1](false); endInteraction(); }}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
        <div className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow" style={{ left: `${fx.value * 100}%`, top: `${fy.value * 100}%` }} />
      </div>
    </div>
  );
}

function BlurSection() {
  const blur = useEditor((s) => s.project.blur);
  const update = useEditor((s) => s.update);
  const [open, setOpen] = useState(true);
  const off = blur.mode === "off";
  return (
    <Section title="Blur" open={open} onToggle={() => setOpen((o) => !o)} tour="blur" right={<IconButton icon="rotate-ccw" size={12} label="Reset blur" onClick={resetBlur} className="h-6 w-6" />}>
      <SelectRow label="Mode" value={blur.mode} onChange={(v: BlurMode) => update((p) => { p.blur.mode = v; })} options={[{ value: "off", label: "None" }, { value: "radial", label: "Radial" }, { value: "directional", label: "Directional" }, { value: "linear", label: "Tilt shift" }, { value: "depth", label: "Lens" }]} />
      {blur.mode === "directional" && (
        <NumberRow label="Angle" value={blur.angle ?? 0} min={0} max={360} step={1} onChange={(v) => update((p) => { p.blur.angle = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      )}
      <AnimRow prop="blur.strength" label="Strength" min={0} max={20} step={0.1} disabled={off} />
      {blur.mode === "depth" && (
        <>
          <Segmented size="sm" value={(blur.focusDistance ?? 0) > 0 ? "manual" : "auto"} onChange={(v) => update((p) => { p.blur.focusDistance = v === "auto" ? 0 : Math.max(0.1, anim.focusDist); })} options={[{ value: "auto", label: "Auto focus", icon: "focus-auto" }, { value: "manual", label: "Manual", icon: "focus-lock" }]} />
          {(blur.focusDistance ?? 0) > 0 && <AnimRow prop="blur.focusDistance" label="Focus distance" min={0.1} max={40} step={0.05} />}
        </>
      )}
      <AnimRow prop="blur.focusSize" label={blur.mode === "depth" ? "Focus range" : "Focus size"} min={0} max={1.5} step={0.01} disabled={off} />
      <AnimRow prop="blur.falloff" label="Falloff" min={0} max={1} step={0.01} disabled={off} />
      <ToggleRow label="Bokeh" checked={blur.bokeh} onChange={(v) => update((p) => { p.blur.bokeh = v; })} disabled={off} />
      {!off && <FocusPicker depth={blur.mode === "depth"} />}
    </Section>
  );
}

/* ---------- Effects ---------- */
function EffectsSection() {
  const effects = useEditor((s) => s.project.effects);
  const update = useEditor((s) => s.update);
  const [menu, setMenu] = useState(false);
  const available = EFFECT_DEFS.filter((d) => !effects.some((e) => e.id === d.id));
  const add = (id: EffectId) => {
    const def = getEffectDef(id);
    update((p) => { p.effects.push({ id, enabled: true, params: Object.fromEntries(def.params.map((x) => [x.key, x.default])) }); });
    setMenu(false);
  };
  return (
    <Section
      title="Effects"
      right={
        <div className="relative">
          <IconButton icon="plus" size={13} label="Add effect" onClick={() => setMenu((m) => !m)} className="h-6 w-6" active={menu} />
          {menu && (
            <div className="fade-in absolute right-0 top-7 z-30 w-44 rounded-lg border border-line bg-panel p-1 shadow-xl">
              {available.length === 0 && <div className="label-sm px-2 py-2 text-muted">All effects added</div>}
              {available.map((d) => (
                <button key={d.id} type="button" onClick={() => add(d.id)} className="label flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-fg-2 hover:bg-fill hover:text-fg">
                  <Icon name={d.icon} size={13} className="text-muted" />{d.name}
                </button>
              ))}
            </div>
          )}
        </div>
      }
    >
      {effects.length === 0 && <div className="label-sm py-1 text-muted">No effects. Add vignette, grain, bloom and more with +.</div>}
      {effects.map((e) => {
        const def = getEffectDef(e.id);
        return (
          <div key={e.id} className="flex flex-col gap-1 rounded-md border border-line bg-panel-2 p-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <Icon name={def.icon} size={13} className="text-muted" />
              <span className="label flex-1 text-fg">{def.name}</span>
              <IconButton icon={e.enabled ? "eye" : "eye-off"} size={12} label={e.enabled ? "Disable" : "Enable"} onClick={() => update((p) => { const x = p.effects.find((y) => y.id === e.id); if (x) x.enabled = !x.enabled; })} className="h-6 w-6" />
              <IconButton icon="trash" size={12} label="Remove" onClick={() => update((p) => { p.effects = p.effects.filter((y) => y.id !== e.id); })} className="h-6 w-6" />
            </div>
            {def.params.map((prm) => (
              <NumberRow
                key={prm.key}
                label={prm.label}
                value={e.params[prm.key] ?? prm.default}
                min={prm.min}
                max={prm.max}
                step={prm.step}
                disabled={!e.enabled}
                onChange={(v) => update((p) => { const x = p.effects.find((y) => y.id === e.id); if (x) x.params[prm.key] = v; })}
                onDragStart={beginInteraction}
                onDragEnd={endInteraction}
              />
            ))}
          </div>
        );
      })}
    </Section>
  );
}

/* ---------- Video (whole-sequence) ---------- */
function VideoSection() {
  const fade = useEditor((s) => s.project.fade ?? { in: 0, out: 0, color: "#000000" });
  const update = useEditor((s) => s.update);
  const [open, setOpen] = useState(false);
  const set = (mut: (f: { in: number; out: number; color: string }) => void) => update((p) => { const f = p.fade ?? { in: 0, out: 0, color: "#000000" }; mut(f); p.fade = f; });
  return (
    <Section title="Video" sub="Fade in / out" open={open} onToggle={() => setOpen((o) => !o)}>
      <NumberRow label="Fade in" value={fade.in} min={0} max={3} step={0.05} unit="s" onChange={(v) => set((f) => { f.in = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <NumberRow label="Fade out" value={fade.out} min={0} max={3} step={0.05} unit="s" onChange={(v) => set((f) => { f.out = v; })} onDragStart={beginInteraction} onDragEnd={endInteraction} />
      <ColorRow label="Colour" value={fade.color} onChange={(v) => set((f) => { f.color = v; })} />
    </Section>
  );
}

/* ---------- Inspector ---------- */
export function Inspector() {
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const canUndo = useStore(useEditor.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useEditor.temporal, (s) => s.futureStates.length > 0);
  const shot = useActiveShot();
  const card = shotKind(shot) !== "media";
  return (
    <div className="flex w-[240px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-1.5">
        <div className="flex">
          <IconButton icon="undo" label="Undo (⌘Z)" onClick={undo} disabled={!canUndo} />
          <IconButton icon="redo" label="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo} />
        </div>
        <IconButton icon={theme === "dark" ? "sun" : "moon"} label="Toggle theme (D)" onClick={toggleTheme} />
      </div>
      <div className="scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <ShotSection />
        {card ? (
          <div className="label-sm border-b border-line px-3 py-3 leading-relaxed text-muted">Text and logo shots fill the frame. Scene, mockup, camera and blur settings apply to media shots.</div>
        ) : (
          <>
            <SceneSection />
            <MockupSection />
            <CameraSection />
            <BlurSection />
          </>
        )}
        <EffectsSection />
        <VideoSection />
        <div className="h-6" />
      </div>
    </div>
  );
}
