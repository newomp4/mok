export type DeviceFamily = "phone" | "tablet" | "laptop" | "watch" | "desktop" | "flat";
/** Only used to group the picker: an Android phone renders exactly like any other phone. */
export type DeviceBrand = "android";

export interface Finish {
  id: string;
  name: string;
  /** frame / body color */
  color: string;
  /** back panel color (glass) — defaults to color */
  back?: string;
  metalness?: number;
  roughness?: number;
  /** band color for watches */
  band?: string;
}

export interface CameraBump {
  kind: "pill" | "plateau" | "bar" | "square" | "lenses";
  lenses: number;
  w: number;
  h: number;
  top: number;
  left: number;
  depth: number;
}

export interface GlbModel {
  /** URL of a .glb (ideally optimised with gltf-transform: meshopt + KTX2) */
  url: string;
  /** name of the mesh (or its material) that should display the screen */
  screenMesh: string;
  /** material names that should take the finish colour */
  finishMaterials?: string[];
  /** explicit scale; by default the model's largest dimension is scaled to `size` mm (or max(body.w, body.h)) */
  scale?: number;
  size?: number;
  rotation?: [number, number, number];
  position?: [number, number, number];
  /** hide transparent glass meshes covering the screen (default true) */
  hideOverlays?: boolean;
  /** fraction of the screen mesh hidden under the bezel: [left, top, right, bottom] */
  screenInset?: [number, number, number, number];
  /** rotate the model so its screen faces the camera exactly (default true) */
  autoYaw?: boolean;
  /** mesh names to hide (baked shadow catchers, props) */
  hide?: string[];
}

export interface DeviceSpec {
  id: string;
  name: string;
  family: DeviceFamily;
  brand?: DeviceBrand;
  /** optional real 3D model — replaces the procedural geometry */
  model?: GlbModel;
  /** contoured edge radius in mm (procedural bodies) */
  edge?: number;
  /** native screen resolution (portrait for phones/tablets/watches) */
  screenPx: [number, number];
  /** physical screen size in mm */
  screenMm: [number, number];
  screenRadius: number;
  body: { w: number; h: number; d: number; r: number };
  bezelTop?: number;
  island?: { w: number; h: number; top: number };
  notch?: { w: number; h: number };
  bump?: CameraBump;
  buttons?: boolean;
  lid?: { thickness: number; angle: number; screenTop: number };
  chin?: number;
  finishes: Finish[];
  fitSize: number;
  free?: boolean;
  /** kept as a code fallback but not offered in the picker */
  hidden?: boolean;
  icon: string;
  /** default standing/lying placement in 3D scenes */
  placement: "stand" | "sit" | "float";
}

const ALU = { metalness: 0.95, roughness: 0.38 };

export const DEVICES: DeviceSpec[] = [
  {
    id: "iphone-17-pro-glb", name: "iPhone 17 Pro", family: "phone",
    screenPx: [1206, 2622], screenMm: [64.9, 141.1], screenRadius: 12.5,
    body: { w: 71.9, h: 150, d: 8.75, r: 14 },
    model: { url: "/models/iphone-17-pro.glb", screenMesh: "OLED", size: 150, rotation: [0, Math.PI, 0], finishMaterials: ["Anodized_aluminum", "Frosted_glass"] },
    finishes: [
      { id: "model", name: "Silver", color: "#dcdde0" },
      { id: "orange", name: "Cosmic Orange", color: "#e9782a" },
      { id: "blue", name: "Deep Blue", color: "#2f4472" },
    ],
    fitSize: 1.55, icon: "phone", placement: "stand", free: true,
  },
  {
    id: "iphone-17-pro-max-glb", name: "iPhone 17 Pro Max", family: "phone",
    screenPx: [1320, 2868], screenMm: [70.5, 153.3], screenRadius: 13.5,
    body: { w: 78, h: 163.4, d: 8.75, r: 15 },
    model: { url: "/models/iphone-17-pro-max.glb", screenMesh: "screen.001", size: 163.4, rotation: [0, Math.PI / 2, 0] },
    finishes: [{ id: "model", name: "Model colour", color: "#dcdde0" }],
    fitSize: 1.68, icon: "phone", placement: "stand",
  },
  {
    id: "iphone-16-pro-max-glb", name: "iPhone 16 Pro Max", family: "phone",
    screenPx: [1320, 2868], screenMm: [70.5, 153.3], screenRadius: 13.5,
    body: { w: 77.6, h: 163, d: 8.25, r: 15 },
    model: { url: "/models/iphone-16-pro-max.glb", screenMesh: "screen.001", size: 163, rotation: [0, Math.PI / 2, 0] },
    finishes: [{ id: "model", name: "Model colour", color: "#dcdde0" }],
    fitSize: 1.68, icon: "phone", placement: "stand",
  },
  {
    id: "ipad-pro-13-glb", name: "iPad Pro 13\"", family: "tablet",
    screenPx: [2752, 2064], screenMm: [262.5, 196.9], screenRadius: 18,
    body: { w: 281.6, h: 215.5, d: 5.1, r: 20 },
    model: { url: "/models/ipad-pro-13.glb", screenMesh: "EjCaatfcGdAQBho", size: 300, rotation: [0, -Math.PI / 2, 0], finishMaterials: ["ZOeABjzhcCnMIQN", "fetMGkTMYCEbhfc", "aFKyVsKnRxtPSIc", "zTliqrIZmHqtGYA", "tNTInhtuVhcfLey", "wADiXiaDqUQHYtm", "QaBMMLWYwWUThNS", "llEXDLHtmQUlhoH", "CvlwRpQyJJzldbv", "AtpoqQwyXHyfcDR", "peAefkBsoaxeaGR", "rlLxXLyqFuSJzQX", "JiwoEoDQOLnLqCc", "lPecWudGlMcwHNs", "UoLXHLITItJlNkC", "qNcPOaKIPnbkQEP", "FrqgcMaoWnXCxPQ", "hHkyTAHrTokEUgD", "tEopPPwRRYPaaeg", "jKxlebhoFEjFmnf", "pHNdlddhxBhpfDc", "rJLLQibgXjvbmhN", "ZGneimAgCRnJijf"] },
    finishes: [
      { id: "silver", name: "Silver", color: "#dfe0e2" },
      { id: "space-black", name: "Space Black", color: "#3a3a3c" },
    ],
    fitSize: 2.9, icon: "tablet", placement: "stand",
  },
  {
    id: "macbook-pro-14-glb", name: "MacBook Pro 14\"", family: "laptop",
    screenPx: [3024, 1964], screenMm: [301, 195.5], screenRadius: 7,
    body: { w: 312.6, h: 221.2, d: 11.2, r: 11 },
    lid: { thickness: 4.3, angle: 100, screenTop: 7 },
    model: { url: "/models/macbook-pro-14.glb", screenMesh: "abgVijaHVNRUvcc", size: 312.6, hide: ["NgmQYtxXWDmCavo", "PSIiVLWbMOjTmDb"], finishMaterials: ["yVmFXNTCIwNkqVT", "hPcehRUjcLAosED", "HpEeGHRuOqfcIZU", "pZbDFXVUkfRwjmQ", "NQXltfOcKPZPQdI", "BMKLbAPYqPmfArt", "kOcboIDeohDRqCf", "LJSCtLIrHNHZnIH", "zqeFZcIteZtOShc", "HPAOpCInJKBtaOC", "XNDkEZQapqqDHpk", "zaEqorbaeeADKgU", "JjuwNKnMBUdtRLb"] },
    finishes: [
      { id: "silver", name: "Silver", color: "#dfe0e3" },
      { id: "space-black", name: "Space Black", color: "#35353a" },
    ],
    fitSize: 3.4, icon: "laptop", placement: "sit",
  },
  {
    id: "macbook-pro-16-glb", name: "MacBook Pro 16\"", family: "laptop",
    screenPx: [3456, 2234], screenMm: [344, 222.5], screenRadius: 7,
    body: { w: 355.7, h: 248.1, d: 12.4, r: 11 },
    lid: { thickness: 4.4, angle: 100, screenTop: 7 },
    model: { url: "/models/macbook-pro-16.glb", screenMesh: "Object_123", size: 355.7, hide: ["Object_66"], finishMaterials: ["lmWQsEjxpsebDlK", "CRQixVLpahJzhJc", "iyDJFXmHelnMTbD", "YYwBgwvcyZVOOAA", "sIfSZcqgDlKMJPf", "LpqXZqhaGCeSzdu", "gMtYExgrEUqPfln", "SLGkCohDDelqXBu", "zhGRTuGrQoJflBD", "nDsMUuDKliqGFdU"] },
    finishes: [
      { id: "space-black", name: "Space Black", color: "#2f2f31" },
      { id: "silver", name: "Silver", color: "#dedfe1" },
    ],
    fitSize: 3.85, icon: "laptop", placement: "sit",
  },
  {
    id: "apple-watch-ultra-glb", name: "Apple Watch Ultra 2", family: "watch",
    screenPx: [410, 502], screenMm: [36, 44], screenRadius: 12,
    body: { w: 44, h: 49, d: 14.4, r: 13 },
    model: { url: "/models/watch-ultra-2.glb", screenMesh: "dEKwzvajmGpjRpl,NONHYSHLUQzoyez,VHnHbLOyhEXLvWA", size: 130, finishMaterials: ["edhWAPEBZsqCLTg", "LMTUXYhSYYJrnsy_0", "GXPSJdzybTrBefY", "CdZJpyOXLDMygZg", "vqobCvtAVyNLbeh", "YtajTVWccmKRZBL", "PmrTDgoSkxCPUel"] },
    finishes: [
      { id: "natural", name: "Natural Titanium", color: "#c9c5bd" },
      { id: "black", name: "Black Titanium", color: "#2b2b2d" },
    ],
    fitSize: 1.15, icon: "watch", placement: "float",
  },
  {
    id: "apple-watch-9-glb", name: "Apple Watch Series 9", family: "watch",
    screenPx: [396, 484], screenMm: [34, 40.5], screenRadius: 13,
    body: { w: 39, h: 45, d: 10.7, r: 15 },
    model: { url: "/models/watch-series-9.glb", screenMesh: "rpqLEPlKpASApqb,uBMkHzJfTETpPSo,hUTWIfJTbVAiNOd,hNUadlaBSDpAdCh", size: 130 },
    finishes: [{ id: "midnight", name: "Midnight", color: "#2b3140" }],
    fitSize: 1.05, icon: "watch", placement: "float",
  },
  {
    id: "imac-24-glb", name: "iMac 24\"", family: "desktop",
    screenPx: [4480, 2520], screenMm: [527, 296.5], screenRadius: 2,
    body: { w: 547, h: 461, d: 11.5, r: 8 }, chin: 88,
    model: { url: "/models/imac-24.glb", screenMesh: "vray_screen", size: 547 },
    finishes: [{ id: "green", name: "Green", color: "#7fa48e" }],
    fitSize: 6.2, icon: "monitor", placement: "sit",
  },
  {
    id: "pro-display-xdr-glb", name: "Pro Display XDR", family: "desktop",
    screenPx: [6016, 3384], screenMm: [697, 392], screenRadius: 2,
    body: { w: 717, h: 412, d: 27, r: 6 },
    model: { url: "/models/pro-display-xdr.glb", screenMesh: "", size: 717 },
    finishes: [{ id: "silver", name: "Silver", color: "#d9dadc" }],
    fitSize: 7.6, icon: "monitor", placement: "sit",
  },
  {
    id: "flat",
    name: "Flat",
    family: "flat",
    screenPx: [1920, 1200],
    screenMm: [192, 120],
    screenRadius: 0,
    body: { w: 192, h: 120, d: 1.6, r: 0 },
    finishes: [
      { id: "none", name: "None", color: "#111111" },
      { id: "dark", name: "Dark edge", color: "#1c1c1e" },
      { id: "light", name: "Light edge", color: "#e9e9ea" },
    ],
    fitSize: 1.6,
    free: true,
    icon: "square",
    placement: "float",
  },
  {
    id: "browser",
    name: "Browser",
    family: "flat",
    screenPx: [1920, 1200],
    screenMm: [192, 120],
    screenRadius: 10,
    body: { w: 192, h: 120, d: 1.6, r: 10 },
    finishes: [
      { id: "light", name: "Light", color: "#f3f3f3" },
      { id: "dark", name: "Dark", color: "#1e1e20" },
    ],
    fitSize: 1.6,
    free: true,
    icon: "browser",
    placement: "float",
  },
  {
    id: "pixel-9-pro",
    name: "Pixel 9 Pro",
    family: "phone",
    brand: "android",
    screenPx: [1280, 2856],
    screenMm: [64.6, 143.9],
    screenRadius: 14,
    body: { w: 72.4, h: 152.8, d: 8.5, r: 15 },
    edge: 2.2,
    island: { w: 8, h: 8, top: 8 },
    bump: { kind: "bar", lenses: 3, w: 64, h: 20, top: 16, left: 4.2, depth: 3.2 },
    buttons: true,
    finishes: [
      { id: "obsidian", name: "Obsidian", color: "#232326", back: "#2b2b2f", ...ALU },
      { id: "porcelain", name: "Porcelain", color: "#eae5dc", back: "#f2eee7", ...ALU },
      { id: "hazel", name: "Hazel", color: "#7f8377", back: "#8d9184", ...ALU },
      { id: "rose-quartz", name: "Rose Quartz", color: "#f0cfd0", back: "#f6dedf", ...ALU },
    ],
    fitSize: 1.55,
    free: true,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "pixel-9-pro-xl",
    hidden: true,
    name: "Pixel 9 Pro XL",
    family: "phone",
    brand: "android",
    screenPx: [1344, 2992],
    screenMm: [69.5, 154.7],
    screenRadius: 15,
    body: { w: 76.6, h: 162.8, d: 8.5, r: 16 },
    edge: 2.2,
    island: { w: 8, h: 8, top: 8 },
    bump: { kind: "bar", lenses: 3, w: 68, h: 21, top: 17, left: 4.3, depth: 3.2 },
    buttons: true,
    finishes: [
      { id: "obsidian", name: "Obsidian", color: "#232326", back: "#2b2b2f", ...ALU },
      { id: "porcelain", name: "Porcelain", color: "#eae5dc", back: "#f2eee7", ...ALU },
      { id: "hazel", name: "Hazel", color: "#7f8377", back: "#8d9184", ...ALU },
    ],
    fitSize: 1.6,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "galaxy-s25-ultra",
    name: "Galaxy S25 Ultra",
    family: "phone",
    brand: "android",
    screenPx: [1440, 3120],
    screenMm: [71.9, 155.7],
    screenRadius: 6,
    body: { w: 77.6, h: 162.8, d: 8.2, r: 7 },
    edge: 2,
    island: { w: 8, h: 8, top: 8 },
    // the Ultra has no camera plateau at all: the lenses sit straight on the back glass
    bump: { kind: "lenses", lenses: 3, w: 20, h: 62, top: 14, left: 9, depth: 1.1 },
    buttons: true,
    finishes: [
      { id: "titanium-black", name: "Titanium Black", color: "#26262a", back: "#2e2e33", ...ALU },
      { id: "titanium-silverblue", name: "Titanium Silverblue", color: "#c3ccd6", back: "#d0d8e0", ...ALU },
      { id: "titanium-whitesilver", name: "Titanium Whitesilver", color: "#e4e4e2", back: "#eeeeec", ...ALU },
      { id: "titanium-gray", name: "Titanium Gray", color: "#8e8e92", back: "#9b9b9f", ...ALU },
    ],
    fitSize: 1.6,
    free: true,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "iphone-17",
    hidden: true,
    name: "iPhone 17",
    family: "phone",
    screenPx: [1206, 2622],
    screenMm: [64.9, 141.1],
    screenRadius: 12.5,
    body: { w: 71.5, h: 149.6, d: 7.95, r: 14 },
    edge: 1.6,
    island: { w: 37, h: 11, top: 10.5 },
    bump: { kind: "pill", lenses: 2, w: 27, h: 55, top: 13, left: 8, depth: 2.4 },
    buttons: true,
    finishes: [
      { id: "lavender", name: "Lavender", color: "#c9c2df", back: "#d9d3ea", ...ALU },
      { id: "sage", name: "Sage", color: "#b7c4b6", back: "#c9d3c7", ...ALU },
      { id: "mist-blue", name: "Mist Blue", color: "#b9cbd9", back: "#cddce7", ...ALU },
      { id: "white", name: "White", color: "#e6e6e4", back: "#f1f1ef", ...ALU },
      { id: "black", name: "Black", color: "#1f1f21", back: "#2a2a2c", ...ALU },
    ],
    fitSize: 1.55,
    free: true,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "iphone-17-pro",
    hidden: true,
    name: "iPhone 17 Pro",
    family: "phone",
    screenPx: [1206, 2622],
    screenMm: [64.9, 141.1],
    screenRadius: 12.5,
    body: { w: 71.9, h: 150, d: 8.75, r: 14 },
    edge: 2.4,
    island: { w: 37, h: 11, top: 10.5 },
    bump: { kind: "plateau", lenses: 3, w: 62, h: 38, top: 10, left: 5, depth: 3.2 },
    buttons: true,
    finishes: [
      { id: "silver", name: "Silver", color: "#dcdde0", back: "#e6e7ea", ...ALU },
      { id: "cosmic-orange", name: "Cosmic Orange", color: "#e0702c", back: "#ea8340", ...ALU },
      { id: "deep-blue", name: "Deep Blue", color: "#26406a", back: "#2f4e7f", ...ALU },
    ],
    fitSize: 1.55,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "iphone-17-pro-max",
    hidden: true,
    name: "iPhone 17 Pro Max",
    family: "phone",
    screenPx: [1320, 2868],
    screenMm: [70.5, 153.3],
    screenRadius: 13.5,
    body: { w: 78, h: 163.4, d: 8.75, r: 15 },
    edge: 2.4,
    island: { w: 37, h: 11, top: 11 },
    bump: { kind: "plateau", lenses: 3, w: 68, h: 40, top: 10, left: 5, depth: 3.2 },
    buttons: true,
    finishes: [
      { id: "silver", name: "Silver", color: "#dcdde0", back: "#e6e7ea", ...ALU },
      { id: "cosmic-orange", name: "Cosmic Orange", color: "#e0702c", back: "#ea8340", ...ALU },
      { id: "deep-blue", name: "Deep Blue", color: "#26406a", back: "#2f4e7f", ...ALU },
    ],
    fitSize: 1.68,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "iphone-air",
    hidden: true,
    name: "iPhone Air",
    family: "phone",
    screenPx: [1260, 2736],
    screenMm: [67.5, 146.7],
    screenRadius: 13,
    body: { w: 74.7, h: 156.2, d: 5.64, r: 14.5 },
    edge: 2.3,
    island: { w: 37, h: 11, top: 10.5 },
    bump: { kind: "bar", lenses: 1, w: 66, h: 18, top: 8, left: 4.3, depth: 3.4 },
    buttons: true,
    finishes: [
      { id: "space-black", name: "Space Black", color: "#1b1b1d", back: "#232325", metalness: 1, roughness: 0.25 },
      { id: "cloud-white", name: "Cloud White", color: "#eeece8", back: "#f6f4f0", metalness: 1, roughness: 0.25 },
      { id: "light-gold", name: "Light Gold", color: "#e6d8bf", back: "#eee3cf", metalness: 1, roughness: 0.25 },
      { id: "sky-blue", name: "Sky Blue", color: "#cfe0ee", back: "#dbe9f3", metalness: 1, roughness: 0.25 },
    ],
    fitSize: 1.62,
    icon: "phone",
    placement: "stand",
  },
  {
    id: "ipad-pro-13",
    hidden: true,
    name: "iPad Pro 13\"",
    family: "tablet",
    screenPx: [2064, 2752],
    screenMm: [196.9, 262.5],
    screenRadius: 18,
    body: { w: 215.5, h: 281.6, d: 5.1, r: 20 },
    edge: 1.2,
    buttons: true,
    bump: { kind: "square", lenses: 1, w: 22, h: 22, top: 10, left: 10, depth: 1.4 },
    finishes: [
      { id: "silver", name: "Silver", color: "#dfe0e2", back: "#e6e7e9", ...ALU },
      { id: "space-black", name: "Space Black", color: "#242426", back: "#2b2b2d", ...ALU },
    ],
    fitSize: 2.9,
    icon: "tablet",
    placement: "stand",
  },
  {
    id: "ipad-air-11",
    name: "iPad Air 11\"",
    family: "tablet",
    screenPx: [1640, 2360],
    screenMm: [165.5, 238.1],
    screenRadius: 16,
    body: { w: 178.5, h: 247.6, d: 6.1, r: 18 },
    edge: 1.4,
    buttons: true,
    bump: { kind: "square", lenses: 1, w: 18, h: 18, top: 9, left: 9, depth: 1.2 },
    finishes: [
      { id: "space-gray", name: "Space Gray", color: "#5f5f63", back: "#6a6a6e", ...ALU },
      { id: "blue", name: "Blue", color: "#b9cbe0", back: "#c6d5e6", ...ALU },
      { id: "purple", name: "Purple", color: "#cbc4e0", back: "#d6d0e8", ...ALU },
      { id: "starlight", name: "Starlight", color: "#e7e0d4", back: "#eee8de", ...ALU },
    ],
    fitSize: 2.55,
    icon: "tablet",
    placement: "stand",
  },
  {
    id: "macbook-pro-14",
    hidden: true,
    name: "MacBook Pro 14\"",
    family: "laptop",
    screenPx: [3024, 1964],
    screenMm: [301, 195.5],
    screenRadius: 7,
    body: { w: 312.6, h: 221.2, d: 11.2, r: 11 },
    notch: { w: 33, h: 9 },
    lid: { thickness: 4.3, angle: 100, screenTop: 7 },
    finishes: [
      { id: "space-black", name: "Space Black", color: "#2a2a2c", ...ALU },
      { id: "silver", name: "Silver", color: "#d7d8da", ...ALU },
    ],
    fitSize: 3.4,
    icon: "laptop",
    placement: "sit",
  },
  {
    id: "macbook-pro-16",
    hidden: true,
    name: "MacBook Pro 16\"",
    family: "laptop",
    screenPx: [3456, 2234],
    screenMm: [344, 222.5],
    screenRadius: 7,
    body: { w: 355.7, h: 248.1, d: 12.4, r: 11 },
    notch: { w: 33, h: 9 },
    lid: { thickness: 4.4, angle: 100, screenTop: 7 },
    finishes: [
      { id: "space-black", name: "Space Black", color: "#2a2a2c", ...ALU },
      { id: "silver", name: "Silver", color: "#d7d8da", ...ALU },
    ],
    fitSize: 3.85,
    icon: "laptop",
    placement: "sit",
  },
  {
    id: "macbook-air-13",
    hidden: true,
    name: "MacBook Air 13\"",
    family: "laptop",
    screenPx: [2560, 1664],
    screenMm: [286, 186],
    screenRadius: 7,
    body: { w: 304.1, h: 215, d: 7.6, r: 10 },
    notch: { w: 30, h: 8.5 },
    lid: { thickness: 3.7, angle: 100, screenTop: 7 },
    finishes: [
      { id: "midnight", name: "Midnight", color: "#2b3140", ...ALU },
      { id: "starlight", name: "Starlight", color: "#e8dfd0", ...ALU },
      { id: "silver", name: "Silver", color: "#d9dadc", ...ALU },
      { id: "sky-blue", name: "Sky Blue", color: "#cbdbe9", ...ALU },
    ],
    fitSize: 3.3,
    icon: "laptop",
    placement: "sit",
  },
  {
    id: "macbook-air-15",
    hidden: true,
    name: "MacBook Air 15\"",
    family: "laptop",
    screenPx: [2880, 1864],
    screenMm: [322, 208.5],
    screenRadius: 7,
    body: { w: 340.4, h: 237.6, d: 7.8, r: 10 },
    notch: { w: 30, h: 8.5 },
    lid: { thickness: 3.7, angle: 100, screenTop: 7 },
    finishes: [
      { id: "midnight", name: "Midnight", color: "#2b3140", ...ALU },
      { id: "starlight", name: "Starlight", color: "#e8dfd0", ...ALU },
      { id: "silver", name: "Silver", color: "#d9dadc", ...ALU },
      { id: "sky-blue", name: "Sky Blue", color: "#cbdbe9", ...ALU },
    ],
    fitSize: 3.7,
    icon: "laptop",
    placement: "sit",
  },
  {
    id: "apple-watch-46",
    hidden: true,
    name: "Apple Watch 46mm",
    family: "watch",
    screenPx: [416, 496],
    screenMm: [34, 40.5],
    screenRadius: 13,
    body: { w: 39, h: 46, d: 9.7, r: 15 },
    finishes: [
      { id: "jet-black", name: "Jet Black", color: "#151517", band: "#1d1d1f", metalness: 1, roughness: 0.15 },
      { id: "silver", name: "Silver", color: "#d9dadc", band: "#e4e4e6", ...ALU },
      { id: "rose-gold", name: "Rose Gold", color: "#dcbcae", band: "#e9d1c7", ...ALU },
      { id: "space-gray", name: "Space Gray", color: "#5a5a5e", band: "#303032", ...ALU },
    ],
    fitSize: 1.05,
    icon: "watch",
    placement: "float",
  },
  {
    id: "apple-watch-ultra",
    hidden: true,
    name: "Apple Watch Ultra 49mm",
    family: "watch",
    screenPx: [410, 502],
    screenMm: [36, 44],
    screenRadius: 12,
    body: { w: 44, h: 49, d: 14.4, r: 13 },
    finishes: [
      { id: "natural", name: "Natural Titanium", color: "#c9c5bd", band: "#3a3a3c", metalness: 0.9, roughness: 0.5 },
      { id: "black", name: "Black Titanium", color: "#2b2b2d", band: "#1d1d1f", metalness: 0.9, roughness: 0.5 },
    ],
    fitSize: 1.15,
    icon: "watch",
    placement: "float",
  },
  {
    id: "studio-display",
    hidden: true,
    name: "Studio Display",
    family: "desktop",
    screenPx: [5120, 2880],
    screenMm: [596.7, 335.6],
    screenRadius: 2,
    body: { w: 623, h: 362, d: 18, r: 6 },
    finishes: [{ id: "silver", name: "Silver", color: "#d9dadc", ...ALU }],
    fitSize: 6.6,
    icon: "monitor",
    placement: "sit",
  },
  {
    id: "imac-24",
    hidden: true,
    name: "iMac 24\"",
    family: "desktop",
    screenPx: [4480, 2520],
    screenMm: [527, 296.5],
    screenRadius: 2,
    body: { w: 547, h: 461, d: 11.5, r: 8 },
    chin: 88,
    finishes: [
      { id: "blue", name: "Blue", color: "#5b7fb0", back: "#2c5e9a", ...ALU },
      { id: "green", name: "Green", color: "#7fa48e", back: "#3e7a5a", ...ALU },
      { id: "pink", name: "Pink", color: "#d99aa3", back: "#c9646f", ...ALU },
      { id: "silver", name: "Silver", color: "#d9dadc", back: "#c8c9cb", ...ALU },
      { id: "orange", name: "Orange", color: "#e2a066", back: "#d76c2b", ...ALU },
      { id: "purple", name: "Purple", color: "#a493c8", back: "#6f5aa6", ...ALU },
    ],
    fitSize: 6.2,
    icon: "monitor",
    placement: "sit",
  },
];

/*
 * To use a real 3D model instead of the procedural geometry, drop a .glb into
 * public/models/ and add a spec with a `model` block, e.g.:
 *
 *   {
 *     id: "iphone-17-pro-glb", name: "iPhone 17 Pro (GLB)", family: "phone",
 *     screenPx: [1206, 2622], screenMm: [64.9, 141.1], screenRadius: 12.5,
 *     body: { w: 71.9, h: 150, d: 8.75, r: 14 },
 *     model: { url: "/models/iphone-17-pro.glb", screenMesh: "Screen", finishMaterials: ["Frame", "Back"] },
 *     finishes: [{ id: "silver", name: "Silver", color: "#dcdde0" }],
 *     fitSize: 1.55, icon: "phone", placement: "stand",
 *   }
 *
 * Optimise models first (meshopt + KTX2, same pipeline Ultramock uses):
 *   pnpm dlx @gltf-transform/cli optimize in.glb public/models/out.glb --compress meshopt --texture-compress ktx2
 */
export const DEVICE_MAP = new Map(DEVICES.map((d) => [d.id, d]));

/** Photoreal glTF counterpart for each procedural device (used for defaults, templates and migration). */
export const PREFERRED_MODEL: Record<string, string> = {
  "iphone-17": "iphone-17-pro-glb",
  "iphone-17-pro": "iphone-17-pro-glb",
  "iphone-17-pro-max": "iphone-17-pro-max-glb",
  "iphone-air": "iphone-17-pro-glb",
  "ipad-pro-13": "ipad-pro-13-glb",
  "macbook-pro-14": "macbook-pro-14-glb",
  "macbook-pro-16": "macbook-pro-16-glb",
  "macbook-air-13": "macbook-pro-14-glb",
  "macbook-air-15": "macbook-pro-16-glb",
  "apple-watch-46": "apple-watch-9-glb",
  "apple-watch-ultra": "apple-watch-ultra-glb",
  "studio-display": "pro-display-xdr-glb",
  "imac-24": "imac-24-glb",
};

/** Swap a procedural device id for its glTF counterpart when one exists. */
export function preferModel(id: string): string {
  const target = PREFERRED_MODEL[id];
  return target && DEVICE_MAP.has(target) ? target : id;
}
export function getDevice(id: string): DeviceSpec {
  return DEVICE_MAP.get(id) ?? DEVICES[2];
}
export function getFinish(spec: DeviceSpec, id: string): Finish {
  return spec.finishes.find((f) => f.id === id) ?? spec.finishes[0];
}

export const FAMILY_LABELS: Record<DeviceFamily | DeviceBrand, string> = {
  flat: "Flat",
  phone: "iPhone",
  android: "Android",
  tablet: "iPad",
  laptop: "MacBook",
  watch: "Apple Watch",
  desktop: "Desktop",
};

/** The heading a device sits under in the picker. */
export function deviceGroup(d: DeviceSpec): DeviceFamily | DeviceBrand {
  return d.brand ?? d.family;
}
