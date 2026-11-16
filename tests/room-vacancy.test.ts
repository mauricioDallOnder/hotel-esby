import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test, type TestContext } from "node:test";
import { createId } from "../lib/domain";
import { workEntrySchema, type RoomEntry, type WorkEntry, type WorkEvent } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";
import { roomAvailability, validateWorkEntry } from "../lib/work";

function entry(patch: Partial<WorkEntry> = {}): WorkEntry {
  return workEntrySchema.parse({ type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: "226",
    expectedRevision: 0, expectedPreviousEventId: null, room: "226", date: "2026-11-16", actor: "Direction",
    notes: "", occurredAt: "2026-11-16T09:00:00.000Z", free: true, ...patch });
}

function next(previous: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry {
  return entry({ ...previous, id: createId(), expectedRevision: previous.expectedRevision + 1,
    expectedPreviousEventId: previous.id, ...patch });
}

function local(t: TestContext) {
  const keys = ["STORAGE_DRIVER", "LOCAL_DATA_DIR"];
  const previous = keys.map(key => [key, process.env[key]] as const);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-room-vacancy-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  t.after(() => {
    previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("vacancy reasons are optional for historical rooms and forbidden on occupied or unrelated records", () => {
  for (const vacancyReason of ["available", "works"] as const) {
    const record = entry({ vacancyReason, notes: "Radiateur en attente de remplacement." });
    assert.equal(record.vacancyReason, vacancyReason);
    assert.equal(validateWorkEntry(record, [], []), undefined);
    const occupied = { ...record, free: false };
    assert.equal(workEntrySchema.safeParse(occupied).success, false);
    assert.match(validateWorkEntry(occupied, [], [])!, /chambre non occupée/);
    const task = { ...record, kind: "dailyTask" as const, targetId: createId(), room: "", free: undefined, done: false, deleted: false };
    assert.equal(workEntrySchema.safeParse(task).success, false);
    assert.match(validateWorkEntry(task, [], [])!, /chambre non occupée/);
  }
  assert.equal(workEntrySchema.safeParse({ ...entry(), vacancyReason: "other" }).success, false);
  assert.equal(workEntrySchema.safeParse({ ...entry(), vacancyReason: null }).success, false);
  assert.equal(Object.hasOwn(entry(), "vacancyReason"), false);
  assert.equal(entry({ free: false }).free, false);
});

test("availability distinguishes works from available without reintroducing unoccupied rooms into the checklist", () => {
  const legacy = entry();
  const works = next(legacy, { vacancyReason: "works", notes: "Peinture de la salle de bains." });
  const available = next(works, { vacancyReason: "available", notes: "Travaux terminés." });
  const occupied = next(available, { free: false, vacancyReason: undefined, notes: "" });
  const events = [legacy, works, available, occupied];
  const before = JSON.stringify(events);
  for (const [history, reason] of [ [[legacy], "available"], [[legacy, works], "works"], [[legacy, works, available], "available"] ] as const) {
    const current = roomAvailability("226", [...history], { occupied: true } as RoomEntry);
    assert.equal(current.free, true, "Both vacancy states remain outside the occupied-room checklist");
    assert.equal(current.vacancyReason, reason);
    assert.equal(current.source!.id, history.at(-1)!.id);
  }
  assert.equal(roomAvailability("226", events).free, false);
  assert.equal(roomAvailability("226", events).vacancyReason, undefined);
  assert.equal(roomAvailability("226", []).vacancyReason, undefined);
  assert.equal(roomAvailability("226", [], { occupied: false } as RoomEntry).vacancyReason, "available");
  assert.equal(roomAvailability("226", [], { occupied: true } as RoomEntry).vacancyReason, undefined);
  assert.equal(JSON.stringify(events), before, "Deriving availability never rewrites previous events");
});

test("historical availability receipts keep their exact payload and replay after later work updates", async t => {
  const directory = local(t);
  // Property order is the schema's persisted order before vacancyReason existed.
  const historicalJson = '{"type":"createWorkEvent","id":"a690955e-934d-434b-8d17-9767fcaa53de","kind":"roomAvailability","targetId":"226","expectedRevision":0,"room":"226","date":"2026-11-16","actor":"Direction","notes":"","occurredAt":"2026-11-16T09:00:00.000Z","free":true,"expectedPreviousEventId":null}';
  const parsed = workEntrySchema.parse(JSON.parse(historicalJson));
  assert.equal(JSON.stringify(parsed), historicalJson);
  const receipt: WorkEvent = { ...parsed, version: 1, updatedAt: parsed.occurredAt,
    submissionHash: createHash("sha256").update(historicalJson).digest("hex") };
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify({ issues: [], inspections: [], workEvents: [receipt] }));
  const works = next(parsed, { vacancyReason: "works", notes: "Réparation de la fuite.\nAttendre le séchage." });
  await executeEntry(works);
  assert.deepEqual((await executeEntry(parsed)).record, receipt);
  assert.equal((await readState()).workEvents?.length, 2);
});

test("local storage keeps vacancy notes and history, prevents duplicate retries and rejects concurrent changes", async t => {
  local(t);
  const works = entry({ vacancyReason: "works", notes: "Réparation de la fuite.\nAttendre le séchage." });
  const first = await executeEntry(works);
  assert.deepEqual(await executeEntry(works), first);
  const released = next(works, { vacancyReason: "available", notes: "Réparation vérifiée, chambre disponible." });
  await executeEntry(released);
  const stale = next(works, { notes: "Autre collègue : peinture prévue." });
  await assert.rejects(executeEntry(stale), { code: 409 });
  await assert.rejects(executeEntry({ ...works, notes: "Remplace les notes sous le même identifiant" }), { code: 409 });
  const occupied = next(released, { free: false, vacancyReason: undefined, notes: "" });
  await executeEntry(occupied);
  const state = await readState();
  assert.equal(state.workEvents?.length, 3);
  assert.equal(state.workEvents![0].vacancyReason, "works");
  assert.equal(state.workEvents![0].notes, works.notes);
  assert.equal(state.workEvents![1].notes, released.notes);
  assert.equal(state.workEvents![2].vacancyReason, undefined);
  assert.equal(roomAvailability("226", state.workEvents!).free, false);
  assert.equal(state.issues.length, 0, "Marking a room in works is not an automatic technical report");
  assert.equal(state.roomInspections?.length || 0, 0);
});

test("Google uses the existing protected work-event action to persist vacancy metadata and keep concurrency guards", async t => {
  const previous = ["STORAGE_DRIVER", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"].map(key => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }));
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/vacancy-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  let locked = false;
  const records: WorkEvent[] = [];
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => { assert.equal(locked, true); return collection === "workEvents" ? structuredClone(records) : []; };
  context.deletedAbsences_ = () => [];
  context.writeRecord_ = (collection: string, record: WorkEvent) => {
    assert.equal(locked, true); assert.equal(collection, "workEvents");
    records.push(JSON.parse(JSON.stringify(record)));
  };
  const actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    return Response.json(context.doPost({ postData: { contents: JSON.stringify(input) } }));
  });
  const works = entry({ vacancyReason: "works", notes: "Salle de bains en travaux." });
  const receipt = await executeEntry(works);
  assert.equal(receipt.record.notes, works.notes);
  assert.equal(receipt.collection, "workEvents");
  if (receipt.collection !== "workEvents") throw new Error("Expected work event");
  assert.equal(receipt.record.vacancyReason, "works");
  const available = next(works, { vacancyReason: "available", notes: "Travaux terminés." });
  await executeEntry(available);
  await assert.rejects(executeEntry(next(works, { notes: "Changement concurrent" })), { code: 409 });
  assert.deepEqual(await executeEntry(works), receipt);
  assert.deepEqual(records.map(record => [record.free, record.vacancyReason, record.notes]), [
    [true, "works", works.notes], [true, "available", available.notes],
  ]);
  assert.ok(actions.every(action => action === "commitWorkEventV2"));
});
