import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test, type TestContext } from "node:test";
import { createId, type Issue, type State } from "../lib/domain";
import { buildRecoveredWorkEntry, canReplaceWorkRequest, inspectEntryRecovery, isCompleteEntryReceipt, recoveryStateIdentity } from "../lib/entryRecovery";
import type { PendingEntry } from "../lib/entryQueue";
import { parseEntry, roomChecks, roomIssue, workEntrySchema, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "../lib/rooms";
import { executeEntry, readPhoto, readState } from "../lib/storage";

function local(t: TestContext, state: State = { issues: [], inspections: [] }) {
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR"].map(key => [key, process.env[key]] as const);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-entry-recovery-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify(state));
  t.after(() => { previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }); rmSync(directory, { recursive: true, force: true }); });
}
function room(): RoomEntry {
  return parseEntry({ type: "createRoomInspection", id: createId(), schemaVersion: 6, room: "114", date: "2026-10-20", inspectedAt: "2026-10-20T10:00:00.000Z",
    actor: "Agent contrôle", notes: "Observation à conserver intégralement", condition: "bon", occupied: true, cleaning: null,
    checks: roomChecks.map(check => ({ key: check.key, result: check.key === "taps" ? "probleme" : "ok" })),
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non",
    photosData: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="], issueLinks: [], problemDetails: [],
  }) as RoomEntry;
}
function work(): WorkEntry {
  return workEntrySchema.parse({ type: "createWorkEvent", id: createId(), targetId: createId(), kind: "dailyTask", expectedRevision: 0, expectedPreviousEventId: null,
    date: "2026-10-25", occurredAt: "2026-10-20T10:00:00.000Z", room: "", actor: "Agent", notes: "Préparer la chambre", done: false, deleted: false });
}
function saved(entry: WorkEntry): WorkEvent {
  return { ...entry, version: 1, updatedAt: entry.occurredAt, submissionHash: createHash("sha256").update(JSON.stringify(workEntrySchema.parse(entry))).digest("hex") };
}
function queued(entry: RoomEntry | WorkEntry): PendingEntry { return { entry, protocol: 2, attempted: true, blocked: true, blockedReason: "conflict" }; }
const empty = (): State => ({ issues: [], inspections: [], workEvents: [], familyEvents: [], roomInspections: [] });

test("a stale room link can be corrected without losing its date, answers, notes or photos", async t => {
  const issue: Issue = { id: createId(), version: 2, date: "2026-10-19", createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z",
    title: "Robinet bloqué", description: "Robinet du lavabo bloqué", category: "Plomberie", priority: "normale", location: "Chambre 114", status: "resolu", assignee: "Agent", reportedBy: "Agent", photoId: null, history: [] };
  local(t, { ...empty(), issues: [issue] });
  const original = { ...room(), issueLinks: [{ key: "taps", issueId: issue.id }] };
  const item = queued(original), snapshot = structuredClone(item);
  await assert.rejects(executeEntry(original), { code: 409 });
  const review = await inspectEntryRecovery(item, await readState(), [item]);
  assert.equal(review.kind, "missing");
  const replacement = { ...original, id: createId(), issueLinks: [] };
  const receipt = await executeEntry(replacement);
  assert.equal(receipt.collection, "roomInspections");
  assert.equal(receipt.record.date, original.date);
  assert.deepEqual((receipt.record as RoomInspection).checks, original.checks);
  assert.equal(receipt.record.notes, original.notes);
  assert.deepEqual((receipt.record as RoomInspection).photoIds?.length, 2);
  assert.equal((await readPhoto(replacement.id, 0, "roomInspections")).toString(), "a");
  assert.equal((await readPhoto(replacement.id, 1, "roomInspections")).toString(), "b");
  assert.deepEqual(item, snapshot);
  assert.equal((await readState()).roomInspections?.length, 1);
  assert.equal(await isCompleteEntryReceipt(queued(replacement), receipt), true);
});

test("a lost room receipt confirms the original submission instead of offering a duplicate control", async t => {
  local(t);
  const entry = room(), receipt = await executeEntry(entry);
  const item = queued(entry);
  const review = await inspectEntryRecovery(item, await readState(), [item]);
  assert.equal(review.kind, "saved");
  assert.deepEqual(review.receipt, receipt);
  assert.equal((await readState()).roomInspections?.length, 1);
});

test("an inspection row without its promised technical issue is partial and cannot be acknowledged", async () => {
  const entry = room(), item = queued(entry);
  const { photosData: _photos, ...fields } = entry;
  assert.equal(_photos.length, 2);
  const record: RoomInspection = { ...fields, version: 1, updatedAt: "2026-10-20T10:05:00.000Z", photoIds: [], photoId: null,
    submissionHash: createHash("sha256").update(JSON.stringify(parseEntry(entry))).digest("hex"), issueSyncVersion: 2, createdIssue: true,
    relatedIssueIds: [], newIssueFindingKeys: ["taps"] };
  const state = { ...empty(), roomInspections: [record] };
  const review = await inspectEntryRecovery(item, state, [item]);
  assert.equal(review.kind, "partial");
  assert.equal(await isCompleteEntryReceipt(item, { collection: "roomInspections", record }), false);
  assert.equal(canReplaceWorkRequest(review, [item]), false);
  const issue = roomIssue(record)!;
  assert.equal((await inspectEntryRecovery(item, { ...state, issues: [issue] }, [item])).kind, "saved");
  assert.equal(await isCompleteEntryReceipt(item, { collection: "roomInspections", record, issue }), true);
  const legacy = { ...record, issueSyncVersion: undefined, createdIssue: undefined };
  assert.equal((await inspectEntryRecovery(item, { ...state, roomInspections: [legacy], issues: [issue] }, [item])).kind, "partial");
});

test("the exact Apps Script replay repairs a partial control before a complete receipt can remove it", async () => {
  const entry = room(), item = queued(entry);
  const { photosData: _photos, ...fields } = entry;
  const record: RoomInspection = { ...fields, version: 1, updatedAt: "2026-10-20T10:05:00.000Z", photoIds: ["photo-one", "photo-two"], photoId: "photo-one",
    submissionHash: createHash("sha256").update(JSON.stringify(parseEntry(entry))).digest("hex"), issueSyncVersion: 2, createdIssue: true,
    relatedIssueIds: [], newIssueFindingKeys: ["taps"] };
  assert.equal(_photos.length, record.photoIds?.length);
  const records: State = { ...empty(), roomInspections: [record] };
  let locked = false, failRepair = true;
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: keyof State) => { assert.equal(locked, true); return structuredClone(records[collection] || []); };
  context.deletedAbsences_ = () => [];
  context.writeRecord_ = (collection: "issues", issue: Issue) => {
    assert.equal(locked, true);
    if (failRepair) throw new Error("Temporary service failure");
    records[collection].push(structuredClone(issue));
  };
  const send = () => context.doPost({ postData: { contents: JSON.stringify({ action: "commitRoomInspectionV4", token: "test-token", collection: "roomInspections",
    expectedVersion: 0, record, issue: roomIssue(record), photosData: entry.photosData,
  }) } });
  const first = send();
  assert.equal(first.ok, false);
  assert.equal((await inspectEntryRecovery(item, records, [item])).kind, "partial");
  assert.equal(records.roomInspections?.length, 1);
  assert.equal(records.issues.length, 0);
  failRepair = false;
  const repaired = send();
  assert.equal(repaired.ok, true);
  assert.equal(await isCompleteEntryReceipt(item, repaired.data), true);
  assert.equal((await inspectEntryRecovery(item, records, [item])).kind, "saved");
  assert.equal(records.roomInspections?.length, 1);
  assert.equal(records.issues.length, 1);
});

test("a same-ID receipt with changed contents or wrong collection cannot remove a pending entry", async () => {
  const entry = work(), item = queued(entry), other = saved({ ...entry, notes: "Autre contenu" });
  const review = await inspectEntryRecovery(item, { ...empty(), workEvents: [other] }, [item]);
  assert.equal(review.kind, "different");
  assert.equal(review.receipt, undefined);
  assert.equal(await isCompleteEntryReceipt(item, { collection: "workEvents", record: other }), false);
  assert.equal(await isCompleteEntryReceipt(item, { collection: "familyEvents", record: saved(entry) } as never), false);
});

test("explicit work recovery uses the reviewed current predecessor and preserves a task's planned date", async () => {
  const base = work();
  const original = workEntrySchema.parse({ ...base, id: createId(), expectedRevision: 1, expectedPreviousEventId: base.id, done: true });
  const remote = saved({ ...base, id: createId(), expectedRevision: 1, expectedPreviousEventId: base.id, notes: "Correction du collègue" });
  const item = queued(original), state = { ...empty(), workEvents: [saved(base), remote] };
  const review = await inspectEntryRecovery(item, state, [item]);
  const replacement = buildRecoveredWorkEntry(review, [item], { id: createId(), at: "2026-10-22T10:00:00.000Z", date: "2026-10-22" });
  assert.equal(replacement.expectedPreviousEventId, remote.id);
  assert.equal(replacement.expectedRevision, 2);
  assert.equal(replacement.date, original.date);
  assert.equal(replacement.notes, original.notes);
  assert.notEqual(replacement.id, original.id);
  const dependent = queued({ ...original, id: createId(), expectedRevision: 2, expectedPreviousEventId: original.id });
  assert.throws(() => buildRecoveredWorkEntry(review, [item, dependent], { id: createId(), at: "2026-10-22T10:00:00.000Z", date: "2026-10-22" }), /autres demandes/);
  const changed = await inspectEntryRecovery(item, { ...state, workEvents: [...state.workEvents, saved({ ...remote, id: createId(), expectedRevision: 2, expectedPreviousEventId: remote.id })] }, [item]);
  assert.notEqual(recoveryStateIdentity(review), recoveryStateIdentity(changed));
  const unrelated = await inspectEntryRecovery(item, { ...state, workEvents: [...state.workEvents, saved(work())] }, [item]);
  assert.equal(recoveryStateIdentity(review), recoveryStateIdentity(unrelated));
});
