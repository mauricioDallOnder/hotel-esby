import type { State } from "./domain";

function mergeRecords<R extends { id: string; version?: number }>(old: R[] = [], fresh: R[] = []): R[] {
  if (old === fresh) return old;
  const records = new Map(old.map(record => [record.id, record]));
  for (const record of fresh) {
    const previous = records.get(record.id);
    // A background read can finish after a save. Never bring a resolved issue
    // or a more recent inspection back to its older version.
    if (previous && (previous.version || 0) > (record.version || 0)) continue;
    records.set(record.id, previous && JSON.stringify(previous) === JSON.stringify(record) ? previous : record);
  }
  const merged = [...records.values()];
  // Stable references avoid recomputing every room card and rewriting the
  // device snapshot when a periodic refresh contains no changes.
  return merged.length === old.length && merged.every((record, index) => record === old[index]) ? old : merged;
}

// Receipts can arrive during a full read. All collections retain those records;
// absence deletions are authoritative and continue to use their tombstones.
export function mergeHotel<T extends State & { mode: string }>(current: T, incoming: T): T {
  if (current.mode !== incoming.mode) return incoming;
  const deleted = [...new Set([...(current.deletedFamilyEventIds || []), ...(incoming.deletedFamilyEventIds || [])])];
  const deletedFamilyEventIds = current.deletedFamilyEventIds?.length === deleted.length &&
    deleted.every((id, index) => id === current.deletedFamilyEventIds![index]) ? current.deletedFamilyEventIds : deleted;
  const allFamilies = mergeRecords(current.familyEvents, incoming.familyEvents);
  const deletedIds = new Set(deletedFamilyEventIds);
  const familyEvents = allFamilies.some(record => deletedIds.has(record.id))
    ? allFamilies.filter(record => !deletedIds.has(record.id)) : allFamilies;
  const merged = { ...incoming,
    issues: mergeRecords(current.issues, incoming.issues),
    inspections: mergeRecords(current.inspections, incoming.inspections),
    deletedFamilyEventIds,
    familyEvents,
    workEvents: mergeRecords(current.workEvents, incoming.workEvents),
    roomInspections: mergeRecords(current.roomInspections, incoming.roomInspections),
  };
  return Object.keys(merged).every(key => merged[key as keyof T] === current[key as keyof T]) ? current : merged;
}
