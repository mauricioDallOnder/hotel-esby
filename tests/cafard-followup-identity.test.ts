import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cafardCases, emptyCafardCase, type CafardCase } from "../lib/cafards";
import { createId } from "../lib/domain";
import { roomChecks, type RoomEntry, type WorkEntry } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";
import { validateWorkEntry } from "../lib/work";

function inspection(date: string, patch: Partial<RoomEntry> = {}): RoomEntry {
  return { type: "createRoomInspection", schemaVersion: 6, id: createId(), room: "110", date,
    inspectedAt: `${date}T09:00:00.000Z`, actor: "Agent test", notes: "Cafards toujours présents.",
    occupied: true, condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non",
    microwaveCleaning: null, fridgeCleaning: "propre", bugs: "oui", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch };
}

function followup(record: CafardCase, patch: Partial<WorkEntry> = {}): WorkEntry {
  return { type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: record.room, room: record.room,
    expectedRevision: record.revision, expectedPreviousEventId: record.lastFollowupEventId,
    cafardObservationId: record.observationId ?? null, date: "2026-11-13", occurredAt: "2026-11-13T11:00:00.000Z",
    actor: "Direction", notes: "Les cafards sont toujours présents.", cafardStatus: "signale",
    detectedOn: record.detectedOn, treatedOn: record.treatedOn, resolvedOn: null, product: record.product, ...patch };
}

function history() {
  const first = inspection("2026-10-19");
  const treatment = followup(cafardCases([first], [])[0], {
    date: "2026-11-05", occurredAt: "2026-11-05T10:00:00.000Z", cafardStatus: "traite",
    treatedOn: "2026-11-05", product: "Gel", notes: "Application du gel.",
  });
  const later = inspection("2026-11-13");
  return { first, treatment, later };
}

test("a later positive control keeps the follow-up predecessor separate from the displayed latest event", () => {
  const { first, treatment, later } = history();
  const original = structuredClone({ first, treatment, later });
  const record = cafardCases([first, later], [treatment])[0];
  assert.equal(record.revision, 1);
  assert.equal(record.lastEventId, later.id, "The card must still identify the new detection");
  assert.equal(record.observationId, later.id);
  assert.equal(record.lastFollowupEventId, treatment.id);
  assert.equal(record.status, "traite");
  assert.equal(record.detectedOn, "2026-10-19");
  assert.equal(record.treatedOn, "2026-11-05");
  assert.equal(record.product, "Gel");
  const draft = followup(record);
  assert.equal(validateWorkEntry(draft, [treatment], [], [], [first, later]), undefined);
  assert.match(validateWorkEntry({ ...draft, expectedPreviousEventId: record.lastEventId }, [treatment], [], [], [first, later])!, /modifié ailleurs/);
  assert.deepEqual({ first, treatment, later }, original, "Projection must not repair or rewrite persisted payloads");
});

test("an observation-only room has no follow-up predecessor and current drafts still reject genuine concurrent changes", () => {
  const { first, treatment, later } = history();
  assert.equal(emptyCafardCase("110").lastFollowupEventId, null);
  const observationOnly = cafardCases([first, later], [])[0];
  assert.equal(observationOnly.revision, 0);
  assert.equal(observationOnly.lastFollowupEventId, null);
  assert.equal(observationOnly.lastEventId, later.id);
  assert.equal(validateWorkEntry(followup(observationOnly), [], [], [], [first, later]), undefined);

  const draft = followup(cafardCases([first, later], [treatment])[0]);
  const colleague = { ...draft, id: createId(), notes: "Contrôle réalisé par un collègue." };
  assert.match(validateWorkEntry(draft, [treatment, colleague], [], [], [first, later])!, /modifié ailleurs/);
  const sameRevisionOtherPredecessor = { ...treatment, id: createId() };
  assert.match(validateWorkEntry(draft, [sameRevisionOtherPredecessor], [], [], [first, later])!, /modifié ailleurs/);
  const newest = inspection("2026-11-13", { inspectedAt: "2026-11-13T12:00:00.000Z" });
  assert.match(validateWorkEntry(draft, [treatment], [], [], [first, later, newest])!, /nouvelle détection/);
});

test("follow-up identity uses the same revision selection as the server instead of sorting event IDs", () => {
  const { treatment } = history();
  // Legacy equal-revision data must not choose a different predecessor solely
  // because the card sorted its history differently from the write validator.
  const lowerId = { ...treatment, id: "11111111-1111-4111-8111-111111111111" };
  const higherId = { ...treatment, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
  for (const events of [[lowerId, higherId], [higherId, lowerId]]) {
    const record = cafardCases([], events)[0];
    assert.equal(record.lastFollowupEventId, events[0].id);
    assert.equal(validateWorkEntry(followup(record), events, [], [], []), undefined);
  }
});

test("chambre110 can record still-present cafards after a newer inspection without losing treatment or duplicating a retry", async t => {
  const previous = { driver: process.env.STORAGE_DRIVER, directory: process.env.LOCAL_DATA_DIR };
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-cafard-identity-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  t.after(() => {
    if (previous.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous.driver;
    if (previous.directory === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = previous.directory;
    rmSync(directory, { recursive: true, force: true });
  });
  const { first, treatment, later } = history();
  await executeEntry(first);
  const treatedReceipt = await executeEntry(treatment);
  await executeEntry(later);
  let state = await readState();
  const current = cafardCases(state.roomInspections || [], state.workEvents || [])[0];
  const brokenDraft = followup(current, { expectedPreviousEventId: current.lastEventId });
  const originalDraft = structuredClone(brokenDraft);
  await assert.rejects(executeEntry(brokenDraft), { code: 409 });
  const corrected = followup(current, { notes: brokenDraft.notes });
  const receipt = await executeEntry(corrected);
  assert.deepEqual(await executeEntry(corrected), receipt);
  assert.deepEqual(await executeEntry(treatment), treatedReceipt);
  assert.deepEqual(brokenDraft, originalDraft, "A rejected original request remains immutable");
  state = await readState();
  const records = cafardCases(state.roomInspections || [], state.workEvents || []);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "signale");
  assert.equal(records[0].revision, 2);
  assert.equal(records[0].lastFollowupEventId, corrected.id);
  assert.equal(records[0].lastEventId, corrected.id);
  assert.equal(records[0].observationId, later.id);
  assert.equal(records[0].notes, corrected.notes);
  assert.equal(records[0].detectedOn, "2026-10-19");
  assert.equal(records[0].treatedOn, "2026-11-05");
  assert.equal(records[0].product, "Gel");
  assert.equal(state.workEvents?.length, 2);
  assert.equal(state.roomInspections?.length, 2);
  assert.equal(records[0].history.length, 4);
  assert.equal(state.issues.length, 0);
});
