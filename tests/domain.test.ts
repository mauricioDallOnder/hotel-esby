import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, emptyInspection, monthlySummary, today, type Issue, type State } from "../lib/domain.ts";

const empty: State = { issues: [], inspections: [] };
const fields = { title: "Fuite", location: "Chambre 204", category: "Plomberie" as const, priority: "critique" as const, description: "Eau sous le lavabo", assignee: "Paul" };
function create(date = "2026-01-10"): Issue {
  return applyCommand(empty, { type: "createIssue", id: crypto.randomUUID(), date, actor: "Marie", fields }, date + "T09:00:00Z").record as Issue;
}
function update(issue: Issue, status: Issue["status"], at: string): Issue {
  return applyCommand({ ...empty, issues: [issue] }, { type: "updateIssue", id: issue.id, version: issue.version, actor: "Paul", note: "Intervention effectuée", status, fields }, at).record as Issue;
}
test("a carried-over issue resolved next month is counted in the resolution month", () => {
  const issue = update(create(), "resolu", "2026-02-02T09:00:00Z");
  const state = { ...empty, issues: [issue] };
  const january = monthlySummary(state, "2026-01");
  assert.equal(january.pendingEnd.length, 1); assert.equal(january.resolvedCount, 0);
  const february = monthlySummary(state, "2026-02");
  assert.equal(february.pendingStart.length, 1); assert.equal(february.newIssues.length, 0); assert.equal(february.resolvedCount, 1); assert.equal(february.pendingEnd.length, 0);
});
test("reopening preserves prior resolutions and monthly historical status", () => {
  let issue = update(create(), "resolu", "2026-01-15T09:00:00Z");
  issue = update(issue, "en_cours", "2026-01-20T09:00:00Z");
  issue = update(issue, "resolu", "2026-02-03T09:00:00Z");
  const january = monthlySummary({ ...empty, issues: [issue] }, "2026-01");
  assert.equal(january.resolvedCount, 1); assert.equal(january.pendingEnd.length, 1); assert.equal(january.interventions.length, 2);
});
test("month boundary uses Paris time and supports leap years", () => {
  const issue = update(create(), "resolu", "2026-01-31T23:30:00Z");
  assert.equal(today(new Date("2026-01-31T23:30:00Z")), "2026-02-01");
  assert.equal(monthlySummary({ ...empty, issues: [issue] }, "2026-01").resolvedCount, 0);
  assert.equal(monthlySummary(empty, "2024-02").end, "2024-02-29");
  assert.equal(monthlySummary(empty, "2026-12").end, "2026-12-31");
});
test("inspection cannot finish unchecked or with an unlinked anomaly", () => {
  const round = { ...emptyInspection("2026-01-10"), inspector: "Marie", area: "Étage 2", completed: true };
  assert.throws(() => applyCommand(empty, { type: "saveInspection", inspection: round }), /Vérifiez tous/);
  round.checks = round.checks.map(c => ({ ...c, result: "conforme" }));
  round.checks[0].result = "anomalie";
  assert.throws(() => applyCommand(empty, { type: "saveInspection", inspection: round }), /Associez chaque/);
  const issue = create(); round.checks[0].issueId = issue.id;
  assert.equal(applyCommand({ ...empty, issues: [issue] }, { type: "saveInspection", inspection: round }).record.version, 1);
});
test("completed inspections are immutable and duplicate checklist points are rejected", () => {
  const round = { ...emptyInspection("2026-01-10"), inspector: "Marie", area: "Étage 2", completed: true };
  round.checks = round.checks.map(c => ({ ...c, result: "conforme" }));
  const result = applyCommand(empty, { type: "saveInspection", inspection: round });
  assert.equal(result.collection, "inspections"); if (result.collection !== "inspections") return;
  assert.throws(() => applyCommand({ ...empty, inspections: [result.record] }, { type: "saveInspection", inspection: result.record }), /terminée/);
  round.checks[1] = round.checks[0];
  assert.throws(() => applyCommand(empty, { type: "saveInspection", inspection: round }), /une seule fois/);
});
test("stale edits, missing resolution notes and future dates are rejected", () => {
  const issue = create();
  const command = { type: "updateIssue" as const, id: issue.id, version: 2, actor: "Paul", note: "Corrigé", status: "resolu" as const, fields };
  assert.throws(() => applyCommand({ ...empty, issues: [issue] }, command), /modifiée/);
  assert.throws(() => applyCommand({ ...empty, issues: [issue] }, { ...command, version: 1, note: " " }), /intervention/);
  assert.throws(() => applyCommand(empty, { type: "createIssue", id: crypto.randomUUID(), date: "2099-01-01", actor: "Marie", fields }), /futur/);
});
