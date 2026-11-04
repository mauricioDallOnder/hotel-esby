import type { PendingEntry } from "./entryQueue";
import { latestRoomRecords, type RoomEntry, type RoomInspection } from "./rooms";

// Only accepted observations describe the current room; blocked submissions stay in the sync panel.
export function roomObservations(saved: RoomInspection[], pending: PendingEntry[], day: string) {
  const queued = pending.flatMap(item => item.entry.type === "createRoomInspection" && !item.blocked && item.entry.date <= day ? [item.entry] : []);
  const records = new Map<string, RoomEntry | RoomInspection>(saved.filter(record => record.date <= day).map(record => [record.id, record]));
  queued.forEach(record => records.set(record.id, record));
  const history = [...records.values()];
  return { history, latest: latestRoomRecords(history), pendingIds: new Set(queued.map(record => record.id)) };
}
