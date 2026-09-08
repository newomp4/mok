import './test-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const { addSweepFade } = await import('../src/three/sweepFade.ts');
const { addEnvironmentGain } = await import('../src/three/environmentGain.ts');
const { addVsmReceiverBoundaryGuard } = await import('../src/three/shadowCalibration.ts');

test('sweep fade composes with live environment gain, VSM filtering and Three output-space fog', () => {
  const material = new THREE.MeshStandardMaterial({ envMapIntensity: .22 });
  addEnvironmentGain(material); addVsmReceiverBoundaryGuard(material); addSweepFade(material, 2);
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  addSweepFade(material, 5);
  assert.equal(material.onBeforeCompile, compile);
  assert.equal(material.customProgramCacheKey(), key);
  const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '#include <envmap_physical_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>' };
  compile.call(material, shader, {});
  assert.equal(shader.uniforms.sweepScale.value, 5);
  material.envMapIntensity = .6;
  assert.equal(shader.uniforms.mokEnvironmentGain.value, .6);
  assert.match(shader.fragmentShader, /receiverKernel/);
  assert.ok(shader.fragmentShader.indexOf('mix(gl_FragColor.rgb, fogColor, sweepFade)') > shader.fragmentShader.indexOf('#include <colorspace_fragment>'));
  assert.equal((shader.vertexShader.match(/vSweepWorld =/g) ?? []).length, 1);
  assert.match(shader.fragmentShader, /#ifdef USE_FOG/);
  material.dispose();
});
