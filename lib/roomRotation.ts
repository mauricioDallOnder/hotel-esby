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
  /** Safety follow-up is independent of completed inspection coverage. */
  fireRisk?: true;
  reason: "fire" | "never" | "overdue" | "followup" | "scheduled" | "done";
};
export function daysSince(date: string, day: string) {
  return Math.floor((Date.parse(day + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / 86_400_000);
}

function addCalendarDays(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

export function completeRoomInspection(record: Record) {
  const version = record.schemaVersion ?? 1;
  const required = roomChecks.filter(c => c.key !== "room_clutter" || version >= 6)
    .filter(c => c.key !== "radiator_clear" || version >= 5)
    .filter(c => c.key !== "door_closer" || version >= 4)
    .filter(c => c.key !== "door_handle_clear" || version >= 2);
  return required.every(c => record.checks.some(check => check.key === c.key && check.result !== "non_verifie" &&
    (!["radiator_clear", "room_clutter"].includes(check.key) || check.result === "ok" || check.result === "probleme"))) &&
    record.microwave !== "non_verifie" && (version < 4 || (typeof record.occupied === "boolean" && !!record.bugs && record.bugs !== "non_verifie"));
}

/** Only a newer explicit Libre assessment can clear a radiator obstruction.
 * Missing/unchecked/legacy answers and future controls are not safety evidence.
 * On an exact chronological tie, keep the hazardous assessment first rather
 * than allowing input order to silently clear the risk. No history is mutated. */
export function radiatorFireRiskRooms(history: Record[], day: string): Set<string> {
  const obstructed = (record: Record) => record.checks.some(check => check.key === "radiator_clear" && check.result === "probleme");
  const assessed = history.filter(record => record.date <= day && record.checks.some(check =>
    check.key === "radiator_clear" && (check.result === "ok" || check.result === "probleme")))
    .sort((a, b) => Number(obstructed(b)) - Number(obstructed(a)));
  return new Set([...latestRoomRecords(assessed)].filter(([, record]) => obstructed(record)).map(([room]) => room));
}

export function roomRotation(history: Record[], day: string, dailyGoal = 15, intervalDays = 7, deferred: string[] = [], eligibleRooms: readonly string[] = rooms) {
  // Occupancy is resolved by the caller, including any explicit safety exceptions.
  const selected = new Set(eligibleRooms);
  const eligible = rooms.filter(room => selected.has(room));
  const goal = Math.min(eligible.length, Math.max(1, Math.floor(dailyGoal) || 15));
  const interval = Math.max(1, Math.min(60, Math.floor(intervalDays) || 7));
  const current = history.filter(r => r.date <= day);
  const complete = current.filter(completeRoomInspection);
  const latestComplete = latestRoomRecords(complete);
  // A newer partial visit can report deterioration or improvement without completing the rotation.
  const latest = latestRoomRecords(current);
  const fireRisk = radiatorFireRiskRooms(current, day);
  const fireRiskRooms = eligible.filter(room => fireRisk.has(room));
  const completedToday = new Set(complete.filter(record => record.date === day).map(record => record.room));
  const done = eligible.filter(room => completedToday.has(room));
  const byRoom = new Map<string, RoomRotationDetail>(eligible.map(room => {
    const lastComplete = latestComplete.get(room)?.date;
    const observation = latest.get(room);
    const regularDueOn = lastComplete ? addCalendarDays(lastComplete, interval) : undefined;
    const followUpOn = observation?.condition === "mauvais" ? addCalendarDays(observation.date, poorConditionFollowUpDays) : undefined;
    const unsafe = fireRisk.has(room);
    const dueOn = unsafe ? day : regularDueOn && followUpOn ? (regularDueOn < followUpOn ? regularDueOn : followUpOn) : regularDueOn;
    const waitingUntil = followUpOn && followUpOn > day ? followUpOn : undefined;
    const reason: RoomRotationDetail["reason"] = unsafe ? "fire" : completedToday.has(room) ? "done" : !lastComplete ? "never"
      : regularDueOn! <= day ? "overdue" : followUpOn && followUpOn <= day ? "followup" : "scheduled";
    return [room, { room, lastComplete, dueOn, regularDueOn, followUpOn, waitingUntil,
      ...(unsafe ? { fireRisk: true as const } : {}), reason }];
  }));
  const priorityRooms = eligible.filter(room => {
    const followUpOn = byRoom.get(room)!.followUpOn;
    return fireRisk.has(room) || !!followUpOn && followUpOn <= day && !completedToday.has(room);
  });
  const priority = new Set(priorityRooms);
  const neverRooms = eligible.filter(room => byRoom.get(room)!.reason === "never");
  const overdueRooms = eligible.filter(room => byRoom.get(room)!.reason === "overdue");
  const waitingPoorRooms = eligible.filter(room => !fireRisk.has(room) && !!byRoom.get(room)!.waitingUntil);
  const due = eligible.filter(room => ["fire", "never", "overdue", "followup"].includes(byRoom.get(room)!.reason))
    .sort((a, b) => {
      const left = byRoom.get(a)!, right = byRoom.get(b)!;
      // Fire safety precedes routine coverage, including never-completed rooms.
      // Otherwise preserve fair ordering by the oldest outstanding deadline.
      return Number(fireRisk.has(b)) - Number(fireRisk.has(a)) ||
        Number(!!left.lastComplete) - Number(!!right.lastComplete) ||
        (left.dueOn || "").localeCompare(right.dueOn || "") ||
        Number(priority.has(b)) - Number(priority.has(a)) ||
        (left.lastComplete || "").localeCompare(right.lastComplete || "") || Number(a) - Number(b);
    });
  const deferredRooms = new Set(deferred);
  // Neither a previous postponement nor today's completed control hides a risk.
  const candidates = due.filter(room => fireRisk.has(room) || !deferredRooms.has(room));
  const urgent = candidates.filter(room => fireRisk.has(room));
  const routineSlots = Math.max(0, goal - done.length - urgent.filter(room => !completedToday.has(room)).length);
  // Include every safety check even beyond the usual goal, without changing the user's setting.
  const plan = [...urgent, ...candidates.filter(room => !fireRisk.has(room)).slice(0, routineSlots)];
  // Coverage is based only on complete inspections, independent of safety and bad-state follow-ups.
  const covered = eligible.filter(room => latestComplete.has(room) && daysSince(latestComplete.get(room)!.date, day) < interval).length;
  const poorCount = eligible.filter(room => latest.get(room)?.condition === "mauvais").length;
  const suggestedGoal = Math.max(0, Math.ceil(poorCount / Math.min(interval, poorConditionFollowUpDays) + (eligible.length - poorCount) / interval - 1e-9));
  return { total: eligible.length, goal, interval, done, due, covered, priorityRooms, fireRiskRooms,
    candidates, latestComplete, byRoom, waitingPoorRooms, neverRooms, overdueRooms, suggestedGoal,
    plan, next: candidates[0], cycleWorkDays: goal ? Math.ceil(eligible.length / goal) : 0 };
}
