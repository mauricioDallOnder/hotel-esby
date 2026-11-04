import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import type { PendingEntry } from "../lib/entryQueue";
import { roomObservations } from "../lib/roomObservations";
import { latestRoomTemperatures } from "../lib/roomTemperature";
import { roomChecks, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { roomAvailability } from "../lib/work";

const day = "2026-11-04";
const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", id: createId(), schemaVersion: 4, room: "101", date: day,
  actor: "Test", notes: "", condition: "bon", occupied: true, cleaning: null,
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null,
  fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
  inspectedAt: "2026-11-04T09:00:00.000Z", ...patch,
});
const saved = (input: RoomEntry): RoomInspection => {
  const { photosData: _photos, ...fields } = input;
  void _photos;
  return { ...fields, version: 1, updatedAt: input.inspectedAt!, submissionHash: "a".repeat(64), photoIds: [], photoId: null };
};

test("room overviews ignore blocked and future controls while keeping the last accepted occupancy", () => {
  const recorded = saved(entry({ date: "2026-11-03", occupied: false }));
  const history = [recorded, saved(entry({ room: "102", date: "2026-11-05" }))];
  const pending: PendingEntry[] = [
    { entry: entry(), blocked: true },
    { entry: entry({ room: "103", date: "2026-11-05" }) },
    { entry: { type: "createFamilyEvent", id: createId(), room: "104", date: day, actor: "Test", notes: "", family: "Test", kind: "absence", returnDate: "" } },
  ];
  const snapshot = structuredClone({ history, pending });
  const current = roomObservations(history, pending, day);
  assert.deepEqual(current.history, [recorded]);
  assert.equal(roomAvailability("101", [], current.latest.get("101")).free, true);
  assert.equal(roomAvailability("102", [], current.latest.get("102")).free, undefined);
  assert.equal(current.pendingIds.size, 0);
  assert.deepEqual({ history, pending }, snapshot);
});

test("accepted offline controls appear once and a blocked replay cannot hide a saved control", () => {
  const record = saved(entry());
  const offline = entry({ room: "102", occupied: false });
  const current = roomObservations([record], [{ entry: entry({ id: record.id }) }, { entry: offline }], day);
  assert.equal(current.history.length, 2);
  assert.equal(current.latest.get("102")?.id, offline.id);
  assert.deepEqual([...current.pendingIds].sort(), [record.id, offline.id].sort());
  assert.equal(roomAvailability("102", [], current.latest.get("102")).free, true);
  const blockedReplay = roomObservations([record], [{ entry: entry({ id: record.id }), blocked: true }], day);
  assert.equal(blockedReplay.latest.get("101"), record);
  assert.equal(blockedReplay.pendingIds.size, 0);
});

test("a new occupancy observation leaves the last temperature visible and blocked measurements do not replace it", () => {
  const measurement = saved(entry({ date: "2026-11-03", temperatureC: 0 }));
  const withoutMeasurement = entry({ occupied: false });
  const blockedMeasurement = entry({ temperatureC: 25, inspectedAt: "2026-11-04T10:00:00.000Z" });
  const current = roomObservations([measurement], [{ entry: withoutMeasurement }, { entry: blockedMeasurement, blocked: true }], day);
  assert.equal(roomAvailability("101", [], current.latest.get("101")).free, true);
  const temperatures = latestRoomTemperatures(current.history, day);
  assert.equal(temperatures.get("101")?.id, measurement.id);
  assert.equal(temperatures.get("101")?.temperatureC, 0);
  assert.equal(current.pendingIds.has(measurement.id), false);
  const accepted = roomObservations([measurement], [{ entry: withoutMeasurement }, { entry: blockedMeasurement }], day);
  assert.equal(latestRoomTemperatures(accepted.history, day).get("101")?.id, blockedMeasurement.id);
  assert.equal(accepted.pendingIds.has(blockedMeasurement.id), true);
});
