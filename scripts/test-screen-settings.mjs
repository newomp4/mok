import './test-loader.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createProject, normalizeProject } = await import('../src/lib/defaults.ts');

test('screen lighting migrates saved projects and bounds imported strength without losing an explicit off state', () => {
  const project = createProject();
  assert.equal(project.screen.spill, 1);
  delete project.screen.spill;
  assert.equal(normalizeProject(project).screen.spill, 1);
  for (const [value, expected] of [[0,0],[0.7,0.7],[2,2],[-1,0],[100,2],[NaN,1],[Infinity,1],['2',1]]) {
    project.screen.spill = value;
    assert.equal(normalizeProject(project).screen.spill, expected);
  }
});
