import { rooms, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "./rooms";
import { latestWork, roomAvailability } from "./work";

export type RoomAvailabilityState = ReturnType<typeof roomAvailability>;

/** Index shared history once while retaining the canonical availability rule. */
export function roomAvailabilityView(events: (WorkEntry | WorkEvent)[], observations: ReadonlyMap<string, RoomEntry | RoomInspection>) {
  const manual = latestWork(events, "roomAvailability");
  return new Map(rooms.map(room => {
    const source = manual.get(room);
    return [room, roomAvailability(room, source ? [source] : [], observations.get(room))];
  }));
}
