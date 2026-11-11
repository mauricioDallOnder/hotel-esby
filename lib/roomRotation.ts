import { latestRoomRecords, roomChecks, rooms, type RoomEntry, type RoomInspection } from "./rooms";

type Record = RoomEntry | RoomInspection;
export const poorConditionFollowUpDays = 4;
export type RoomRotationDetail = {
  room: string;
  /** Date of the last complete inspection; partial observations never reset it. */
  lastComplete?: string;
  dueOn?: string;
  regularDueOn?: string;
  followUpOn?: string;
  /** The bad-condition follow-up is waiting; a missing full inspection may still be due. */
  waitingUntil?: string;
  reason: "never" | "overdue" | "followup" | "scheduled" | "done";
};
export function daysSince(date: string, day: string) {
  return Math.floor((Date.parse(day + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / 86_400_000);
}

function addCalendarDays(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

export function completeRoomInspection(record: Record) {
  const version = record.schemaVersion ?? 1;
  const required = roomChecks.filter(c => c.key !== "radiator_clear" || version >= 5)
    .filter(c => c.key !== "door_closer" || version >= 4)
    .filter(c => c.key !== "door_handle_clear" || version >= 2);
  return required.every(c => record.checks.some(check => check.key === c.key && check.result !== "non_verifie" &&
    (check.key !== "radiator_clear" || check.result === "ok" || check.result === "probleme"))) &&
    record.microwave !== "non_verifie" && (version < 4 || (typeof record.occupied === "boolean" && !!record.bugs && record.bugs !== "non_verifie"));
}

export function roomRotation(history: Record[], day: string, dailyGoal = 15, intervalDays = 7, deferred: string[] = [], eligibleRooms: readonly string[] = rooms) {
  // Occupancy is resolved by the caller; only these rooms belong to the current tour.
  const selected = new Set(eligibleRooms);
  const eligible = rooms.filter(room => selected.has(room));
  const goal = Math.min(eligible.length, Math.max(1, Math.floor(dailyGoal) || 15));
  const interval = Math.max(1, Math.min(60, Math.floor(intervalDays) || 7));
  const current = history.filter(r => r.date <= day);
  const complete = current.filter(completeRoomInspection);
  const latestComplete = latestRoomRecords(complete);
  // A newer partial visit can report deterioration or improvement without completing the rotation.
  const latest = latestRoomRecords(current);
  const completedToday = new Set(complete.filter(record => record.date === day).map(record => record.room));
  const done = eligible.filter(room => completedToday.has(room));
  const byRoom = new Map<string, RoomRotationDetail>(eligible.map(room => {
    const lastComplete = latestComplete.get(room)?.date;
    const observation = latest.get(room);
    const regularDueOn = lastComplete ? addCalendarDays(lastComplete, interval) : undefined;
    const followUpOn = observation?.condition === "mauvais" ? addCalendarDays(observation.date, poorConditionFollowUpDays) : undefined;
    const dueOn = regularDueOn && followUpOn ? (regularDueOn < followUpOn ? regularDueOn : followUpOn) : regularDueOn;
    const waitingUntil = followUpOn && followUpOn > day ? followUpOn : undefined;
    const reason: RoomRotationDetail["reason"] = completedToday.has(room) ? "done" : !lastComplete ? "never"
      : regularDueOn! <= day ? "overdue" : followUpOn && followUpOn <= day ? "followup" : "scheduled";
    return [room, { room, lastComplete, dueOn, regularDueOn, followUpOn, waitingUntil, reason }];
  }));
  const priorityRooms = eligible.filter(room => {
    const followUpOn = byRoom.get(room)!.followUpOn;
    return !!followUpOn && followUpOn <= day && !completedToday.has(room);
  });
  const priority = new Set(priorityRooms);
  const neverRooms = eligible.filter(room => byRoom.get(room)!.reason === "never");
  const overdueRooms = eligible.filter(room => byRoom.get(room)!.reason === "overdue");
  const waitingPoorRooms = eligible.filter(room => !!byRoom.get(room)!.waitingUntil);
  const due = eligible.filter(room => ["never", "overdue", "followup"].includes(byRoom.get(room)!.reason))
    .sort((a, b) => {
      const left = byRoom.get(a)!, right = byRoom.get(b)!;
      // Each completed room receives a new deadline. An older outstanding
      // deadline therefore cannot be overtaken forever by recurring follow-ups.
      return Number(!!left.lastComplete) - Number(!!right.lastComplete) ||
        (left.dueOn || "").localeCompare(right.dueOn || "") ||
        Number(priority.has(b)) - Number(priority.has(a)) ||
        (left.lastComplete || "").localeCompare(right.lastComplete || "") || Number(a) - Number(b);
    });
  const deferredRooms = new Set(deferred);
  const candidates = due.filter(room => !deferredRooms.has(room));
  // Coverage is based only on complete inspections, independent of bad-state follow-ups.
  const covered = eligible.filter(room => latestComplete.has(room) && daysSince(latestComplete.get(room)!.date, day) < interval).length;
  const poorCount = eligible.filter(room => latest.get(room)?.condition === "mauvais").length;
  const suggestedGoal = Math.max(0, Math.ceil(poorCount / Math.min(interval, poorConditionFollowUpDays) + (eligible.length - poorCount) / interval - 1e-9));
  return { total: eligible.length, goal, interval, done, due, covered, priorityRooms,
    candidates, latestComplete, byRoom, waitingPoorRooms, neverRooms, overdueRooms, suggestedGoal,
    plan: candidates.slice(0, Math.max(0, goal - done.length)),
    next: candidates[0], cycleWorkDays: goal ? Math.ceil(eligible.length / goal) : 0 };
}
