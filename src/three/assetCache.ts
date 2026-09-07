/** Bounded cache with explicit leases: an active or staging consumer can never be evicted. */
export class AssetCache<T> {
  private entries = new Map<string, { value: T; refs: number; used: number }>();
  private clock = 0;
  constructor(readonly capacity: number, private dispose: (value: T, key: string) => void) {}
  get size() { return this.entries.size; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry) entry.used = ++this.clock;
    return entry?.value;
  }
  put(key: string, value: T): void {
    const entry = this.entries.get(key);
    if (entry) { if (entry.value !== value) throw new Error(`Cannot replace owned asset ${key}`); entry.used = ++this.clock; return; }
    this.entries.set(key, { value, refs: 0, used: ++this.clock });
  }
  retain(key: string): () => void {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`Cannot retain missing asset ${key}`);
    entry.refs++; entry.used = ++this.clock;
    let released = false;
    return () => { if (released) return; released = true; entry.refs--; this.trim(); };
  }
  forget(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.refs) return false;
    this.entries.delete(key); this.dispose(entry.value, key); return true;
  }
  trim(): void {
    const unused = [...this.entries].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].used - b[1].used);
    while (this.entries.size > this.capacity && unused.length) {
      const [key, entry] = unused.shift()!;
      this.entries.delete(key); this.dispose(entry.value, key);
    }
  }
}
