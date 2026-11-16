import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { roomChecks, rooms, type RoomEntry, type RoomInspection, type WorkEntry } from "../lib/rooms";
import { radiatorFireRiskRooms, roomRotation } from "../lib/roomRotation";
import { roomObservations } from "../lib/roomObservations";
import { roomAvailabilityView } from "../lib/roomAvailabilityView";

const day = "2026-11-16", yesterday = "2026-11-15";
function entry(patch: Partial<RoomEntry> = {}): RoomEntry {
  return { type: "createRoomInspection", id: createId(), schemaVersion: 6, room: "114", date: yesterday,
    inspectedAt: `${patch.date || yesterday}T09:00:00.000Z`, actor: "Test sécurité", notes: "Contrôle fictif.",
    occupied: true, condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "",
    microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch };
}
function radiator(record: RoomEntry, result: RoomEntry["checks"][number]["result"]): RoomEntry {
  return { ...record, checks: record.checks.map(check => check.key === "radiator_clear" ? { ...check, result } : check) };
}
function saved(record: RoomEntry): RoomInspection {
  return { ...record, version: 1, updatedAt: record.inspectedAt!, submissionHash: "fixture", photoIds: [], photoId: null };
}

test("a recently obstructed radiator immediately precedes uninspected and overdue rooms, even with a good general condition", () => {
  const history = [radiator(entry(), "probleme"), entry({ room: "102", date: "2026-10-01" })];
  const snapshot = structuredClone(history);
  const rotation = roomRotation(history, day, 1, 7, [], ["101", "102", "114"]);
  assert.deepEqual(rotation.fireRiskRooms, ["114"]);
  assert.deepEqual(rotation.priorityRooms, ["114"]);
  assert.deepEqual(rotation.due, ["114", "101", "102"]);
  assert.deepEqual(rotation.plan, ["114"]);
  assert.equal(rotation.next, "114");
  assert.equal(rotation.byRoom.get("114")?.reason, "fire");
  assert.equal(rotation.byRoom.get("114")?.fireRisk, true);
  assert.equal(rotation.byRoom.get("114")?.dueOn, day);
  assert.deepEqual(history, snapshot);
});

test("an obstructed radiator never waits for the four-day bad-condition follow-up", () => {
  const history = [radiator(entry({ condition: "mauvais" }), "probleme")];
  const rotation = roomRotation(history, day, 1, 7, [], ["114"]);
  assert.deepEqual(rotation.fireRiskRooms, ["114"]);
  assert.deepEqual(rotation.plan, ["114"]);
  assert.deepEqual(rotation.waitingPoorRooms, []);
  assert.equal(rotation.byRoom.get("114")?.followUpOn, "2026-11-19");
  assert.equal(rotation.byRoom.get("114")?.reason, "fire");
});

test("a complete control today still requires a safety check after the daily goal and despite a stored deferral", () => {
  const unsafe = radiator(entry({ date: day }), "probleme");
  const rotation = roomRotation([unsafe], day, 1, 7, ["114"], ["114"]);
  assert.deepEqual(rotation.done, ["114"], "Keep the actual inspection count");
  assert.deepEqual(rotation.candidates, ["114"]);
  assert.deepEqual(rotation.plan, ["114"]);
  assert.deepEqual(rotation.priorityRooms, ["114"]);
  assert.equal(rotation.goal, 1);
  assert.equal(rotation.byRoom.get("114")?.reason, "fire");
});

test("all active radiator hazards remain in the plan even when they exceed the routine goal", () => {
  const scope = ["114", "115", "116"];
  const history = scope.map(room => radiator(entry({ room }), "probleme"));
  const rotation = roomRotation(history, day, 1, 7, scope, scope);
  assert.deepEqual(rotation.plan, scope);
  assert.deepEqual(rotation.fireRiskRooms, scope);
  assert.equal(rotation.goal, 1, "Safety exceptions never rewrite the usual goal");
  assert.equal(new Set(rotation.plan).size, 3);
});

test("unchecked, absent and missing radiator answers cannot clear a previous hazard", () => {
  const unsafe = radiator(entry(), "probleme");
  const later = entry({ date: day });
  const inconclusive = [radiator(later, "non_verifie"), radiator(later, "absent"),
    { ...later, checks: later.checks.filter(check => check.key !== "radiator_clear") }];
  for (const record of inconclusive) {
    assert.deepEqual([...radiatorFireRiskRooms([unsafe, record], day)], ["114"]);
    assert.deepEqual(roomRotation([record, unsafe], day, 1, 7, [], ["114"]).plan, ["114"]);
  }
});

test("only a chronologically newer explicit Libre assessment removes the hazard, independently of input order", () => {
  const unsafe = radiator(entry({ date: day }), "probleme");
  const clear = entry({ date: day, inspectedAt: `${day}T12:00:00.000Z` });
  for (const history of [[unsafe, clear], [clear, unsafe]]) {
    const rotation = roomRotation(history, day, 1, 7, [], ["114"]);
    assert.deepEqual(rotation.fireRiskRooms, []);
    assert.deepEqual(rotation.priorityRooms, []);
    assert.deepEqual(rotation.plan, []);
    assert.equal(rotation.byRoom.get("114")?.reason, "done");
  }
  const again = radiator(entry({ date: day, inspectedAt: `${day}T13:00:00.000Z` }), "probleme");
  assert.deepEqual(roomRotation([again, unsafe, clear], day, 1, 7, [], ["114"]).plan, ["114"]);
});

test("future and backdated controls cannot conceal a current hazard or fabricate one", () => {
  const unsafe = radiator(entry(), "probleme");
  const future = entry({ date: "2026-11-17" });
  assert.deepEqual([...radiatorFireRiskRooms([unsafe, future], day)], ["114"]);
  assert.deepEqual([...radiatorFireRiskRooms([unsafe, entry({ date: "2026-11-14" })], day)], ["114"]);
  assert.deepEqual([...radiatorFireRiskRooms([entry(), radiator(future, "probleme")], day)], []);
});

test("ambiguous same-time assessments preserve the hazard in either input order and do not mutate history", () => {
  const unsafe = radiator(entry(), "probleme"), clear = entry();
  for (const history of [[unsafe, clear], [clear, unsafe]]) {
    const snapshot = structuredClone(history);
    assert.deepEqual([...radiatorFireRiskRooms(history, day)], ["114"]);
    assert.deepEqual(history, snapshot);
  }
});

test("a blocked safety clearance stays excluded while accepted offline observations participate normally", () => {
  const unsafe = saved(radiator(entry(), "probleme"));
  const clear = entry({ date: day });
  const blocked = roomObservations([unsafe], [{ entry: clear, protocol: 2, blocked: true }], day);
  assert.deepEqual([...radiatorFireRiskRooms(blocked.history, day)], ["114"]);
  const offline = roomObservations([unsafe], [{ entry: clear, protocol: 2 }], day);
  assert.deepEqual([...radiatorFireRiskRooms(offline.history, day)], []);
  assert.equal(offline.pendingIds.has(clear.id), true);
});

test("free and works rooms enter the safety scope only while the radiator obstruction remains active", () => {
  for (const vacancyReason of ["available", "works"] as const) {
    const event: WorkEntry = { type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: "114", room: "114",
      expectedRevision: 0, expectedPreviousEventId: null, free: true, vacancyReason,
      date: day, actor: "Test occupation", notes: "", occurredAt: `${day}T10:00:00.000Z` };
    const unsafe = saved(radiator(entry(), "probleme"));
    const safe = saved(entry({ date: day }));
    for (const [history, hazardous] of [[[unsafe], true], [[unsafe, safe], false]] as const) {
      const observations = roomObservations([...history], [], day);
      const availability = roomAvailabilityView([event], observations.latest);
      const risks = radiatorFireRiskRooms(observations.history, day);
      const scope = rooms.filter(room => availability.get(room)?.free !== true || risks.has(room));
      const rotation = roomRotation(observations.history, day, 1, 7, [], scope);
      assert.equal(rotation.fireRiskRooms.includes("114"), hazardous);
      assert.equal(rotation.plan.includes("114"), hazardous);
      assert.equal(availability.get("114")?.vacancyReason, vacancyReason, "No implicit occupancy change");
    }
  }
});

test("ordinary room clutter, unrelated equipment faults and legacy controls do not create a radiator alert", () => {
  for (const key of ["room_clutter", "damage", "taps"] as const) {
    const record = entry();
    record.checks = record.checks.map(check => check.key === key ? { ...check, result: "probleme" } : check);
    assert.deepEqual([...radiatorFireRiskRooms([record], day)], []);
    assert.deepEqual(roomRotation([record], day, 1, 7, [], ["114"]).fireRiskRooms, []);
  }
  const legacy = entry({ schemaVersion: 4, checks: entry().checks.filter(check => !["room_clutter", "radiator_clear"].includes(check.key)) });
  assert.deepEqual([...radiatorFireRiskRooms([legacy], day)], []);
});
