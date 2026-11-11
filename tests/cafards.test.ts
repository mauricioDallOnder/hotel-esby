import assert from "node:assert/strict";
import test from "node:test";
import { createId } from "../lib/domain";
import { cafardCases, type CafardSeed } from "../lib/cafards";
import { roomChecks, workEntrySchema, type RoomEntry, type RoomInspection, type WorkEntry } from "../lib/rooms";

function inspection(patch: Partial<RoomEntry> = {}): RoomEntry {
  return {
    type: "createRoomInspection", id: createId(), schemaVersion: 5, room: "101", date: "2025-10-19",
    inspectedAt: "2025-10-19T09:00:00.000Z", actor: "Agent test", notes: "Cafards près du minibar.",
    condition: "bon", occupied: true, cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non",
    microwaveCleaning: null, fridgeCleaning: "propre", bugs: "oui", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch,
  };
}

function followup(patch: Partial<WorkEntry> = {}): WorkEntry {
  return {
    type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: "101", room: "101",
    expectedRevision: 0, date: "2025-11-05", occurredAt: "2025-11-05T10:00:00.000Z", actor: "Responsable test", notes: "",
    cafardStatus: "a_verifier", detectedOn: "2025-10-19", treatedOn: null, resolvedOn: null, ...patch,
  };
}

function seed(patch: Partial<CafardSeed> = {}): CafardSeed {
  return {
    room: "101", status: "a_verifier", detectedOn: null, treatedOn: null, updatedOn: null, resolvedOn: null,
    importedAt: "2025-11-05T12:00:00.000Z", product: "", notes: "À vérifier.", sourceIssueIds: [createId()], treatments: [], ...patch,
  };
}

test("cafard follow-ups validate their room, nullable dates and status-specific chronology", () => {
  const valid = [
    followup({ detectedOn: null }),
    followup({ cafardStatus: "signale", notes: "Présence constatée." }),
    followup({ cafardStatus: "traite", treatedOn: "2025-10-29", product: " Gel " }),
    followup({ cafardStatus: "resolu", treatedOn: "2025-10-29", resolvedOn: "2025-11-05" }),
    followup({ cafardStatus: "resolu", detectedOn: null, resolvedOn: "2025-11-05" }),
  ];
  for (const entry of valid) assert.equal(workEntrySchema.safeParse(entry).success, true, JSON.stringify(entry));
  assert.equal(workEntrySchema.parse(valid[2]).product, "Gel");
  const invalid = [
    followup({ room: "", targetId: "101" }), followup({ room: "999", targetId: "999" }),
    followup({ targetId: "102" }), followup({ actor: " " }), followup({ cafardStatus: undefined }),
    followup({ detectedOn: undefined }), followup({ treatedOn: undefined }), followup({ resolvedOn: undefined }),
    followup({ detectedOn: "2025-11-06" }), followup({ treatedOn: "2025-10-18" }),
    followup({ treatedOn: "2025-02-30" }), followup({ cafardStatus: "traite" }),
    followup({ cafardStatus: "resolu" }), followup({ resolvedOn: "2025-11-05" }),
    followup({ cafardStatus: "resolu", treatedOn: "2025-11-04", resolvedOn: "2025-11-03" }),
    followup({ cafardStatus: "resolu", resolvedOn: "2025-10-18" }),
    followup({ free: true }), followup({ done: true }), followup({ deleted: false }),
    followup({ familyEventId: createId() }), followup({ product: "x".repeat(201) }),
    { ...followup(), kind: "roomAvailability", free: true },
  ];
  for (const entry of invalid) assert.equal(workEntrySchema.safeParse(entry).success, false, JSON.stringify(entry));
});

test("positive inspections produce one case per room and duplicate receipts do not duplicate history", () => {
  const first = inspection(), later = inspection({ date: "2025-10-23", inspectedAt: "2025-10-23T11:00:00.000Z", notes: "Toujours présents." });
  const other = inspection({ room: "102" });
  const clean = inspection({ room: "103", bugs: "non" });
  const notChecked = inspection({ room: "103", bugs: "non_verifie" });
  const input = [later, first, other, first, clean, notChecked], original = structuredClone(input);
  const cases = cafardCases(input, [], []);
  assert.deepEqual(cases.map(record => record.room), ["101", "102"]);
  assert.equal(cases[0].status, "signale");
  assert.equal(cases[0].detectedOn, "2025-10-19");
  assert.equal(cases[0].updatedOn, "2025-10-23");
  assert.equal(cases[0].notes, "Toujours présents.");
  assert.equal(cases[0].history.length, 2);
  assert.equal(cases[0].history[0].actor, "Agent test");
  assert.equal(cases[0].revision, 0);
  assert.equal(cases[0].lastEventId, later.id);
  assert.deepEqual(cafardCases([...input].reverse(), [], []), cases);
  assert.deepEqual(input, original);
});

test("manual revisions preserve applications and notes without a negative control resolving the case", () => {
  const positive = inspection();
  const treatment = followup({ cafardStatus: "traite", treatedOn: "2025-10-29", date: "2025-10-29", occurredAt: "2025-10-29T11:00:00.000Z", product: "Gel", notes: "Application derrière le minibar." });
  const negative = inspection({ bugs: "non", date: "2025-11-05", inspectedAt: "2025-11-05T10:00:00.000Z" });
  const active = cafardCases([negative, positive], [treatment], [])[0];
  assert.equal(active.status, "traite");
  assert.equal(active.resolvedOn, null);
  const resolved = followup({ expectedRevision: 1, cafardStatus: "resolu", treatedOn: "2025-10-29", resolvedOn: "2025-11-05", product: "Gel", notes: "Aucun cafard trouvé lors de la vérification." });
  const events = [resolved, treatment, treatment], before = structuredClone(events);
  const record = cafardCases([positive, negative], events, [])[0];
  assert.equal(record.status, "resolu");
  assert.equal(record.resolvedOn, "2025-11-05");
  assert.equal(record.treatedOn, "2025-10-29");
  assert.equal(record.product, "Gel");
  assert.equal(record.revision, 2);
  assert.equal(record.lastEventId, resolved.id);
  assert.deepEqual(record.history.map(event => event.kind), ["followup", "followup", "inspection"]);
  assert.equal(record.history[1].notes, treatment.notes);
  assert.deepEqual(events, before);
});

test("repeated detections join the open treatment without resetting its stage, dates or history", () => {
  for (const status of ["traite", "a_verifier"] as const) {
    const first = inspection();
    const treatment = followup({ cafardStatus: status, treatedOn: "2025-10-29", date: "2025-10-29",
      occurredAt: "2025-10-29T11:00:00.000Z", product: "Gel", notes: "Application derrière le minibar." });
    const later = inspection({ date: "2025-11-05", inspectedAt: "2025-11-05T11:00:00.000Z", notes: "Présence près du lavabo." });
    const repeated = inspection({ date: "2025-11-06", inspectedAt: "2025-11-06T11:00:00.000Z", notes: "Toujours présents près du lavabo." });
    const observations = [repeated, first, later, repeated], before = structuredClone({ observations, treatment });
    const records = cafardCases(observations, [treatment, treatment]);
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.status, status);
    assert.equal(record.detectedOn, "2025-10-19");
    assert.equal(record.treatedOn, "2025-10-29");
    assert.equal(record.product, "Gel");
    assert.equal(record.resolvedOn, null);
    assert.equal(record.updatedOn, "2025-11-06");
    assert.equal(record.notes, repeated.notes);
    assert.equal(record.lastEventId, repeated.id);
    assert.equal(record.observationId, repeated.id);
    assert.equal(record.revision, 1);
    assert.equal(record.history.length, 4);
    assert.equal(record.history.find(event => event.id === treatment.id)?.notes, treatment.notes);
    assert.equal(record.history.filter(event => event.kind === "inspection").length, 3);
    assert.deepEqual(cafardCases([...observations].reverse(), [treatment]), records);
    assert.deepEqual({ observations, treatment }, before);
  }
});

test("a detection preserves an imported application but confirms a room that was only awaiting inspection", () => {
  const observation = inspection({ date: "2025-11-06", inspectedAt: "2025-11-06T11:00:00.000Z" });
  const imported = seed({ treatedOn: "2025-10-29", product: "Gel", treatments: [{ date: "2025-10-29", product: "Gel" }] });
  const treated = cafardCases([observation], [], [imported])[0];
  assert.equal(treated.status, "a_verifier");
  assert.equal(treated.treatedOn, "2025-10-29");
  assert.equal(treated.product, "Gel");
  assert.equal(treated.detectedOn, null);
  assert.equal(treated.lastEventId, observation.id);
  assert.equal(treated.history.filter(event => event.status === "traite").length, 1);
  const unconfirmed = cafardCases([observation], [], [seed()])[0];
  assert.equal(unconfirmed.status, "signale");
  assert.equal(unconfirmed.detectedOn, "2025-11-06");
  assert.equal(unconfirmed.treatedOn, null);
  assert.equal(unconfirmed.revision, 0);
});

test("late or backdated inspections cannot reopen a resolved case but a later same-day detection can", () => {
  const closure = followup({ cafardStatus: "resolu", treatedOn: "2025-10-29", resolvedOn: "2025-11-05", product: "Gel" });
  const earlier = inspection({ date: "2025-11-05", inspectedAt: "2025-11-05T09:00:00.000Z" });
  const delayed: RoomInspection = { ...earlier, version: 1, submissionHash: "a".repeat(64), updatedAt: "2025-11-08T11:00:00.000Z", photoIds: [], photoId: null };
  const noTime = inspection({ date: "2025-11-05", inspectedAt: undefined });
  const backdated = inspection({ date: "2025-11-04", inspectedAt: "2025-11-08T12:00:00.000Z" });
  assert.equal(cafardCases([delayed, noTime, backdated], [closure], [])[0].status, "resolu");
  const later = inspection({ date: "2025-11-05", inspectedAt: "2025-11-05T11:00:00.000Z", notes: "Cafards revenus." });
  const record = cafardCases([later, delayed, noTime, backdated, later], [closure], [])[0];
  assert.equal(record.status, "signale");
  assert.equal(record.resolvedOn, null);
  assert.equal(record.detectedOn, "2025-10-19");
  assert.equal(record.treatedOn, "2025-10-29");
  assert.equal(record.product, "Gel");
  assert.equal(record.updatedOn, "2025-11-05");
  assert.equal(record.notes, "Cafards revenus.");
  assert.equal(record.lastEventId, later.id);
  assert.equal(record.history.filter(event => event.id === later.id).length, 1);
  assert.equal(record.history.find(event => event.id === delayed.id)?.at, earlier.inspectedAt);
  assert.equal(record.history.find(event => event.id === backdated.id)?.at, null);
});

test("same-day ordering uses Paris midnight and the resolution date rather than a later receipt", () => {
  const closure = followup({ cafardStatus: "resolu", resolvedOn: "2025-11-05", occurredAt: "2025-11-04T23:30:00.000Z" });
  const before = inspection({ date: "2025-11-05", inspectedAt: "2025-11-04T23:00:00.000Z" });
  const after = inspection({ date: "2025-11-05", inspectedAt: "2025-11-05T00:00:00.000Z" });
  assert.equal(cafardCases([before], [closure], [])[0].status, "resolu");
  assert.equal(cafardCases([before, after], [closure], [])[0].status, "signale");
  const recordedLater = followup({ date: "2025-11-05", cafardStatus: "resolu", resolvedOn: "2025-11-03" });
  const nextDay = inspection({ date: "2025-11-04", inspectedAt: "2025-11-04T11:00:00.000Z" });
  assert.equal(cafardCases([nextDay], [recordedLater], [])[0].status, "signale");
});

test("explicit revisions win over older manual snapshots even when the entered date is earlier", () => {
  const old = followup({ cafardStatus: "resolu", resolvedOn: "2025-11-05" });
  const correction = followup({ expectedRevision: 1, date: "2025-11-04", cafardStatus: "signale", notes: "Correction : des cafards sont toujours présents." });
  const record = cafardCases([], [correction, old], [])[0];
  assert.equal(record.status, "signale");
  assert.equal(record.updatedOn, "2025-11-04");
  assert.equal(record.resolvedOn, null);
  assert.equal(record.lastEventId, correction.id);
  assert.equal(record.revision, 2);
  assert.equal(record.history.length, 2);
});

test("cases start empty and runtime seeds preserve their supplied statuses and dates", () => {
  assert.deepEqual(cafardCases([], []), []);
  const initial = [
    seed({ room: "101", status: "a_verifier", detectedOn: "2025-10-01", updatedOn: "2025-10-02" }),
    seed({ room: "102", status: "signale", detectedOn: "2025-10-02", updatedOn: "2025-11-05", notes: "Observation de test." }),
    seed({ room: "103", status: "resolu", detectedOn: "2025-10-03", treatedOn: "2025-10-10", updatedOn: "2025-11-05",
      resolvedOn: "2025-11-05", product: "Produit de test", treatments: [{ date: "2025-10-10", product: "Produit de test", sourceIssueIds: [createId()] }] }),
  ];
  const original = structuredClone(initial), records = cafardCases([], [], initial);
  assert.deepEqual(records.map(record => [record.room, record.status]),
    [["101", "a_verifier"], ["102", "signale"], ["103", "resolu"]]);
  assert.equal(records[0].detectedOn, "2025-10-01");
  assert.equal(records[0].treatedOn, null);
  assert.equal(records[0].product, "");
  assert.equal(records[1].updatedOn, "2025-11-05");
  assert.equal(records[1].resolvedOn, null);
  assert.equal(records[2].resolvedOn, "2025-11-05");
  assert.equal(records[2].treatedOn, "2025-10-10");
  assert.equal(records[2].product, "Produit de test");
  assert.deepEqual(initial, original);
});

test("runtime checkpoints win over old controls but never overwrite explicit follow-ups or newer observations", () => {
  const initial = [seed({ room: "101", status: "resolu", detectedOn: "2025-10-19", treatedOn: "2025-10-29",
    resolvedOn: "2025-11-05", updatedOn: "2025-11-05", product: "Produit de test" })];
  const original = structuredClone(initial);
  const earlier = inspection({ room: "101", date: "2025-11-05", inspectedAt: "2025-11-05T11:00:00.000Z" });
  assert.equal(cafardCases([earlier], [], initial)[0].status, "resolu");
  const later = inspection({ room: "101", date: "2025-11-05", inspectedAt: "2025-11-05T13:00:00.000Z" });
  assert.equal(cafardCases([earlier, later], [], initial)[0].status, "signale");
  const update = followup({ room: "101", targetId: "101", cafardStatus: "traite", treatedOn: "2025-11-05",
    occurredAt: "2025-11-05T14:00:00.000Z", product: "Produit de test B", notes: "Nouvelle application de test." });
  const result = cafardCases([earlier, later], [update], initial)[0];
  assert.equal(result.status, "traite");
  assert.equal(result.product, "Produit de test B");
  assert.equal(result.resolvedOn, null);
  assert.equal(result.history.find(event => event.id === "initial:101")?.resolvedOn, "2025-11-05");
  assert.deepEqual(initial, original);
});

test("unknown business dates stay unknown and reopening preserves a usable chronological record", () => {
  const unknown = cafardCases([], [], [seed()])[0];
  assert.equal(unknown.detectedOn, null);
  assert.equal(unknown.treatedOn, null);
  assert.equal(unknown.updatedOn, null);
  assert.equal(unknown.resolvedOn, null);
  const closure = followup({ detectedOn: null, treatedOn: "2025-10-29", cafardStatus: "resolu", resolvedOn: "2025-11-05" });
  const later = inspection({ date: "2025-11-05", inspectedAt: "2025-11-05T14:00:00.000Z" });
  const reopened = cafardCases([later], [closure], [])[0];
  assert.equal(reopened.status, "signale");
  assert.equal(reopened.detectedOn, null);
  assert.equal(reopened.treatedOn, "2025-10-29");
  assert.equal(reopened.resolvedOn, null);
  assert.equal(workEntrySchema.safeParse(followup({ cafardStatus: reopened.status, detectedOn: reopened.detectedOn, treatedOn: reopened.treatedOn, resolvedOn: reopened.resolvedOn })).success, true);
  assert.ok(reopened.history.some(event => event.kind === "inspection" && event.detectedOn === "2025-11-05"));
});

test("the initial history retains each documented application without changing the source", () => {
  const imported = seed({ detectedOn: "2025-10-19", treatedOn: "2025-11-01", updatedOn: "2025-11-03", product: "Gel B", treatments: [
    { date: "2025-10-29", product: "Gel A" }, { date: "2025-11-01", product: "Gel B" },
  ] });
  const before = structuredClone(imported), record = cafardCases([], [], [imported])[0];
  assert.deepEqual(record.history.filter(event => event.status === "traite").map(event => [event.treatedOn, event.product]),
    [["2025-11-01", "Gel B"], ["2025-10-29", "Gel A"]]);
  assert.equal(record.product, "Gel B");
  assert.deepEqual(imported, before);
});
