import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { completeRoomInspection, roomRotation } from "../lib/roomRotation";
import { roomChecks, rooms, type RoomEntry } from "../lib/rooms";

function addDays(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

function inspection(room: string, date: string, condition: RoomEntry["condition"] = "bon", partial = false): RoomEntry {
  return {
    type: "createRoomInspection", id: createId(), schemaVersion: 5, room, date,
    inspectedAt: date + "T10:00:00.000Z", actor: "Test rotation", notes: "", occupied: true, condition,
    cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null,
    fridgeCleaning: "propre", bugs: "non", photosData: [],
    checks: roomChecks.map((check, index) => ({ key: check.key, result: partial && index === 0 ? "non_verifie" : "ok" })),
  };
}

test("continuous poor-condition follow-ups cannot consume every tour and starve the other rooms", () => {
  const eligible = rooms.slice(0, 30), bad = new Set(eligible.slice(0, 20)), start = "2026-10-01";
  const history = eligible.map(room => inspection(room, start, bad.has(room) ? "mauvais" : "bon"));
  const hits = new Map(eligible.map(room => [room, [] as number[]]));
  // Twenty poor rooms returning every four days can consume all five slots per
  // day forever under the former unconditional bad-first ordering.
  for (let elapsed = 4; elapsed < 34; elapsed++) {
    const day = addDays(start, elapsed), rotation = roomRotation(history, day, 5, 7, [], eligible);
    assert.ok(rotation.plan.length <= 5);
    assert.equal(new Set(rotation.plan).size, rotation.plan.length);
    for (const room of rotation.plan) {
      hits.get(room)!.push(elapsed);
      history.push(inspection(room, day, bad.has(room) ? "mauvais" : "bon"));
    }
  }
  for (const room of eligible) {
    assert.ok(hits.get(room)!.length >= 2, `Room ${room} must receive repeated coverage despite poor-condition pressure`);
    assert.ok(hits.get(room)![0] < 18, `Room ${room} must not wait indefinitely for its first follow-up`);
  }
});

test("every never-completed room receives a first full control before early repeat visits can monopolize the tour", () => {
  const history: RoomEntry[] = [], seen = new Set<string>(), start = "2026-10-01";
  const goal = 15, rounds = Math.ceil(rooms.length / goal);
  for (let elapsed = 0; elapsed < rounds; elapsed++) {
    const day = addDays(start, elapsed), rotation = roomRotation(history, day, goal, 7);
    const unseenBefore = rooms.filter(room => !seen.has(room));
    for (const room of rotation.plan.slice(0, Math.min(goal, unseenBefore.length))) {
      assert.equal(seen.has(room), false, `Room ${room} repeated before the first coverage was complete`);
      seen.add(room);
      history.push(inspection(room, day, "mauvais"));
    }
  }
  assert.deepEqual([...seen].sort(), [...rooms].sort());
});

test("calendar-day poor follow-ups mature on the fourth day across month, year and daylight-saving boundaries", () => {
  for (const observed of ["2026-01-30", "2026-12-30", "2026-03-27", "2026-10-23"]) {
    const history = [inspection("101", observed, "mauvais")];
    for (let elapsed = 0; elapsed < 4; elapsed++) {
      const before = roomRotation(history, addDays(observed, elapsed), 5, 7, [], ["101"]);
      assert.equal(before.priorityRooms.includes("101"), false, `${observed} + ${elapsed}`);
      assert.equal(before.plan.includes("101"), false);
      assert.equal(before.byRoom.get("101")?.followUpOn, addDays(observed, 4));
    }
    const due = roomRotation(history, addDays(observed, 4), 5, 7, [], ["101"]);
    assert.deepEqual(due.priorityRooms, ["101"]);
    assert.deepEqual(due.plan, ["101"]);
  }
});

test("repeated partial observations never renew complete-control coverage or hide an overdue room", () => {
  const history = [inspection("101", "2026-10-01")];
  for (let elapsed = 0; elapsed < 6; elapsed++) {
    const day = addDays("2026-10-15", elapsed), partial = inspection("101", day, "mauvais", true);
    assert.equal(completeRoomInspection(partial), false);
    history.push(partial);
    const rotation = roomRotation(history, day, 5, 7, [], ["101"]);
    assert.equal(rotation.covered, 0);
    assert.deepEqual(rotation.done, []);
    assert.deepEqual(rotation.plan, ["101"]);
    assert.deepEqual(rotation.priorityRooms, []);
    assert.equal(rotation.latestComplete.get("101")?.date, "2026-10-01");
    assert.equal(rotation.byRoom.get("101")?.regularDueOn, "2026-10-08");
    assert.equal(rotation.byRoom.get("101")?.followUpOn, addDays(day, 4));
  }
});

test("an incomplete poor first visit remains visible for normal coverage while its special priority waits", () => {
  const record = inspection("101", "2026-11-11", "mauvais", true);
  const rotation = roomRotation([record], record.date, 5, 7, [], ["101", "102"]);
  assert.equal(rotation.covered, 0);
  assert.deepEqual(rotation.done, []);
  assert.deepEqual(rotation.neverRooms, ["101", "102"]);
  assert.deepEqual(rotation.priorityRooms, []);
  assert.equal(rotation.byRoom.get("101")?.followUpOn, "2026-11-15");
  assert.deepEqual(rotation.plan, ["101", "102"]);
});

test("daily goal and postponement never remove the remaining due queue", () => {
  const eligible = rooms.slice(0, 12), day = "2026-11-11";
  const completed = inspection(eligible[0], day);
  const postponed = [eligible[1], eligible[2]];
  const rotation = roomRotation([completed], day, 1, 7, postponed, eligible);
  assert.deepEqual(rotation.done, [eligible[0]]);
  assert.deepEqual(rotation.plan, []);
  assert.deepEqual(rotation.due, eligible.slice(1));
  assert.deepEqual(rotation.candidates, eligible.slice(3));
  assert.equal(rotation.next, eligible[3]);
  const tomorrow = roomRotation([completed], addDays(day, 1), 1, 7, [], eligible);
  assert.equal(tomorrow.next, eligible[1]);
  const extended = roomRotation([completed], day, 6, 7, postponed, eligible);
  assert.deepEqual(extended.plan, eligible.slice(3, 8));
  assert.equal(extended.plan.length + extended.done.length, 6);
});
