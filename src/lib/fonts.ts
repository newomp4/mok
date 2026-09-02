"use client";

export interface FontDef {
  family: string;
  weights: number[];
  /** shipped with the app (Geist), no network load */
  builtin?: boolean;
  category: "sans" | "serif" | "mono" | "display";
}

/** Curated families: Geist first, then popular Google fonts. Weights are the ones each family ships. */
export const FONTS: FontDef[] = [
  { family: "Geist", weights: [300, 400, 500, 600, 700, 800, 900], builtin: true, category: "sans" },
  { family: "Geist Mono", weights: [300, 400, 500, 600, 700, 800, 900], builtin: true, category: "mono" },
  { family: "Inter", weights: [300, 400, 500, 600, 700, 800, 900], category: "sans" },
  { family: "Manrope", weights: [300, 400, 500, 600, 700, 800], category: "sans" },
  { family: "Plus Jakarta Sans", weights: [300, 400, 500, 600, 700, 800], category: "sans" },
  { family: "DM Sans", weights: [300, 400, 500, 600, 700, 800, 900], category: "sans" },
  { family: "Space Grotesk", weights: [300, 400, 500, 600, 700], category: "sans" },
  { family: "Outfit", weights: [300, 400, 500, 600, 700, 800, 900], category: "sans" },
  { family: "Sora", weights: [300, 400, 500, 600, 700, 800], category: "sans" },
  { family: "Poppins", weights: [300, 400, 500, 600, 700, 800, 900], category: "sans" },
  { family: "Montserrat", weights: [300, 400, 500, 600, 700, 800, 900], category: "sans" },
  { family: "Roboto", weights: [300, 400, 500, 700, 900], category: "sans" },
  { family: "Bricolage Grotesque", weights: [300, 400, 500, 600, 700, 800], category: "display" },
  { family: "Syne", weights: [400, 500, 600, 700, 800], category: "display" },
  { family: "Unbounded", weights: [300, 400, 500, 600, 700, 800, 900], category: "display" },
  { family: "Playfair Display", weights: [400, 500, 600, 700, 800, 900], category: "serif" },
  { family: "Instrument Serif", weights: [400], category: "serif" },
  { family: "Fraunces", weights: [300, 400, 500, 600, 700, 800, 900], category: "serif" },
  { family: "Lora", weights: [400, 500, 600, 700], category: "serif" },
  { family: "IBM Plex Mono", weights: [300, 400, 500, 600, 700], category: "mono" },
  { family: "JetBrains Mono", weights: [300, 400, 500, 600, 700, 800], category: "mono" },
];

export function getFont(family: string): FontDef {
  return FONTS.find((f) => f.family === family) ?? FONTS[0];
}

const injected = new Set<string>();
const loaded = new Map<string, Promise<void>>();

/** CSS family string usable in canvas `ctx.font` and in inline styles. */
export function cssFamily(family: string): string {
  const def = getFont(family);
  if (def.builtin) {
    // next/font assigns a hashed family name; read the resolved stack off the document
    if (typeof document !== "undefined") {
      const v = getComputedStyle(document.documentElement).getPropertyValue(def.category === "mono" ? "--font-geist-mono" : "--font-geist-sans").trim();
      if (v) return v.replace(/^'|'$/g, "");
    }
    return def.category === "mono" ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif";
  }
  return `"${family}", ui-sans-serif, system-ui, sans-serif`;
}

/** Make sure a Google font (family + weight) is available to canvas text; resolves when it is ready. */
export function ensureFont(family: string, weight: number): Promise<void> {
  const def = getFont(family);
  if (def.builtin || typeof document === "undefined") return Promise.resolve();
  const w = def.weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), def.weights[0]);
  const key = `${family}:${w}`;
  const existing = loaded.get(key);
  if (existing) return existing;
  if (!injected.has(family)) {
    injected.add(family);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${def.weights.join(";")}&display=swap`;
    document.head.appendChild(link);
  }
  const p = (async () => {
    const deadline = Date.now() + 8000;
    // the stylesheet is async; poll document.fonts until the face resolves
    while (Date.now() < deadline) {
      try {
        const faces = await document.fonts.load(`${w} 32px "${family}"`);
        if (faces.length > 0) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 120));
    }
  })();
  loaded.set(key, p);
  return p;
}

/** Nearest weight the family ships. */
export function nearestWeight(family: string, weight: number): number {
  const def = getFont(family);
  return def.weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), def.weights[0]);
}
