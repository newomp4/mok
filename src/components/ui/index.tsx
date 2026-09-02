"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn, clamp, fmt } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icons";

/* ---------- Button ---------- */
type Variant = "ghost" | "solid" | "soft" | "accent" | "outline" | "danger";
export function Button({
  variant = "soft", size = "md", icon, iconRight, children, className, active, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md" | "lg"; icon?: IconName | string; iconRight?: IconName | string; active?: boolean; ref?: React.Ref<HTMLButtonElement>;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  const sizes = { sm: "h-6 px-2 label-sm", md: "h-7 px-2.5 label", lg: "h-8 px-3.5 label" }[size];
  const variants: Record<Variant, string> = {
    ghost: cn("text-fg hover:bg-fill", active && "bg-fill"),
    solid: "bg-inverse text-inverse-fg hover:opacity-90",
    soft: cn("bg-fill text-fg hover:bg-fill-2", active && "bg-fill-2"),
    accent: "bg-accent text-white hover:brightness-95",
    outline: cn("border border-line-2 text-fg hover:bg-fill", active && "bg-fill"),
    danger: "bg-fill text-red-600 hover:bg-red-500/10",
  };
  return (
    <button type="button" className={cn(base, sizes, variants[variant], className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 12 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 11 : 12} className="text-muted" />}
    </button>
  );
}

export function IconButton({ icon, size = 14, className, active, label, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName | string; size?: number; active?: boolean; label?: string; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-fill hover:text-fg disabled:opacity-40 disabled:pointer-events-none", active && "bg-fill text-fg", className)}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="label-sm inline-flex h-4 min-w-4 items-center justify-center rounded border border-line-2 bg-panel px-1 text-muted">{children}</kbd>;
}

export function Chip({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "accent" | "fg"; className?: string }) {
  return (
    <span className={cn("label-sm inline-flex h-4 items-center rounded px-1.5", tone === "accent" && "bg-accent-soft text-accent", tone === "muted" && "bg-fill text-muted", tone === "fg" && "bg-inverse text-inverse-fg", className)}>
      {children}
    </span>
  );
}

/* ---------- click outside ---------- */
export function useClickOutside(refs: React.RefObject<HTMLElement | null>[], onOutside: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current && r.current.contains(t))) return;
      if (t instanceof Element && t.closest("[data-popover-layer]")) return;
      onOutside();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onOutside(); };
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", handler, true);
      document.removeEventListener("keydown", key);
    };
  }, [refs, onOutside, enabled]);
}

/* ---------- Popover ---------- */
export function Popover({
  open, onClose, anchor, children, align = "start", side = "bottom", offset = 6, width, className,
}: {
  open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null>; children: ReactNode;
  align?: "start" | "end" | "center"; side?: "bottom" | "top"; offset?: number; width?: number | string; className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useClickOutside([panel, anchor], onClose, open);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const compute = () => {
      const r = anchor.current!.getBoundingClientRect();
      const pw = panel.current?.offsetWidth ?? 0;
      const ph = panel.current?.offsetHeight ?? 0;
      let left = align === "start" ? r.left : align === "end" ? r.right - pw : r.left + r.width / 2 - pw / 2;
      left = clamp(left, 8, window.innerWidth - pw - 8);
      let top = side === "bottom" ? r.bottom + offset : r.top - offset - ph;
      if (side === "bottom" && top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
      if (top < 8) top = 8;
      setPos({ left, top });
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [open, anchor, align, side, offset]);
  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      data-popover-layer=""
      style={{ position: "fixed", zIndex: 60, width, visibility: pos ? "visible" : "hidden", ...(pos ?? {}) }}
      className={cn("fade-in rounded-lg border border-line bg-panel p-1 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]", className)}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ---------- Menu ---------- */
export interface MenuItem {
  label: ReactNode;
  onSelect?: () => void;
  icon?: IconName | string;
  shortcut?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  sub?: ReactNode;
  checked?: boolean;
  right?: ReactNode;
}
export function MenuList({ items, onClose, className }: { items: MenuItem[]; onClose?: () => void; className?: string }) {
  return (
    <div className={cn("flex min-w-44 flex-col", className)}>
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => { it.onSelect?.(); onClose?.(); }}
            className={cn("label flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-fg transition-colors hover:bg-fill disabled:opacity-40 disabled:pointer-events-none", it.danger && "text-red-600")}
          >
            {it.icon && <Icon name={it.icon} size={13} className="text-muted" />}
            <span className="flex flex-1 flex-col gap-0.5">
              <span>{it.label}</span>
              {it.sub && <span className="label-sm normal-case tracking-normal text-muted">{it.sub}</span>}
            </span>
            {it.checked && <Icon name="check" size={12} />}
            {it.right}
            {it.shortcut && <span className="label-sm text-muted">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/* ---------- Select row ---------- */
export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  sub?: ReactNode;
  swatch?: string;
  disabled?: boolean;
}
export function SelectRow<T extends string>({ label, value, options, onChange, className, disabled }: {
  label: ReactNode; value: T; options: SelectOption<T>[]; onChange: (v: T) => void; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex h-8 w-full items-center justify-between rounded-md bg-fill px-2.5 transition-colors hover:bg-fill-2 disabled:opacity-40", open && "bg-fill-2", className)}
      >
        <span className="label text-fg-2">{label}</span>
        <span className="label flex items-center gap-1.5 text-fg">
          {current?.swatch && <span className="h-3 w-3 rounded-sm border border-black/10" style={{ background: current.swatch }} />}
          {current?.label ?? value}
          <Icon name="chevron-down" size={11} className="text-muted" />
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} align="end" width={ref.current?.offsetWidth}>
        <div className="scroll max-h-72 overflow-auto">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn("label flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-fg-2 transition-colors hover:bg-fill hover:text-fg disabled:opacity-40", o.value === value && "bg-fill text-fg")}
            >
              {o.swatch && <span className="h-3 w-3 rounded-sm border border-black/10" style={{ background: o.swatch }} />}
              <span className="flex-1">{o.label}</span>
              {o.sub && <span className="label-sm text-muted">{o.sub}</span>}
              {o.value === value && <Icon name="check" size={11} />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({ value, options, onChange, className, size = "md" }: {
  value: T; options: { value: T; label: ReactNode; icon?: IconName | string; disabled?: boolean }[]; onChange: (v: T) => void; className?: string; size?: "sm" | "md";
}) {
  return (
    <div className={cn("flex rounded-md bg-fill p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn("label flex flex-1 items-center justify-center gap-1.5 rounded-[5px] transition-colors disabled:opacity-40", size === "sm" ? "h-6 px-2" : "h-7 px-2.5", o.value === value ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          {o.icon && <Icon name={o.icon} size={12} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Switch ---------- */
export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40", checked ? "bg-inverse" : "bg-fill-3")}
    >
      <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-panel shadow transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
    </button>
  );
}

export function ToggleRow({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <div className={cn("flex h-8 items-center justify-between rounded-md bg-fill px-2.5", disabled && "opacity-40")}>
      <span className="label flex items-center gap-1.5 text-fg-2">{label}{hint && <Hint>{hint}</Hint>}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <span className="label-sm rounded bg-fill-2 px-1 py-0.5 text-muted">{children}</span>;
}

/* ---------- Keyframe button ---------- */
export type KeyState = "none" | "track" | "key";
export function KeyButton({ state, onClick, disabled }: { state: KeyState; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={state === "key" ? "Remove keyframe" : "Add keyframe"}
      className={cn("flex h-8 w-7 shrink-0 items-center justify-center rounded-md bg-fill transition-colors hover:bg-fill-2 disabled:opacity-40", state === "key" && "bg-accent-soft text-accent hover:bg-accent-soft", state === "track" && "text-accent", state === "none" && "text-muted")}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill={state === "key" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={state === "none" ? 1.8 : 2.2} strokeLinejoin="round">
        <path d="M12 3l9 9-9 9-9-9z" />
        {state === "track" && <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />}
      </svg>
    </button>
  );
}

/* ---------- Number row (scrubbable) ---------- */
export function NumberRow({
  label, value, min, max, step = 1, onChange, onDragStart, onDragEnd, digits, hint, unit, keyState, onKey, disabled, className, sensitivity,
}: {
  label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  onDragStart?: () => void; onDragEnd?: () => void; digits?: number; hint?: string; unit?: string;
  keyState?: KeyState; onKey?: () => void; disabled?: boolean; className?: string; sensitivity?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const d = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
  const pct = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;

  const commit = useCallback((v: number) => {
    const snapped = Math.round(v / step) * step;
    onChange(clamp(Number(snapped.toFixed(6)), min, max));
  }, [min, max, step, onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || editing) return;
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (!drag.current.moved && Math.abs(dx) < 3) return;
    if (!drag.current.moved) { drag.current.moved = true; onDragStart?.(); document.body.style.cursor = "ew-resize"; }
    const width = ref.current?.offsetWidth ?? 200;
    const range = max - min;
    const sens = sensitivity ?? 1;
    const fine = e.shiftKey ? 0.1 : 1;
    commit(drag.current.v + (dx / width) * range * sens * fine);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    drag.current = null;
    document.body.style.cursor = "";
    if (moved) onDragEnd?.();
    else {
      setText(value.toFixed(d));
      setEditing(true);
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };
  const finishEdit = () => {
    setEditing(false);
    const n = parseFloat(text);
    if (!Number.isNaN(n)) commit(n);
  };
  return (
    <div className={cn("flex items-stretch gap-1", className)}>
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => { if (!disabled) { setText(value.toFixed(d)); setEditing(true); } }}
        className={cn("relative flex h-8 flex-1 cursor-ew-resize items-center justify-between overflow-hidden rounded-md bg-fill px-2.5", disabled && "pointer-events-none opacity-40")}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-fill-2" style={{ width: `${pct * 100}%` }} />
        <span className="label relative flex items-center gap-1.5 text-fg-2">{label}{hint && <Hint>{hint}</Hint>}</span>
        {editing ? (
          <input
            autoFocus
            className="num relative w-16 rounded bg-panel px-1 text-right text-[11px] text-fg outline-none ring-1 ring-accent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={(e) => { if (e.key === "Enter") finishEdit(); if (e.key === "Escape") setEditing(false); }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="num relative text-[11px] text-fg">{fmt(value, d)}{unit}</span>
        )}
      </div>
      {keyState !== undefined && onKey && <KeyButton state={keyState} onClick={onKey} disabled={disabled} />}
    </div>
  );
}

/* ---------- Color row ---------- */
export function ColorRow({ label, value, onChange }: { label: ReactNode; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex h-8 items-center justify-between rounded-md bg-fill px-2.5">
      <span className="label text-fg-2">{label}</span>
      <span className="flex items-center gap-2">
        <input
          className="num w-16 bg-transparent text-right text-[11px] uppercase text-fg outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (/^#[0-9a-f]{6}$/i.test(text)) onChange(text.toLowerCase()); else setText(value); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        <label className="relative h-4 w-4 cursor-pointer overflow-hidden rounded border border-black/10" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </span>
    </div>
  );
}

/* ---------- Section ---------- */
export function Section({ title, children, right, open = true, onToggle, className, sub }: {
  title: ReactNode; children?: ReactNode; right?: ReactNode; open?: boolean; onToggle?: () => void; className?: string; sub?: ReactNode;
}) {
  return (
    <div className={cn("border-b border-line", className)}>
      <div className="flex h-9 items-center justify-between px-3">
        <button type="button" onClick={onToggle} className="label flex items-center gap-2 text-fg">
          {title}
          {sub && <span className="label-sm text-muted">{sub}</span>}
        </button>
        <div className="flex items-center gap-0.5">
          {right}
          {onToggle && (
            <IconButton icon={open ? "chevron-down" : "chevron-up"} size={12} onClick={onToggle} className="h-6 w-6" label={open ? "Collapse" : "Expand"} />
          )}
        </div>
      </div>
      {open && <div className="flex flex-col gap-1 px-3 pb-3">{children}</div>}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, onClose, children, width = 420, title, className }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; title?: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useClickOutside([panel], onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <div ref={panel} style={{ width }} className={cn("fade-in max-h-[85vh] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl", className)}>
        {title !== undefined && (
          <div className="flex h-12 items-center justify-between border-b border-line px-4">
            <div className="label text-fg">{title}</div>
            <IconButton icon="x" onClick={onClose} label="Close" />
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Progress ---------- */
export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-fill-2">
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
    </div>
  );
}

/* ---------- Tab pill (top bar) ---------- */
export function BarButton({ children, icon, iconRight, active, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName | string; iconRight?: IconName | string; active?: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button type="button" className={cn("label flex h-7 items-center gap-1.5 rounded-md px-2.5 text-fg-2 transition-colors hover:bg-fill hover:text-fg", active && "bg-fill text-fg", className)} {...rest}>
      {icon && <Icon name={icon} size={13} />}
      {children}
      {iconRight && <Icon name={iconRight} size={11} className="text-muted" />}
    </button>
  );
}
