"use client";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import type { WorkEntry } from "./rooms";

export function useWorkEvents() {
  const { workEvents = [], role } = useAppContext();
  const { pending, enqueue } = useEntries();
  const queued = pending.filter(p => p.entry.type === "createWorkEvent");
  const accepted = queued.filter(p => !p.blocked).map(p => p.entry as WorkEntry);
  const events = [...workEvents.filter(e => !accepted.some(p => p.id === e.id)), ...accepted];
  return { events, queued, enqueue, actor: role === "direction" ? "Direction" : "Employé", isPending: (id?: string) => !!id && queued.some(p => p.entry.id === id) };
}
