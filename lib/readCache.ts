/** Bounded, process-local cache. Concurrent readers share one request. */
export class ReadCache<T> {
  private values = new Map<string, { value: T; expires: number; size: number }>();
  private pending = new Map<string, Promise<T>>();
  private size = 0;

  constructor(
    private ttl: number,
    private maxSize: number,
    private sizeOf: (value: T) => number = () => 1,
  ) {}

  clear() {
    this.values.clear();
    this.pending.clear();
    this.size = 0;
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now()) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached.value;
    }
    if (cached) {
      this.size -= cached.size;
      this.values.delete(key);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = Promise.resolve().then(load);
    this.pending.set(key, request);
    try {
      const value = await request;
      // A write may have invalidated this request while it was loading.
      if (this.pending.get(key) !== request) return value;
      const size = this.sizeOf(value);
      if (size <= this.maxSize) {
        while (this.size + size > this.maxSize && this.values.size) {
          const oldest = this.values.keys().next().value!;
          this.size -= this.values.get(oldest)!.size;
          this.values.delete(oldest);
        }
        this.values.set(key, { value, expires: Date.now() + this.ttl, size });
        this.size += size;
      }
      return value;
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
}
