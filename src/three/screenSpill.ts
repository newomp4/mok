import * as THREE from "three";
import { visibleBounds } from "@/three/bounds";

interface ScreenRectangle { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }
const rectangles = new WeakMap<THREE.BufferGeometry, ScreenRectangle | null>();

/** Fit the screen's actual content UVs, including baked tilt and an inset content window. */
function screenRectangle(geometry: THREE.BufferGeometry): ScreenRectangle | null {
  if (rectangles.has(geometry)) return rectangles.get(geometry)!;
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  if (!position || !uv || position.count !== uv.count) { rectangles.set(geometry, null); return null; }
  const step = Math.max(1, Math.floor(position.count / 6000));
  const mean = new THREE.Vector3(), point = new THREE.Vector3();
  let mu = 0, mv = 0, count = 0;
  for (let i = 0; i < position.count; i += step) {
    mean.add(point.fromBufferAttribute(position, i)); mu += uv.getX(i); mv += uv.getY(i); count++;
  }
  mean.divideScalar(count); mu /= count; mv /= count;
  const pu = new THREE.Vector3(), pv = new THREE.Vector3();
  let uu = 0, vv = 0, uvSum = 0;
  for (let i = 0; i < position.count; i += step) {
    const u = uv.getX(i) - mu, v = uv.getY(i) - mv;
    point.fromBufferAttribute(position, i).sub(mean);
    pu.addScaledVector(point, u); pv.addScaledVector(point, v);
    uu += u * u; vv += v * v; uvSum += u * v;
  }
  const determinant = uu * vv - uvSum * uvSum;
  if (determinant < 1e-12) { rectangles.set(geometry, null); return null; }
  const u = pu.clone().multiplyScalar(vv).addScaledVector(pv, -uvSum).divideScalar(determinant);
  const v = pv.clone().multiplyScalar(uu).addScaledVector(pu, -uvSum).divideScalar(determinant);
  const result = { origin: mean.addScaledVector(u, -mu).addScaledVector(v, -mv), u, v };
  rectangles.set(geometry, result);
  return result;
}

/** Borrowed screen texture: receivers allocate no textures or render targets. */
export function createScreenSpill() {
  return {
    map: new THREE.Uniform<THREE.Texture | null>(null),
    origin: new THREE.Uniform(new THREE.Vector3()),
    u: new THREE.Uniform(new THREE.Vector3()),
    v: new THREE.Uniform(new THREE.Vector3()),
    normal: new THREE.Uniform(new THREE.Vector3(0, 0, 1)),
    inverse: new THREE.Uniform(new THREE.Matrix4()),
    area: new THREE.Uniform(0),
    maxMip: new THREE.Uniform(0),
    strength: new THREE.Uniform(0),
    linear: new THREE.Matrix3(),
  };
}
export type ScreenSpill = ReturnType<typeof createScreenSpill>;
export const screenSpill = createScreenSpill();

export function updateScreenSpill(spill: ScreenSpill, mesh: THREE.Mesh | null, texture: THREE.Texture | null, strength: number): boolean {
  spill.strength.value = 0;
  spill.map.value = texture;
  if (!mesh || !texture || !Number.isFinite(strength) || strength <= 0) return false;
  const rectangle = screenRectangle(mesh.geometry);
  if (!rectangle) return false;
  spill.linear.setFromMatrix4(mesh.matrixWorld);
  spill.origin.value.copy(rectangle.origin).applyMatrix4(mesh.matrixWorld);
  spill.u.value.copy(rectangle.u).applyMatrix3(spill.linear);
  spill.v.value.copy(rectangle.v).applyMatrix3(spill.linear);
  spill.normal.value.crossVectors(spill.u.value, spill.v.value);
  const area = spill.normal.value.length();
  if (!Number.isFinite(area) || area < 1e-8) return false;
  spill.normal.value.divideScalar(area);
  spill.area.value = area;
  spill.inverse.value.makeBasis(spill.u.value, spill.v.value, spill.normal.value).setPosition(spill.origin.value).invert();
  const image = texture.image as { width?: number; height?: number } | undefined;
  spill.maxMip.value = Math.log2(Math.max(1, image?.width ?? 1, image?.height ?? 1));
  spill.strength.value = strength;
  return true;
}

export function createScreenReceiver(frame: THREE.Object3D, minY: number, maxY: number) {
  return {
    frame,
    inverse: new THREE.Uniform(new THREE.Matrix4()),
    up: new THREE.Uniform(new THREE.Vector3(0, 1, 0)),
    height: new THREE.Uniform(new THREE.Vector2(minY, maxY)),
    normalMatrix: new THREE.Matrix3(),
  };
}
export type ScreenReceiver = ReturnType<typeof createScreenReceiver>;

export function updateScreenReceiver(receiver: ScreenReceiver) {
  receiver.frame.updateWorldMatrix(true, false);
  receiver.inverse.value.copy(receiver.frame.matrixWorld).invert();
  receiver.up.value.set(0, 1, 0).applyNormalMatrix(receiver.normalMatrix.getNormalMatrix(receiver.frame.matrixWorld));
}

/** The lid uses separate material clones; the fragment mask then admits only upper deck faces. */
export function laptopReceivers(root: THREE.Object3D, screen: THREE.Mesh, lid: THREE.Object3D | null, nativeFrame: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const inverse = nativeFrame.matrixWorld.clone().invert();
  const screenBox = visibleBounds(screen, inverse), screenHeight = Math.max(0.1, screenBox.max.y - screenBox.min.y);
  const candidates: { mesh: THREE.Mesh; box: THREE.Box3; area: number }[] = [];
  // Staged GLBs are prepared while their root is hidden; authored hidden children stay excluded.
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh === screen) return;
    for (let parent: THREE.Object3D | null = mesh; parent && parent !== root; parent = parent.parent) if (parent === lid || !parent.visible) return;
    const box = visibleBounds(mesh, inverse), size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || size.y > screenHeight * 0.25 || box.max.y > screenBox.min.y + screenHeight * 0.2) return;
    candidates.push({ mesh, box, area: size.x * size.z });
  });
  const largest = Math.max(0, ...candidates.map((c) => c.area));
  if (largest < 1e-6) return null;
  const top = Math.max(...candidates.filter((c) => c.area >= largest * 0.35).map((c) => c.box.max.y));
  const minY = top - screenHeight * 0.055, maxY = top + screenHeight * 0.05;
  return {
    receiver: createScreenReceiver(nativeFrame, minY, maxY),
    meshes: new Set(candidates.filter((c) => c.box.max.y >= minY && c.box.min.y <= maxY).map((c) => c.mesh)),
  };
}

const installed = new WeakSet<THREE.Material>();
export function installScreenSpill(material: THREE.MeshStandardMaterial, receiver: ScreenReceiver, spill: ScreenSpill = screenSpill) {
  if (installed.has(material)) return;
  installed.add(material);
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      spillMap: spill.map, spillOrigin: spill.origin, spillU: spill.u, spillV: spill.v,
      spillNormal: spill.normal, spillInverse: spill.inverse, spillArea: spill.area,
      spillMaxMip: spill.maxMip, spillStrength: spill.strength,
      spillDeckInverse: receiver.inverse, spillDeckUp: receiver.up, spillDeckHeight: receiver.height,
    });
    shader.vertexShader = `varying vec3 vSpillWorld;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
      vec4 spillPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        spillPosition = batchingMatrix * spillPosition;
      #endif
      #ifdef USE_INSTANCING
        spillPosition = instanceMatrix * spillPosition;
      #endif
      vSpillWorld = (modelMatrix * spillPosition).xyz;
      #include <project_vertex>`);
    shader.fragmentShader = `
      varying vec3 vSpillWorld;
      uniform sampler2D spillMap;
      uniform vec3 spillOrigin, spillU, spillV, spillNormal, spillDeckUp;
      uniform mat4 spillInverse, spillDeckInverse;
      uniform vec2 spillDeckHeight;
      uniform float spillArea, spillMaxMip, spillStrength;
      vec3 sampleScreenSpill(vec2 uv, float lod, vec2 filterWidth) {
        // The display is a finite emitter. Filter its boundary as well as its image: clipping a
        // blurred tap at UV 0/1 creates visible bands when the reflected rectangle crosses a deck.
        vec2 edge = smoothstep(-filterWidth, filterWidth, uv) * smoothstep(-filterWidth, filterWidth, 1.0 - uv);
        return textureLod(spillMap, clamp(uv, 0.0, 1.0), clamp(lod, 0.0, spillMaxMip)).rgb * edge.x * edge.y;
      }
      ${shader.fragmentShader}`.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
      if (spillStrength > 0.0) {
        vec3 spillWorldNormal = inverseTransformDirection(geometryNormal, viewMatrix);
        float deckY = (spillDeckInverse * vec4(vSpillWorld, 1.0)).y;
        vec3 sourceSpace = (spillInverse * vec4(vSpillWorld, 1.0)).xyz;
        // No underside, sidewall, back-of-display or lid illumination through the model.
        if (dot(spillWorldNormal, spillDeckUp) > 0.55 && deckY >= spillDeckHeight.x && deckY <= spillDeckHeight.y && sourceSpace.z > 0.0001) {
          vec3 irradiance = vec3(0.0);
          float projectedWeight = 0.0;
          float patchArea = spillArea / 9.0;
          for (int sy = 0; sy < 3; sy++) for (int sx = 0; sx < 3; sx++) {
            vec2 suv = (vec2(float(sx), float(sy)) + 0.5) / 3.0;
            vec3 lightVector = spillOrigin + spillU * suv.x + spillV * suv.y - vSpillWorld;
            float distanceSq = max(dot(lightVector, lightVector), 0.0001);
            vec3 lightDirection = lightVector * inversesqrt(distanceSq);
            float emission = max(dot(-lightDirection, spillNormal), 0.0);
            float incidence = max(dot(spillWorldNormal, lightDirection), 0.0);
            float weight = emission * incidence * patchArea / (distanceSq + patchArea * 0.25);
            projectedWeight += weight;
            irradiance += sampleScreenSpill(suv, spillMaxMip - 2.0, vec2(0.008)) * weight;
          }
          // Projected solid angle is at most PI over the receiving hemisphere. Near a closed lid,
          // coarse patch quadrature can overshoot that bound; normalize only those close samples.
          irradiance *= min(1.0, PI / max(projectedWeight, 0.0001));
          reflectedLight.directDiffuse += irradiance * spillStrength * BRDF_Lambert(material.diffuseContribution);
          vec3 viewDirection = normalize(cameraPosition - vSpillWorld);
          vec3 reflectedRay = reflect(-viewDirection, spillWorldNormal);
          vec3 sourceRay = mat3(spillInverse) * reflectedRay;
          if (sourceRay.z < -0.0001) {
            float travel = -sourceSpace.z / sourceRay.z;
            vec2 centerUv = sourceSpace.xy + sourceRay.xy * travel;
            float cone = max(0.003, material.roughness * material.roughness) * travel * 0.65;
            vec2 footprint = cone / vec2(length(spillU), length(spillV));
            float lod = spillMaxMip + log2(max(0.0001, max(footprint.x, footprint.y))) - 1.0;
            vec2 filterWidth = max(vec2(0.008), footprint * 0.9);
            vec3 reflection = vec3(0.0);
            for (int ry = -1; ry <= 1; ry++) for (int rx = -1; rx <= 1; rx++) {
              vec2 uv = centerUv + vec2(float(rx), float(ry)) * footprint;
              float weight = (rx == 0 ? 2.0 : 1.0) * (ry == 0 ? 2.0 : 1.0) / 16.0;
              reflection += sampleScreenSpill(uv, lod, filterWidth) * weight;
            }
            float dotNV = max(dot(spillWorldNormal, viewDirection), 0.0);
            vec3 fresnel = F_Schlick(material.specularColorBlended, material.specularF90, dotNV);
            float visibility = spillArea / (spillArea + cone * cone * 4.0);
            reflectedLight.indirectSpecular += reflection * fresnel * visibility * spillStrength;
          }
        }
      }`);
  };
  material.customProgramCacheKey = () => `${key}:screen-spill-v1`;
  material.needsUpdate = true;
}
