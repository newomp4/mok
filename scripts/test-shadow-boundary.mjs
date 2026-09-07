import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const { addVsmReceiverBoundaryGuard, calibrateShadow } = await import('../src/three/shadowCalibration.ts');
const { addEnvironmentGain } = await import('../src/three/environmentGain.ts');

test('VSM receiver guard preserves inherited IBL, map defines and other shadow algorithms', () => {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), envMapIntensity: .3 });
  addEnvironmentGain(material); addVsmReceiverBoundaryGuard(material);
  const first = material.onBeforeCompile;
  addVsmReceiverBoundaryGuard(material); assert.equal(material.onBeforeCompile, first);
  const shader = { uniforms: {}, fragmentShader: '#include <envmap_physical_pars_fragment>\n#include <shadowmap_pars_fragment>' };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.mokEnvironmentGain.value, .3);
  material.envMapIntensity = .7; assert.equal(shader.uniforms.mokEnvironmentGain.value, .7);
  assert.ok(material.map); assert.match(material.customProgramCacheKey(), /environment-gain.*vsm-receiver-boundary/);
  const original = THREE.ShaderChunk.shadowmap_pars_fragment, start = original.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  assert.ok(shader.fragmentShader.includes(original.slice(0, start)), 'PCF sampling is unchanged');
  assert.match(shader.fragmentShader, /receiverKernel = \(vec2\(shadowRadius\) \+ 1\.0\) \/ shadowMapSize/);
  assert.equal((shader.fragmentShader.match(/receiverKernel =/g) ?? []).length, 1);
  material.map.dispose(); material.dispose();
});

test('fitted directional maps retain one complete VSM kernel around caster and floor projection at every softness and export tier', () => {
  const device = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 2, .2), new THREE.MeshStandardMaterial());
  device.add(mesh); device.rotation.set(.2, .6, .1); device.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(device), floorY = bounds.min.y - .1, fitSize = 3;
  for (const resolution of [1024, 2048, 4096]) for (const soft of [0, .5, 1]) for (const direction of [[-3,5,3],[-5,2,-3],[3,8,-2]]) {
    const light = new THREE.DirectionalLight(); light.position.fromArray(direction);
    light.shadow.radius = Math.max(1, soft * 104) * resolution / 2048;
    calibrateShadow(light, device, floorY, fitSize, resolution);
    const camera = light.shadow.camera, ray = light.target.position.clone().sub(light.position).normalize();
    const edge = (light.shadow.radius + 1) / resolution;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
      const projected = p.clone().addScaledVector(ray, Math.min(fitSize * 4, (floorY - p.y) / ray.y)); projected.y = floorY;
      for (const value of [p, projected]) {
        value.project(camera);
        assert.ok((1 - Math.abs(value.x)) / 2 > edge, `horizontal kernel clipped at ${soft}/${resolution}`);
        assert.ok((1 - Math.abs(value.y)) / 2 > edge, `vertical kernel clipped at ${soft}/${resolution}`);
      }
    }
    const prior = [camera.left, camera.right, camera.top, camera.bottom, light.shadow.radius];
    calibrateShadow(light, device, floorY, fitSize, resolution);
    assert.deepEqual([camera.left, camera.right, camera.top, camera.bottom, light.shadow.radius], prior, 'calibration cannot drift per frame');
  }
  mesh.geometry.dispose(); mesh.material.dispose();
});
