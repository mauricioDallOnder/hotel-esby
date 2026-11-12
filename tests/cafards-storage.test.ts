import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createId, today } from "../lib/domain";
import { cafardCases } from "../lib/cafards";
import { comparePendingEntries } from "../lib/entryQueue";
import { roomChecks, type RoomEntry, type WorkEntry, type WorkEvent } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";
import { roomAvailability } from "../lib/work";

const followup = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: "114", expectedRevision: 0, expectedPreviousEventId: null,
  room: "114", date: "2026-10-20", actor: "Marie", notes: "Cafards détectés près des plinthes.",
  occurredAt: "2026-10-20T10:00:00.000Z", cafardStatus: "signale",
  detectedOn: "2026-10-20", treatedOn: null, resolvedOn: null, ...patch,
});
const next = (entry: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry => ({
  ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1, expectedPreviousEventId: entry.id, ...patch,
});
const availability = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: "114", expectedRevision: 0, expectedPreviousEventId: null,
  room: "114", date: "2026-10-20", actor: "Marie", notes: "", occurredAt: "2026-10-20T10:00:00.000Z", free: false, ...patch,
});
const inspection = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", id: createId(), schemaVersion: 5, room: "114", date: "2026-10-20", actor: "Marie",
  occupied: true, condition: "bon", cleaning: null, notes: "Présence constatée près de la porte.",
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre",
  bugs: "oui", photosData: [], checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch,
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
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-cafards-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = directory;
}
function sheets() {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/cafards-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
}

test("cafard follow-ups persist as immutable revisions and retries cannot replace history", async t => {
  local(t);
  const reported = followup(), first = await executeEntry(reported);
  const treated = next(reported, { date: "2026-10-21", occurredAt: "2026-10-21T10:00:00.000Z", cafardStatus: "traite",
    treatedOn: "2026-10-21", product: "Gel test", notes: "Produit appliqué." });
  const second = await executeEntry(treated);
  const resolved = next(treated, { date: "2026-10-22", occurredAt: "2026-10-22T10:00:00.000Z", cafardStatus: "resolu",
    resolvedOn: "2026-10-22", notes: "Aucun cafard constaté au contrôle." });
  const third = await executeEntry(resolved);
  assert.equal(first.collection, "workEvents");
  assert.deepEqual(await executeEntry(reported), first);
  await assert.rejects(executeEntry(next(reported, { notes: "Modification concurrente." })), { code: 409 });
  await assert.rejects(executeEntry({ ...reported, notes: "Même identifiant avec un autre constat." }), { code: 409 });

  const state = await readState();
  assert.deepEqual(state.workEvents, [first.record, second.record, third.record]);
  assert.equal(state.issues.length, 0);
  const current = cafardCases([], state.workEvents || [], [])[0];
  assert.equal(current.room, "114");
  assert.equal(current.status, "resolu");
  assert.equal(current.detectedOn, "2026-10-20");
  assert.equal(current.treatedOn, "2026-10-21");
  assert.equal(current.resolvedOn, "2026-10-22");
  assert.equal(current.revision, 3);
});

test("offline cafard revisions synchronize in order without colliding with room availability", async t => {
  local(t);
  const report = followup();
  const treatment = next(report, { cafardStatus: "traite", treatedOn: report.date, product: "Gel test" });
  const resolution = next(treatment, { cafardStatus: "resolu", resolvedOn: report.date });
  const occupied = availability(), free = next(occupied, { free: true });
  await assert.rejects(executeEntry(resolution), { code: 409 });
  const pending = [resolution, free, treatment, occupied, report].map((entry, index) => ({ entry, queuedAt: index }));
  for (const item of pending.sort(comparePendingEntries)) await executeEntry(item.entry);
  const events = (await readState()).workEvents || [];
  assert.equal(events.length, 5);
  const current = cafardCases([], events, [])[0];
  assert.equal(current.status, "resolu");
  assert.equal(current.revision, 3);
  assert.equal(roomAvailability("114", events).free, true);
  assert.equal(roomAvailability("114", events).revision, 2);
});

test("saved room inspections feed cafard follow-up while anomalies contain only eligible repairs", async t => {
  local(t);
  const pests = inspection(), receipt = await executeEntry(pests);
  assert.equal(receipt.collection, "roomInspections");
  if (receipt.collection !== "roomInspections") throw new Error("Expected a room inspection");
  assert.equal(receipt.issue, undefined);
  assert.deepEqual(await executeEntry(pests), receipt);
  let state = await readState();
  assert.equal(state.issues.length, 0);
  assert.equal(state.roomInspections?.length, 1);
  const detected = cafardCases(state.roomInspections || [], state.workEvents || [], []);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].room, "114");
  assert.equal(detected[0].status, "signale");
  assert.equal(detected[0].detectedOn, pests.date);
  assert.equal(detected[0].revision, 0);

  const mixed = inspection({ room: "115", condition: "mauvais", notes: "Robinet bloqué ; observations conservées au contrôle.",
    checks: roomChecks.map(check => ({ key: check.key, result: ["taps", "bed", "mattress"].includes(check.key) ? "probleme" : "ok" })) });
  const mixedReceipt = await executeEntry(mixed);
  assert.equal(mixedReceipt.collection, "roomInspections");
  if (mixedReceipt.collection !== "roomInspections") throw new Error("Expected a room inspection");
  assert.deepEqual(mixedReceipt.issue?.roomFindings?.map(finding => finding.key), ["taps"]);
  assert.doesNotMatch(mixedReceipt.issue?.description || "", /Cafards|Matelas|Lit en bon état|Mauvais état/);
  state = await readState();
  assert.equal(state.issues.length, 1);
  assert.equal(state.roomInspections?.find(record => record.id === mixed.id)?.bugs, "oui");
  assert.deepEqual(cafardCases(state.roomInspections || [], state.workEvents || [], []).map(item => item.room).sort(), ["114", "115"]);
});

test("future cafard dates are rejected before local persistence or a Google request", async t => {
  local(t);
  const tomorrow = new Date(today() + "T12:00:00.000Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = followup({ date: tomorrow.toISOString().slice(0, 10) });
  await assert.rejects(executeEntry(future), { code: 400 });
  const state = await readState();
  assert.equal(state.workEvents?.length || 0, 0);
  assert.equal(state.issues.length, 0);
  sheets();
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("A future follow-up must not reach Google"); });
  await assert.rejects(executeEntry(future), { code: 400 });
  assert.equal(request.mock.callCount(), 0);
});

// Use the existing deployable transaction and WorkLogic, replacing only storage.
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

test("the existing protected Apps Script work transaction accepts cafard fields and enforces revisions", async t => {
  restoreEnvironment(t);
  sheets();
  const google = googleFixture();
  const requests: { action: string; expectedVersion: number; token: string; record: WorkEvent }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body));
    requests.push(input);
    return Response.json(google.call(input));
  });
  const reported = followup(), first = await executeEntry(reported);
  const treated = next(reported, { cafardStatus: "traite", treatedOn: reported.date, product: "Gel test", notes: "Application réalisée." });
  const second = await executeEntry(treated);
  assert.equal(first.collection, "workEvents");
  assert.equal(second.collection, "workEvents");
  assert.deepEqual(await executeEntry(reported), first);
  await assert.rejects(executeEntry(next(reported, { notes: "Modification concurrente." })), { code: 409 });
  await assert.rejects(executeEntry({ ...reported, notes: "Même ID, autre contenu." }), { code: 409 });
  await executeEntry(availability());
  assert.ok(requests.every(request => request.action === (request.record.kind === "cafardFollowup" ? "commitCafardFollowupV3" : "commitWorkEventV2") && request.expectedVersion === 0 && request.token === "test-token"));
  const events = google.records();
  assert.equal(events.length, 3);
  assert.deepEqual(events.slice(0, 2), [first.record, second.record]);
  assert.equal(events[1].cafardStatus, "traite");
  assert.equal(events[1].treatedOn, reported.date);
  assert.equal(events[1].product, "Gel test");
  assert.match(events[1].submissionHash, /^[a-f0-9]{64}$/);
  assert.equal(cafardCases([], events, [])[0].revision, 2);
  assert.equal(roomAvailability("114", events).revision, 1);
});
