import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { cafardCases } from "../lib/cafards";
import { createId } from "../lib/domain";
import { parseEntry, roomChecks, workEntrySchema, type RoomEntry, type WorkEntry } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";
import { latestCafardObservationId, validateWorkEntry } from "../lib/work";

function inspection(patch: Partial<RoomEntry> = {}): RoomEntry {
  return { type: "createRoomInspection", schemaVersion: 5, id: createId(), room: "114", date: "2026-11-05",
    inspectedAt: "2026-11-05T09:00:00.000Z", actor: "Agent test", notes: "Cafards près de la porte.",
    occupied: true, condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non",
    microwaveCleaning: null, fridgeCleaning: "propre", bugs: "oui", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch };
}
function followup(patch: Partial<WorkEntry> = {}): WorkEntry {
  return { type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: "114", room: "114",
    expectedRevision: 0, expectedPreviousEventId: null, date: "2026-11-05", occurredAt: "2026-11-05T12:00:00.000Z", actor: "Agent test", notes: "Vérification du suivi existant.",
    cafardStatus: "traite", detectedOn: "2026-11-05", treatedOn: "2026-11-05", resolvedOn: null,
    product: "Gel test", cafardObservationId: null, ...patch };
}

test("the latest positive inspection identity is stable across ordering and does not treat an unchecked room as a new case", () => {
  const first = inspection(), later = inspection({ inspectedAt: "2026-11-05T11:00:00.000Z" });
  const otherRoom = inspection({ room: "115", inspectedAt: "2026-11-05T14:00:00.000Z" });
  const negative = inspection({ bugs: "non", inspectedAt: "2026-11-05T15:00:00.000Z" });
  const inputs = [negative, later, first, otherRoom, first];
  assert.equal(latestCafardObservationId(inputs, "114"), later.id);
  assert.equal(latestCafardObservationId([...inputs].reverse(), "114"), later.id);
  assert.equal(latestCafardObservationId([negative, otherRoom], "114"), null);
  const cases = cafardCases(inputs, []);
  assert.equal(cases.filter(record => record.room === "114").length, 1);
  assert.equal(cases.find(record => record.room === "114")?.observationId, later.id);
});

test("same-day detection changes are rejected by identity, not by the unchanged date or follow-up revision", () => {
  const first = inspection(), later = inspection({ inspectedAt: "2026-11-05T11:00:00.000Z" });
  const draft = followup({ cafardObservationId: first.id });
  assert.equal(validateWorkEntry(draft, [], [], [], [first]), undefined);
  assert.match(validateWorkEntry(draft, [], [], [], [first, later])!, /nouvelle détection/);
  assert.equal(validateWorkEntry({ ...draft, cafardObservationId: later.id }, [], [], [], [first, later]), undefined);
  assert.match(validateWorkEntry(followup(), [], [], [], [first])!, /nouvelle détection/);
});

test("old queued follow-ups preserve their canonical payload while the context field is specific to cafards", () => {
  const original = followup();
  delete original.cafardObservationId;
  delete original.expectedPreviousEventId;
  const parsed = parseEntry(original);
  assert.equal("cafardObservationId" in parsed, false);
  assert.equal("expectedPreviousEventId" in parsed, false);
  assert.deepEqual(parseEntry(parsed), parsed);
  assert.equal(validateWorkEntry(original, [], [], [], [inspection()]), undefined);
  assert.equal(workEntrySchema.safeParse({ ...followup(), kind: "roomAvailability", free: true }).success, false);
});

test("local storage rejects stale cafard context, keeps one room follow-up and returns earlier receipts unchanged", async t => {
  const old = { driver: process.env.STORAGE_DRIVER, directory: process.env.LOCAL_DATA_DIR };
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-cafard-context-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  t.after(() => {
    if (old.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = old.driver;
    if (old.directory === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = old.directory;
    rmSync(directory, { recursive: true, force: true });
  });
  const first = inspection(), later = inspection({ inspectedAt: "2026-11-05T11:00:00.000Z" });
  await executeEntry(first);
  const accepted = followup({ cafardObservationId: first.id });
  const receipt = await executeEntry(accepted);
  const stale = followup({ expectedRevision: 1, expectedPreviousEventId: accepted.id, cafardObservationId: first.id, cafardStatus: "resolu", resolvedOn: "2026-11-05" });
  await executeEntry(later);
  await assert.rejects(executeEntry(stale), { code: 409 });
  assert.deepEqual(await executeEntry(accepted), receipt);
  const fresh = { ...stale, cafardObservationId: later.id };
  await executeEntry(fresh);
  const state = await readState();
  assert.equal(state.workEvents?.length, 2);
  assert.equal(state.roomInspections?.length, 2);
  assert.equal(cafardCases(state.roomInspections || [], state.workEvents || []).length, 1);
  assert.equal(state.issues.length, 0);
});

test("Apps Script enforces the cafard context inside the lock and keeps retry receipts idempotent", () => {
  let locked = false;
  const first = inspection(), later = inspection({ inspectedAt: "2026-11-05T11:00:00.000Z" });
  const observations = [first], events: WorkEntry[] = [];
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => { assert.equal(locked, true); return structuredClone(collection === "workEvents" ? events : collection === "roomInspections" ? observations : []); };
  context.deletedAbsences_ = () => [];
  context.writeRecord_ = (_collection: string, record: WorkEntry) => { assert.equal(locked, true); events.push(structuredClone(record)); };
  const call = (entry: WorkEntry, action = "commitCafardFollowupV3") => context.doPost({ postData: { contents: JSON.stringify({
    token: "test-token", action, collection: "workEvents", expectedVersion: 0,
    record: { ...entry, version: 1, submissionHash: entry.id.replaceAll("-", "").repeat(2) },
  }) } });
  const accepted = followup({ cafardObservationId: first.id });
  assert.equal(call(accepted, "commitWorkEvent").ok, false);
  const receipt = call(accepted);
  assert.equal(receipt.ok, true, receipt.error);
  observations.push(later);
  const stale = followup({ expectedRevision: 1, expectedPreviousEventId: accepted.id, cafardObservationId: first.id });
  assert.equal(call(stale).code, 409);
  assert.deepEqual(call(accepted), receipt);
  assert.equal(events.length, 1);
  assert.equal(call({ ...stale, cafardObservationId: later.id }).ok, true);
  assert.equal(events.length, 2);
  assert.equal(locked, false);
});
