import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCommand, createId, type Issue, type IssueFields } from "../lib/domain";
import { findDuplicateOpenIssue, matchesRoomFinding, planRoomIssue, validateIssueDistinction } from "../lib/roomIssueMatching";
import { issueFindingProgress, issueFindingStates } from "../lib/issueFindings";
import { freshIssueDraft, issueDraftCommand, issueDraftIsStale } from "../lib/issueDraft";
import { roomChecks, roomIssue, type RoomInspection } from "../lib/rooms";

const now = "2026-11-12T12:00:00.000Z", date = "2026-11-12";
function inspection(keys = ["damage"]): RoomInspection {
  return { type: "createRoomInspection", id: createId(), room: "101", date, actor: "Test", notes: "", occupied: true, schemaVersion: 6,
    checks: roomChecks.map(check => ({ key: check.key, result: keys.includes(check.key) ? "probleme" : "ok" })),
    condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non",
    problemDetails: keys.includes("damage") ? [{ key: "damage", problemType: "electrical_socket", description: "Prise cassée près du lit." }] : [],
    version: 1, updatedAt: now, submissionHash: "test", photoIds: [], photoId: null };
}
function update(current: Issue, patch: Partial<Extract<Parameters<typeof applyCommand>[1], { type: "updateIssue" }>> = {}) {
  return applyCommand({ issues: [current], inspections: [] }, { type: "updateIssue", id: current.id, version: current.version,
    actor: "Direction test", note: "Intervention documentée", status: current.status, fields: current, ...patch }, now).record as Issue;
}
function manual(description: string): Issue {
  return { ...roomIssue(inspection())!, id: createId(), roomFindings: undefined, problemType: "electrical_socket",
    title: "Prise électrique cassée ou mal fixée", description };
}

test("free-text corrections invalidate obsolete fitting metadata without erasing its source", () => {
  const original = roomIssue(inspection())!;
  const fields: IssueFields = { ...original, title: "Prise cassée près de la fenêtre", description: "Prise cassée près de la fenêtre." };
  const corrected = update(original, { fields });
  assert.equal(corrected.roomFindingsActive, false);
  assert.deepEqual(corrected.roomFindings?.map(finding => finding.description), ["Prise cassée près du lit."]);
  const later = inspection();
  const plan = planRoomIssue(roomIssue(later), later, [corrected]);
  assert.deepEqual(plan.relatedIssueIds, []);
  assert.ok(plan.issue);
  assert.equal(matchesRoomFinding(corrected, { key: "damage", label: "Prise", problemType: "electrical_socket", description: "Prise cassée près du lit." }), false);
});

test("different cardinal and numbered fittings remain independent despite identical preset titles", () => {
  for (const [first, second] of [["Prise du mur nord cassée.", "Prise du mur sud cassée."], ["Prise numéro 1 cassée.", "Prise numéro 2 cassée."]])
    assert.equal(findDuplicateOpenIssue(manual(second), [manual(first)]), undefined);
});

test("an explicit, documented distinction resolves ambiguous similarity and is checked against the room", () => {
  const first = manual("Prise cassée côté armoire."), second = manual("Prise cassée côté commode.");
  assert.ok(findDuplicateOpenIssue(second, [first]));
  const distinguished = { ...second, distinctFromIssueIds: [first.id], distinctReason: "Autre prise située à côté de la commode." };
  assert.equal(validateIssueDistinction(distinguished, [first]), undefined);
  assert.equal(findDuplicateOpenIssue(distinguished, [first]), undefined);
  assert.ok(validateIssueDistinction({ ...distinguished, distinctReason: "" }, [first]));
  assert.ok(validateIssueDistinction(distinguished, [{ ...first, room: "102", location: "Chambre 102" }]));
  const change = applyCommand({ issues: [first], inspections: [] }, { type: "createIssue", id: second.id, date, actor: "Test", fields: second,
    distinctFromIssueIds: [first.id], distinctReason: distinguished.distinctReason }, now);
  assert.deepEqual((change.record as Issue).distinctFromIssueIds, [first.id]);
});

test("partial repairs retain open items and release only resolved findings for later recurrence", () => {
  const original = roomIssue(inspection(["taps", "lights"]))!;
  const partial = update(original, { status: "en_cours", findingStates: [{ key: "taps", status: "resolu" }, { key: "lights", status: "ouvert" }] });
  assert.equal(partial.status, "en_cours");
  assert.deepEqual(issueFindingProgress(partial), { total: 2, resolved: 1, pending: 1 });
  assert.equal(matchesRoomFinding(partial, { key: "taps", label: "Robinet" }), false);
  assert.equal(matchesRoomFinding(partial, { key: "lights", label: "Éclairage" }), true);
  const repeated = inspection(["taps"]);
  assert.ok(planRoomIssue(roomIssue(repeated), repeated, [partial]).issue);
  const incorrectLink = { ...repeated, issueLinks: [{ key: "taps", issueId: partial.id }] };
  assert.match(planRoomIssue(roomIssue(incorrectLink), incorrectLink, [partial]).conflicts[0], /déjà résolu/);
  assert.throws(() => update(partial, { status: "resolu", findingStates: issueFindingStates(partial) }), /Terminez chaque problème/);
  const resolved = update(partial, { status: "resolu" });
  assert.equal(resolved.status, "resolu");
  assert.equal(issueFindingProgress(resolved).pending, 0);
  assert.equal(partial.history.at(-1)?.findingStates?.find(finding => finding.key === "taps")?.status, "resolu");
  assert.equal(original.roomFindings?.some(finding => finding.status), false, "the source was not mutated");
});

test("progressing a historical duplicate remains possible while reopening an item checks duplicates again", () => {
  const original = roomIssue(inspection(["taps", "lights"]))!, duplicate = { ...original, id: createId() };
  const command = { type: "updateIssue" as const, id: original.id, version: 1, actor: "Direction", note: "Robinet réparé", fields: original,
    status: "en_cours" as const, findingStates: [{ key: "taps", status: "resolu" as const }, { key: "lights", status: "ouvert" as const }] };
  const partial = applyCommand({ issues: [original, duplicate], inspections: [] }, command, now).record as Issue;
  const draft = { ...freshIssueDraft(original), actor: command.actor, note: command.note, status: command.status, findingStates: command.findingStates };
  assert.doesNotThrow(() => applyCommand({ issues: [original, duplicate], inspections: [] }, issueDraftCommand(draft, original), now));
  assert.throws(() => applyCommand({ issues: [partial, duplicate], inspections: [] }, { ...command, version: partial.version,
    findingStates: [{ key: "taps", status: "ouvert" }, { key: "lights", status: "ouvert" }] }, now), { code: 409 });
});

test("drafts retain the original version, identifiers, notes, photos and exact uncertain request", () => {
  const original = roomIssue(inspection())!, draft = freshIssueDraft(original);
  draft.note = "Intervention en cours";
  const command = issueDraftCommand(draft, original);
  assert.equal(command.type, "updateIssue");
  const restored = JSON.parse(JSON.stringify({ ...draft, attempt: command }));
  assert.equal(issueDraftIsStale(restored, { ...original, version: 2 }), true);
  assert.deepEqual(issueDraftCommand({ ...restored, note: "changed after network loss" }, { ...original, version: 2 }), command);
  assert.equal(issueDraftIsStale(restored, { ...original, version: 2, history: [{ ...original.history[0], commandId: draft.commandId }] }), false);
  const creation = freshIssueDraft();
  creation.photos = ["data:image/jpeg;base64,YQ=="];
  creation.fields = { ...creation.fields, title: "Test", location: "101", description: "Prise cassée" };
  const creationRestored = JSON.parse(JSON.stringify(creation));
  const restoredCommand = issueDraftCommand(creationRestored);
  assert.ok(restoredCommand.type === "createIssue");
  assert.equal(restoredCommand.id, creation.id);
  assert.deepEqual(restoredCommand.photosData, creation.photos);
});
