import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { roundedRectShape } from "./geometry";

/**
 * Profile-sweep geometry: a 2D edge profile (outward offset `o`, height `z`)
 * swept around a rounded-rectangle outline. This is how real industrial
 * shapes (phones, laptops, watches, displays) get their contoured edges
 * instead of a generic bevel.
 */
export interface ProfilePoint {
  /** outward offset from the outline (negative = inset) */
  o: number;
  /** height along the extrusion axis (+z = front) */
  z: number;
  /** split shading here (hard edge) */
  hard?: boolean;
}

export function sampleRoundedRect(w: number, h: number, r: number, cornerSegments = 12): { p: THREE.Vector2[]; n: THREE.Vector2[] } {
  const rr = Math.max(0.02, Math.min(r, w / 2, h / 2));
  const hw = w / 2 - rr, hh = h / 2 - rr;
  const corners: [number, number, number, number][] = [
    [hw, -hh, -Math.PI / 2, 0],
    [hw, hh, 0, Math.PI / 2],
    [-hw, hh, Math.PI / 2, Math.PI],
    [-hw, -hh, Math.PI, Math.PI * 1.5],
  ];
  const p: THREE.Vector2[] = [], n: THREE.Vector2[] = [];
  for (const [cx, cy, a0, a1] of corners) {
    for (let s = 0; s <= cornerSegments; s++) {
      const t = a0 + ((a1 - a0) * s) / cornerSegments;
      const c = Math.cos(t), sn = Math.sin(t);
      p.push(new THREE.Vector2(cx + rr * c, cy + rr * sn));
      n.push(new THREE.Vector2(c, sn));
    }
  }
  return { p, n };
}

export function sweepRoundedRect(
  w: number,
  h: number,
  r: number,
  profile: ProfilePoint[],
  opts: { cornerSegments?: number; caps?: boolean } = {},
): THREE.BufferGeometry {
  const { cornerSegments = 12, caps = true } = opts;
  const { p, n } = sampleRoundedRect(w, h, r, cornerSegments);
  const N = p.length;
  // split the profile into smooth runs at hard points
  const runs: ProfilePoint[][] = [[]];
  profile.forEach((pt, j) => {
    if (j > 0 && pt.hard) {
      runs[runs.length - 1].push(pt);
      runs.push([pt]);
    } else runs[runs.length - 1].push(pt);
  });
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  let base = 0;
  for (const run of runs) {
    if (run.length < 2) continue;
    for (let j = 0; j < run.length; j++) {
      const { o, z } = run[j];
      for (let i = 0; i < N; i++) {
        positions.push(p[i].x + n[i].x * o, p[i].y + n[i].y * o, z);
        uvs.push(i / N, j / (run.length - 1));
      }
    }
    for (let j = 0; j < run.length - 1; j++) {
      for (let i = 0; i < N; i++) {
        const i2 = (i + 1) % N;
        const a = base + j * N + i, b = base + j * N + i2, c = base + (j + 1) * N + i2, d = base + (j + 1) * N + i;
        // outward-facing winding (outline is CCW, profile runs front → back)
        indices.push(a, c, b, a, d, c);
      }
    }
    base += run.length * N;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (!caps) return geo;
  const first = profile[0], last = profile[profile.length - 1];
  const front = new THREE.ShapeGeometry(roundedRectShape(w + 2 * first.o, h + 2 * first.o, Math.max(0.02, r + first.o)), cornerSegments);
  front.translate(0, 0, first.z);
  const back = new THREE.ShapeGeometry(roundedRectShape(w + 2 * last.o, h + 2 * last.o, Math.max(0.02, r + last.o)), cornerSegments);
  back.rotateY(Math.PI);
  back.translate(0, 0, last.z);
  const merged = mergeGeometries([geo, front, back], false);
  geo.dispose(); front.dispose(); back.dispose();
  return merged ?? geo;
}

/** points along a circular arc in (o, z) space */
export function arcProfile(co: number, cz: number, radius: number, a0: number, a1: number, steps = 6, skipFirst = false): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let s = skipFirst ? 1 : 0; s <= steps; s++) {
    const t = a0 + ((a1 - a0) * s) / steps;
    out.push({ o: co + radius * Math.cos(t), z: cz + radius * Math.sin(t) });
  }
  return out;
}

/** Contoured edge: rounded front edge (radius eFront), flat side, rounded back edge (radius eBack). */
export function contourProfile(d: number, eFront: number, eBack = eFront, steps = 7): ProfilePoint[] {
  const hd = d / 2;
  const pts: ProfilePoint[] = [];
  pts.push(...arcProfile(-eFront, hd - eFront, eFront, Math.PI / 2, 0, steps));
  if (hd - eFront > hd - eBack + 1e-6 || hd - eBack > hd - eFront + 1e-6 || eFront !== eBack) pts.push({ o: 0, z: -(hd - eBack) });
  else pts.push({ o: 0, z: -(hd - eBack) });
  pts.push(...arcProfile(-eBack, -(hd - eBack), eBack, 0, -Math.PI / 2, steps, true));
  return pts;
}

/** Chamfered edge (hard) */
export function chamferProfile(d: number, cFront: number, cBack = cFront): ProfilePoint[] {
  const hd = d / 2;
  return [
    { o: -cFront, z: hd },
    { o: 0, z: hd - cFront, hard: true },
    { o: 0, z: -(hd - cBack), hard: true },
    { o: -cBack, z: -hd },
  ];
}

/** Fully rounded (pill) edge */
export function pillProfile(d: number, steps = 12): ProfilePoint[] {
  return arcProfile(-d / 2, 0, d / 2, Math.PI / 2, -Math.PI / 2, steps);
}

/** Bulging edge that swells outwards at mid-height (watch cases). */
export function bulgeProfile(d: number, eFront: number, bulge: number, eBack: number, steps = 10): ProfilePoint[] {
  const hd = d / 2;
  const p0 = new THREE.Vector2(-eFront, hd);
  const c0 = new THREE.Vector2(bulge * 0.9, hd - eFront * 0.2);
  const c1 = new THREE.Vector2(bulge * 1.05, -hd + eBack * 0.6);
  const p1 = new THREE.Vector2(-eBack, -hd);
  const curve = new THREE.CubicBezierCurve(p0, c0, c1, p1);
  return curve.getPoints(steps).map((v) => ({ o: v.x, z: v.y }));
}

/** A small swept solid used for buttons / plateaus: rounded rect with a soft top edge. */
export function domeProfile(depth: number, edge: number, steps = 5): ProfilePoint[] {
  return [...arcProfile(-edge, depth - edge, edge, Math.PI / 2, 0, steps), { o: 0, z: 0 }];
}
