import type { Entry } from "./rooms";

export type PendingEntry = {
  entry: Entry; protocol?: 2; attempted?: boolean; queuedAt?: number; error?: string; blocked?: boolean;
  blockedReason?: "conflict" | "dependency" | "legacy" | "validation";
  blockedBy?: string;
};

// A family must exist before its comments; offline revisions must reach the
// server in order, even though IndexedDB enumerates UUID keys alphabetically.
export function comparePendingEntries(a: PendingEntry, b: PendingEntry) {
  return Number(a.entry.type === "createWorkEvent") - Number(b.entry.type === "createWorkEvent") ||
    (a.entry.type === "createWorkEvent" && b.entry.type === "createWorkEvent" ? a.entry.expectedRevision - b.entry.expectedRevision : 0) ||
    (a.queuedAt || 0) - (b.queuedAt || 0);
}

export function sameWorkTarget(a: Entry, b: Entry) {
  return a.type === "createWorkEvent" && b.type === "createWorkEvent" && a.kind === b.kind && a.targetId === b.targetId;
}

export function dependsOnEntry(entry: Entry, previous: Entry) {
  if (entry.id === previous.id || entry.type !== "createWorkEvent") return false;
  if (previous.type === "createWorkEvent" && sameWorkTarget(entry, previous))
    return entry.expectedPreviousEventId === previous.id || entry.expectedRevision > previous.expectedRevision;
  if (previous.type === "createFamilyEvent") return entry.kind === "familyComment" && entry.familyEventId === previous.id;
  return previous.type === "createRoomInspection" && entry.kind === "cafardFollowup" && entry.cafardObservationId === previous.id;
}

/** Persist the whole refused branch before sending anything else. A later
 * request must stay held even after its predecessor is explicitly discarded. */
export function blockPendingBranch(items: readonly PendingEntry[], refused: PendingEntry, reason: PendingEntry["blockedReason"] = "conflict") {
  const blocked = new Map<string, PendingEntry>([[refused.entry.id, { ...refused, blocked: true, blockedReason: reason }]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (blocked.has(item.entry.id)) continue;
      const ancestor = [...blocked.values()].find(value => dependsOnEntry(item.entry, value.entry));
      if (!ancestor) continue;
      blocked.set(item.entry.id, { ...item, blocked: true, blockedReason: "dependency", blockedBy: refused.entry.id,
        error: "Une demande précédente de ce suivi n’a pas été confirmée. Vérifiez cette suite de modifications avant de la reprendre." });
      changed = true;
    }
  }
  return [...blocked.values()];
}

/** Old immutable payloads are never rewritten to invent a predecessor/hash. */
export function pendingRequiresLegacyReview(item: PendingEntry) {
  return item.entry.type === "createWorkEvent" && item.entry.expectedRevision > 0 && item.entry.expectedPreviousEventId === undefined;
}

export function pendingBlocker(entry: Entry, items: readonly PendingEntry[]) {
  return items.find(item => item.blocked && item.entry.id !== entry.id &&
    (sameWorkTarget(entry, item.entry) || dependsOnEntry(entry, item.entry)));
}

export function isPermanentEntryFailure(status: number) {
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}
