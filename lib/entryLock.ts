// Web Locks serialize send/cancel across tabs. The fallback also serializes
// operations in browsers opened on an insecure local-network HTTP origin.
let tail: Promise<unknown> = Promise.resolve();
export async function withEntryLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("hotel-entry-queue", operation);
  const next = tail.catch(() => {}).then(operation);
  tail = next;
  return next;
}
