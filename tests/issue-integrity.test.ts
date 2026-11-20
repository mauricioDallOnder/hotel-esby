import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCommand, createId, type Issue, type IssueFields } from "../lib/domain";
import { findDuplicateOpenIssue, linkableRoomIssueFindings, matchesRoomFinding, planRoomIssue, prepareRoomInspection, validateIssueDistinction } from "../lib/roomIssueMatching";
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

test("one inspection records independent outcomes on an existing grouped issue", () => {
  const original = roomIssue(inspection(["taps", "lights", "window"]))!;
  const record = inspection(["lights", "smoke"]);
  record.issueLinks = [
    { key: "taps", findingKey: "taps", issueId: original.id, outcome: "resolved", expectedVersion: 1, note: "Joint remplacé." },
    { key: "lights", findingKey: "lights", issueId: original.id, outcome: "present", expectedVersion: 1 },
  ];
  const before = structuredClone(original);
  const { issue, updatedIssues } = prepareRoomInspection(roomIssue(record), record, [original]);
  assert.deepEqual(original, before);
  assert.equal(updatedIssues.length, 1);
  const [updated] = updatedIssues;
  assert.equal(updated.status, "en_cours");
  assert.equal(updated.version, 2);
  assert.equal(updated.history.at(-1)?.inspectionId, record.id);
  assert.match(updated.history.at(-1)!.note, /Joint remplacé/);
  assert.deepEqual(issueFindingStates(updated), [
    { key: "taps", status: "resolu" }, { key: "lights", status: "ouvert" }, { key: "window", status: "ouvert" },
  ]);
  assert.deepEqual(issue?.roomFindings?.map(item => item.key), ["smoke"]);
  assert.deepEqual(record.relatedIssueIds, [original.id]);
  assert.deepEqual(record.issueAssociations?.map(({ key, source, status }) => ({ key, source, status })), [
    { key: "taps", source: "existing", status: "resolu" }, { key: "lights", source: "existing", status: "ouvert" },
    { key: "smoke", source: "created", status: "ouvert" },
  ]);
});

test("a repaired-only inspection accepts an OK answer and rejects a stale or ambiguous target", () => {
  const original = roomIssue(inspection(["taps", "lights"]))!;
  const record = inspection([]);
  const link = { key: "taps", issueId: original.id, outcome: "resolved" as const, expectedVersion: 1 };
  for (const [patch, message] of [[{}, /élément concerné/], [{ findingKey: "absent" }, /élément concerné/],
    [{ findingKey: "taps", expectedVersion: 2 }, /a changé/]] as const) {
    const invalid = { ...record, issueLinks: [{ ...link, ...patch }] };
    assert.throws(() => prepareRoomInspection(undefined, invalid, [original]), message);
    assert.equal(invalid.issueSyncVersion, undefined);
  }
  const valid = { ...record, issueLinks: [{ ...link, findingKey: "taps" }] };
  const { issue, updatedIssues } = prepareRoomInspection(undefined, valid, [original]);
  assert.equal(issue, undefined);
  assert.equal(updatedIssues.length, 1);
  assert.deepEqual(valid.relatedIssueIds, [original.id]);
  assert.deepEqual(valid.issueAssociations?.map(item => item.outcome), ["resolved"]);
});

test("a corrected free-text report can be observed without reusing its superseded equipment list", () => {
  const amended = { ...roomIssue(inspection(["taps", "lights"]))!, title: "Robinets de la douche", roomFindingsActive: false };
  const record = inspection(["taps"]);
  record.issueLinks = [{ key: "taps", issueId: amended.id, outcome: "present", expectedVersion: 1 }];
  const { updatedIssues } = prepareRoomInspection(roomIssue(record), record, [amended]);
  assert.deepEqual(updatedIssues[0].roomFindings, amended.roomFindings);
  assert.equal(record.issueAssociations?.[0].label, amended.title);
  assert.equal(record.issueAssociations?.[0].findingKey, undefined);
  const repaired = inspection([]);
  repaired.issueLinks = [{ key: "taps", issueId: amended.id, outcome: "resolved", expectedVersion: 1 }];
  assert.throws(() => prepareRoomInspection(undefined, repaired, [amended]), /reclassés/);
});

test("a new report created while the inspection form was open needs confirmation by ID", () => {
  const record = inspection(["lights"]);
  record.schemaVersion = 7;
  const reportedMeanwhile = roomIssue(inspection(["lights"]))!;
  assert.throws(() => prepareRoomInspection(roomIssue(record), record, [reportedMeanwhile]), /confirmez l’association/);
  assert.equal(record.issueSyncVersion, undefined);
  record.issueLinks = [{ key: "lights", issueId: reportedMeanwhile.id, expectedVersion: 1, outcome: "present" }];
  const result = prepareRoomInspection(roomIssue(record), record, [reportedMeanwhile]);
  assert.equal(result.issue, undefined);
  assert.equal(result.updatedIssues[0].id, reportedMeanwhile.id);
});

test("117 reuses the clutter and hidden radiator reports while leaving the open tap issue untouched", () => {
  const visit = { ...inspection(["room_clutter", "radiator_clear"]), room: "117", schemaVersion: 7 as const };
  visit.problemDetails = [{ key: "radiator_clear", problemType: "radiator_obstructed" }];
  const candidate = roomIssue(visit)!;
  const [heater, clutter] = candidate.roomFindings!;
  const card = (items: NonNullable<Issue["roomFindings"]>, description: string): Issue =>
    ({ ...candidate, id: createId(), roomFindings: items, title: "Chambre 117", description });
  const tap = card([{ key: "taps", label: "Robinets fonctionnels : Problème" }, { key: "damage", label: "Rien de cassé : Problème" }], "Robinet desserré");
  const radiator = card([heater], heater.label), belongings = card([clutter], clutter.label);
  const issues = [tap, radiator, belongings];
  const preview = planRoomIssue(candidate, visit, issues);
  assert.deepEqual(preview.conflicts, []);
  assert.deepEqual(preview.relatedIssueIds, [radiator.id, belongings.id]);
  const issueLinks = [heater, clutter].map((item, i) => ({ key: item.key, findingKey: item.key, issueId: issues[i + 1].id, expectedVersion: 1, outcome: "present" as const }));
  const incorrect = { ...visit, issueLinks: [{ ...issueLinks[0], issueId: tap.id, findingKey: "taps" }, issueLinks[1]] };
  assert.throws(() => prepareRoomInspection(candidate, incorrect, issues), /ne correspond pas/);
  const result = prepareRoomInspection(candidate, { ...visit, issueLinks }, issues);
  assert.equal(result.issue, undefined);
  assert.deepEqual(result.updatedIssues.map(issue => issue.id), [radiator.id, belongings.id]);

  // An older combined card can identify a heater with a different checklist key.
  const legacyHeater = { ...heater, key: "damage" };
  const mixed = card([tap.roomFindings![0], legacyHeater], "Chauffage caché et robinet desserré");
  assert.deepEqual(linkableRoomIssueFindings(mixed, heater), [legacyHeater]);
  assert.equal(planRoomIssue(candidate, visit, [mixed, belongings]).associations[0].findingKey, "damage");
  const wrongItem = { ...visit, issueLinks: [{ ...issueLinks[0], issueId: mixed.id, findingKey: "taps" }, issueLinks[1]] };
  assert.throws(() => prepareRoomInspection(candidate, wrongItem, [mixed, belongings]), /ne correspond pas/);
});

test("two present conditions in one free-text report are recorded with a single issue history event", () => {
  const record = inspection(["room_clutter", "radiator_clear"]);
  const candidate = roomIssue(record)!;
  const combined = { ...candidate, id: createId(), roomFindings: undefined, description: "Chambre encombrée et chauffage caché." };
  record.issueLinks = candidate.roomFindings!.map(finding => ({ key: finding.key, issueId: combined.id, outcome: "present", expectedVersion: combined.version }));
  const result = prepareRoomInspection(candidate, record, [combined]);
  assert.equal(result.issue, undefined);
  assert.equal(result.updatedIssues.length, 1);
  assert.equal(result.updatedIssues[0].history.filter(event => event.inspectionId === record.id).length, 1);
  assert.deepEqual(record.relatedIssueIds, [combined.id]);
  assert.equal(record.issueAssociations?.length, 2);
});

test("a minibar never creates an automatic issue and can follow an explicitly linked repair", () => {
  const record = inspection(["fridge"]);
  const current = { ...manual("Minibar en panne"), title: "Minibar", problemType: "fridge_fault" };
  assert.equal(roomIssue(record), undefined);
  record.issueLinks = [{ key: "fridge", issueId: current.id, expectedVersion: 1, outcome: "present" }];
  const first = prepareRoomInspection(undefined, record, [current]);
  assert.equal(first.issue, undefined);
  assert.equal(first.updatedIssues[0].status, "ouvert");
  const repaired = inspection([]);
  repaired.issueLinks = [{ key: "fridge", issueId: current.id, expectedVersion: 2, outcome: "resolved" }];
  const next = prepareRoomInspection(undefined, repaired, first.updatedIssues);
  assert.equal(next.issue, undefined);
  assert.equal(next.updatedIssues[0].status, "resolu");
  assert.equal(record.issueAssociations?.[0].status, "ouvert");
  assert.equal(repaired.issueAssociations?.[0].status, "resolu");
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
