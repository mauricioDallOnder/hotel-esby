import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { collectedItems } from "../lib/collectedItems";
import { createId, today } from "../lib/domain";
import { comparePendingEntries } from "../lib/entryQueue";
import type { WorkEntry, WorkEvent } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";
import { roomAvailability } from "../lib/work";

// Fictitious examples: no guest or operational inventory is bundled in the app.
const item = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "collectedItem", targetId: createId(), expectedRevision: 0,
  room: "101", date: "2025-06-01", actor: "Agent exemple", notes: "Appareil non autorisé.",
  occurredAt: "2025-06-01T10:00:00.000Z", itemName: "Plaque de cuisson de démonstration",
  collectedOn: "2025-06-01", collectedBy: "Agent exemple", returnedOn: null, returnedBy: "", ...patch,
});
const next = (entry: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry => ({
  ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1, ...patch,
});
const availability = (): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: "101", expectedRevision: 0,
  room: "101", date: "2025-06-01", actor: "Agent exemple", notes: "", occurredAt: "2025-06-01T10:00:00.000Z", free: false,
});

function restoreEnvironment(t: TestContext) {
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"]
    .map(key => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }));
}
function local(t: TestContext) {
  restoreEnvironment(t);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-collected-items-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = directory;
}
function sheets() {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/collected-items-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
}

test("unidentified items retain custody, returns and later room identification as immutable local revisions", async t => {
  local(t);
  const collected = item({ room: "", roomUnidentified: true }), first = await executeEntry(collected);
  const corrected = next(collected, {
    date: "2025-06-02", occurredAt: "2025-06-02T10:00:00.000Z", actor: "Direction",
    itemName: "Plaque rouge de démonstration", notes: "Cordon rangé avec l’appareil.",
  });
  const second = await executeEntry(corrected);
  const returned = next(corrected, {
    date: "2025-06-03", occurredAt: "2025-06-03T10:00:00.000Z", actor: "Autre agent exemple",
    returnedOn: "2025-06-03", returnedBy: "Autre agent exemple",
  });
  const third = await executeEntry(returned);
  const identified = next(returned, {
    room: "102", roomUnidentified: undefined, date: "2025-06-04",
    occurredAt: "2025-06-04T10:00:00.000Z", actor: "Direction",
  });
  delete identified.roomUnidentified;
  const fourth = await executeEntry(identified);
  assert.equal(first.collection, "workEvents");
  assert.deepEqual(await executeEntry(collected), first);
  assert.deepEqual(await executeEntry(returned), third);
  assert.deepEqual(await executeEntry(identified), fourth);
  await assert.rejects(executeEntry(next(collected, { notes: "Correction concurrente." })), { code: 409 });
  await assert.rejects(executeEntry({ ...collected, notes: "Autre contenu pour le même identifiant." }), { code: 409 });

  const state = await readState();
  assert.deepEqual(state.workEvents, [first.record, second.record, third.record, fourth.record]);
  assert.deepEqual(state.workEvents?.slice(0, 3).map(event => [event.room, event.roomUnidentified]), [["", true], ["", true], ["", true]]);
  assert.equal(Object.hasOwn(state.workEvents![3], "roomUnidentified"), false);
  assert.equal(state.issues.length, 0);
  const current = collectedItems(state.workEvents || [])[0];
  assert.equal(current.id, collected.targetId);
  assert.equal(current.itemName, corrected.itemName);
  assert.equal(current.collectedOn, collected.collectedOn);
  assert.equal(current.collectedBy, "Agent exemple");
  assert.equal(current.returnedOn, "2025-06-03");
  assert.equal(current.returnedBy, "Autre agent exemple");
  assert.equal(current.room, "102");
  assert.equal(current.roomUnidentified, false);
  assert.equal(current.revision, 4);
  assert.equal(current.history.length, 4);
  assert.deepEqual(current.history.map(event => event.roomUnidentified), [false, true, true, true]);
  assert.equal(current.history[1].returnedOn, "2025-06-03");
  assert.equal(current.history[1].room, "");
  assert.equal(current.history[3].itemName, collected.itemName);
  assert.equal(current.history[3].reason, collected.notes);
  assert.equal(current.history[3].returnedOn, null);
});

test("separate items from the same room synchronize independently of each other and occupancy", async t => {
  local(t);
  const first = item(), second = item({ itemName: "Multiprise de démonstration", notes: "" });
  const returned = next(first, { actor: "Agent restitution", returnedOn: first.date, returnedBy: "Agent restitution" });
  const restored = next(returned, { actor: "Agent correction", returnedOn: null, returnedBy: "" });
  const occupied = availability();
  await assert.rejects(executeEntry(returned), { code: 409 });
  const pending = [restored, returned, occupied, second, first].map((entry, index) => ({ entry, queuedAt: index }));
  for (const queued of pending.sort(comparePendingEntries)) await executeEntry(queued.entry);
  const state = await readState(), records = collectedItems(state.workEvents || []);
  assert.equal(state.workEvents?.length, 5);
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.room === first.room));
  assert.equal(records.find(record => record.id === first.targetId)?.revision, 3);
  assert.equal(records.find(record => record.id === first.targetId)?.returnedOn, null);
  assert.equal(records.find(record => record.id === second.targetId)?.reason, "");
  assert.equal(records.find(record => record.id === second.targetId)?.revision, 1);
  assert.equal(roomAvailability(first.room, state.workEvents || []).free, false);
  assert.equal(roomAvailability(first.room, state.workEvents || []).revision, 1);
  assert.equal(state.issues.length, 0);
});

test("future custody dates are rejected before either local persistence or a Google request", async t => {
  local(t);
  const tomorrow = new Date(today() + "T12:00:00.000Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const futureDate = tomorrow.toISOString().slice(0, 10);
  const future = item({ date: futureDate, collectedOn: futureDate });
  await assert.rejects(executeEntry(future), { code: 400 });
  assert.equal((await readState()).workEvents?.length || 0, 0);
  sheets();
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Future custody must not reach Google"); });
  await assert.rejects(executeEntry(future), { code: 400 });
  await assert.rejects(executeEntry(item({ date: futureDate, returnedOn: futureDate, returnedBy: "Agent restitution" })), { code: 400 });
  assert.equal(request.mock.callCount(), 0);
});

// Execute the existing deployed transaction and WorkLogic; replace only storage.
function googleFixture() {
  const collections = new Map<string, WorkEvent[]>();
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => structuredClone(collections.get(collection) || []);
  context.deletedAbsences_ = () => [];
  context.writeRecord_ = (collection: string, record: WorkEvent) => {
    const records = collections.get(collection) || [];
    records.push(structuredClone(record));
    collections.set(collection, records);
  };
  return {
    call: (input: object) => context.doPost({ postData: { contents: JSON.stringify(input) } }),
    records: () => structuredClone(collections.get("workEvents") || []),
  };
}

test("the unchanged Apps Script preserves unidentified items, returns and identification while rejecting stale updates", async t => {
  restoreEnvironment(t);
  sheets();
  const google = googleFixture();
  const requests: { action: string; expectedVersion: number; token: string; record: WorkEvent }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body));
    requests.push(input);
    return Response.json(google.call(input));
  });
  const collected = item({ room: "", roomUnidentified: true }), first = await executeEntry(collected);
  const returned = next(collected, {
    date: "2025-06-03", occurredAt: "2025-06-03T10:00:00.000Z", actor: "Agent restitution",
    returnedOn: "2025-06-03", returnedBy: "Agent restitution",
  });
  const second = await executeEntry(returned);
  assert.equal(first.collection, "workEvents");
  assert.equal(second.collection, "workEvents");
  assert.deepEqual(await executeEntry(collected), first);
  assert.deepEqual(await executeEntry(returned), second);
  await assert.rejects(executeEntry(next(collected, { returnedOn: collected.date, returnedBy: "Autre agent" })), { code: 409 });
  await assert.rejects(executeEntry({ ...collected, collectedBy: "Nom modifié" }), { code: 409 });
  const identified = next(returned, {
    room: "102", roomUnidentified: undefined, date: "2025-06-04", occurredAt: "2025-06-04T10:00:00.000Z",
  });
  delete identified.roomUnidentified;
  const third = await executeEntry(identified);
  assert.deepEqual(await executeEntry(returned), second);
  assert.deepEqual(await executeEntry(identified), third);
  await executeEntry(item({ room: "", roomUnidentified: true, notes: "", itemName: "Autre objet de démonstration" }));
  assert.ok(requests.every(request => request.action === "commitWorkEvent" && request.expectedVersion === 0 && request.token === "test-token"));
  const events = google.records();
  assert.equal(events.length, 4);
  assert.deepEqual(events.slice(0, 3), [first.record, second.record, third.record]);
  assert.deepEqual(events.slice(0, 2).map(event => [event.room, event.roomUnidentified]), [["", true], ["", true]]);
  assert.equal(Object.hasOwn(events[2], "roomUnidentified"), false);
  assert.equal(events[1].itemName, collected.itemName);
  assert.equal(events[1].collectedBy, collected.collectedBy);
  assert.equal(events[1].collectedOn, collected.collectedOn);
  assert.equal(events[1].returnedOn, returned.returnedOn);
  assert.equal(events[1].returnedBy, returned.returnedBy);
  assert.match(events[1].submissionHash, /^[a-f0-9]{64}$/);
  const records = collectedItems(events);
  assert.equal(records.length, 2);
  const current = records.find(record => record.id === collected.targetId)!;
  assert.equal(current.revision, 3);
  assert.equal(current.room, "102");
  assert.equal(current.roomUnidentified, false);
  assert.equal(current.returnedOn, returned.returnedOn);
  assert.deepEqual(current.history.map(event => [event.room, event.roomUnidentified]), [["102", false], ["", true], ["", true]]);
  assert.equal(records.find(record => record.id !== collected.targetId)?.roomUnidentified, true);
});
