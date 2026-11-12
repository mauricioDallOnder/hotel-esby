type Mutation = { type: "put"; value: unknown } | { type: "delete" };
type Waiter = { resolve: () => void; reject: (error: unknown) => void };
type Job = { mutation: Mutation; waiters: Waiter[] };
export type DraftWriteStatus = Readonly<{ saving: boolean; error: string }>;
const idle: DraftWriteStatus = { saving: false, error: "" };
type Bucket = {
  jobs: Job[];
  status: DraftWriteStatus;
  done: Promise<void>;
  finish: () => void;
  failure?: unknown;
};

/** Keep one active write per draft, replacing only versions not yet started. */
export class DeviceDraftWrites {
  private buckets = new Map<string, Bucket>();
  private listeners = new Map<string, Set<() => void>>();

  constructor(
    private put: (key: string, value: unknown) => Promise<unknown>,
    private remove: (key: string) => Promise<unknown>,
  ) {}

  status(key: string): DraftWriteStatus { return this.buckets.get(key)?.status || idle; }

  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) || new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }

  private notify(key: string) { this.listeners.get(key)?.forEach(listener => listener()); }

  save(key: string, value: unknown) { return this.schedule(key, { type: "put", value }); }
  clear(key: string) { return this.schedule(key, { type: "delete" }); }

  private schedule(key: string, mutation: Mutation): Promise<void> {
    let bucket = this.buckets.get(key);
    const start = !bucket?.status.saving;
    if (start) {
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      bucket = { jobs: [], status: { saving: true, error: "" }, done, finish };
      this.buckets.set(key, bucket);
    }
    const current = bucket!;
    const promise = new Promise<void>((resolve, reject) => {
      const tail = current.jobs.at(-1);
      // Deletes form a barrier: a new draft written after a clear must survive it.
      if (mutation.type === "put" && tail?.mutation.type === "put") {
        tail.mutation = mutation;
        tail.waiters.push({ resolve, reject });
      } else current.jobs.push({ mutation, waiters: [{ resolve, reject }] });
    });
    if (start) {
      this.notify(key);
      queueMicrotask(() => { void this.drain(key, current); });
    }
    return promise;
  }

  private async drain(key: string, bucket: Bucket) {
    while (bucket.jobs.length) {
      const job = bucket.jobs.shift()!;
      try {
        if (job.mutation.type === "put") await this.put(key, job.mutation.value);
        else await this.remove(key);
        bucket.failure = undefined;
        job.waiters.forEach(waiter => waiter.resolve());
      } catch (error) {
        bucket.failure = error;
        job.waiters.forEach(waiter => waiter.reject(error));
      }
    }
    if (bucket.failure) bucket.status = { saving: false, error: bucket.failure instanceof Error ? bucket.failure.message : "Impossible de conserver le brouillon sur cet appareil." };
    else this.buckets.delete(key);
    bucket.finish();
    this.notify(key);
  }

  /** A reopening must read after all preceding writes, including another mount. */
  async wait(key: string) {
    while (this.buckets.get(key)?.status.saving) await this.buckets.get(key)!.done;
  }

  async flush() {
    for (;;) {
      const active = [...this.buckets.values()].filter(bucket => bucket.status.saving);
      if (!active.length) break;
      await Promise.all(active.map(bucket => bucket.done));
    }
    const failed = [...this.buckets.values()].find(bucket => bucket.failure);
    if (failed) throw failed.failure;
  }
}
