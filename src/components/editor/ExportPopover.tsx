"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { useUI } from "@/store/ui";
import { Button, IconButton, NumberRow, Popover, Segmented, SelectRow, ToggleRow } from "@/components/ui";
import { EXPORT_SIZES, getAspect } from "@/lib/presets";
import { useRenderFlags } from "@/three/registry";
import { captureImage, estimateBitrate, exportVideo, type ImageFormat, type VideoQuality } from "@/export/capture";
import { downloadBlob } from "@/lib/persistence";
import { totalDuration } from "@/lib/animation";
import { exportSizeFor, quickCapture, slug } from "./hooks";
import { chime } from "@/lib/sounds";

type Orientation = "landscape" | "square" | "portrait";
const imageState = { format: "png" as ImageFormat, transparent: false, size: "1080", orientation: "landscape" as Orientation, customW: 1920, customH: 1080 };
const videoState = { size: "1080", quality: "high" as VideoQuality, fps: 30, blur: "off" as "off" | "low" | "med" | "high", transparent: false, format: "mp4" as "mp4" | "webm", orientation: "landscape" as Orientation, customW: 1920, customH: 1080 };
const even = (n: number, max: number) => Math.max(16, Math.min(max, Math.round(n / 2) * 2));
const BLUR_SAMPLES = { off: 1, low: 4, med: 8, high: 16 };

export function CaptureButton() {
  return (
    <IconButton icon="camera" label="Quick capture (⌘E)" onClick={() => void quickCapture()} className="border border-accent/50 bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent" />
  );
}

/** The viewport previews the transparent frame while the menu is open, and goes back when it closes. */
function useAlphaPreview(open: boolean) {
  useEffect(() => {
    if (!open) useRenderFlags.getState().setTransparent(false);
  }, [open]);
  useEffect(() => () => useRenderFlags.getState().setTransparent(false), []);
}

export function ExportButton() {
  const [open, setOpen] = useState(false);
  useAlphaPreview(open);
  const [tab, setTab] = useState<"image" | "video">("image");
  const ref = useRef<HTMLButtonElement>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const project = useEditor((s) => s.project);
  const viewportSize = useUI((s) => s.viewport);
  const setExporting = useUI((s) => s.setExporting);
  const showToast = useUI((s) => s.showToast);
  const ui = { viewport: viewportSize, setExporting, showToast };
  const aspect = getAspect(project.aspect);
  const fixed = aspect.ratio !== null;
  const fixedOrientation: Orientation = !aspect.ratio ? "landscape" : aspect.ratio > 1.05 ? "landscape" : aspect.ratio < 0.95 ? "portrait" : "square";

  const imgDims = useMemo((): [number, number] => {
    if (imageState.size === "custom") return [even(imageState.customW, 7680), even(imageState.customH, 7680)];
    const size = EXPORT_SIZES.find((s) => s.id === imageState.size);
    if (size?.px) return size.px;
    return exportSizeFor(project.aspect, size?.long ?? 1920, ui.viewport, fixed ? undefined : imageState.orientation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.aspect, ui.viewport, imageState.size, imageState.orientation, imageState.customW, imageState.customH, fixed]);
  const vidDims = useMemo((): [number, number] => {
    if (videoState.size === "custom") return [even(videoState.customW, 3840), even(videoState.customH, 3840)];
    const size = EXPORT_SIZES.find((s) => s.id === videoState.size);
    if (size?.px) return size.px;
    return exportSizeFor(project.aspect, size?.long ?? 1920, ui.viewport, fixed ? undefined : videoState.orientation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.aspect, ui.viewport, videoState.size, videoState.orientation, videoState.customW, videoState.customH, fixed]);

  const runImage = async () => {
    setOpen(false);
    ui.setExporting({ label: "Rendering image…", progress: 0.4 });
    try {
      const blob = await captureImage({ width: imgDims[0], height: imgDims[1], format: imageState.format, transparent: imageState.transparent, quality: 0.92 });
      downloadBlob(blob, `${slug(project.name)}-${imgDims[0]}x${imgDims[1]}.${imageState.format}`);
      ui.showToast(`Exported ${imgDims[0]} × ${imgDims[1]} ${imageState.format.toUpperCase()}`);
      chime();
    } catch (e) {
      ui.showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      ui.setExporting(null);
    }
  };

  const runVideo = async () => {
    setOpen(false);
    const ctrl = new AbortController();
    ui.setExporting({ label: "Preparing…", progress: 0, cancel: () => ctrl.abort() });
    try {
      const { blob, ext } = await exportVideo({
        width: vidDims[0], height: vidDims[1], fps: videoState.fps, quality: videoState.quality,
        samples: BLUR_SAMPLES[videoState.blur], transparent: videoState.transparent, format: videoState.transparent ? "webm" : videoState.format,
        signal: ctrl.signal,
        onProgress: (p, label) => ui.setExporting({ label, progress: p, cancel: () => ctrl.abort() }),
      });
      downloadBlob(blob, `${slug(project.name)}-${vidDims[0]}x${vidDims[1]}-${videoState.fps}fps.${ext}`);
      ui.showToast(`Exported ${vidDims[0]} × ${vidDims[1]} ${ext.toUpperCase()}`);
      chime();
    } catch (e) {
      if ((e as Error).name === "AbortError") ui.showToast("Export cancelled");
      else ui.showToast(`Export failed: ${(e as Error).message}`);
    } finally {
      ui.setExporting(null);
    }
  };

  const duration = totalDuration(project);
  const mbps = estimateBitrate(vidDims[0], vidDims[1], videoState.fps, videoState.quality) / 1e6;
  const orientationOptions = [
    { value: "landscape" as Orientation, label: "Landscape", icon: "landscape" },
    { value: "square" as Orientation, label: "Square", icon: "square-outline" },
    { value: "portrait" as Orientation, label: "Portrait", icon: "portrait" },
  ];

  return (
    <>
      <Button ref={ref} variant="solid" iconRight="chevron-down" onClick={() => setOpen((o) => !o)} className="ml-1">Export</Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} align="end" className="w-[300px] p-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} className="mb-3" />
        {tab === "image" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Format</Label>
            <SelectRow
              label="Format"
              value={imageState.format}
              onChange={(v) => { imageState.format = v; if (v === "jpg") imageState.transparent = false; rerender(); }}
              options={[{ value: "png", label: "PNG — best quality" }, { value: "webp", label: "WebP — small + sharp" }, { value: "jpg", label: "JPG — smallest file" }]}
            />
            {/* JPEG has no alpha channel, so asking for transparency picks the format that does */}
            <ToggleRow label="Transparent background" checked={imageState.transparent} onChange={(v) => { imageState.transparent = v; if (v && imageState.format === "jpg") imageState.format = "png"; useRenderFlags.getState().setTransparent(v); rerender(); }} />
            <Label>Orientation</Label>
            <Segmented size="sm" value={fixed ? fixedOrientation : imageState.orientation} onChange={(v) => { imageState.orientation = v; rerender(); }} options={orientationOptions.map((o) => ({ ...o, disabled: fixed && o.value !== fixedOrientation }))} />
            <Label>Size</Label>
            <SelectRow label="Size" value={imageState.size} onChange={(v) => { imageState.size = v; rerender(); }} options={[...EXPORT_SIZES.filter((s) => !s.video).map((s) => ({ value: s.id, label: s.label, sub: s.px ? s.px.join(" × ") : `${exportSizeFor(project.aspect, s.long, ui.viewport, fixed ? undefined : imageState.orientation).join(" × ")}` })), { value: "custom", label: "Custom…", sub: "up to 7680" }]} />
            {imageState.size === "custom" && (
              <div className="grid grid-cols-2 gap-1.5">
                <NumberRow label="W" value={imageState.customW} min={16} max={7680} step={2} onChange={(v) => { imageState.customW = v; rerender(); }} />
                <NumberRow label="H" value={imageState.customH} min={16} max={7680} step={2} onChange={(v) => { imageState.customH = v; rerender(); }} />
              </div>
            )}
            <Summary title={`${imgDims[0]} × ${imgDims[1]}`} tag={imageState.format.toUpperCase()} sub={imageState.transparent ? "Transparent background." : "Opaque background."} />
            <Button variant="solid" size="lg" onClick={() => void runImage()} className="mt-1 w-full">Export image</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label>Orientation</Label>
            <Segmented size="sm" value={fixed ? fixedOrientation : videoState.orientation} onChange={(v) => { videoState.orientation = v; rerender(); }} options={orientationOptions.map((o) => ({ ...o, disabled: fixed && o.value !== fixedOrientation }))} />
            <Label>Size</Label>
            <SelectRow label="Size" value={videoState.size} onChange={(v) => { videoState.size = v; rerender(); }} options={[...EXPORT_SIZES.filter((s) => s.id !== "4320" && !(s.store && !s.video)).map((s) => ({ value: s.id, label: s.label, sub: s.px ? s.px.join(" × ") : `${exportSizeFor(project.aspect, s.long, ui.viewport, fixed ? undefined : videoState.orientation).join(" × ")}` })), { value: "custom", label: "Custom…", sub: "up to 3840" }]} />
            {videoState.size === "custom" && (
              <div className="grid grid-cols-2 gap-1.5">
                <NumberRow label="W" value={videoState.customW} min={16} max={3840} step={2} onChange={(v) => { videoState.customW = v; rerender(); }} />
                <NumberRow label="H" value={videoState.customH} min={16} max={3840} step={2} onChange={(v) => { videoState.customH = v; rerender(); }} />
              </div>
            )}
            <Label>Quality</Label>
            <Segmented size="sm" value={videoState.quality} onChange={(v) => { videoState.quality = v; rerender(); }} options={[{ value: "low", label: "Low" }, { value: "med", label: "Med" }, { value: "high", label: "High" }, { value: "ultra", label: "Ultra" }]} />
            <Label>Frame rate</Label>
            <Segmented size="sm" value={String(videoState.fps)} onChange={(v) => { videoState.fps = Number(v); rerender(); }} options={[{ value: "24", label: "24 fps" }, { value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }]} />
            <Label>Motion blur</Label>
            <Segmented size="sm" value={videoState.blur} onChange={(v) => { videoState.blur = v; rerender(); }} options={[{ value: "off", label: "Off" }, { value: "low", label: "Low" }, { value: "med", label: "Med" }, { value: "high", label: "High" }]} />
            <Label>Container</Label>
            <Segmented size="sm" value={videoState.transparent ? "webm" : videoState.format} onChange={(v) => { videoState.format = v; rerender(); }} options={[{ value: "mp4", label: "MP4 · H.264", disabled: videoState.transparent }, { value: "webm", label: "WebM · VP9" }]} />
            <ToggleRow label="Transparent background" checked={videoState.transparent} onChange={(v) => { videoState.transparent = v; rerender(); }} hint="WebM" />
            <Summary title={`${vidDims[0]} × ${vidDims[1]}`} tag={`${videoState.fps} fps · ~${mbps.toFixed(0)} Mbps`} sub={`${duration.toFixed(1)}s · ${project.shots.length} shot${project.shots.length === 1 ? "" : "s"} back to back${project.audio ? " · audio" : ""}${videoState.blur !== "off" ? ` · ${BLUR_SAMPLES[videoState.blur]}× motion blur` : ""}`} />
            <Button variant="solid" size="lg" onClick={() => void runVideo()} className="mt-1 w-full">Export video</Button>
            <p className="px-0.5 pt-1 text-[10px] leading-relaxed text-muted">Frames are rendered one by one and encoded with WebCodecs, so the export is deterministic at any frame rate.</p>
          </div>
        )}
      </Popover>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="label-sm mt-1 px-0.5 text-muted">{children}</div>;
}

function Summary({ title, tag, sub }: { title: string; tag: string; sub: string }) {
  return (
    <div className="mt-1 rounded-md bg-panel-2 px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="num text-sm font-semibold text-fg">{title}</span>
        <span className="label-sm text-muted">{tag}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted">{sub}</div>
    </div>
  );
}
