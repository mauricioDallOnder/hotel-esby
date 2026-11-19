import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createId, today } from "../lib/domain";
import { reportPhotos, reportRows } from "../lib/reportData";
import { roomChecks, roomEntrySchema, type RoomEntry } from "../lib/rooms";
import { roomRotation } from "../lib/roomRotation";
import { execute, executeEntry, readPhoto, readState } from "../lib/storage";

function reset() {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-323-"));
}

function inspection(problems: string[] = []): RoomEntry {
  return {
    type: "createRoomInspection", schemaVersion: 7, id: createId(), room: "323",
    date: today(), actor: "Maurice", notes: "", condition: "bon", occupied: true, cleaning: null,
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre",
    bugs: "non", photosData: [], checks: roomChecks.map(check => ({
      key: check.key, result: problems.includes(check.key) ? "probleme" : "ok",
    })),
  };
}

async function knownIssue(title: string) {
  const id = createId();
  await execute({ type: "createIssue", id, date: today(), actor: "Alice", fields: {
    location: "Chambre 323", title, description: title, category: "Équipements",
    assignee: "", priority: "normale",
  } });
  return id;
}

test("validation identifies the exact fields to correct in current and previous checklists", () => {
  for (const schemaVersion of [6, 7] as const) {
    const entry = { ...inspection(["damage"]), schemaVersion, actor: "", problemDetails: [] };
    const result = roomEntrySchema.safeParse(entry);
    assert.equal(result.success, false);
    const fields = result.error.issues.map(issue => issue.path.join("."));
    assert.ok(fields.includes("actor"));
    assert.ok(fields.includes("problemDetails"));
  }
});

test("323 commits the repaired toilet, obstructed heater and a new fault with one immutable inspection receipt", async () => {
  reset();
  const toilet = await knownIssue("Chasse d’eau cassée");
  const heater = await knownIssue("Chauffage encombré");
  const entry = inspection(["radiator_clear", "lights"]);
  entry.notes = "La chasse fonctionne. Le meuble est encore devant le radiateur.";
  entry.photosData = ["data:image/jpeg;base64,YQ=="];
  entry.issueLinks = [
    { key: "damage", issueId: toilet, outcome: "resolved", expectedVersion: 1 },
    { key: "radiator_clear", issueId: heater, outcome: "present", expectedVersion: 1 },
  ];
  const [receipt, retry] = await Promise.all([executeEntry(entry), executeEntry(structuredClone(entry))]);
  assert.equal(receipt.collection, "roomInspections");
  assert.deepEqual(retry.record, receipt.record);
  const after = await readState();
  assert.equal(after.roomInspections?.length, 1);
  const control = after.roomInspections[0];
  assert.equal(after.issues.length, 3);
  assert.deepEqual(new Set(control.relatedIssueIds), new Set([toilet, heater]));
  assert.equal(control.checks.find(c => c.key === "damage")?.result, "ok");
  assert.deepEqual(after.issues.find(i => i.id === entry.id)?.roomFindings?.map(f => f.key), ["lights"]);
  assert.equal(after.issues.find(i => i.id === toilet)?.status, "resolu");
  assert.equal(after.issues.find(i => i.id === heater)?.status, "ouvert");
  assert.equal(roomRotation([control], today()).plan[0], "323");
  assert.deepEqual(reportRows(after, "daily", today(), "resolved").map(row => row.issue.id), [toilet]);
  assert.deepEqual(new Set(reportRows(after, "daily", today(), "technical").map(row => row.issue.id)), new Set([heater, entry.id]));
  const heaterIssue = after.issues.find(i => i.id === heater)!;
  const [photo] = reportPhotos(heaterIssue, after, today());
  assert.equal(photo.sourceId, entry.id);
  assert.equal((await readPhoto(photo.sourceId, photo.index, photo.collection)).toString(), "a");

  const followUp = inspection();
  followUp.issueLinks = [{ key: "radiator_clear", issueId: heater, outcome: "resolved", expectedVersion: heaterIssue.version }];
  await executeEntry(followUp);
  // A retry after a lost response must acknowledge the original visit without replaying its effects.
  await executeEntry(entry);
  const later = await readState();
  assert.equal(later.issues.length, 3);
  assert.equal(later.roomInspections?.length, 2);
  assert.deepEqual(later.roomInspections.find(r => r.id === entry.id), control);
  assert.equal(later.issues.find(i => i.id === heater)?.status, "resolu");
  assert.equal(later.issues.find(i => i.id === heater)?.version, heaterIssue.version + 1);
});

test("a concurrent change rejects the entire write and the same inspection can be corrected and retried", async () => {
  reset();
  const toilet = await knownIssue("Abattant à remplacer");
  const heater = await knownIssue("Chauffage encombré");
  const first = inspection(["radiator_clear"]);
  first.issueLinks = [{ key: "radiator_clear", issueId: heater, outcome: "present", expectedVersion: 1 }];
  const second = inspection(["radiator_clear", "lights"]);
  second.notes = "Obstruction toujours présente.";
  second.issueLinks = [{ key: "damage", issueId: toilet, outcome: "resolved", expectedVersion: 1 }, ...first.issueLinks];
  const attempts = await Promise.allSettled([executeEntry(first), executeEntry(second)]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const after = await readState();
  assert.equal(after.roomInspections?.length, 1);
  const refused = attempts[0].status === "rejected" ? first : second;
  assert.ok(!after.roomInspections.some(r => r.id === refused.id));
  if (refused === second) {
    assert.equal(after.issues.find(i => i.id === toilet)?.status, "ouvert");
    assert.ok(!after.issues.some(i => i.id === second.id));
  }
  const reviewed = structuredClone(refused);
  reviewed.issueLinks!.find(link => link.issueId === heater)!.expectedVersion = after.issues.find(i => i.id === heater)!.version;
  await executeEntry(reviewed);
  assert.equal((await readState()).roomInspections?.length, 2);
});

test("a later checklist updates two findings on one issue independently and reports only the outstanding repair", async () => {
  reset();
  const original = await executeEntry(inspection(["taps", "lights"]));
  assert.equal(original.collection, "roomInspections");
  assert.ok(original.issue);
  const followUp = inspection(["lights"]);
  followUp.issueLinks = [
    { key: "taps", issueId: original.issue.id, findingKey: "taps", outcome: "resolved", expectedVersion: 1 },
    { key: "lights", issueId: original.issue.id, findingKey: "lights", outcome: "present", expectedVersion: 1 },
  ];
  await executeEntry(followUp);
  const state = await readState();
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].version, 2);
  assert.equal(state.issues[0].status, "en_cours");
  assert.equal(state.issues[0].history.filter(event => event.inspectionId === followUp.id).length, 1);
  const pending = reportRows(state, "daily", today(), "all");
  assert.equal(pending.length, 1);
  assert.match(pending[0].description, /Éclairage/);
  assert.doesNotMatch(pending[0].description, /Robinets/);
  assert.deepEqual(state.roomInspections?.find(r => r.id === original.record.id), original.record);
});
