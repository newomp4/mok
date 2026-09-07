import type { MeshStandardMaterial } from "three";

/** Source-specific corrections stay narrow. Authored normals, colors, and channel maps otherwise
 * retain their source strengths; rubber, key legends, grilles and leather need their full relief.
 * The 17 Pro's dense anodized grain keeps the previous preview's attenuation, without applying it
 * to every unrelated material in the catalog. The 14-inch MacBook's identified silver enclosure
 * uses a 256² grain with 4.13° RMS normal tilt; 0.55 gain brings it close to the 16-inch enclosure's
 * 2.37° source grain and reduces grazing sparkle. Keycaps, legends, trackpad and rubber are untouched.
 * These factors multiply the author's normal scale. See docs/research/visual-0.11.0.md for A/B data.
 */
const profiles: Record<string, Record<string, { normalGain: number }>> = {
  "iphone-17-pro-glb": { Anodized_aluminum: { normalGain: 0.65 } },
  "macbook-pro-14-glb": {
    hPcehRUjcLAosED: { normalGain: 0.55 }, // Silver enclosure / palm rest.
    zqeFZcIteZtOShc: { normalGain: 0.55 }, // Matching outer display enclosure.
  },
};

export function applyMaterialProfile(deviceId: string, material: MeshStandardMaterial): void {
  if (material.normalMap) material.normalScale.multiplyScalar(profiles[deviceId]?.[material.name]?.normalGain ?? 1);
}
