import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createId } from "../lib/domain";
import { laundryCycles, laundryMachineStates } from "../lib/laundry";
import type { WorkEntry, WorkEvent } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";

const firstTime = "2026-10-01T09:00:00.000Z";
const start = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "laundryCycle", targetId: "washer-1", expectedRevision: 0,
  room: "101", date: "2026-10-01", actor: "Agent fictif", notes: "Sac de démonstration.", occurredAt: firstTime,
  laundryCycleId: createId(), laundryStatus: "en_cours", laundryStartedAt: firstTime,
  laundryCollectedAt: null, laundryCollectedBy: "", laundryOwner: "Exemple", ...patch,
});
const collect = (entry: WorkEntry): WorkEntry => ({ ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1,
  actor: "Agent retrait", laundryStatus: "recupere", occurredAt: "2026-10-01T09:45:00.000Z",
  laundryCollectedAt: "2026-10-01T09:45:00.000Z", laundryCollectedBy: "Agent retrait" });

function restoreEnvironment(t: TestContext) {
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"].map(key => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }));
}
function local(t: TestContext) {
  restoreEnvironment(t);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-laundry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = directory;
}
function sheets(t: TestContext) {
  restoreEnvironment(t);
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/laundry-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
}

test("local laundry keeps custody history, separates identically numbered appliances and rejects overlapping reservations", async t => {
  local(t);
  const first = start(), receipt = await executeEntry(first);
  const washerThree = start({ targetId: "washer-3" }), dryerThree = start({ targetId: "dryer-3" });
  await executeEntry(washerThree);
  await executeEntry(dryerThree);
  assert.deepEqual(await executeEntry(first), receipt);
  await assert.rejects(executeEntry(start()), { code: 409 });
  await assert.rejects(executeEntry(start({ expectedRevision: 1 })), { code: 409 });
  await assert.rejects(executeEntry({ ...first, notes: "Même identifiant, autre contenu." }), { code: 409 });
  const removed = collect(first), removalReceipt = await executeEntry(removed);
  assert.deepEqual(await executeEntry(removed), removalReceipt);
  const next = start({ expectedRevision: 2, room: "102", laundryStartedAt: "2026-10-01T10:00:00.000Z", occurredAt: "2026-10-01T10:00:00.000Z" });
  await executeEntry(next);
  assert.deepEqual(await executeEntry(first), receipt, "An old start replay must not occupy the machine again");
  await assert.rejects(executeEntry({ ...collect(first), expectedRevision: 3 }), { code: 409 });
  const state = await readState();
  assert.equal(state.workEvents?.length, 5);
  assert.equal(state.issues.length, 0);
  assert.equal(state.roomInspections?.length || 0, 0);
  const history = laundryCycles(state.workEvents!);
  assert.equal(history.length, 4);
  assert.equal(history.find(cycle => cycle.cycleId === first.laundryCycleId)?.collectedBy, "Agent retrait");
  assert.equal(history.find(cycle => cycle.cycleId === first.laundryCycleId)?.collectedAt, removed.laundryCollectedAt);
  const machines = laundryMachineStates(state.workEvents!, Date.parse("2026-10-01T10:10:00.000Z"));
  assert.equal(machines[0].cycle?.room, "102");
  assert.equal(machines[2].cycle?.cycleId, washerThree.laundryCycleId);
  assert.equal(machines[5].cycle?.cycleId, dryerThree.laundryCycleId);
});

function googleFixture() {
  const collections = new Map<string, WorkEvent[]>();
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => key === "API_TOKEN" ? "test-token" : null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => structuredClone(collections.get(collection) || []);
  context.deletedAbsences_ = () => [];
  context.writeRecord_ = (collection: string, record: WorkEvent) => {
    const records = collections.get(collection) || [];
    records.push(structuredClone(record)); collections.set(collection, records);
  };
  return {
    call: (input: object) => context.doPost({ postData: { contents: JSON.stringify(input) } }),
    records: () => structuredClone(collections.get("workEvents") || []),
  };
}

test("Google laundry uses the protected transaction and applies the same machine exclusivity and replay rules", async t => {
  sheets(t);
  const google = googleFixture(), actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    return Response.json(google.call(input));
  });
  const first = start(), receipt = await executeEntry(first);
  assert.deepEqual(await executeEntry(first), receipt);
  await assert.rejects(executeEntry(start({ expectedRevision: 1 })), { code: 409 });
  const removed = collect(first), removalReceipt = await executeEntry(removed);
  assert.deepEqual(await executeEntry(removed), removalReceipt);
  await executeEntry(start({ expectedRevision: 2, room: "102", laundryStartedAt: "2026-10-01T10:00:00.000Z", occurredAt: "2026-10-01T10:00:00.000Z" }));
  assert.deepEqual(await executeEntry(first), receipt);
  assert.equal(google.records().length, 3);
  assert.equal(laundryMachineStates(google.records())[0].cycle?.room, "102");
  assert.ok(actions.every(action => action === "commitLaundryCycle"));
});

test("an old Apps Script deployment rejects laundry safely instead of accepting an unprotected booking", async t => {
  sheets(t);
  const actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    actions.push(JSON.parse(String(options?.body)).action);
    return Response.json({ ok: false, code: 400, error: "Action invalide." });
  });
  await assert.rejects(executeEntry(start()), { code: 503 });
  assert.deepEqual(actions, ["commitLaundryCycle"]);
});

test("future laundry actions are rejected before a local write or Google request", async t => {
  local(t);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const input = start({ date: future.slice(0, 10), laundryStartedAt: future, occurredAt: future });
  await assert.rejects(executeEntry(input), { code: 400 });
  assert.equal((await readState()).workEvents?.length || 0, 0);
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/laundry-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("A future action must not reach Google"); });
  await assert.rejects(executeEntry(input), { code: 400 });
  await assert.rejects(executeEntry({ ...collect(start()), occurredAt: future, laundryCollectedAt: future }), { code: 400 });
  assert.equal(request.mock.callCount(), 0);
});
