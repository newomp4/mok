import * as THREE from "three";

/** mm → scene units (1 unit = 100 mm) */
export const S = 0.01;

export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const rr = Math.min(r, w / 2, h / 2);
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + rr, y);
  shape.lineTo(x + w - rr, y);
  shape.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + h - rr);
  shape.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  shape.lineTo(x + rr, y + h);
  shape.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + rr);
  shape.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/**
 * A rounded box built by extruding a rounded rect along +z with a bevel.
 * Centered at the origin; front face at +d/2.
 */
export function roundedBoxGeometry(w: number, h: number, d: number, r: number, bevel = 0, segments = 24, bevelSegments = 6): THREE.ExtrudeGeometry {
  const b = Math.min(bevel, d / 2 - 1e-4, r);
  const shape = roundedRectShape(w - 2 * b, h - 2 * b, Math.max(0.0001, r - b));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, d - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments,
    curveSegments: segments,
  });
  geo.translate(0, 0, -(d - 2 * b) / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Flat rounded plane with UVs normalised to 0..1 (v=0 at bottom). */
export function roundedPlaneGeometry(w: number, h: number, r: number, segments = 24): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(roundedRectShape(w, h, r), segments);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Fully rounded pill (capsule) shape as a flat plane. */
export function pillGeometry(w: number, h: number): THREE.ShapeGeometry {
  return roundedPlaneGeometry(w, h, Math.min(w, h) / 2);
}

export function ringGeometry(rInner: number, rOuter: number): THREE.RingGeometry {
  return new THREE.RingGeometry(rInner, rOuter, 48);
}

/** A 2D profile (cove) extruded along X to build a studio cyclorama */
export function cycloramaGeometry(width: number, floorDepth: number, radius: number, wallHeight: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  // profile in (z, y) plane, we extrude along x. Shape x → z, shape y → y
  s.moveTo(floorDepth, 0);
  s.lineTo(-0 + radius, 0);
  s.absarc(radius, radius, radius, -Math.PI / 2, -Math.PI, true);
  s.lineTo(0, wallHeight);
  s.lineTo(-0.2, wallHeight);
  s.lineTo(-0.2, radius);
  s.absarc(radius, radius, radius + 0.2, -Math.PI, -Math.PI / 2, false);
  s.lineTo(floorDepth, -0.2);
  s.lineTo(floorDepth, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 32 });
  // rotate so extrusion (z) becomes x, and shape x (depth) becomes z
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}
