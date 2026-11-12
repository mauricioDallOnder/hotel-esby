"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deviceStore } from "./deviceStore";
import { DeviceDraftWrites } from "./deviceDraftWrites";

const draftWrites = new DeviceDraftWrites(
  (key, value) => deviceStore("put", key, value),
  key => deviceStore("delete", key),
);
export async function flushDeviceDrafts() {
  await draftWrites.flush();
}

export function useDeviceDraft<T>(key: string, initial: () => T, normalize: (value: T) => T = value => value, legacyKeys: string[] = []) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState("");
  const subscribe = useCallback((listener: () => void) => draftWrites.subscribe(key, listener), [key]);
  const getStatus = useCallback(() => draftWrites.status(key), [key]);
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);
  const initialRef = useRef(initial);
  const normalizeRef = useRef(normalize);
  const legacyKeysRef = useRef(legacyKeys);
  useEffect(() => {
    let active = true;
    const read = async () => {
      await draftWrites.wait(key);
      const current = await deviceStore<T | undefined>("get", key);
      if (current !== undefined) return current;
      for (const previousKey of legacyKeysRef.current) {
        const previous = await deviceStore<T | undefined>("get", previousKey);
        if (previous === undefined) continue;
        // Keep the original until an explicit save/clear, and make the recovered
        // draft accessible even if the server revision changes before reopening.
        try { await draftWrites.save(key, previous); }
        catch (e) { if (active) setError((e as Error).message); }
        return previous;
      }
      return undefined;
    };
    void read().then(draft => {
      if (active) setValue(normalizeRef.current(draft || initialRef.current()));
    }).catch(e => { if (active) { setError(e.message); setValue(initialRef.current()); } });
    return () => { active = false; };
  }, [key]);
  function update(next: T) {
    setValue(next);
    // Status belongs to the shared queue: an older completion cannot announce
    // success while the latest typed version is still waiting to be written.
    void draftWrites.save(key, next).then(() => setError("")).catch(() => {});
  }
  async function clear() {
    await draftWrites.clear(key);
    for (const previousKey of legacyKeysRef.current) await draftWrites.clear(previousKey);
    setError("");
    setValue(initialRef.current());
  }
  return { value, update, clear, error: status.error || error, saving: status.saving };
}
