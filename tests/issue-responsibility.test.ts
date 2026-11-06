import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createId, issueResponsible, type Issue, type IssueFields, type State } from "../lib/domain";
import { roomChecks, roomIssue, type RoomInspection } from "../lib/rooms";

const fields: IssueFields = { title: "Robinet bloqué", location: "Chambre 204", category: "Plomberie", priority: "normale", description: "Impossible de fermer le robinet", assignee: "Autre nom saisi par un ancien client" };
const at = "2026-11-05T08:00:00.000Z";

function report(): Issue {
  const change = applyCommand({ issues: [], inspections: [] }, {
    type: "createIssue", id: createId(), date: "2026-11-05", actor: "  Marie  ", fields,
  }, at);
  assert.equal(change.collection, "issues");
  if (change.collection !== "issues") throw new Error("Expected an anomaly");
  return change.record;
}

test("a reporter becomes the responsible person even when an older client submits another assignee", () => {
  const issue = report();
  assert.equal(issue.reportedBy, "Marie");
  assert.equal(issue.assignee, "Marie");
  assert.equal(issue.history[0].actor, "Marie");
  assert.equal(issue.history[0].assignee, "Marie");
});

test("an intervention keeps the original reporter responsible and records its own author without rewriting history", () => {
  const current = report();
  current.assignee = "Technicien historique";
  current.history[0].assignee = "Technicien historique";
  const state: State = { issues: [current], inspections: [] };
  const before = structuredClone(state);
  const change = applyCommand(state, {
    type: "updateIssue", id: current.id, version: current.version, actor: "Salima", note: "Robinet remplacé", status: "resolu", fields,
  }, "2026-11-05T10:00:00.000Z");
  assert.equal(change.collection, "issues");
  if (change.collection !== "issues") return;
  assert.equal(change.record.reportedBy, "Marie");
  assert.equal(change.record.assignee, "Marie");
  assert.equal(change.record.history.at(-1)?.actor, "Salima");
  assert.equal(change.record.history.at(-1)?.assignee, "Marie");
  assert.equal(change.record.status, "resolu");
  assert.equal(change.record.version, 2);
  assert.deepEqual(change.record.history.slice(0, -1), before.issues[0].history);
  assert.deepEqual(state, before);
});

test("legacy responsibility uses the reporter first and retains a stored assignee only when the reporter is missing", () => {
  assert.equal(issueResponsible({ reportedBy: " Marie ", assignee: "Technicien" }), "Marie");
  assert.equal(issueResponsible({ reportedBy: " ", assignee: " Technicien " }), "Technicien");
  assert.equal(issueResponsible({ assignee: "Technicien" } as Issue), "Technicien");
  assert.equal(issueResponsible({ reportedBy: "", assignee: "" }), "");
  const legacy = { ...report(), reportedBy: "", assignee: "Technicien historique" };
  const change = applyCommand({ issues: [legacy], inspections: [] }, {
    type: "updateIssue", id: legacy.id, version: legacy.version, actor: "Salima", note: "Pièce commandée", status: "en_cours", fields,
  }, at);
  assert.equal(change.collection, "issues");
  if (change.collection !== "issues") return;
  assert.equal(change.record.assignee, "Technicien historique");
  assert.equal(change.record.reportedBy, "");
  assert.equal(change.record.history.at(-1)?.actor, "Salima");
});

test("an automatic room anomaly assigns the inspector and preserves the inspection payload", () => {
  const record: RoomInspection = {
    type: "createRoomInspection", schemaVersion: 5, id: createId(), room: "204", date: "2026-11-05", actor: "Mauricio",
    notes: "", condition: "bon", occupied: true, cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non", fridgeCleaning: "propre", bugs: "non",
    checks: roomChecks.map(check => ({ key: check.key, result: check.key === "taps" ? "probleme" : "ok" })),
    version: 1, updatedAt: at, submissionHash: "a".repeat(64), photoId: null, photoIds: [],
  };
  const before = structuredClone(record);
  const issue = roomIssue(record);
  assert.ok(issue);
  assert.equal(issue.reportedBy, "Mauricio");
  assert.equal(issue.assignee, "Mauricio");
  assert.equal(issue.history[0].actor, "Mauricio");
  assert.equal(issue.history[0].assignee, "Mauricio");
  assert.deepEqual(record, before);
});
