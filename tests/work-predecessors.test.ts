import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test, type TestContext } from "node:test";
import { createId } from "../lib/domain";
import { blockPendingBranch, isPermanentEntryFailure, pendingRequiresLegacyReview, type PendingEntry } from "../lib/entryQueue";
import { workEntrySchema, type WorkEntry, type WorkEvent } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";
import { latestWork, validateWorkPredecessor } from "../lib/work";

function local(t: TestContext) {
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR"].map(key => [key, process.env[key]] as const);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-predecessors-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  t.after(() => { previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }); rmSync(directory, { recursive: true, force: true }); });
  return directory;
}

function initial(kind: "collectedItem" | "cafardFollowup" | "roomAvailability"): WorkEntry {
  return workEntrySchema.parse({ type: "createWorkEvent", id: createId(), kind, targetId: kind === "collectedItem" ? createId() : "114",
    expectedRevision: 0, expectedPreviousEventId: null, room: "114", date: "2026-10-19", occurredAt: "2026-10-19T10:00:00.000Z", actor: "Initial", notes: "État initial",
    ...(kind === "collectedItem" ? { itemName: "Plaque de cuisson", collectedOn: "2026-10-19", collectedBy: "Initial", returnedOn: null, returnedBy: "" }
      : kind === "cafardFollowup" ? { cafardStatus: "signale", detectedOn: "2026-10-19", treatedOn: null, resolvedOn: null, product: "", cafardObservationId: null }
      : { free: false }),
  });
}
function next(entry: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry {
  return workEntrySchema.parse({ ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1, expectedPreviousEventId: entry.id, ...patch });
}
function branch(kind: Parameters<typeof initial>[0]) {
  const base = initial(kind);
  const a1 = next(base, kind === "cafardFollowup" ? { cafardStatus: "traite", treatedOn: "2026-10-20", product: "Produit A", date: "2026-10-20" } : { notes: "Modification A", ...(kind === "roomAvailability" ? { free: true } : {}) });
  const a2 = next(a1, kind === "cafardFollowup" ? { cafardStatus: "resolu", resolvedOn: "2026-10-21", date: "2026-10-21" }
    : kind === "collectedItem" ? { returnedOn: "2026-10-20", returnedBy: "A", date: "2026-10-20" } : { free: false });
  const b1 = next(base, kind === "cafardFollowup" ? { cafardStatus: "traite", treatedOn: "2026-10-22", product: "Produit B", date: "2026-10-22" }
    : kind === "collectedItem" ? { room: "115", notes: "Chambre corrigée par B" } : { free: true });
  return { base, a1, a2, b1 };
}

for (const kind of ["collectedItem", "cafardFollowup", "roomAvailability"] as const) {
  test(`${kind}: a refused offline predecessor cannot borrow another device's revision`, async t => {
    local(t);
    const { base, a1, a2, b1 } = branch(kind);
    await executeEntry(base); await executeEntry(b1);
    await assert.rejects(executeEntry(a1), { code: 409 });
    await assert.rejects(executeEntry(a2), { code: 409 });
    const events = (await readState()).workEvents!;
    assert.equal(events.length, 2);
    assert.equal(latestWork(events, kind).get(base.targetId)?.id, b1.id);
    assert.match(validateWorkPredecessor(a2, events, true) || "", /modifié ailleurs/);
  });
}

test("Apps Script protects the predecessor identity under its write lock as well", () => {
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
  context.writeRecord_ = (_collection: string, record: WorkEvent) => { assert.equal(locked, true); records.push(structuredClone(record)); };
  const { base, a1, a2, b1 } = branch("collectedItem");
  const send = (entry: WorkEntry) => context.doPost({ postData: { contents: JSON.stringify({ action: "commitWorkEventV2", collection: "workEvents", token: "test-token", expectedVersion: 0,
    record: { ...entry, version: 1, updatedAt: entry.occurredAt, submissionHash: createHash("sha256").update(JSON.stringify(entry)).digest("hex") },
  }) } });
  assert.equal(send(base).ok, true); assert.equal(send(b1).ok, true);
  assert.equal(send(a1).code, 409); assert.equal(send(a2).code, 409);
  assert.deepEqual(records.map(record => record.id), [base.id, b1.id]);
});

test("holding a branch survives discarding its predecessor and does not stop unrelated work", () => {
  const { a1, a2 } = branch("collectedItem"), a3 = next(a2);
  const other = initial("roomAvailability");
  const items: PendingEntry[] = [a1, a2, a3, other].map(entry => ({ entry, protocol: 2, attempted: false }));
  const changed = blockPendingBranch(items, { ...items[0], error: "Revision conflict" });
  const afterFailure = new Map(items.map(item => [item.entry.id, item]));
  changed.forEach(item => afterFailure.set(item.entry.id, item));
  afterFailure.delete(a1.id);
  assert.equal(afterFailure.get(a2.id)?.blocked, true);
  assert.equal(afterFailure.get(a2.id)?.blockedBy, a1.id);
  assert.equal(afterFailure.get(a3.id)?.blockedReason, "dependency");
  assert.equal(afterFailure.get(other.id)?.blocked, undefined);
  assert.deepEqual([...afterFailure.values()].filter(item => !item.blocked).map(item => item.entry.id), [other.id]);
});

test("legacy saved payloads retain hashes and receipts while unconfirmed revisions require review", async t => {
  const directory = local(t);
  const base = initial("roomAvailability");
  const legacy = { ...next(base, { free: true }), expectedPreviousEventId: undefined };
  const parsed = workEntrySchema.parse(legacy);
  assert.equal(JSON.stringify(parsed).includes("expectedPreviousEventId"), false);
  const receipt: WorkEvent = { ...parsed, version: 1, updatedAt: parsed.occurredAt,
    submissionHash: createHash("sha256").update(JSON.stringify(parsed)).digest("hex") };
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify({ issues: [], inspections: [], workEvents: [receipt] }));
  assert.deepEqual((await executeEntry(legacy)).record, JSON.parse(JSON.stringify(receipt)));
  await assert.rejects(executeEntry({ ...legacy, id: createId(), expectedRevision: 2 }), { code: 409 });
  assert.equal(pendingRequiresLegacyReview({ entry: legacy }), true);
  assert.equal(pendingRequiresLegacyReview({ entry: { ...base, expectedPreviousEventId: undefined } }), false);
});

test("authentication and transient transport failures never permanently block an entry", () => {
  for (const status of [401, 408, 429, 500, 502, 503, 504]) assert.equal(isPermanentEntryFailure(status), false);
  for (const status of [400, 403, 409, 413]) assert.equal(isPermanentEntryFailure(status), true);
});
