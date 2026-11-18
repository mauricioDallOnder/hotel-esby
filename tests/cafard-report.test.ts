import assert from "node:assert/strict";
import test from "node:test";
import { cafardReportRows } from "../lib/cafardReport";
import type { Issue, State } from "../lib/domain";
import type { RoomInspection, WorkEvent } from "../lib/rooms";

const day = "2026-11-09";
const stamp = day + "T12:00:00.000Z";
function inspection(patch: Partial<RoomInspection> = {}): RoomInspection {
  return {
    type: "createRoomInspection", id: crypto.randomUUID(), version: 1, date: day, room: "203", actor: "Camille",
    updatedAt: stamp, inspectedAt: stamp, submissionHash: "test", checks: [], condition: "bon",
    carpet: "ok", carpetNotes: "", microwave: "non", bugs: "oui", notes: "Cafards près de la porte.",
    photoId: null, photoIds: ["control-photo"], ...patch,
  };
}
function followup(patch: Partial<WorkEvent> = {}): WorkEvent {
  return {
    type: "createWorkEvent", id: crypto.randomUUID(), targetId: "203", room: "203", kind: "cafardFollowup",
    date: day, occurredAt: stamp, updatedAt: stamp, expectedRevision: 0, version: 1, submissionHash: "test",
    actor: "Alex", cafardStatus: "resolu", detectedOn: "2026-11-06", resolvedOn: day,
    treatedOn: "2026-11-07", product: "Gel", notes: "Contrôle terminé.", ...patch,
  };
}
function legacy(patch: Partial<Issue> = {}): Issue {
  return {
    id: crypto.randomUUID(), version: 1, room: "203", location: "Chambre 203", title: "Cafards présents",
    description: "Blattes près de la porte.", category: "Autre", date: "2026-11-05",
    status: "ouvert", priority: "normale", assignee: "", reportedBy: "Camille", photoId: null,
    history: [], photoIds: ["legacy-photo"], createdAt: "2026-11-05T10:00:00Z", updatedAt: stamp, ...patch,
  };
}

test("one current case replaces only legacy pest-only issues and retains each original attachment once", () => {
  const old = legacy();
  const mixed = legacy({ title: "Contrôle regroupé", roomFindings: [
    { key: "bugs", label: "Cafards" }, { key: "taps", label: "Robinet cassé" },
  ] });
  const legacyOnlyRoom = legacy({ room: "201", location: "Chambre 201" });
  const control = inspection({ photoIds: ["legacy-photo", "control-photo"], relatedIssueIds: [old.id] });
  const unrelated = inspection({ bugs: "non", photoIds: ["unrelated-photo"] });
  const future = inspection({ date: "2026-11-10", photoIds: ["future-photo"] });
  const state: State = { issues: [old, mixed, legacyOnlyRoom], roomInspections: [control, unrelated, future], inspections: [] };
  const before = structuredClone(state);
  const { rows, replacedIssueIds, mixedIssueIds } = cafardReportRows(state, day, day, "complete");
  assert.deepEqual([...replacedIssueIds], [old.id]);
  assert.deepEqual([...mixedIssueIds], [mixed.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issue.room, "203");
  assert.equal(rows[0].status, "ouvert");
  assert.deepEqual(rows[0].photos?.map(({ sourceId, index, collection }) => [sourceId, index, collection]),
    [[old.id, 0, "issues"], [control.id, 1, "roomInspections"]]);
  for (const scope of ["technical", "room_clutter"] as const) {
    assert.deepEqual(cafardReportRows(state, day, day, scope), { rows: [], replacedIssueIds: new Set(), mixedIssueIds: new Set() });
  }
  assert.deepEqual(state, before);
});

test("resolved reports use the recorded resolution date and later room observations reopen the case", () => {
  const state: State = { issues: [], inspections: [], workEvents: [followup()],
    roomInspections: [inspection({ date: "2026-11-10", inspectedAt: "2026-11-10T11:00:00Z" })] };
  assert.equal(cafardReportRows(state, "2026-11-08", "2026-11-08", "complete").rows.length, 0);
  assert.equal(cafardReportRows(state, day, day, "all").rows.length, 0);
  const [resolved] = cafardReportRows(state, day, day, "resolved").rows;
  assert.equal(resolved.status, "resolu");
  assert.match(resolved.description, /Résolu le 09\/11\/2026 · Alex/);
  assert.match(resolved.description, /Contrôle terminé/);
  assert.equal(cafardReportRows(state, "2026-11-10", "2026-11-10", "resolved").rows.length, 0);
  assert.equal(cafardReportRows(state, "2026-11-10", "2026-11-10", "complete").rows[0].status, "ouvert");
  assert.equal(cafardReportRows({ ...state, roomInspections: [] }, "2026-12-01", "2026-12-31", "resolved").rows.length, 0);
});

test("a later legacy resolution cannot change a historical room report", () => {
  const old = legacy({ history: [{
    at: "2026-11-10T14:00:00Z", actor: "Alex", note: "Aucun cafard observé.", assignee: "", status: "resolu", priority: "normale",
  }] });
  const state: State = { issues: [old], inspections: [], roomInspections: [inspection()] };
  const [pending] = cafardReportRows(state, day, day, "all").rows;
  assert.equal(pending.status, "ouvert");
  assert.doesNotMatch(pending.description, /Aucun cafard/);
});

test("a treatment with an unknown detection date keeps the date of the observation unknown", () => {
  const treatment = followup({ cafardStatus: "traite", detectedOn: null, resolvedOn: null });
  const [row] = cafardReportRows({ issues: [], inspections: [], workEvents: [treatment] }, day, day, "all").rows;
  assert.equal(row.issue.date, "");
  assert.match(row.description, /Dernier suivi le 09\/11\/2026/);
});
