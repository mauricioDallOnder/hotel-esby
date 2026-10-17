import type { Entry } from "./rooms";

export type PendingEntry = { entry: Entry; protocol?: 2; attempted?: boolean; queuedAt?: number; error?: string; blocked?: boolean };

// A family must exist before its comments; offline revisions must reach the
// server in order, even though IndexedDB enumerates UUID keys alphabetically.
export function comparePendingEntries(a: PendingEntry, b: PendingEntry) {
  return Number(a.entry.type === "createWorkEvent") - Number(b.entry.type === "createWorkEvent") ||
    (a.entry.type === "createWorkEvent" && b.entry.type === "createWorkEvent" ? a.entry.expectedRevision - b.entry.expectedRevision : 0) ||
    (a.queuedAt || 0) - (b.queuedAt || 0);
}
