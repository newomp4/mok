import { randomUUID } from 'node:crypto';

export function cancelled() { return new DOMException('Automation job cancelled', 'AbortError'); }
export function check(signal) { if (signal?.aborted) throw cancelled(); }

/** One browser/renderer operation at a time. Completed metadata is bounded, never media bytes. */
export class Jobs {
  constructor({ maxQueued = 8, maxHistory = 100, timeoutMs = 30 * 60_000 } = {}) {
    this.maxQueued = maxQueued; this.maxHistory = maxHistory; this.timeoutMs = timeoutMs;
    this.entries = new Map(); this.queue = []; this.running = null; this.closed = false;
  }
  enqueue(kind, task, requestSignal) {
    check(requestSignal);
    if (this.closed) throw new Error('Automation server is closing.');
    if (this.queue.length >= this.maxQueued) throw new Error('Automation queue is full. Wait for a job to finish.');
    let resolve, reject;
    const done = new Promise((yes, no) => { resolve = yes; reject = no; });
    void done.catch(() => {});
    const entry = { id: randomUUID(), kind, state: 'queued', createdAt: new Date().toISOString(), progress: 0, phase: 'Queued', controller: new AbortController(), task, resolve, reject, done };
    const abort = () => this.cancel(entry.id);
    requestSignal?.addEventListener('abort', abort, { once: true });
    entry.detach = () => requestSignal?.removeEventListener('abort', abort);
    this.entries.set(entry.id, entry); this.queue.push(entry); void this.pump();
    return entry;
  }
  snapshot(id) {
    const entry = this.entries.get(id); if (!entry) throw new Error('Unknown or expired job id.');
    const { kind, state, createdAt, startedAt, finishedAt, progress, phase, result, error } = entry;
    return { id, kind, state, createdAt, startedAt, finishedAt, progress, phase, result, error };
  }
  cancel(id) {
    const entry = this.entries.get(id); if (!entry) throw new Error('Unknown or expired job id.');
    if (['succeeded', 'failed', 'cancelled'].includes(entry.state)) return this.snapshot(id);
    entry.controller.abort(); entry.phase = 'Cancelling';
    if (entry.state === 'queued') {
      this.queue = this.queue.filter((item) => item !== entry); this.finish(entry, 'cancelled', cancelled());
    }
    return this.snapshot(id);
  }
  finish(entry, state, error) {
    entry.state = state; entry.finishedAt = new Date().toISOString(); entry.detach();
    if (error) { entry.error = error.message ?? String(error); entry.reject(error); }
    else { entry.progress = 1; entry.phase = 'Complete'; entry.resolve(entry.result); }
    delete entry.task;
    for (const [id, old] of this.entries) {
      if (this.entries.size <= this.maxHistory) break;
      if (old.finishedAt) this.entries.delete(id);
    }
  }
  async pump() {
    if (this.running || !this.queue.length) return;
    const entry = this.queue.shift(); this.running = entry;
    entry.state = 'running'; entry.startedAt = new Date().toISOString(); entry.phase = 'Starting';
    const timer = setTimeout(() => { entry.phase = 'Timed out'; entry.controller.abort(); }, this.timeoutMs);
    try {
      entry.result = await entry.task(entry.controller.signal, (progress, phase) => {
        entry.progress = Math.max(0, Math.min(1, progress)); entry.phase = String(phase).slice(0, 256);
      });
      check(entry.controller.signal); this.finish(entry, 'succeeded');
    } catch (error) { this.finish(entry, entry.controller.signal.aborted ? 'cancelled' : 'failed', error); }
    finally { clearTimeout(timer); this.running = null; void this.pump(); }
  }
  async close() {
    this.closed = true;
    for (const entry of this.entries.values()) if (!entry.finishedAt) this.cancel(entry.id);
    await this.running?.done.catch(() => {});
  }
}
