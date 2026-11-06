import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../lib/domain";
import { collectedItemRoomLabel, collectedItems, filterCollectedItems } from "../lib/collectedItems";
import { parseEntry, roomSchema, workEntrySchema, type WorkEntry, type WorkEvent } from "../lib/rooms";
import { validateWorkEntry } from "../lib/work";

function item(patch: Partial<WorkEntry> = {}): WorkEntry {
  return {
    type: "createWorkEvent", id: createId(), kind: "collectedItem", targetId: createId(),
    expectedRevision: 0, room: "101", date: "2026-10-12", actor: "Agent test A", notes: "",
    occurredAt: "2026-10-12T09:00:00.000Z", itemName: "Multiprise blanche",
    collectedOn: "2026-10-10", collectedBy: "Agent test A", returnedOn: null, returnedBy: "", ...patch,
  };
}

function next(entry: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry {
  return { ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1,
    occurredAt: "2026-10-13T10:00:00.000Z", date: "2026-10-13", ...patch };
}

test("collected items require a known or explicitly unidentified room, object, collection date and collector", () => {
  const stored = item({ itemName: " Multiprise blanche ", collectedBy: " Agent test A ", notes: "   " });
  const parsed = workEntrySchema.parse(stored);
  assert.equal(parsed.itemName, "Multiprise blanche");
  assert.equal(parsed.collectedBy, "Agent test A");
  assert.equal(parsed.notes, "");
  assert.equal(parsed.returnedOn, null);
  assert.equal(parsed.returnedBy, "");
  assert.deepEqual(parseEntry(stored), parsed);
  const unidentified = workEntrySchema.parse({ ...stored, room: "", roomUnidentified: true });
  assert.equal(unidentified.room, "");
  assert.equal(unidentified.roomUnidentified, true);
  assert.equal(unidentified.notes, "");
  assert.deepEqual(parseEntry(unidentified), unidentified);
  assert.equal(roomSchema.safeParse("").success, false);
  assert.equal(roomSchema.safeParse("unidentified").success, false);
  for (const flag of [false, null, "true", 1]) {
    assert.equal(workEntrySchema.safeParse({ ...stored, room: "", roomUnidentified: flag }).success, false);
  }
  const invalid = [
    { room: "" }, { room: "999" }, { room: "unidentified", roomUnidentified: true as const },
    { room: "999", roomUnidentified: true as const }, { room: "101", roomUnidentified: true as const },
    { targetId: "101" }, { actor: " " },
    { itemName: undefined }, { itemName: " " }, { itemName: "x".repeat(201) },
    { collectedOn: undefined }, { collectedOn: "2026-02-30" }, { collectedOn: "2026-10-13" },
    { collectedBy: undefined }, { collectedBy: " " }, { collectedBy: "x".repeat(201) },
    { returnedOn: undefined }, { returnedBy: undefined }, { returnedBy: "Agent test B" },
    { returnedBy: "x".repeat(201) }, { notes: "x".repeat(4001) },
    { free: true }, { done: false }, { deleted: false }, { familyEventId: createId() },
    { cafardStatus: "signale" as const }, { detectedOn: null }, { treatedOn: null },
    { resolvedOn: null }, { product: "Gel de test" },
  ];
  for (const patch of invalid) assert.equal(workEntrySchema.safeParse(item(patch)).success, false, JSON.stringify(patch));
});

test("a return requires its own staff name and a date between collection and the update", () => {
  const returned = item({ returnedOn: "2026-10-11", returnedBy: " Agent test B " });
  assert.equal(workEntrySchema.parse(returned).returnedBy, "Agent test B");
  assert.equal(workEntrySchema.safeParse(item({ returnedOn: "2026-10-10", returnedBy: "Agent test B" })).success, true);
  for (const patch of [
    { returnedOn: "2026-10-09", returnedBy: "Agent test B" },
    { returnedOn: "2026-10-13", returnedBy: "Agent test B" },
    { returnedOn: "2026-02-30", returnedBy: "Agent test B" },
    { returnedOn: "2026-10-12", returnedBy: " " },
    { returnedOn: "2026-10-12", returnedBy: undefined },
  ]) assert.equal(workEntrySchema.safeParse(item(patch)).success, false, JSON.stringify(patch));
});

test("existing work payloads retain their serialized shape and reject fields belonging to collected items", () => {
  const common = {
    type: "createWorkEvent" as const, id: createId(), kind: "dailyTask" as const,
    targetId: createId(), expectedRevision: 0, room: "", date: "2026-10-12",
    actor: "Employé", notes: "Test", occurredAt: "2026-10-12T09:00:00.000Z",
  };
  const oldEntries: WorkEntry[] = [
    { ...common, done: false, deleted: false },
    { ...common, kind: "roomAvailability", room: "101", targetId: "101", notes: "", free: true },
    { ...common, kind: "familyComment", room: "101", familyEventId: createId() },
    { ...common, kind: "cafardFollowup", room: "101", targetId: "101", notes: "", cafardStatus: "a_verifier",
      detectedOn: null, treatedOn: null, resolvedOn: null, product: "" },
  ];
  const legacyItem = item();
  assert.equal(JSON.stringify(workEntrySchema.parse(legacyItem)), JSON.stringify(legacyItem));
  assert.equal(Object.hasOwn(workEntrySchema.parse(legacyItem), "roomUnidentified"), false);
  const legacyRecord = collectedItems([legacyItem])[0];
  assert.equal(legacyRecord.roomUnidentified, false);
  assert.equal(legacyRecord.history[0].roomUnidentified, false);
  const objectFields = { roomUnidentified: true, itemName: "Multiprise", collectedOn: "2026-10-10", collectedBy: "Agent test A", returnedOn: null, returnedBy: "" };
  for (const old of oldEntries) {
    // Existing queue hashes use JSON.stringify(parseEntry(payload)). New optional
    // fields must not add keys/defaults or change the serialized property order.
    assert.equal(JSON.stringify(workEntrySchema.parse(old)), JSON.stringify(old));
    for (const [field, value] of Object.entries(objectFields)) {
      assert.equal(workEntrySchema.safeParse({ ...old, [field]: value }).success, false, old.kind + ": " + field);
    }
  }
});

test("each physical object has an independent record and revision even when the room is shared", () => {
  const first = item({ itemName: "Multiprise blanche" });
  const second = item({ itemName: "Plaque de cuisson noire" });
  const returned = next(first, { returnedOn: "2026-10-13", returnedBy: "Agent test B", actor: "Agent test B" });
  const unrelated: WorkEntry = { type: "createWorkEvent", id: createId(), kind: "dailyTask", targetId: first.targetId,
    expectedRevision: 5, room: "", date: first.date, actor: "Employé", notes: "Test", occurredAt: first.occurredAt, done: true, deleted: false };
  assert.equal(validateWorkEntry(first, [], []), undefined);
  assert.equal(validateWorkEntry(second, [first], []), undefined);
  assert.equal(validateWorkEntry(returned, [first, second, unrelated], []), undefined);
  assert.match(validateWorkEntry(next(first), [first, returned, second], [])!, /modifié ailleurs/);
  const records = collectedItems([first, second, unrelated, returned]);
  assert.equal(records.length, 2);
  const a = records.find(record => record.id === first.targetId)!, b = records.find(record => record.id === second.targetId)!;
  assert.equal(a.returnedOn, "2026-10-13");
  assert.equal(a.returnedBy, "Agent test B");
  assert.equal(a.collectedBy, "Agent test A");
  assert.equal(a.revision, 2);
  assert.equal(b.returnedOn, null);
  assert.equal(b.revision, 1);
  assert.equal(b.history.length, 1);
  assert.deepEqual(collectedItems([]), []);
});

test("unidentified objects remain independent through return and later identification without rewriting history", () => {
  const first = item({ room: "", roomUnidentified: true, itemName: "Plaque électrique", notes: "" });
  const second = item({ room: "", roomUnidentified: true, itemName: "Multiprise bleue" });
  const returned = next(first, { returnedOn: "2026-10-13", returnedBy: "Agent test B", actor: "Agent test B" });
  assert.equal(workEntrySchema.safeParse(returned).success, true);
  assert.equal(validateWorkEntry(second, [first], []), undefined);
  assert.equal(validateWorkEntry(returned, [first, second], []), undefined);
  const beforeIdentification = collectedItems([first, second, returned]);
  assert.equal(beforeIdentification.length, 2);
  assert.equal(beforeIdentification.find(record => record.id === first.targetId)?.revision, 2);
  assert.equal(beforeIdentification.find(record => record.id === second.targetId)?.returnedOn, null);
  assert.deepEqual(filterCollectedItems(beforeIdentification, "non identifiee plaque").map(record => record.id), [first.targetId]);
  assert.equal(collectedItemRoomLabel(first.room), "Chambre non identifiée");

  const stillFlagged = next(returned, { room: "102" });
  assert.equal(workEntrySchema.safeParse(stillFlagged).success, false);
  const identified = workEntrySchema.parse({ ...stillFlagged, roomUnidentified: undefined });
  assert.equal(validateWorkEntry(identified, [first, second, returned], []), undefined);
  const records = collectedItems([returned, first, identified, second]);
  const record = records.find(record => record.id === first.targetId)!;
  assert.equal(records.length, 2);
  assert.equal(record.id, first.targetId);
  assert.equal(record.room, "102");
  assert.equal(record.roomUnidentified, false);
  assert.equal(record.revision, 3);
  assert.equal(record.returnedOn, returned.returnedOn);
  assert.equal(record.returnedBy, "Agent test B");
  assert.deepEqual(record.history.map(event => [event.room, event.roomUnidentified]), [["102", false], ["", true], ["", true]]);
  assert.deepEqual(record.history.map(event => event.id), [identified.id, returned.id, first.id]);
  assert.equal(collectedItemRoomLabel(record.room), "Chambre 102");
  assert.deepEqual(filterCollectedItems(records, "non identifiee").map(record => record.id), [second.targetId]);
  assert.deepEqual(filterCollectedItems(records, "CHAMBRE 102").map(record => record.id), [first.targetId]);
  assert.deepEqual(filterCollectedItems(records, "NON IDENTIFIÉE multiprise").map(record => record.id), [second.targetId]);

  // Projection also refuses malformed persisted data, so an accidentally blank
  // room or an inconsistent flag cannot silently become an unidentified object.
  assert.deepEqual(collectedItems([
    item({ room: "" }), item({ room: "999", roomUnidentified: true }),
    item({ room: "101", roomUnidentified: true }),
  ]), []);
});

test("corrections and cancellation of a return preserve every dated snapshot and author", () => {
  const first = item({ notes: "Appareil non autorisé." });
  const returned = next(first, { returnedOn: "2026-10-12", returnedBy: "Agent test B", actor: "Agent test B" });
  const corrected = next(returned, { room: "102", itemName: "Multiprise grise", collectedOn: "2026-10-09",
    notes: "Correction du numéro de chambre et de la description.", actor: "Direction", date: "2026-10-12",
    occurredAt: "2026-10-14T08:00:00.000Z" });
  const restored = next(corrected, { returnedOn: null, returnedBy: "", actor: "Agent test C",
    occurredAt: "2026-10-15T08:00:00.000Z", date: "2026-10-15" });
  const events = [returned, restored, first, corrected], original = structuredClone(events);
  const record = collectedItems(events)[0];
  assert.equal(record.id, first.targetId);
  assert.equal(record.revision, 4);
  assert.equal(record.lastEventId, restored.id);
  assert.equal(record.room, "102");
  assert.equal(record.itemName, "Multiprise grise");
  assert.equal(record.collectedOn, "2026-10-09");
  assert.equal(record.collectedBy, "Agent test A");
  assert.equal(record.returnedOn, null);
  assert.equal(record.returnedBy, "");
  assert.deepEqual(record.history.map(event => event.actor), ["Agent test C", "Direction", "Agent test B", "Agent test A"]);
  assert.equal(record.history[2].returnedOn, "2026-10-12");
  assert.equal(record.history[2].returnedBy, "Agent test B");
  assert.equal(record.history[3].reason, "Appareil non autorisé.");
  assert.equal(record.history[3].room, "101");
  assert.equal(record.history[3].collectedOn, "2026-10-10");
  assert.deepEqual(events, original);
  assert.deepEqual(collectedItems([...events].reverse()), [record]);
});

test("saved receipts and pending copies do not duplicate history or override newer revisions", () => {
  const first = item();
  const correction = next(first, { date: "2026-10-11", collectedOn: "2026-10-09", actor: "Direction" });
  const oldReceipt: WorkEvent = { ...first, version: 1, submissionHash: "a".repeat(64), updatedAt: "2026-10-20T12:00:00.000Z" };
  const newReceipt: WorkEvent = { ...correction, version: 1, submissionHash: "b".repeat(64), updatedAt: "2026-10-21T12:00:00.000Z" };
  const result = collectedItems([oldReceipt, correction, first, newReceipt, correction]);
  assert.equal(result.length, 1);
  assert.equal(result[0].history.length, 2);
  assert.equal(result[0].collectedOn, "2026-10-09");
  assert.equal(result[0].lastEventId, correction.id);
  assert.equal(result[0].updatedAt, correction.occurredAt);
  assert.deepEqual(collectedItems([correction, newReceipt, first, correction, oldReceipt]), result);
});

test("objects sort by collection date from newest to oldest and searches combine room, item and staff names", () => {
  const older = item({ collectedOn: "2026-10-09", itemName: "Plaque électrique", collectedBy: "Élodie Test", notes: "Équipement de plus de 100 W" });
  const newer = item({ collectedOn: "2026-10-11", room: "102", itemName: "Multiprise noire" });
  const sameDay = item({ collectedOn: "2026-10-11", room: "103", occurredAt: "2026-10-12T10:00:00.000Z" });
  const returned = next(older, { returnedOn: "2026-10-13", returnedBy: "François Test", actor: "François Test" });
  const records = collectedItems([newer, returned, sameDay, older]);
  assert.deepEqual(records.map(record => record.id), [sameDay.targetId, newer.targetId, older.targetId]);
  for (const query of ["101", "ELECTRIQUE", "elodie", "  ELOdie   101 plaque ", "francois", "100 w"]) {
    assert.deepEqual(filterCollectedItems(records, query).map(record => record.id), [older.targetId], query);
  }
  assert.deepEqual(filterCollectedItems(records, "multiprise 102").map(record => record.id), [newer.targetId]);
  assert.deepEqual(filterCollectedItems(records, "101 multiprise"), []);
  assert.deepEqual(filterCollectedItems(records, "   "), records);
  assert.deepEqual(collectedItems([older, sameDay, returned, newer]), records);
});
