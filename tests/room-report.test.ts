import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { createId, today } from "../lib/domain";
import { parseEntry, roomChecks, roomEntrySchema, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { buildFreeRoomsReport, freeRoomRows } from "../lib/roomPdfExport";
import { execute, executeEntry, readState } from "../lib/storage";

const entry = (): RoomEntry => ({ type: "createRoomInspection", id: createId(), room: "114", date: today(), actor: "Marie", notes: "", condition: "bon", occupied: false, cleaning: "faite", carpet: "ok", carpetNotes: "", microwave: "oui", microwaveCleaning: "propre", fridgeCleaning: "sale", photosData: [], checks: roomChecks.map(c => ({ key: c.key, result: "ok" })) });
const saved = (overrides: Partial<RoomInspection> = {}): RoomInspection => ({ ...entry(), version: 1, updatedAt: "2026-10-01T10:00:00Z", submissionHash: "hash", photoIds: [], photoId: null, ...overrides });

test("PDF selects the latest checklist, excludes occupied/unknown rooms, and labels missing and pending answers", () => {
  const oldFree = saved({ date: "2026-09-29" });
  const nowOccupied = saved({ occupied: true, date: "2026-09-30" });
  const unknown = saved({ room: "115", occupied: null });
  const legacy = saved({ room: "116", fridgeCleaning: undefined, microwaveCleaning: undefined });
  const absent = saved({ room: "118", microwave: "non", checks: roomChecks.map(c => ({ key: c.key, result: c.key === "fridge" ? "absent" : "ok" })) });
  const pending = { ...entry(), room: "117" };
  const history = [oldFree, nowOccupied, unknown, legacy, pending, absent];
  const rows = freeRoomRows(history);
  assert.deepEqual(rows.map(r => r[0]), ["116", "117", "118"]);
  assert.match(rows[0][4], /Non renseignée/);
  assert.match(rows[1][1], /En attente d’envoi/);
  assert.match(rows[1][5], /Sale/);
  assert.equal(rows[2][4], "Absent"); assert.equal(rows[2][5], "Absent");
  const doc = buildFreeRoomsReport({ hotelName: "Hôtel test", history });
  assert.match(doc.output(), /^%PDF/);
  const stream = doc.output().match(/stream\n([\s\S]*?)\nendstream/)![1];
  assert.match(inflateSync(Buffer.from(stream, "binary")).toString("latin1"), /Minibar/);
  assert.ok(doc.output("arraybuffer").byteLength > 1000);
});

test("PDF paginates a full hotel and long observations", () => {
  const history = roomChecks.flatMap((_, index) => [saved({ room: String(101 + index), notes: "Observation longue. ".repeat(100) })]);
  assert.ok(buildFreeRoomsReport({ hotelName: "Test", history }).getNumberOfPages() > 1);
});

test("v2 pending payloads keep their original hash and cleaning answers", () => {
  const v2 = { type: "createRoomInspection", id: createId(), room: "114", date: today(), actor: "Marie", notes: "", condition: "bon", cleaning: "faite", checks: entry().checks, carpet: "ok", carpetNotes: "", microwave: "oui", photosData: [], occupied: true, schemaVersion: 2 };
  assert.deepEqual(parseEntry(v2), v2);
  assert.equal(createHash("sha256").update(JSON.stringify(parseEntry(v2))).digest("hex"), createHash("sha256").update(JSON.stringify(v2)).digest("hex"));
  assert.equal(roomEntrySchema.safeParse(v2).success, false);
});

test("room problems create one editable anomaly and retries preserve its resolution", async () => {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-room-issues-"));
  const input = entry();
  const receipt = await executeEntry(input);
  assert.equal(receipt.collection, "roomInspections");
  assert.ok(receipt.collection === "roomInspections" && receipt.issue);
  const issue = (await readState()).issues[0];
  assert.match(issue.description, /Minibar sale/);
  await execute({ type: "updateIssue", id: issue.id, version: 1, actor: "Direction", note: "Minibar nettoyé", status: "resolu", fields: issue });
  await executeEntry(input);
  const state = await readState();
  assert.equal(state.issues.length, 1); assert.equal(state.issues[0].status, "resolu");
  await executeEntry({ ...entry(), id: createId(), fridgeCleaning: "propre" });
  assert.equal((await readState()).issues.length, 1);
});
