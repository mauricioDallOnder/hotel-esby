"use client";
import { useCallback, useMemo } from "react";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import type { WorkEntry, WorkEvent } from "./rooms";

const emptyEvents: WorkEvent[] = [];

export function useWorkEvents() {
  const { workEvents = emptyEvents, role } = useAppContext();
  const { pending, enqueue } = useEntries();
  const queued = useMemo(() => pending.filter(p => p.entry.type === "createWorkEvent"), [pending]);
  const events = useMemo(() => {
    const accepted = queued.filter(p => !p.blocked).map(p => p.entry as WorkEntry);
    if (!accepted.length) return workEvents;
    const pendingIds = new Set(accepted.map(event => event.id));
    return [...workEvents.filter(event => !pendingIds.has(event.id)), ...accepted];
  }, [workEvents, queued]);
  const isPending = useCallback((id?: string) => !!id && queued.some(p => p.entry.id === id), [queued]);
  return { events, queued, enqueue, actor: role === "direction" ? "Direction" : "Employé", isPending };
}
