import { rooms, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "./rooms";
import { latestWork, roomAvailability } from "./work";

export type RoomAvailabilityState = ReturnType<typeof roomAvailability>;

export function roomAvailabilityCounts(states: ReadonlyMap<string, RoomAvailabilityState>, selectedRooms: readonly string[] = rooms) {
  const counts = { all: selectedRooms.length, occupied: 0, free: 0, works: 0, unknown: 0 };
  for (const room of selectedRooms) {
    const state = states.get(room);
    if (state?.free === undefined) counts.unknown++;
    else if (!state.free) counts.occupied++;
    else if (state.vacancyReason === "works") counts.works++;
    else counts.free++;
  }
  return counts;
}

/** Index shared history once while retaining the canonical availability rule. */
export function roomAvailabilityView(events: (WorkEntry | WorkEvent)[], observations: ReadonlyMap<string, RoomEntry | RoomInspection>) {
  const manual = latestWork(events, "roomAvailability");
  return new Map(rooms.map(room => {
    const source = manual.get(room);
    return [room, roomAvailability(room, source ? [source] : [], observations.get(room))];
  }));
}
