import * as THREE from "three";

/** Measure visible geometry directly in the requested frame, without rotating a world AABB twice. */
export function visibleBounds(root: THREE.Object3D, inverse: THREE.Matrix4, target = new THREE.Box3(), ignoreRootVisibility = false): THREE.Box3 {
  target.makeEmpty();
  root.updateWorldMatrix(true, true);
  const matrix = new THREE.Matrix4(), box = new THREE.Box3();
  const visit = (object: THREE.Object3D) => {
    if (!object.visible && !(object === root && ignoreRootVisibility)) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute("position")) {
      const instanced = mesh as THREE.InstancedMesh;
      if (instanced.isInstancedMesh) { if (!instanced.boundingBox) instanced.computeBoundingBox(); }
      else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const localBox = instanced.isInstancedMesh ? instanced.boundingBox : mesh.geometry.boundingBox;
      if (localBox) {
        matrix.multiplyMatrices(inverse, mesh.matrixWorld);
        target.union(box.copy(localBox).applyMatrix4(matrix));
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return target;
}
