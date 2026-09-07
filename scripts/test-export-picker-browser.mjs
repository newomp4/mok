// UI must budget the selected still, including while the open picker follows the playhead.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
const require = createRequire(process.env.MOK_QA_NODE_MODULES ? join(process.env.MOK_QA_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => { localStorage.setItem('mok:toured', '1'); localStorage.removeItem('mok:seen-version'); });
  await page.goto(process.env.MOK_QA_URL ?? 'http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mok?.registry.composer);
  const size = await page.evaluate(async () => {
    const m = window.__mok, p = structuredClone(m.useEditor.getState().project);
    m.useUI.setState({ time: .5, playing: false, modal: null, tourStep: null });
    p.id = 'picker-scope'; p.duration = 1; p.effects = [{ id: 'bloom', enabled: true, params: {} }]; p.blur.mode = 'depth';
    p.mockup.device = 'flat'; p.scene.preset = 'custom'; p.scene.detailShadows = 0;
    p.shots = [
      { id: 'simple', duration: 1, name: 'Simple', media: null, fit: 'contain', keyframes: {}, focusAreas: [], blurMode: 'off', effects: [] },
      { id: 'heavy', duration: 1, name: 'Heavy', media: null, fit: 'contain', keyframes: {}, focusAreas: [], blurMode: 'depth' },
    ];
    m.useEditor.getState().replaceProject(p); await m.ownership.ready(p.id);
    return navigator.deviceMemory >= 8 ? 5600 : 3600;
  });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /^Size/ }).click();
  await page.getByRole('option', { name: /Custom/ }).click();
  for (const name of ['W', 'H']) {
    await page.getByRole('spinbutton', { name, exact: true }).press('Enter');
    const input = page.getByRole('textbox', { name, exact: true }); await input.fill(String(size)); await input.press('Enter');
  }
  if (await page.getByRole('button', { name: 'Export image', exact: true }).isDisabled()) throw new Error('Unrelated later depth shot incorrectly disables the current simple still');
  await page.evaluate(() => window.__mok.useUI.setState({ time: 1.5 }));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Export image' && b.disabled));
  await page.evaluate(() => window.__mok.useUI.setState({ time: .5 }));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Export image' && !b.disabled));
  const result = { size, currentSimpleAllowed: true, laterDepthBlocked: true, playheadUpdateRestored: true };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
