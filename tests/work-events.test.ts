import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createId, today } from "../lib/domain";
import { workEntrySchema, type WorkEntry, type FamilyEntry } from "../lib/rooms";
import { dailyTasks, familyComments, roomAvailability, validateWorkEntry } from "../lib/work";
import { withEntryLock, withEntryWriteLock } from "../lib/entryLock";
import { comparePendingEntries } from "../lib/entryQueue";
import { freeRoomRows, buildFreeRoomsReport } from "../lib/roomPdfExport";
import { mergeHotel } from "../lib/mergeHotel";
import { executeEntry, readState, deleteAbsence } from "../lib/storage";

const task = (patch: Partial<WorkEntry> = {}): WorkEntry => ({ type: "createWorkEvent", id: createId(), targetId: createId(), kind: "dailyTask", expectedRevision: 0,
  room: "", date: "2026-10-17", actor: "Employé", notes: "Préparer les clés", occurredAt: "2026-10-17T10:00:00.000Z", done: false, deleted: false, ...patch });
const family = (): FamilyEntry => ({ type: "createFamilyEvent", id: createId(), room: "201", actor: "Marie", date: today(), notes: "Retour lundi", kind: "absence", family: "Famille test", returnDate: "" });
const comment = (parent: FamilyEntry, patch: Partial<WorkEntry> = {}): WorkEntry => ({ type: "createWorkEvent", id: createId(), targetId: createId(), kind: "familyComment", expectedRevision: 0,
  room: parent.room, familyEventId: parent.id, date: "2026-10-17", actor: "Salima", notes: "Appel de la famille", occurredAt: "2026-10-17T10:00:00.000Z", ...patch });
const availability = (free: boolean, patch: Partial<WorkEntry> = {}): WorkEntry => ({ type: "createWorkEvent", id: createId(), targetId: "101", kind: "roomAvailability", expectedRevision: 0,
  room: "101", date: "2026-10-17", actor: "Employé", notes: "", occurredAt: "2026-10-17T10:00:00.000Z", free, ...patch });
const next = (entry: WorkEntry, patch: Partial<WorkEntry> = {}) => ({ ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1, ...patch });

function local() {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-work-"));
}

test("work schemas validate entity, dates, text and kind-specific fields", () => {
  for (const entry of [task(), availability(true), comment(family())]) assert.equal(workEntrySchema.safeParse(entry).success, true);
  for (const entry of [task({ notes: " " }), task({ notes: "x".repeat(501) }), task({ targetId: "wrong" }), task({ date: "2026-02-30" }), task({ room: "201" }),
    task({ expectedRevision: -1 }), task({ done: undefined }), task({ free: true }), availability(true, { targetId: "102" }), availability(true, { room: "111", targetId: "111" }),
    availability(true, { deleted: true }), comment(family(), { familyEventId: undefined })]) assert.equal(workEntrySchema.safeParse(entry).success, false, JSON.stringify(entry));
});

test("availability can mark an uninspected room free and export it without inventing a control", async () => {
  local();
  assert.equal(roomAvailability("101", []).free, undefined);
  const free = availability(true);
  await executeEntry(free);
  const state = await readState();
  assert.equal(state.roomInspections?.length || 0, 0);
  assert.equal(state.issues.length, 0);
  assert.equal(roomAvailability("101", state.workEvents || []).free, true);
  const rows = freeRoomRows([], state.workEvents);
  assert.equal(rows.length, 1); assert.equal(rows[0][0], "101"); assert.equal(rows[0][1], "Aucun contrôle");
  assert.match(rows[0][6], /Disponibilité indiquée/);
  const report = await buildFreeRoomsReport({ hotelName: "Test", history: [], workEvents: state.workEvents });
  assert.match(report.output(), /^%PDF/);
  await executeEntry(next(free, { free: false }));
  assert.equal(freeRoomRows([], (await readState()).workEvents).length, 0);
});

test("task history supports completion, editing, rescheduling and deletion without resurrection", async () => {
  local();
  const initial = task();
  await executeEntry(initial);
  const complete = next(initial, { done: true }); await executeEntry(complete);
  assert.equal(dailyTasks((await readState()).workEvents || [], initial.date)[0].done, true);
  const edit = next(complete, { notes: "Clés et badges", date: "2026-10-18" }); await executeEntry(edit);
  let events = (await readState()).workEvents || [];
  assert.equal(dailyTasks(events, initial.date).length, 0);
  assert.equal(dailyTasks(events, edit.date)[0].notes, edit.notes);
  assert.equal(events[0].notes, initial.notes);
  const deleted = next(edit, { deleted: true }); await executeEntry(deleted);
  events = (await readState()).workEvents || [];
  assert.equal(dailyTasks(events, edit.date).length, 0);
  assert.equal(events.length, 4);
  await assert.rejects(executeEntry(next(deleted, { deleted: false })), { code: 409 });
  await assert.rejects(executeEntry(task({ deleted: true })), { code: 409 });
});

test("family comments retain the original and every edited version, with independent comment dates", async () => {
  local();
  const parent = family(); await executeEntry(parent);
  const originalEdit = comment(parent, { targetId: parent.id, notes: "Retour mardi", date: "2026-10-16" });
  await executeEntry(originalEdit);
  const additional = comment(parent, { notes: "Confirmation reçue", date: "2026-10-17" }); await executeEntry(additional);
  const revised = next(additional, { notes: "Confirmation reçue par téléphone", date: "2026-10-15" }); await executeEntry(revised);
  const state = await readState(), timeline = familyComments(parent, state.workEvents || []);
  assert.equal(state.familyEvents?.[0].notes, "Retour lundi");
  assert.deepEqual(timeline.map(c => c.date), ["2026-10-16", "2026-10-15"]);
  assert.deepEqual(timeline[0].revisions.map(r => r.notes), ["Retour lundi", "Retour mardi"]);
  assert.deepEqual(timeline[1].revisions.map(r => r.notes), ["Confirmation reçue", "Confirmation reçue par téléphone"]);
  assert.equal(familyComments({ ...parent, id: createId() }, state.workEvents || []).length, 1);
  await assert.rejects(executeEntry(comment(parent, { room: "202" })), { code: 409 });
  await deleteAbsence({ collection: "familyEvents", id: parent.id });
  await assert.rejects(executeEntry(comment(parent)), { code: 409 });
});

test("idempotent replay survives later revisions; stale concurrent edits are rejected", async () => {
  local();
  const initial = task(), receipt = await executeEntry(initial);
  const a = next(initial, { done: true }), b = next(initial, { notes: "Modification concurrente" });
  await executeEntry(a);
  await assert.rejects(executeEntry(b), { code: 409 });
  assert.deepEqual(await executeEntry(initial), receipt);
  await assert.rejects(executeEntry({ ...initial, notes: "Même ID, autre contenu" }), { code: 409 });
  assert.equal((await readState()).workEvents?.length, 2);
  const events = (await readState()).workEvents!;
  const stale = { mode: "local", issues: [], inspections: [], workEvents: [events[0]] };
  const merged = mergeHotel({ ...stale, workEvents: events }, stale);
  assert.equal(dailyTasks(merged.workEvents, initial.date)[0].done, true);
});

test("offline queue orders parents and successive edits before synchronizing", () => {
  const parent = family(), added = comment(parent), edit = next(added), task0 = task(), task1 = next(task0), task2 = next(task1);
  const unordered = [task2, edit, added, task1, parent, task0].map((entry, i) => ({ entry, queuedAt: 100 - i }));
  const sorted = unordered.sort(comparePendingEntries).map(p => p.entry);
  assert.equal(sorted[0].id, parent.id);
  const accepted: WorkEntry[] = [];
  for (const entry of sorted.slice(1)) {
    assert.equal(entry.type, "createWorkEvent");
    if (entry.type === "createWorkEvent") { assert.equal(validateWorkEntry(entry, accepted, [parent]), undefined); accepted.push(entry); }
  }
});

test("Google work save uses the protected action; old deployments fail before writes and remain retryable", async () => {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const original = globalThis.fetch, actions: string[] = [];
  try {
    globalThis.fetch = async (_url, options) => { const input = JSON.parse(options!.body as string); actions.push(input.action); return Response.json({ ok: true, data: { collection: input.collection, record: input.record } }); };
    assert.equal((await executeEntry(task())).collection, "workEvents");
    assert.deepEqual(actions, ["commitWorkEvent"]);
    globalThis.fetch = async () => Response.json({ ok: false, code: 400, error: "Action invalide." });
    await assert.rejects(executeEntry(task()), { code: 503 });
  } finally { globalThis.fetch = original; }
});


test("persisting a quick action does not wait for an in-flight slow server request", async () => {
  let release!: () => void;
  const slowNetwork = new Promise<void>(resolve => { release = resolve; });
  const sending = withEntryLock(() => slowNetwork);
  try {
    const persisted = await Promise.race([withEntryWriteLock(async () => "persisted"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    assert.equal(persisted, "persisted");
  } finally { release(); await sending; }
});
