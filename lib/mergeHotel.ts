import type { State } from "./domain";
// A slow full read may finish after a successful queued save. New records are
// immutable, so preserve receipts already received while refreshing older data.
export function mergeHotel<T extends State & { mode: string }>(current: T, incoming: T): T {
  if (current.mode !== incoming.mode) return incoming;
  const merge = <R extends { id: string }>(old: R[] = [], fresh: R[] = []) =>
    [...new Map([...old, ...fresh].map(record => [record.id, record])).values()];
  return { ...incoming,
    familyEvents: merge(current.familyEvents, incoming.familyEvents),
    roomInspections: merge(current.roomInspections, incoming.roomInspections),
  };
}
