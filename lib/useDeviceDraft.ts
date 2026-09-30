"use client";
import { useEffect, useRef, useState } from "react";
import { deviceStore } from "./deviceStore";

const draftWrites = new Map<string, Promise<unknown>>();
export async function flushDeviceDrafts() {
  await Promise.all(draftWrites.values());
}

export function useDeviceDraft<T>(key: string, initial: () => T, normalize: (value: T) => T = value => value) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const initialRef = useRef(initial);
  const normalizeRef = useRef(normalize);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    void deviceStore<T | undefined>("get", key).then(draft => {
      if (active) setValue(normalizeRef.current(draft || initialRef.current()));
    }).catch(e => { if (active) { setError(e.message); setValue(initialRef.current()); } });
    return () => { active = false; };
  }, [key]);
  function update(next: T) {
    setValue(next);
    setSaving(true);
    writes.current = writes.current.catch(() => {}).then(() => deviceStore("put", key, next));
    draftWrites.set(key, writes.current);
    void writes.current.then(() => { setError(""); setSaving(false); }).catch(e => { setError(e.message); setSaving(false); });
  }
  async function clear() {
    await writes.current.catch(() => {});
    await deviceStore("delete", key);
    setValue(initialRef.current());
  }
  return { value, update, clear, error, saving };
}
