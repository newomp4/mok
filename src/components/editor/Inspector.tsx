"use client";
import { useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEditor, redo, undo, beginInteraction, endInteraction } from "@/store/editor";
import { useUI } from "@/store/ui";
import { ANIM_LABELS, type AnimProp, type BlurMode, type EffectId, type FitMode } from "@/lib/types";
import { hasKeyframeAt, locate, sampleTrack } from "@/lib/animation";
import { DEVICES, FAMILY_LABELS, getDevice, getFinish, type DeviceFamily } from "@/lib/devices";
import { BG_PRESETS, CAMERA_PRESETS, EFFECT_DEFS, LIGHTINGS, SCENES, getEffectDef, getScene } from "@/lib/presets";
import { Button, ColorRow, IconButton, NumberRow, Section, Segmented, SelectRow, ToggleRow, type KeyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useMedia, ACCEPTED_TYPES } from "@/lib/media";
import { useActiveShot } from "@/three/Device";
import { applyCameraPreset, importBackgroundImage, importFilesToShot, resetBlur, resetCamera, setShotMedia } from "@/lib/actions";
import { pickFiles } from "./hooks";

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

/* ---------- Source ---------- */
function SourceSection() {
  const shot = useActiveShot();
  const media = useMedia(shot?.media);
  const update = useEditor((s) => s.update);
  const [open, setOpen] = useState(true);
  const pick = () => void pickFiles(ACCEPTED_TYPES).then((f) => importFilesToShot(f, shot?.id));
  return (
    <Section title="Source" sub={shot?.name} open={open} onToggle={() => setOpen((o) => !o)}>
      {media ? (
        <div className="flex flex-col gap-1.5">
          <div className="group relative overflow-hidden rounded-md border border-line bg-panel-2">
            {media.kind === "video" ? (
              <video src={media.url} muted className="h-28 w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.url} alt="" className="h-28 w-full object-cover" draggable={false} />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
              <span className="label-sm truncate text-white/90">{media.ref.name}</span>
              <span className="label-sm text-white/70">{media.width} × {media.height}</span>
            </div>
            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton icon="upload" label="Replace" onClick={pick} className="h-6 w-6 bg-panel/90" />
              <IconButton icon="trash" label="Remove" onClick={() => setShotMedia(shot?.id ?? null, null)} className="h-6 w-6 bg-panel/90" />
            </div>
          </div>
          <Segmented size="sm" value={shot?.fit ?? "cover"} onChange={(v: FitMode) => update((p) => { const s = p.shots.find((x) => x.id === shot?.id); if (s) s.fit = v; })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }, { value: "stretch", label: "Stretch" }]} />
          <Button variant="ghost" size="sm" icon="copy" onClick={() => update((p) => { for (const s of p.shots) s.media = shot?.media ?? null; })} className="justify-start text-muted">Use for all shots</Button>
        </div>
      ) : (
        <button type="button" onClick={pick} className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-2 bg-panel-2 text-fg-2 transition-colors hover:border-fg-2 hover:text-fg">
          <Icon name="upload" size={16} />
          <span className="label">Click to upload</span>
          <span className="label-sm text-muted">Drag & drop or paste</span>
        </button>
      )}
    </Section>
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
    <Section title="Scene" open={open} onToggle={() => setOpen((o) => !o)}>
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
          {bg.type === "preset" && (
            <SelectRow label="BG preset" value={bg.preset} onChange={(v) => update((p) => { p.scene.background.preset = v; })} options={BG_PRESETS.map((b) => ({ value: b.id, label: b.name, swatch: `linear-gradient(135deg, ${b.colors[1]}, ${b.colors[3]})` }))} />
          )}
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
      <div className="grid grid-cols-2 gap-1.5">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { setScenePreset(s.id); setPicker(null); }}
            className={cn("flex flex-col overflow-hidden rounded-md border text-left transition-colors", s.id === current ? "border-accent" : "border-line hover:border-line-2")}
          >
            <div className="flex h-16 items-center justify-center" style={{ background: `linear-gradient(160deg, ${s.swatch}, ${shade(s.swatch)})` }}>
              <Icon name={s.id === "custom" ? "sliders" : "cube"} size={18} className={isDark(s.swatch) ? "text-white/70" : "text-black/55"} />
            </div>
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              <span className="label text-fg">{s.name}</span>
              <span className="label-sm truncate text-muted">{s.description}</span>
            </div>
          </button>
        ))}
      </div>
    </Section>
  );
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
  const update = useEditor((s) => s.update);
  const picker = useUI((s) => s.picker);
  const setPicker = useUI((s) => s.setPicker);
  const [open, setOpen] = useState(true);
  const spec = getDevice(mockup.device);
  const finish = getFinish(spec, mockup.finish);
  if (picker === "device") return <DevicePicker />;
  return (
    <Section title="Mockup" open={open} onToggle={() => setOpen((o) => !o)}>
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
                className={cn("flex flex-col items-center gap-1.5 rounded-md border bg-panel-2 px-2 py-3 transition-colors", d.id === current ? "border-accent" : "border-line hover:border-line-2")}
              >
                <Icon name={d.icon} size={22} className="text-fg-2" strokeWidth={1.25} />
                <span className="label text-center text-fg">{d.name}</span>
                <span className="label-sm text-muted">{d.model ? "3D model" : "built-in"} · {d.screenPx[0]} × {d.screenPx[1]}</span>
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
    <Section title="Camera" open={open} onToggle={() => setOpen((o) => !o)} right={<IconButton icon="rotate-ccw" size={12} label="Reset camera" onClick={resetCamera} className="h-6 w-6" />}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "manual", label: "Manual" }, { value: "presets", label: "Presets" }]} />
      {tab === "manual" ? (
        <>
          <AnimRow prop="camera.x" label="X axis" hint="Drag" min={-180} max={180} step={1} />
          <AnimRow prop="camera.y" label="Y axis" hint="Drag" min={-89} max={89} step={1} />
          <AnimRow prop="camera.z" label="Z axis" min={-180} max={180} step={1} />
          <AnimRow prop="camera.fov" label="FOV" min={8} max={90} step={1} />
          <AnimRow prop="camera.zoom" label="Zoom" hint="Scroll" min={0.2} max={6} step={0.01} />
          <AnimRow prop="camera.panX" label="Pan X" hint="Space drag" min={-1} max={1} step={0.01} />
          <AnimRow prop="camera.panY" label="Pan Y" hint="Space drag" min={-1} max={1} step={0.01} />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
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
    <Section title="Blur" open={open} onToggle={() => setOpen((o) => !o)} right={<IconButton icon="rotate-ccw" size={12} label="Reset blur" onClick={resetBlur} className="h-6 w-6" />}>
      <SelectRow label="Mode" value={blur.mode} onChange={(v: BlurMode) => update((p) => { p.blur.mode = v; })} options={[{ value: "off", label: "Off" }, { value: "radial", label: "Radial" }, { value: "linear", label: "Linear" }, { value: "depth", label: "Depth" }]} />
      <AnimRow prop="blur.strength" label="Strength" min={0} max={20} step={0.1} disabled={off} />
      <AnimRow prop="blur.focusSize" label="Focus size" min={0} max={1.5} step={0.01} disabled={off} />
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

/* ---------- Inspector ---------- */
export function Inspector() {
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const canUndo = useStore(useEditor.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useEditor.temporal, (s) => s.futureStates.length > 0);
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
        <SourceSection />
        <SceneSection />
        <MockupSection />
        <CameraSection />
        <BlurSection />
        <EffectsSection />
        <div className="h-6" />
      </div>
    </div>
  );
}
