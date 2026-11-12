import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { rooms, type RoomEntry, type WorkEntry } from "../lib/rooms";
import { roomAvailabilityView } from "../lib/roomAvailabilityView";
import { roomAvailability } from "../lib/work";

test("one availability index preserves every room's canonical manual and inspection fallback", () => {
  const first: WorkEntry = { type: "createWorkEvent", kind: "roomAvailability", id: createId(), targetId: "101", room: "101", expectedRevision: 0, expectedPreviousEventId: null, free: true, actor: "Test", notes: "", date: "2026-11-10", occurredAt: "2026-11-10T09:00:00.000Z" };
  const latest: WorkEntry = { ...first, id: createId(), expectedRevision: 1, expectedPreviousEventId: first.id, free: false };
  const unrelated: WorkEntry = { ...first, id: createId(), kind: "dailyTask", targetId: createId(), room: "", free: undefined, done: false };
  const events = [first, unrelated, latest];
  const observations = new Map<string, RoomEntry>([["101", { occupied: false } as RoomEntry], ["102", { occupied: true } as RoomEntry]]);
  const indexed = roomAvailabilityView(events, observations);
  assert.equal(indexed.size, rooms.length);
  for (const room of rooms) assert.deepEqual(indexed.get(room), roomAvailability(room, events, observations.get(room)));
  assert.equal(indexed.get("101")!.source!.id, latest.id);
  assert.equal(indexed.get("102")!.free, false);
  assert.equal(indexed.get("103")!.free, undefined);
});
