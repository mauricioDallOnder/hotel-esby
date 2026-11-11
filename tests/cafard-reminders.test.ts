import assert from "node:assert/strict";
import test from "node:test";
import { cafardCases, cafardTreatmentReminder, type CafardStatus } from "../lib/cafards";
import { cafardSeedsFromIssues } from "../lib/cafardsLegacy";
import { createId, type Issue } from "../lib/domain";
import { roomChecks, type RoomEntry, type WorkEntry } from "../lib/rooms";

const applied = (treatedOn: string | null) => ({ status: "traite" as const, treatedOn });

test("the treatment visit becomes due on the seventh day and stays due afterwards", () => {
  const record = Object.freeze(applied("2026-10-30"));
  assert.deepEqual(cafardTreatmentReminder(record, "2026-11-05"), { dueOn: "2026-11-06", due: false });
  assert.deepEqual(cafardTreatmentReminder(record, "2026-11-06"), { dueOn: "2026-11-06", due: true });
  assert.deepEqual(cafardTreatmentReminder(record, "2026-11-16"), { dueOn: "2026-11-06", due: true });
  assert.deepEqual(record, applied("2026-10-30"));
});

test("visit dates follow the calendar across month, year, leap-day and clock changes", () => {
  const dates = [
    ["2026-01-28", "2026-02-04"],
    ["2026-12-28", "2027-01-04"],
    ["2028-02-23", "2028-03-01"],
    ["2027-02-23", "2027-03-02"],
    ["2026-03-23", "2026-03-30"],
    ["2026-10-19", "2026-10-26"],
  ];
  for (const [treatedOn, dueOn] of dates) {
    assert.deepEqual(cafardTreatmentReminder(applied(treatedOn), treatedOn), { dueOn, due: false });
    assert.deepEqual(cafardTreatmentReminder(applied(treatedOn), dueOn), { dueOn, due: true });
  }
});

test("the default day changes at Paris midnight, independently of the execution timezone", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-07T21:59:59.000Z") });
  assert.deepEqual(cafardTreatmentReminder(applied("2026-07-01")), { dueOn: "2026-07-08", due: false });
  t.mock.timers.tick(1000);
  assert.deepEqual(cafardTreatmentReminder(applied("2026-07-01")), { dueOn: "2026-07-08", due: true });
  t.mock.timers.setTime(new Date("2026-11-05T22:59:59.000Z").getTime());
  assert.deepEqual(cafardTreatmentReminder(applied("2026-10-30")), { dueOn: "2026-11-06", due: false });
  t.mock.timers.tick(1000);
  assert.deepEqual(cafardTreatmentReminder(applied("2026-10-30")), { dueOn: "2026-11-06", due: true });
});

test("unreviewable or invalid dates do not generate a misleading reminder", () => {
  for (const treatedOn of [null, "", "2026-02-30", "2026-02-29", "2026-13-01", "2026-00-01", "06/11/2026", "2026-11-06T12:00:00Z", "2026-1-01", "9999-12-31"]) {
    assert.equal(cafardTreatmentReminder(applied(treatedOn), "2026-11-06"), null, String(treatedOn));
  }
  assert.equal(cafardTreatmentReminder(applied("2026-10-30"), "2026-02-30"), null);
  assert.deepEqual(cafardTreatmentReminder(applied("2026-11-10"), "2026-11-06"), { dueOn: "2026-11-17", due: false });
});

test("resolved cases or new detections do not revive an old treatment reminder", () => {
  for (const status of ["signale", "resolu"] satisfies CafardStatus[]) {
    assert.equal(cafardTreatmentReminder({ status, treatedOn: "2026-10-01" }, "2026-11-06"), null);
  }
});

test("cases awaiting verification need a documented application date to generate a reminder", () => {
  const pending = { status: "a_verifier" as const, treatedOn: "2026-10-30" };
  assert.deepEqual(cafardTreatmentReminder(pending, "2026-11-05"), { dueOn: "2026-11-06", due: false });
  assert.deepEqual(cafardTreatmentReminder(pending, "2026-11-06"), { dueOn: "2026-11-06", due: true });
  assert.equal(cafardTreatmentReminder({ ...pending, treatedOn: null }, "2026-11-06"), null);
  assert.equal(cafardTreatmentReminder({ ...pending, treatedOn: "2026-02-30" }, "2026-11-06"), null);
});

test("new detections on an open treatment keep its original seven-day visit reminder", () => {
  const positive: RoomEntry = {
    type: "createRoomInspection", id: createId(), schemaVersion: 5, room: "101", date: "2026-11-05", inspectedAt: "2026-11-05T11:00:00.000Z",
    actor: "Agent test", notes: "Cafards encore présents.", condition: "bon", occupied: true, cleaning: null,
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "oui", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
  };
  for (const cafardStatus of ["traite", "a_verifier"] as const) {
    const treatment: WorkEntry = {
      type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: "101", room: "101",
      expectedRevision: 0, date: "2026-10-30", occurredAt: "2026-10-30T10:00:00.000Z", actor: "Agent test", notes: "Produit appliqué.",
      cafardStatus, detectedOn: "2026-10-29", treatedOn: "2026-10-30", resolvedOn: null, product: "Produit test",
    };
    const record = cafardCases([positive], [treatment])[0];
    assert.equal(record.status, cafardStatus);
    assert.deepEqual(cafardTreatmentReminder(record, "2026-11-05"), { dueOn: "2026-11-06", due: false });
    assert.deepEqual(cafardTreatmentReminder(record, "2026-11-06"), { dueOn: "2026-11-06", due: true });
    const repeated = { ...positive, id: createId(), date: "2026-11-07", inspectedAt: "2026-11-07T11:00:00.000Z" };
    const afterRepeated = cafardCases([positive, repeated], [treatment])[0];
    assert.deepEqual(cafardTreatmentReminder(afterRepeated, "2026-11-07"), { dueOn: "2026-11-06", due: true });
    assert.equal(afterRepeated.revision, 1);
  }
});

test("an application imported from legacy history gets its reminder without changing the source or status", () => {
  const issue: Issue = {
    id: createId(), version: 1, date: "2026-10-29", location: "Chambre 101",
    title: "Cafards", description: "Cafards détectés près du lavabo.", category: "Autre",
    priority: "normale", assignee: "", reportedBy: "Agent test", status: "resolu", photoId: null,
    createdAt: "2026-10-29T09:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z",
    history: [{ at: "2026-10-30T10:00:00.000Z", note: "Gel appliqué.", actor: "Agent test", status: "resolu", priority: "normale", assignee: "" }],
  };
  const before = structuredClone(issue);
  const record = cafardCases([], [], cafardSeedsFromIssues([issue]))[0];
  assert.equal(record.status, "a_verifier");
  assert.equal(record.treatedOn, "2026-10-30");
  assert.deepEqual(cafardTreatmentReminder(record, "2026-11-06"), { dueOn: "2026-11-06", due: true });
  assert.deepEqual(issue, before);
  assert.equal(record.status, "a_verifier");

  const checked: Issue = { ...issue, history: [...issue.history,
    { at: "2026-11-06T10:00:00.000Z", note: "Aucun cafard détecté lors du contrôle.", actor: "Agent test", status: "resolu", priority: "normale", assignee: "" },
  ] };
  const resolved = cafardCases([], [], cafardSeedsFromIssues([checked]))[0];
  assert.equal(resolved.status, "resolu");
  assert.equal(cafardTreatmentReminder(resolved, "2026-11-06"), null);
});

test("manual resolution, a newer positive inspection and a new treatment use the current case", () => {
  const treatment: WorkEntry = {
    type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: "101", room: "101",
    expectedRevision: 0, date: "2026-10-30", occurredAt: "2026-10-30T10:00:00.000Z", actor: "Agent test", notes: "Produit appliqué.",
    cafardStatus: "traite", detectedOn: "2026-10-29", treatedOn: "2026-10-30", resolvedOn: null, product: "Produit test",
  };
  assert.equal(cafardTreatmentReminder(cafardCases([], [treatment])[0], "2026-11-06")?.due, true);

  const resolution: WorkEntry = {
    ...treatment, id: createId(), expectedRevision: 1, date: "2026-11-06", occurredAt: "2026-11-06T10:00:00.000Z",
    cafardStatus: "resolu", resolvedOn: "2026-11-06", notes: "Vérification terminée.",
  };
  assert.equal(cafardTreatmentReminder(cafardCases([], [treatment, resolution])[0], "2026-11-06"), null);

  const positive: RoomEntry = {
    type: "createRoomInspection", id: createId(), schemaVersion: 5, room: "101", date: "2026-11-06", inspectedAt: "2026-11-06T11:00:00.000Z",
    actor: "Agent test", notes: "Cafards encore présents.", condition: "bon", occupied: true, cleaning: null,
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "oui", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
  };
  const reopened = cafardCases([positive], [treatment, resolution])[0];
  assert.equal(reopened.status, "signale");
  assert.equal(reopened.treatedOn, "2026-10-30");
  assert.equal(cafardTreatmentReminder(reopened, "2026-11-06"), null);
  const recurring = { ...positive, id: createId(), date: "2026-11-07", inspectedAt: "2026-11-07T11:00:00.000Z" };
  const stillReopened = cafardCases([positive, recurring], [treatment, resolution]);
  assert.equal(stillReopened.length, 1);
  assert.equal(stillReopened[0].status, "signale");
  assert.equal(stillReopened[0].treatedOn, "2026-10-30");
  assert.equal(stillReopened[0].revision, 2);
  assert.equal(cafardTreatmentReminder(stillReopened[0], "2026-11-07"), null);

  const newTreatment: WorkEntry = {
    ...treatment, id: createId(), expectedRevision: 2, date: "2026-11-06", occurredAt: "2026-11-06T12:00:00.000Z",
    treatedOn: "2026-11-06", notes: "Nouvelle application.",
  };
  const events = [newTreatment, treatment, resolution], before = structuredClone(events);
  const treatedAgain = cafardCases([positive], events)[0];
  assert.deepEqual(cafardTreatmentReminder(treatedAgain, "2026-11-06"), { dueOn: "2026-11-13", due: false });
  assert.deepEqual(cafardTreatmentReminder(treatedAgain, "2026-11-13"), { dueOn: "2026-11-13", due: true });
  assert.deepEqual(events, before);
});
