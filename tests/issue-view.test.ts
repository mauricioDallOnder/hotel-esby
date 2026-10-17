import assert from "node:assert/strict";
import { test } from "node:test";
import { createId, today, type Issue } from "../lib/domain";
import { defaultIssueFilters, issueAge, lastIntervention, selectIssues } from "../lib/issueView";

const issue = (patch: Partial<Issue> = {}): Issue => ({ id: createId(), version: 1, title: "Éclairage défectueux", location: "Chambre 204", description: "Ampoule de la salle de bain", category: "Électricité", priority: "normale", status: "ouvert", assignee: "", reportedBy: "Marie", date: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-10T10:00:00Z", photoId: null,
  history: [{ at: "2026-10-10T10:00:00Z", actor: "Marie", note: "Anomalie signalée.", status: "ouvert", priority: "normale", assignee: "" }], ...patch });

test("anomaly search ignores accents and word order, includes interventions and matches room numbers exactly", () => {
  const a = issue({ history: [...issue().history, { at: "2026-10-12T10:00:00Z", actor: "Salima", note: "Pièce commandée", status: "en_cours", priority: "normale", assignee: "Technicien" }] });
  const b = issue({ location: "Chambre 1204" });
  assert.deepEqual(selectIssues([a, b], { ...defaultIssueFilters, query: "  204 eclairage  " }).map(i => i.id), [a.id]);
  assert.deepEqual(selectIssues([a, b], { ...defaultIssueFilters, query: "commande salima" }).map(i => i.id), [a.id]);
  assert.deepEqual(selectIssues([a, b], { ...defaultIssueFilters, query: "eclairage introuvable" }), []);
});

test("default ordering puts critical issues first and oldest within a priority without mutating the source", () => {
  const a = issue({ priority: "haute", date: "2026-10-16" }), b = issue({ priority: "haute", date: "2026-10-01" }), c = issue({ priority: "critique" }), d = issue({ priority: "critique", status: "resolu" });
  const source = [a, b, c, d];
  assert.deepEqual(selectIssues(source, defaultIssueFilters).map(i => i.id), [c.id, b.id, a.id]);
  assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, status: "all" }).map(i => i.id), [c.id, b.id, a.id, d.id]);
  assert.deepEqual(source, [a, b, c, d]);
});

test("status, category, priority, inclusive date range and missing assignee filters combine", () => {
  const a = issue({ assignee: "  ", priority: "haute", status: "en_cours" });
  const source = [a, issue({ ...a, id: createId(), assignee: "Technicien" }), issue({ ...a, id: createId(), date: "2026-10-09" }), issue({ ...a, id: createId(), category: "Plomberie" }), issue({ ...a, id: createId(), status: "resolu" })];
  const filters = { ...defaultIssueFilters, unassigned: true, priority: "haute" as const, category: "Électricité", status: "en_cours" as const, from: "2026-10-10", to: "2026-10-10" };
  assert.deepEqual(selectIssues(source, filters).map(i => i.id), [a.id]);
  assert.equal(selectIssues(source, { ...filters, from: "2026-10-11" }).length, 0);
  assert.equal(selectIssues(source, { ...defaultIssueFilters, status: "resolu" }).length, 1);
});

test("chronological sorting and last intervention use saved dates rather than array position", () => {
  const a = issue({ date: "2026-10-01", updatedAt: "2026-10-17T10:00:00Z" }), b = issue({ date: "2026-10-16", updatedAt: "2026-10-16T10:00:00Z" });
  assert.equal(selectIssues([b, a], { ...defaultIssueFilters, sort: "updated" })[0].id, a.id);
  assert.equal(selectIssues([a, b], { ...defaultIssueFilters, sort: "recent" })[0].id, b.id);
  assert.equal(selectIssues([b, a], { ...defaultIssueFilters, sort: "oldest" })[0].id, a.id);
  assert.equal(lastIntervention(a), undefined);
  const event = { ...a.history[0], at: a.updatedAt, note: "Ampoule remplacée" };
  assert.equal(lastIntervention({ ...a, history: [...a.history, event] })?.note, event.note);
});

test("pending age uses Paris calendar days, clamps future dates and tolerates unknown legacy dates", () => {
  assert.equal(issueAge(issue({ date: "2026-10-17" }), today(new Date("2026-10-17T22:01:00Z"))), 1);
  assert.equal(issueAge(issue({ date: "2026-10-18" }), "2026-10-17"), 0);
  assert.equal(issueAge(issue({ date: "" }), "2026-10-17"), 0);
});
