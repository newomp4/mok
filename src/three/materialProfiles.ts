import type { MeshStandardMaterial } from "three";

/** Source-specific corrections stay narrow. Authored normals, colors, and channel maps otherwise
 * retain their source strengths; rubber, key legends, grilles and leather need their full relief.
 * The 17 Pro's dense anodized grain keeps the previous preview's attenuation, without applying it
 * to every unrelated material in the catalog. These factors multiply the author's normal scale.
 */
const profiles: Record<string, Record<string, { normalGain: number }>> = {
  "iphone-17-pro-glb": { Anodized_aluminum: { normalGain: 0.65 } },
};

export function applyMaterialProfile(deviceId: string, material: MeshStandardMaterial): void {
  if (material.normalMap) material.normalScale.multiplyScalar(profiles[deviceId]?.[material.name]?.normalGain ?? 1);
}
