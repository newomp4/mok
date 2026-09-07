"use client";
import { useState } from "react";
import { useUI } from "@/store/ui";
import { Button, Modal, Segmented } from "@/components/ui";
import type { FocusArea } from "@/lib/types";

const LESSONS = {
  timeline: [
    ["Selection and playhead", "Click a practice shot to select it, then scrub the playhead. Selection chooses the clip you edit; the playhead chooses the frame you see."],
    ["Trim without moving everything", "Change the selected shot's duration. In your project, drag its edge to trim. The project end stays independent, and the space after the last shot holds its final frame."],
    ["Keys belong to properties", "Scrub within a shot and add a practice camera key. In the editor, the diamond beside a camera or focus control adds a key for that property. K stamps the current tracks."],
    ["Shape the movement", "Compare Linear and Smooth. In the advanced timeline, open a key's easing curve to change the movement into and out of it. Each property keeps its own keys."],
    ["Ready for your sequence", "Right-click a real shot to split, duplicate or replace its source. Click the seam between shots for a fade. You can switch Simple and Advanced without losing your keys."],
  ],
  autoMotion: [
    ["Choose the subject", "This disposable dashboard is your practice source. In your project, choose a media shot, open Auto-motion and mark the details the camera should visit."],
    ["Mark focus areas", "Add a focus area with the button, or drag over the dashboard. Areas are visited in order. Remove one and add it again to try a different composition."],
    ["Compose and preview", "Compose the practice move, then scrub its preview. In the real editor, Compose writes ordinary camera keyframes. Source fit, crop, padding and device orientation are included."],
    ["Keep control of the result", "Shuffle gives the real move a new variation. Its generated keys remain editable in the advanced timeline. Cropped-out focus areas are skipped with an explanation."],
  ],
};

/** Practice state lives only in this modal. No project, media, history or persistence writes. */
export function WorkflowTour({ kind }: { kind: "timeline" | "autoMotion" }) {
  const step = useUI((s) => s.tourStep) ?? 0;
  const setStep = useUI((s) => s.setTourStep);
  const [reset, setReset] = useState(0);
  const lessons = LESSONS[kind], current = lessons[Math.min(step, lessons.length - 1)];
  return <Modal open onClose={() => setStep(null)} title={kind === "timeline" ? "Tour the timeline" : "Tour Auto-motion"} width={600}>
    <div className="flex flex-col gap-4 p-4">
      <div className="flex justify-between gap-3"><span className="label text-fg">{current[0]}</span><span className="label-sm text-muted">{step + 1} / {lessons.length}</span></div>
      <p className="text-[12px] leading-relaxed text-fg-2">{current[1]}</p>
      <div className="rounded-lg border border-line bg-panel-2 p-3">
        <div className="mb-3 flex items-center justify-between gap-2"><span className="label-sm text-muted">Practice only · your project stays untouched</span><Button size="sm" variant="ghost" onClick={() => setReset((v) => v + 1)}>Reset practice</Button></div>
        {kind === "timeline" ? <TimelinePractice key={reset} /> : <MotionPractice key={reset} />}
      </div>
      <div className="flex justify-between gap-2"><Button variant="ghost" onClick={() => setStep(null)}>Exit tour</Button><div className="flex gap-2"><Button disabled={step === 0} variant="soft" onClick={() => setStep(Math.max(0, step - 1))}>Back</Button><Button variant="accent" onClick={() => setStep(step === lessons.length - 1 ? null : step + 1)}>{step === lessons.length - 1 ? "Done" : "Next"}</Button></div></div>
    </div>
  </Modal>;
}

function TimelinePractice() {
  const [selected, setSelected] = useState(0);
  const [lengths, setLengths] = useState([3, 3]);
  const [time, setTime] = useState(0);
  const [keys, setKeys] = useState<number[][]>([[], []]);
  const [ease, setEase] = useState("smooth");
  const total = lengths[0] + lengths[1];
  const shown = time < lengths[0] ? 0 : 1;
  const local = shown ? time - lengths[0] : time;
  const progress = Math.max(0, Math.min(1, local / lengths[shown]));
  const move = ease === "smooth" ? progress * progress * (3 - 2 * progress) : progress;
  return <div className="flex flex-col gap-3">
    <div className="relative flex h-24 items-center justify-center overflow-hidden rounded bg-[#10131b] text-white" aria-label={`Practice preview: Shot ${shown + 1}`}><div className="rounded border border-white/30 bg-white/10 px-5 py-3" style={{ transform: `translateX(${(move - 0.5) * 80}px) rotate(${(move - 0.5) * 12}deg)` }}>Shot {shown + 1}</div></div>
    <div className="flex gap-1">{lengths.map((duration, i) => <button key={i} type="button" aria-pressed={selected === i} className={`relative min-w-0 rounded border px-3 py-2 text-left text-[11px] ${selected === i ? "border-accent bg-accent/10 text-fg" : "border-line bg-fill text-muted"}`} style={{ flex: duration }} onClick={() => setSelected(i)}><span>Practice shot {i + 1} · {duration.toFixed(1)}s</span><span className="block truncate text-accent" aria-label={`${keys[i].length} camera keys`}>{keys[i].map((t) => `◆ ${t.toFixed(1)}s`).join(" · ") || "No camera keys"}</span></button>)}</div>
    <label className="label-sm flex flex-col gap-1 text-fg">Practice playhead · {time.toFixed(1)}s<input aria-label="Practice playhead" type="range" min={0} max={total} step={0.1} value={Math.min(time, total)} onChange={(e) => setTime(Number(e.target.value))} /></label>
    <label className="label-sm flex flex-col gap-1 text-fg">Selected shot duration<input aria-label="Practice shot duration" type="range" min={1} max={5} step={0.1} value={lengths[selected]} onChange={(e) => { const next = lengths.map((v, i) => i === selected ? Number(e.target.value) : v); setLengths(next); setTime((t) => Math.min(t, next[0] + next[1])); }} /></label>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="soft" onClick={() => { const start = selected ? lengths[0] : 0; const t = Math.max(0, Math.min(lengths[selected], time - start)); setKeys((rows) => rows.map((row, i) => i === selected ? [...new Set([...row, t])].sort((a, b) => a - b) : row)); }}>Add practice camera key</Button><Segmented size="sm" value={ease} onChange={setEase} options={[{ value: "linear", label: "Linear" }, { value: "smooth", label: "Smooth" }]} /></div>
  </div>;
}

const EXAMPLE_AREAS: FocusArea[] = [{ id: "revenue", x: 0.19, y: 0.15, w: 0.38, h: 0.34 }, { id: "chart", x: 0.19, y: 0.52, w: 0.5, h: 0.4 }, { id: "customers", x: 0.73, y: 0.15, w: 0.22, h: 0.77 }];
function MotionPractice() {
  const [areas, setAreas] = useState<FocusArea[]>([]);
  const [keys, setKeys] = useState<FocusArea[]>([]);
  const [time, setTime] = useState(0);
  const [draft, setDraft] = useState<FocusArea | null>(null);
  const point = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  const frame = keys[Math.min(keys.length - 1, Math.floor(time * Math.max(1, keys.length - 1)))];
  const next = keys[Math.min(keys.length - 1, Math.floor(time * Math.max(1, keys.length - 1)) + 1)];
  const fraction = (time * Math.max(1, keys.length - 1)) % 1;
  const eased = fraction * fraction * (3 - 2 * fraction);
  const view = frame && next ? (["x", "y", "w", "h"] as const).map((key) => frame[key] + (next[key] - frame[key]) * eased) : [0, 0, 1, 1];
  const normalize = (area: FocusArea) => ({ ...area, x: area.w < 0 ? area.x + area.w : area.x, y: area.h < 0 ? area.y + area.h : area.y, w: Math.abs(area.w), h: Math.abs(area.h) });
  return <div className="flex flex-col gap-3">
    <div className="relative aspect-[5/3] max-h-52 touch-none overflow-hidden rounded bg-[#10131b]" onPointerDown={(e) => { if (e.button || keys.length) return; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); setDraft({ id: `area-${Date.now()}`, ...p, w: 0, h: 0 }); }} onPointerMove={(e) => { if (draft) { const p = point(e); setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y }); } }} onPointerUp={() => { if (draft) { const a = normalize(draft); if (a.w >= 0.03 && a.h >= 0.03) setAreas([...areas, a]); setDraft(null); } }} onPointerCancel={() => setDraft(null)}>
      <Dashboard viewBox={keys.length ? `${view[0] * 1000} ${view[1] * 600} ${view[2] * 1000} ${view[3] * 600}` : "0 0 1000 600"} />
      {!keys.length && [...areas, ...(draft ? [normalize(draft)] : [])].map((a, i) => <div key={a.id} className="pointer-events-none absolute border-2 border-[#f26a2e] bg-orange-400/10" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}><span className="bg-[#f26a2e] px-1 text-[10px] text-white">{i + 1}</span></div>)}
    </div>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="soft" disabled={areas.length >= 3 || !!keys.length} onClick={() => { const a = EXAMPLE_AREAS.find((a) => !areas.some((b) => a.id === b.id)) ?? EXAMPLE_AREAS[0]; setAreas([...areas, { ...a }]); }}>Add practice focus area</Button><Button size="sm" variant="accent" disabled={!areas.length} onClick={() => { setKeys(structuredClone(areas)); setTime(0); }}>Compose practice move</Button>{!!keys.length && <Button size="sm" variant="ghost" onClick={() => setKeys([])}>Edit practice areas</Button>}</div>
    {areas.length > 0 && <div className="flex flex-wrap gap-2">{areas.map((a, i) => <Button key={a.id} size="sm" variant="ghost" onClick={() => { setAreas(areas.filter((b) => b.id !== a.id)); setKeys([]); }}>Remove area {i + 1}</Button>)}</div>}
    {!!keys.length && <label className="label-sm flex flex-col gap-1 text-fg">Practice movement · {keys.length} camera poses<input aria-label="Practice movement preview" type="range" min={0} max={1} step={0.01} value={time} onChange={(e) => setTime(Number(e.target.value))} /></label>}
  </div>;
}

function Dashboard({ viewBox }: { viewBox: string }) {
  return <svg role="img" aria-label="Practice dashboard with revenue, chart and customers" viewBox={viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet"><rect width="1000" height="600" fill="#10131b"/><rect width="160" height="600" fill="#1a1e29"/><text x="30" y="65" fill="#f26a2e" fontSize="28">mok</text>{["Overview", "Analytics", "Customers"].map((text, i) => <text key={text} x="24" y={145 + i * 55} fill="#b7bdca" fontSize="18">{text}</text>)}<text x="200" y="60" fill="white" fontSize="28">Overview</text><rect x="190" y="95" width="510" height="175" rx="14" fill="#242a39"/><text x="220" y="140" fill="#a6afc5" fontSize="20">Revenue</text><text x="220" y="200" fill="white" fontSize="44">$128,420</text><rect x="190" y="305" width="510" height="250" rx="14" fill="#1d2330"/>{[.3,.6,.4,.85,.7,.9,.5,.95].map((h,i) => <rect key={i} x={220+i*55} y={510-h*150} width="30" height={h*150} rx="5" fill={i===7 ? "#f26a2e" : "#606c86"}/>)}<rect x="730" y="95" width="225" height="460" rx="14" fill="#242a39"/><text x="750" y="140" fill="white" fontSize="20">Customers</text>{["Acme", "Globex", "Initech", "Hooli"].map((n,i) => <text key={n} x="765" y={205+i*75} fill="#b7bdca" fontSize="20">{n}</text>)}</svg>;
}
