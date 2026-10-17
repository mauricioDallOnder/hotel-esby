import { latestRoomRecords, roomChecks, rooms, type RoomEntry, type RoomInspection } from "./rooms";

type Record = RoomEntry | RoomInspection;
export function daysSince(date: string, day: string) {
  return Math.floor((Date.parse(day + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / 86_400_000);
}

export function completeRoomInspection(record: Record) {
  const required = roomChecks.filter(c => c.key !== "door_closer" || record.schemaVersion === 4)
    .filter(c => c.key !== "door_handle_clear" || !!record.schemaVersion);
  return required.every(c => record.checks.some(check => check.key === c.key && check.result !== "non_verifie")) &&
    record.microwave !== "non_verifie" && (record.schemaVersion !== 4 || (typeof record.occupied === "boolean" && !!record.bugs && record.bugs !== "non_verifie"));
}

export function roomRotation(history: Record[], day: string, dailyGoal = 15, intervalDays = 7, deferred: string[] = []) {
  const goal = Math.max(1, Math.min(rooms.length, Math.floor(dailyGoal) || 15));
  const interval = Math.max(1, Math.min(60, Math.floor(intervalDays) || 7));
  const complete = history.filter(r => r.date <= day && completeRoomInspection(r));
  const latest = latestRoomRecords(complete);
  const done = rooms.filter(room => complete.some(r => r.room === room && r.date === day));
  const due = rooms.filter(room => !latest.has(room) || daysSince(latest.get(room)!.date, day) >= interval)
    .sort((a, b) => (latest.get(a)?.date || "").localeCompare(latest.get(b)?.date || "") || Number(a) - Number(b));
  // Oldest first prevents starvation. Equal dates keep neighbouring rooms together.
  const candidates = due.filter(room => !done.includes(room) && !deferred.includes(room));
  return { goal, interval, done, due, covered: rooms.length - due.length,
    plan: candidates.slice(0, Math.max(0, goal - done.length)),
    next: candidates[0], cycleWorkDays: Math.ceil(rooms.length / goal) };
}
