import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { roomChecks, rooms, type RoomEntry } from "../lib/rooms";
import { completeRoomInspection, roomRotation } from "../lib/roomRotation";

const day = "2026-11-03", yesterday = "2026-11-02";
const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", id: createId(), schemaVersion: 4, room: "114", date: patch.date || yesterday,
  inspectedAt: `${patch.date || yesterday}T10:00:00Z`, actor: "Marie", notes: "", occupied: true, condition: "bon", cleaning: null,
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch,
});
const partial = (patch: Partial<RoomEntry> = {}) => entry({ ...patch, checks: roomChecks.map((check, index) => ({ key: check.key, result: index ? "ok" : "non_verifie" })) });
const recentHistory = () => rooms.map(room => entry({ room }));

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
