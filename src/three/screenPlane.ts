import * as THREE from "three";

interface LocalPlane { center: THREE.Vector3; normal: THREE.Vector3 }
const planes = new WeakMap<THREE.BufferGeometry, LocalPlane>();
const normalMatrix = new THREE.Matrix3();

/** The display can be tilted in its vertex data, so its bounding-box axes are not its plane. */
function localPlane(geometry: THREE.BufferGeometry): LocalPlane {
  const cached = planes.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute("position");
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  const step = Math.max(1, Math.floor(position.count / 6000));
  let count = 0;
  for (let i = 0; i < position.count; i += step) { center.add(point.fromBufferAttribute(position, i)); count++; }
  center.divideScalar(Math.max(1, count));
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < position.count; i += step) {
    point.fromBufferAttribute(position, i).sub(center);
    const v = [point.x, point.y, point.z];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) a[row][col] += v[row] * v[col];
  }
  // Jacobi diagonalization: the least-variance axis is the display's surface normal.
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 32; iteration++) {
    let p = 0, q = 1;
    if (Math.abs(a[0][2]) > Math.abs(a[p][q])) { p = 0; q = 2; }
    if (Math.abs(a[1][2]) > Math.abs(a[p][q])) { p = 1; q = 2; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    for (let k = 0; k < 3; k++) {
      const ap = a[k][p], aq = a[k][q];
      a[k][p] = c * ap - s * aq; a[k][q] = s * ap + c * aq;
    }
    for (let k = 0; k < 3; k++) {
      const ap = a[p][k], aq = a[q][k];
      a[p][k] = c * ap - s * aq; a[q][k] = s * ap + c * aq;
      const vp = axes[k][p], vq = axes[k][q];
      axes[k][p] = c * vp - s * vq; axes[k][q] = s * vp + c * vq;
    }
  }
  const least = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j])[0];
  const normal = new THREE.Vector3(axes[0][least], axes[1][least], axes[2][least]).normalize();
  // The content UVs define the front even when an imported panel has reversed triangle winding.
  // Without UVs, use the authored winding so a turned-away display still lights its front.
  const triangle = new THREE.Vector3(), edge = new THREE.Vector3(), b = new THREE.Vector3(), winding = new THREE.Vector3();
  const index = geometry.index;
  const uv = geometry.getAttribute("uv");
  const total = index?.count ?? position.count;
  const triangleStep = Math.max(1, Math.floor(total / 18000)) * 3;
  for (let i = 0; i + 2 < total; i += triangleStep) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    point.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    edge.fromBufferAttribute(position, ic).sub(point);
    triangle.crossVectors(b.sub(point), edge);
    if (uv) {
      const determinant = (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) - (uv.getX(ic) - uv.getX(ia)) * (uv.getY(ib) - uv.getY(ia));
      if (determinant < 0) triangle.negate();
    }
    winding.add(triangle);
  }
  if (winding.lengthSq() > 1e-12 ? normal.dot(winding) < 0 : normal.z < 0) normal.negate();
  const result = { center, normal };
  planes.set(geometry, result);
  return result;
}

/** Uses cached local geometry and the current transform, including animated lids, pitch and roll. */
export function readScreenPlane(mesh: THREE.Mesh, center: THREE.Vector3, normal: THREE.Vector3) {
  const plane = localPlane(mesh.geometry);
  center.copy(plane.center).applyMatrix4(mesh.matrixWorld);
  normal.copy(plane.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(mesh.matrixWorld));
}

/** Finds the live display, ignoring models staged invisibly during a device change. */
export function findDisplay(device: THREE.Object3D): THREE.Mesh | null {
  let screen: THREE.Mesh | null = null, best = -1;
  const size = new THREE.Vector3();
  device.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((m) => "reflection" in m)) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox!.getSize(size);
    const e = mesh.matrixWorld.elements;
    const scale = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
    const span = size.length() * scale;
    if (span > best) { best = span; screen = mesh; }
  });
  return screen;
}
