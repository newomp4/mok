import { chromium } from 'playwright';
import { check } from './jobs.mjs';

/** This adapter runs only in the server's fresh, nonpersistent browser context. */
export async function installAdapter() {
  const m = window.__mok;
  if (!m?.persistence?.importProjectFile || !m?.capture?.captureImage || !m?.actions?.newProject) throw new Error('This app does not expose the supported mok automation bridge. Use mok 0.11 or later.');
  const input = document.createElement('input'); input.type = 'file'; input.id = 'mok-automation-input'; input.style.display = 'none'; document.body.appendChild(input);
  const state = { result: null, release: null, controller: new AbortController(), progress: 0, phase: 'Ready' };
  let sourceRefs = new Map(), importedRefs = new Map();
  const ready = async () => {
    const id = m.useEditor.getState().project.id;
    if (m.ownership && !(await m.ownership.ready(id))) throw new Error('Automation could not acquire its isolated project session.');
    m.useUI.setState({ playing: false, modal: null, activeShotId: m.useEditor.getState().project.shots[0]?.id ?? null, time: 0 });
  };
  const project = () => structuredClone(m.useEditor.getState().project);
  const file = () => { const value = input.files?.[0]; if (!value) throw new Error('No uploaded input file.'); return value; };
  const save = async () => { state.result = await m.persistence.exportProjectFile(project()); if (!(state.result instanceof Blob)) throw new Error('Portable project serialization failed.'); };
  const metadata = () => ({ bytes: state.result?.size ?? 0, type: state.result?.type ?? 'application/octet-stream' });
  window.__mokAutomation = {
    async catalog() {
      return {
        appVersion: m.version,
        devices: m.devices.filter((d) => !d.hidden).map(({ id, name, family, finishes, screenPx }) => ({ id, name, family, finishes, screenPx })),
        templates: m.templates.map(({ id, name, device, scene, aspect, motion, sequence }) => ({ id, name, device, scene, aspect, animated: !!(motion || sequence) })),
        scenes: m.scenes.map(({ id, name }) => ({ id, name })),
        effects: m.effectDefs,
      };
    },
    async create({ name, templateId, deviceId, aspect }) {
      m.actions.newProject(); await ready();
      if (templateId) {
        const template = m.templates.find((t) => t.id === templateId);
        if (!template) throw new Error('Unknown template id. Use mok_catalog.');
        m.actions.applyTemplate(templateId);
        const target = project().shots.find((s) => !s.kind || s.kind === 'media');
        if (template.screen && target) {
          await m.actions.applySampleScreen(template.screen, target.id);
          const ref = project().shots.find((s) => s.id === target.id)?.media;
          if (!ref) throw new Error('The template sample image could not be prepared.');
          m.useEditor.getState().update((p) => { for (const s of p.shots) if ((!s.kind || s.kind === 'media') && !s.media) s.media = ref; });
        }
      }
      if (deviceId) {
        if (!m.devices.some((d) => d.id === deviceId && !d.hidden)) throw new Error('Unknown selectable device id. Use mok_catalog.');
        m.useEditor.getState().setDevice(deviceId);
      }
      const p = project(); if (name) p.name = name; if (aspect) p.aspect = aspect;
      m.useEditor.getState().replaceProject(p); await ready();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await save(); return { project: project(), output: metadata() };
    },
    async load() {
      // Portable imports intentionally regenerate media ids. Keep the external .mok ids stable
      // in read/edit responses, then translate edits back to this private context's loaded ids.
      const portable = JSON.parse(await file().text());
      if (portable.format !== 'mok' || !portable.project) throw new Error('Not a mok project file.');
      m.useEditor.getState().replaceProject(portable.project); await ready();
      const canonical = project(), before = m.persistence.collectMedia(canonical);
      const p = await m.persistence.importProjectFile(file());
      const after = m.persistence.collectMedia(p);
      if (before.length !== after.length) throw new Error('Portable media normalization changed unexpectedly. Re-export the project in the editor.');
      sourceRefs = new Map(before.map((ref, index) => [ref.id, after[index]]));
      importedRefs = new Map(after.map((ref) => [ref.id, ref]));
      m.useEditor.getState().replaceProject(p); await ready();
      return canonical;
    },
    async update(value) {
      value.id = project().id;
      m.useEditor.getState().replaceProject(value);
      const normalized = project();
      // collectMedia deduplicates ids; visit every actual slot so two shots sharing one source
      // cannot leave one of their cloned reference objects pointing at the portable-only id.
      const refs = [...normalized.shots.flatMap((shot) => [shot.media, shot.logo?.media]), normalized.scene.background.image, normalized.screen.bg?.image, normalized.audio?.media].filter(Boolean);
      for (const ref of refs) {
        const loaded = sourceRefs.get(ref.id) ?? importedRefs.get(ref.id);
        if (!loaded) throw new Error('Unknown media reference in edits. Use mok_import_media to attach new source files.');
        Object.assign(ref, loaded);
      }
      m.useEditor.getState().replaceProject(normalized); await ready(); await save(); return { project: project(), output: metadata() };
    },
    async importMedia({ target, shotId }) {
      const p = project();
      const shot = p.shots.find((s) => s.id === shotId);
      if (['screen', 'logo'].includes(target) && !shot) throw new Error('Unknown shot id. Read the project to discover its shots.');
      let before, after;
      if (target === 'screen') {
        if (shot.kind && shot.kind !== 'media') throw new Error('Screen imports require a media shot.');
        before = shot.media?.id;
        await m.actions.importFilesToShot([file()], shotId);
        after = project().shots.find((s) => s.id === shotId)?.media;
      } else if (target === 'logo') {
        if (shot.kind !== 'logo') throw new Error('Logo imports require a logo shot.');
        before = shot.logo?.media?.id; await m.actions.importLogo(file(), shotId);
        after = project().shots.find((s) => s.id === shotId)?.logo?.media;
      } else if (target === 'soundtrack') {
        before = p.audio?.media?.id; await m.actions.addAudioFile(file()); after = project().audio?.media;
      } else if (target === 'background') {
        before = p.scene.background.image?.id; await m.actions.importBackgroundImage(file()); after = project().scene.background.image;
      } else {
        before = p.screen.bg?.image?.id; await m.actions.importScreenBackground(file()); after = project().screen.bg?.image;
      }
      if (!after || after.id === before) throw new Error('Media import failed. Check that the file type is supported for the selected target.');
      await save(); return { media: after, project: project(), output: metadata() };
    },
    async render(options) {
      state.controller = new AbortController(); state.progress = 0; state.phase = 'Preparing';
      const { kind, ...settings } = options;
      if (kind === 'video') {
        const output = await m.capture.exportVideo({ ...settings, signal: state.controller.signal, onProgress: (progress, phase) => { state.progress = progress; state.phase = phase; } });
        state.result = output.blob; state.release = output.cleanup;
        return { ...metadata(), format: output.ext };
      }
      state.result = await m.capture.captureImage({ ...settings, signal: state.controller.signal });
      return { ...metadata(), format: settings.format };
    },
    progress: () => ({ progress: state.progress, phase: state.phase }),
    cancel: () => state.controller.abort(),
    async chunk(offset, size) {
      if (!state.result) throw new Error('No result is available.');
      const bytes = new Uint8Array(await state.result.slice(offset, offset + size).arrayBuffer());
      let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(text);
    },
    async release() { state.result = null; const cleanup = state.release; state.release = null; await cleanup?.(); },
  };
  await ready();
}

export class BrowserAdapter {
  constructor({ appURL, executablePath, softwareGL = false, startupMs = 60_000 }) {
    this.appURL = appURL; this.executablePath = executablePath; this.softwareGL = softwareGL; this.startupMs = startupMs;
    this.browser = null; this.current = null;
  }
  async start() {
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({ headless: true, executablePath: this.executablePath,
        args: this.softwareGL ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [] });
    }
    return this.browser;
  }
  async session(signal, task) {
    check(signal);
    const browser = await this.start(); check(signal);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' });
    this.current = context;
    let forceClose;
    const abort = () => {
      for (const page of context.pages()) void page.evaluate(() => window.__mokAutomation?.cancel()).catch(() => {});
      forceClose ??= setTimeout(() => void context.close().catch(() => {}), 5000);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      check(signal);
      // Only the configured local app origin can receive network requests. No account cookies or profile are loaded.
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return ['blob:', 'data:'].includes(url.protocol) || url.origin === new URL(this.appURL).origin ? route.continue() : route.abort('blockedbyclient');
      });
      await context.addInitScript(() => { localStorage.setItem('mok:toured', '1'); });
      const page = await context.newPage(); page.setDefaultTimeout(this.startupMs);
      await page.goto(this.appURL, { waitUntil: 'domcontentloaded', timeout: this.startupMs });
      if (new URL(page.url()).origin !== new URL(this.appURL).origin) throw new Error('The app redirected away from its configured local origin.');
      await page.waitForFunction(() => window.__mok?.registry?.state && window.__mok?.registry?.composer);
      await page.evaluate(installAdapter); check(signal);
      return await task(page);
    } finally {
      signal.removeEventListener('abort', abort); clearTimeout(forceClose);
      for (const page of context.pages()) await page.evaluate(() => window.__mokAutomation?.release()).catch(() => {});
      await context.close().catch(() => {}); this.current = null;
    }
  }
  async close() { await this.current?.close().catch(() => {}); await this.browser?.close().catch(() => {}); this.browser = null; }
}
