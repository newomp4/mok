import { useEffect } from "react";
import * as THREE from "three";

type Disposable = { dispose(): void };

/** Dispose only the resources a component created; material textures may belong to the GLTF cache. */
export function disposeResources(resources: object) {
  const unique = new Set<Disposable>();
  for (const value of Object.values(resources)) {
    if (value && typeof value === "object" && "dispose" in value && typeof value.dispose === "function") unique.add(value as Disposable);
  }
  for (const resource of unique) resource.dispose();
}

export function useOwnedResources(resources: object) {
  useEffect(() => () => disposeResources(resources), [resources]);
}

/** Primitive GLTF objects bypass R3F's automatic disposal. Track their private clones explicitly. */
export function ownModelResource<T extends THREE.Material | THREE.BufferGeometry>(root: THREE.Object3D, resource: T): T {
  const owned = (root.userData.ownedResources ??= new Set<Disposable>()) as Set<Disposable>;
  owned.add(resource);
  return resource;
}

export function disposeModelResources(root: THREE.Object3D) {
  const owned = root.userData.ownedResources as Set<Disposable> | undefined;
  // Keep the ownership list: React Strict Mode can clean up and then remount these same objects.
  owned?.forEach((resource) => resource.dispose());
}

/** Reuse one tint per source material while dragging a color picker instead of caching every color. */
export function tintBandMaterials(root: THREE.Object3D, mesh: THREE.Mesh, original: THREE.Material | THREE.Material[], color: string) {
  const cache = (mesh.userData.bandTint ??= new Map<THREE.Material, THREE.Material>()) as Map<THREE.Material, THREE.Material>;
  const materials = (Array.isArray(original) ? original : [original]).map((source) => {
    let material = cache.get(source);
    if (!material) { material = ownModelResource(root, source.clone()); cache.set(source, material); }
    if ("color" in material) (material as THREE.MeshStandardMaterial).color.set(color);
    if ("fog" in material) material.fog = false;
    return material;
  });
  return Array.isArray(original) ? materials : materials[0];
}
