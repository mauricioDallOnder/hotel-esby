import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { latestRoomRecords, roomChecks, rooms, type RoomEntry, type WorkEntry } from "../lib/rooms";
import { completeRoomInspection, roomRotation } from "../lib/roomRotation";
import { roomAvailability } from "../lib/work";

const day = "2026-11-03", yesterday = "2026-11-02";
const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", id: createId(), schemaVersion: 5, room: "114", date: patch.date || yesterday,
  inspectedAt: `${patch.date || yesterday}T10:00:00Z`, actor: "Marie", notes: "", occupied: true, condition: "bon", cleaning: null,
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch,
});
const partial = (patch: Partial<RoomEntry> = {}) => entry({ ...patch, checks: roomChecks.map((check, index) => ({ key: check.key, result: index ? "ok" : "non_verifie" })) });
const recentHistory = () => rooms.map(room => entry({ room }));

test("rotation respects each inspection version without marking old complete controls unfinished", () => {
  for (const version of [undefined, 2, 3, 4, 5] as const) {
    const checks = entry().checks.filter(check => check.key !== "radiator_clear" || version === 5)
      .filter(check => check.key !== "door_closer" || !!version && version >= 4)
      .filter(check => check.key !== "door_handle_clear" || !!version);
    const input = entry({ schemaVersion: version, checks, date: day });
    assert.equal(completeRoomInspection(input), true, `v${version ?? 1}`);
    assert.deepEqual(roomRotation([input], day).done, [input.room]);
  }
  for (const result of ["non_verifie", "absent"] as const) {
    const input = entry({ checks: entry().checks.map(check => check.key === "radiator_clear" ? { ...check, result } : check) });
    assert.equal(completeRoomInspection(input), false);
  }
  assert.equal(completeRoomInspection(entry({ checks: entry().checks.filter(check => check.key !== "radiator_clear") })), false);
  assert.equal(completeRoomInspection(entry({ checks: entry().checks.filter(check => check.key !== "door_closer") })), false);
  assert.equal(completeRoomInspection(entry({ occupied: null })), false);
  assert.equal(completeRoomInspection(entry({ bugs: "non_verifie" })), false);
  assert.equal(completeRoomInspection(entry({ checks: entry().checks.map(check => check.key === "radiator_clear" ? { ...check, result: "probleme" } : check) })), true);
});

test("recent poor rooms precede never-inspected and overdue rooms without losing interval coverage", () => {
  const history = recentHistory().filter(record => record.room !== "101").map(record => record.room === "102"
    ? entry({ room: "102", date: "2026-10-01" }) : record.room === "114" ? { ...record, condition: "mauvais" as const } : record);
  const original = structuredClone(history);
  const rotation = roomRotation(history, day, 3, 7);
  assert.deepEqual(rotation.priorityRooms, ["114"]);
  assert.deepEqual(rotation.due, ["114", "101", "102"]);
  assert.deepEqual(rotation.plan, ["114", "101", "102"]);
  assert.equal(rotation.next, "114");
  assert.equal(rotation.covered, rooms.length - 2);
  assert.deepEqual(history, original);
});

test("the latest partial bad observation creates priority without completing a room inspection", () => {
  const bad = partial({ room: "114", date: day, condition: "mauvais" });
  assert.equal(completeRoomInspection(bad), false);
  const rotation = roomRotation([...recentHistory(), bad], day, 5, 7);
  assert.deepEqual(rotation.priorityRooms, ["114"]);
  assert.deepEqual(rotation.due, ["114"]);
  assert.deepEqual(rotation.plan, ["114"]);
  assert.deepEqual(rotation.done, []);
  assert.equal(rotation.covered, rooms.length);
  const withoutCompleteHistory = roomRotation([bad], day, 5, 7);
  assert.equal(withoutCompleteHistory.covered, 0);
  assert.equal(withoutCompleteHistory.plan[0], "114");
});

test("newer good or a_revoir observations clear an older bad condition by date and by visit time", () => {
  const history = recentHistory().map(record => record.room === "114" ? { ...record, condition: "mauvais" as const } : record);
  for (const condition of ["bon", "a_revoir"] as const) {
    for (const date of [yesterday, day]) {
      const improved = partial({ room: "114", date, inspectedAt: `${date}T15:00:00Z`, condition });
      // The latest complete inspection is still bad, but the newer observation supersedes its condition.
      const rotation = roomRotation([improved, ...history], day, 5, 7);
      assert.deepEqual(rotation.priorityRooms, []);
      assert.deepEqual(rotation.due, []);
      assert.deepEqual(rotation.plan, []);
      assert.equal(rotation.covered, rooms.length);
    }
  }
});

test("future inspections neither create priority nor clear a current bad condition", () => {
  const history = recentHistory().map(record => record.room === "115" ? { ...record, condition: "mauvais" as const } : record);
  const rotation = roomRotation([
    entry({ room: "114", date: "2026-11-04", condition: "mauvais" }),
    entry({ room: "115", date: "2026-11-04", condition: "bon" }),
    ...history,
  ], day, 5, 7);
  assert.deepEqual(rotation.priorityRooms, ["115"]);
  assert.deepEqual(rotation.plan, ["115"]);
  assert.deepEqual(rotation.done, []);
  assert.equal(rotation.covered, rooms.length);
});

test("a complete bad inspection today is counted once and returns to priority tomorrow", () => {
  const bad = entry({ room: "114", date: day, condition: "mauvais" });
  const history = [...recentHistory(), bad, { ...bad, id: createId(), inspectedAt: `${day}T14:00:00Z` }];
  const rotation = roomRotation(history, day, 5, 7);
  assert.deepEqual(rotation.priorityRooms, ["114"]);
  assert.deepEqual(rotation.done, ["114"]);
  assert.deepEqual(rotation.due, []);
  assert.deepEqual(rotation.plan, []);
  assert.equal(rotation.covered, rooms.length);
  assert.deepEqual(roomRotation(history, "2026-11-04", 5, 7).plan, ["114"]);
});

test("a later partial bad observation does not undo a complete inspection already done today", () => {
  const rotation = roomRotation([
    ...recentHistory(), entry({ room: "114", date: day }),
    partial({ room: "114", date: day, inspectedAt: `${day}T15:00:00Z`, condition: "mauvais" }),
  ], day, 5, 7);
  assert.deepEqual(rotation.priorityRooms, ["114"]);
  assert.deepEqual(rotation.done, ["114"]);
  assert.deepEqual(rotation.due, []);
  assert.deepEqual(rotation.plan, []);
});

test("daily deferrals exclude priority rooms from the plan and next room without erasing their state", () => {
  const history = recentHistory().map(record => ["114", "115"].includes(record.room) ? { ...record, condition: "mauvais" as const } : record);
  const rotation = roomRotation(history, day, 5, 7, ["114"]);
  assert.deepEqual(rotation.priorityRooms, ["114", "115"]);
  assert.deepEqual(rotation.due, ["114", "115"]);
  assert.deepEqual(rotation.plan, ["115"]);
  assert.equal(rotation.next, "115");
  const allDeferred = roomRotation(history, day, 5, 7, ["114", "115"]);
  assert.deepEqual(allDeferred.plan, []);
  assert.equal(allDeferred.next, undefined);
  assert.equal(roomRotation(history, "2026-11-04", 5, 7).next, "114");
});

test("both priority groups retain never-inspected, oldest-complete-date and room-number ordering", () => {
  const dates: { [room: string]: string } = { "102": "2026-10-10", "103": "2026-10-10", "115": "2026-10-15", "116": "2026-10-20", "117": "2026-10-20" };
  const history = rooms.filter(room => !["101", "114"].includes(room)).map(room => entry({
    room, date: dates[room] || yesterday, condition: ["115", "116", "117"].includes(room) ? "mauvais" : "bon",
  }));
  history.push(partial({ room: "114", condition: "mauvais" }));
  const rotation = roomRotation(history.reverse(), day, 10, 7);
  assert.deepEqual(rotation.plan, ["114", "115", "116", "117", "101", "102", "103"]);
});

test("a_revoir and equipment problems alone do not trigger poor-condition priority", () => {
  const history = recentHistory().filter(record => record.room !== "101").map(record => record.room === "114"
    ? { ...record, condition: "a_revoir" as const }
    : record.room === "115" ? { ...record, checks: record.checks.map((check, index) => ({ ...check, result: index ? check.result : "probleme" as const })) } : record);
  const rotation = roomRotation(history, day, 5, 7);
  assert.deepEqual(rotation.priorityRooms, []);
  assert.deepEqual(rotation.due, ["101"]);
  assert.deepEqual(rotation.plan, ["101"]);
});

test("priority rooms respect the daily workload remaining after completed rooms", () => {
  const completed = entry({ room: "101", date: day });
  const history = [...recentHistory().map(record => ["114", "115", "116"].includes(record.room) ? { ...record, condition: "mauvais" as const } : record), completed, completed];
  const rotation = roomRotation(history, day, 2, 7);
  assert.deepEqual(rotation.done, ["101"]);
  assert.deepEqual(rotation.due, ["114", "115", "116"]);
  assert.deepEqual(rotation.plan, ["114"]);
  assert.equal(rotation.done.length + rotation.plan.length, rotation.goal);
  assert.deepEqual(roomRotation(history, day, 1, 7).plan, []);
});

test("free rooms are excluded from priority, completed counts, coverage and the remaining daily workload", () => {
  const history = [
    entry({ room: "101", date: day, occupied: false, cleaning: "faite" }),
    entry({ room: "102", condition: "mauvais", occupied: false, cleaning: "faite" }),
    entry({ room: "103", date: "2026-10-01" }),
    entry({ room: "104", date: day }),
  ];
  const before = structuredClone(history);
  const eligible = ["103", "104", "105"] as const;
  const rotation = roomRotation(history, day, 2, 7, ["102"], eligible);
  assert.equal(rotation.total, 3);
  assert.equal(rotation.goal, 2);
  assert.deepEqual(rotation.done, ["104"]);
  assert.equal(rotation.covered, 1);
  assert.deepEqual(rotation.priorityRooms, []);
  assert.deepEqual(rotation.due, ["105", "103"]);
  assert.deepEqual(rotation.plan, ["105"]);
  assert.equal(rotation.next, "105");
  assert.equal(rotation.cycleWorkDays, 2);
  assert.deepEqual(history, before);
  assert.deepEqual(eligible, ["103", "104", "105"]);
});

test("the occupancy scope honours manual Libre and reopens occupied rooms while retaining unknown occupancy", () => {
  const history = [
    entry({ room: "101", condition: "mauvais", occupied: true }),
    entry({ room: "102", occupied: false, cleaning: "faite" }),
  ];
  const latest = latestRoomRecords(history);
  const markedFree: WorkEntry = {
    type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: "101", room: "101",
    expectedRevision: 0, date: day, actor: "Test", notes: "", occurredAt: `${day}T10:00:00Z`, free: true,
  };
  const eligible = (events: WorkEntry[]) => rooms.filter(room => roomAvailability(room, events, latest.get(room)).free !== true);
  const current = roomRotation(history, day, 15, 7, [], eligible([markedFree]));
  assert.equal(current.total, rooms.length - 2);
  assert.equal(current.due.includes("101"), false);
  assert.equal(current.due.includes("102"), false);
  assert.deepEqual(current.priorityRooms, []);
  assert.ok(current.due.includes("103"), "Unknown occupation must remain in the checklist");

  const reoccupied: WorkEntry = { ...markedFree, id: createId(), expectedRevision: 1, occurredAt: `${day}T11:00:00Z`, free: false };
  const reopened = roomRotation(history, day, 15, 7, [], eligible([reoccupied, markedFree]));
  assert.equal(reopened.total, rooms.length - 1);
  assert.deepEqual(reopened.priorityRooms, ["101"]);
  assert.equal(reopened.plan[0], "101");
  assert.equal(reopened.next, "101");
  assert.equal(reopened.due.includes("102"), false);
});

test("a fully free hotel has an empty tour and finite zero totals", () => {
  const rotation = roomRotation(recentHistory(), day, 15, 7, ["114"], []);
  assert.equal(rotation.total, 0);
  assert.equal(rotation.goal, 0);
  assert.equal(rotation.covered, 0);
  assert.equal(rotation.cycleWorkDays, 0);
  assert.equal(rotation.next, undefined);
  for (const field of ["done", "due", "plan", "priorityRooms"] as const) assert.deepEqual(rotation[field], []);
});

test("a small eligible scope caps the goal and ignores duplicate or unknown room identifiers", () => {
  const eligible = ["114", "999", "114", "103"] as const;
  const rotation = roomRotation([], day, 15, 7, [], eligible);
  assert.equal(rotation.total, 2);
  assert.equal(rotation.goal, 2);
  assert.equal(rotation.cycleWorkDays, 1);
  assert.deepEqual(rotation.plan, ["103", "114"]);
  assert.deepEqual(eligible, ["114", "999", "114", "103"]);
  const onePerDay = roomRotation([], day, 1, 7, [], eligible);
  assert.equal(onePerDay.goal, 1);
  assert.equal(onePerDay.cycleWorkDays, 2);
  assert.deepEqual(onePerDay.plan, ["103"]);
});
