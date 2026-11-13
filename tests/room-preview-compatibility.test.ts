import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEntry, roomChecks } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";

test("removing the temperature UI preserves the hash and receipt of controls saved by the preview", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-preview-replay-"));
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR"].map(key => [key, process.env[key]] as const);
  t.after(() => {
    previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    rmSync(directory, { recursive: true, force: true });
  });
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = directory;

  // This hash was captured from the published preview before removing its UI.
  const submissionHash = "4dc2d607785fc79f819d44154ebae7c65a393c3bba494eaf190af6baafdabe7e";
  const input = {
    type: "createRoomInspection", id: "a1111111-1111-4111-8111-111111111111", room: "114",
    date: "2026-10-20", actor: "Marie", notes: "", condition: "bon", cleaning: "faite",
    checks: roomChecks.filter(check => !["radiator_clear", "room_clutter"].includes(check.key)).map(check => ({ key: check.key, result: "ok" })),
    carpet: "ok", carpetNotes: "", microwave: "oui", photosData: [],
    schemaVersion: 4, occupied: true, bugs: "non", microwaveCleaning: "propre", fridgeCleaning: "propre",
    inspectedAt: "2026-10-20T10:15:00Z", distinctProblemKeys: [], issueLinks: [], temperatureC: 21.5,
  };
  const parsed = parseEntry(input);
  assert.equal(parsed.type, "createRoomInspection");
  if (parsed.type !== "createRoomInspection") throw new Error("Expected a room inspection");
  assert.equal(createHash("sha256").update(JSON.stringify(parsed)).digest("hex"), submissionHash);
  assert.equal(parsed.temperatureC, 21.5);
  const { photosData, ...fields } = parsed;
  assert.deepEqual(photosData, []);
  const record = { ...fields, version: 1, updatedAt: "2026-10-20T10:15:00Z", submissionHash,
    photoIds: [], photoId: null, issueSyncVersion: 2, createdIssue: false, relatedIssueIds: [], newIssueFindingKeys: [] };
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify({ issues: [], inspections: [], roomInspections: [record] }));

  const receipt = await executeEntry(parsed);
  assert.equal(receipt.collection, "roomInspections");
  assert.deepEqual(receipt.record, record);
  assert.equal("issue" in receipt ? receipt.issue : undefined, undefined);
  assert.deepEqual(await executeEntry(parsed), receipt);
  const state = await readState();
  assert.deepEqual(state.roomInspections, [record]);
  assert.deepEqual(state.issues, []);
});
