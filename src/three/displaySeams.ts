import * as THREE from "three";
import { ownModelResource } from "./resources";

/** The shipped Mac16 bezel and lower rim do not quite meet. An internal black
 * backing seals that source crack without moving either authored surface. */
export function addDisplaySeamBacking(root: THREE.Object3D, deviceId: string, screen: THREE.Mesh, worldFrame: THREE.Matrix4): THREE.Mesh | null {
  if (deviceId !== "macbook-pro-16-glb") return null;
  const bezel = root.getObjectByName("Object_129") as THREE.Mesh | undefined;
  const rim = root.getObjectByName("Object_131") as THREE.Mesh | undefined;
  if (!bezel?.isMesh || !rim?.isMesh || bezel.material instanceof Array || bezel.material.name !== "gOXiFODBFKnUyyU") return null;
  const existing = bezel.children.find(child => child.userData.displaySeamBacking);
  if (existing) return existing as THREE.Mesh;
  root.updateWorldMatrix(true, true);
  const inverse = worldFrame.clone().invert();
  const points = (mesh: THREE.Mesh) => {
    const position = mesh.geometry.getAttribute("position"), transform = inverse.clone().multiply(mesh.matrixWorld);
    if (!position || !Number.isFinite(position.count) || position.count > 100000) return [];
    return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform));
  };
  const source = points(bezel), display = points(screen), outline = points(rim);
  if ([source, display, outline].some(values => values.length < 3 || values.some(p => !p.toArray().every(Number.isFinite)))) return null;
  const bounds = new THREE.Box3().setFromPoints(source), size = bounds.getSize(new THREE.Vector3());
  const screenBounds = new THREE.Box3().setFromPoints(display), screenSize = screenBounds.getSize(new THREE.Vector3());
  if (size.z > size.x * .001 || size.x < screenSize.x || size.x > screenSize.x * 1.1 || size.y > screenSize.y * 1.15 || size.y < screenSize.y) return null;
  // Find the nearest lower rim edge, rather than giving the helper an arbitrary
  // enlarged rectangle. Future assets with a different arrangement fail closed.
  const below = outline.filter(p => p.y < bounds.min.y - size.x * .00001 && Math.abs(p.z) < size.x * .02);
  const edge = Math.max(...below.map(p => p.y)), gap = bounds.min.y - edge;
  if (!(gap > 0 && gap < size.y * .02)) return null;
  const sorted = source.map(p => new THREE.Vector2(p.x, p.y)).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (values: THREE.Vector2[]) => {
    const hull: THREE.Vector2[] = [];
    for (const p of values) { while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop(); hull.push(p); }
    hull.pop(); return hull;
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  if (hull.length < 3) return null;
  const epsilon = size.x * .0001, center = bounds.getCenter(new THREE.Vector3());
  const local = bezel.matrixWorld.clone().invert().multiply(worldFrame);
  const vertices = hull.map(p => new THREE.Vector3(
    p.x + Math.sign(p.x - center.x) * epsilon,
    (p.y < bounds.min.y + epsilon ? edge : p.y) + Math.sign(p.y - center.y) * epsilon,
    bounds.min.z - epsilon,
  ).applyMatrix4(local));
  const positions: number[] = [];
  for (let i = 1; i < vertices.length - 1; i++) for (const p of [vertices[0], vertices[i], vertices[i + 1]]) positions.push(p.x, p.y, p.z);
  const geometry = ownModelResource(root, new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = ownModelResource(root, new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide }));
  const backing = new THREE.Mesh(geometry, material);
  backing.name = "Mac16 internal display backing";
  backing.userData.displaySeamBacking = true;
  backing.castShadow = false; backing.receiveShadow = false;
  bezel.add(backing);
  return backing;
}
