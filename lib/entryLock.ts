// Web Locks serialize send/cancel across tabs. The fallback also serializes
// operations in browsers opened on an insecure local-network HTTP origin.
const tails = new Map<string, Promise<unknown>>();
async function withLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(name, operation);
  const next = (tails.get(name) || Promise.resolve()).catch(() => {}).then(operation);
  tails.set(name, next);
  return next;
}
export function withEntryLock<T>(operation: () => Promise<T>): Promise<T> {
  return withLock("hotel-entry-queue", operation);
}
// Persisting another entry must not wait for a slow network send. Entries in the
// queue are immutable, so concurrent insertion of distinct IDs is safe.
export function withEntryWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  return withLock("hotel-entry-writes", operation);
}
