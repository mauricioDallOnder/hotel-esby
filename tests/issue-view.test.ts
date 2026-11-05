import assert from "node:assert/strict";
import { test } from "node:test";
import { createId, today, type Issue } from "../lib/domain";
import { defaultIssueFilters, issueAge, issueShortcuts, lastIntervention, selectIssues, type IssueFilters } from "../lib/issueView";

const issue = (patch: Partial<Issue> = {}): Issue => ({ id: createId(), version: 1, title: "Éclairage défectueux", location: "Chambre 204", description: "Ampoule de la salle de bain", category: "Électricité", priority: "normale", status: "ouvert", assignee: "", reportedBy: "Marie", date: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-10T10:00:00Z", photoId: null,
  history: [{ at: "2026-10-10T10:00:00Z", actor: "Marie", note: "Anomalie signalée.", status: "ouvert", priority: "normale", assignee: "" }], ...patch });

test("anomaly search ignores accents and word order, includes interventions and matches room numbers exactly", () => {
  const a = issue({ history: [...issue().history, { at: "2026-10-12T10:00:00Z", actor: "Salima", note: "Pièce commandée", status: "en_cours", priority: "normale", assignee: "Technicien" }] });
  const b = issue({ location: "Chambre 1204" });
  assert.deepEqual(selectIssues([a, b], { ...defaultIssueFilters, query: "  204 eclairage  " }).map(i => i.id), [a.id]);
  assert.deepEqual(selectIssues([a, b], { ...defaultIssueFilters, query: "commande salima" }).map(i => i.id), [a.id]);
  assert.deepEqual(selectIssues([a, b], { ...defaultIssueFilters, query: "eclairage introuvable" }), []);
});

test("default ordering shows the newest reports first, breaks same-day ties by creation time and preserves the source", () => {
  const a = issue({ priority: "haute", date: "2026-10-16", createdAt: "2026-10-16T09:00:00Z" });
  const b = issue({ priority: "haute", date: "2026-10-01", createdAt: "2026-10-01T10:00:00Z" });
  const c = issue({ priority: "critique" });
  const d = issue({ priority: "critique", status: "resolu", date: "2026-10-17", createdAt: "2026-10-17T10:00:00Z" });
  const e = issue({ priority: "normale", date: "2026-10-16", createdAt: "2026-10-16T15:00:00Z" });
  const source = [a, b, c, d, e];
  assert.deepEqual(selectIssues(source, defaultIssueFilters).map(i => i.id), [e.id, a.id, c.id, b.id]);
  assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, status: "all" }).map(i => i.id), [d.id, e.id, a.id, c.id, b.id]);
  assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, sort: "priority" }).map(i => i.id), [c.id, b.id, a.id, e.id]);
  assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, sort: "priority", status: "all" }).map(i => i.id), [c.id, b.id, a.id, e.id, d.id]);
  assert.deepEqual(source, [a, b, c, d, e]);
});

test("status, category, priority, inclusive date range and missing responsible filters combine", () => {
  const a = issue({ reportedBy: " ", assignee: "  ", priority: "haute", status: "en_cours" });
  const source = [a, issue({ ...a, id: createId(), assignee: "Technicien" }), issue({ ...a, id: createId(), reportedBy: "Marie" }), issue({ ...a, id: createId(), date: "2026-10-09" }), issue({ ...a, id: createId(), category: "Plomberie" }), issue({ ...a, id: createId(), status: "resolu" })];
  const filters = { ...defaultIssueFilters, unassigned: true, priority: "haute" as const, category: "Électricité", status: "en_cours" as const, from: "2026-10-10", to: "2026-10-10" };
  assert.deepEqual(selectIssues(source, filters).map(i => i.id), [a.id]);
  assert.equal(selectIssues(source, { ...filters, from: "2026-10-11" }).length, 0);
  assert.equal(selectIssues(source, { ...defaultIssueFilters, status: "resolu" }).length, 1);
});

test("the responsible filter uses the reporter and legacy fallback while searches retain previous assignments and intervention authors", () => {
  const reported = issue({ reportedBy: "  Maurício  ", assignee: "Ancien responsable", history: [
    { ...issue().history[0], actor: "Maurício", assignee: "Ancien responsable" },
    { at: "2026-10-12T10:00:00Z", actor: "Salima", note: "Ampoule remplacée", status: "en_cours", priority: "normale", assignee: "Équipe de nuit" },
  ] });
  const legacy = issue({ reportedBy: " ", assignee: "  Jean  " });
  const missing = issue({ reportedBy: "", assignee: " " });
  const source = [reported, legacy, missing], original = structuredClone(source);
  assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, unassigned: true }).map(item => item.id), [missing.id]);
  assert.equal(issueShortcuts(source, defaultIssueFilters).find(shortcut => shortcut.id === "unassigned")?.count, 1);
  for (const query of ["mauricio", "ancien responsable", "salima remplacee", "equipe nuit"])
    assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, query }).map(item => item.id), [reported.id], query);
  assert.deepEqual(selectIssues(source, { ...defaultIssueFilters, query: "jean" }).map(item => item.id), [legacy.id]);
  assert.deepEqual(source, original);
});

test("shortcut counts match their results within the current search, dates and category, without changing the source", () => {
  const assigned = issue({ id: "assigned", priority: "critique", assignee: "Technicien", status: "en_cours" });
  const missing = issue({ id: "missing", date: "2026-10-12", priority: "normale", reportedBy: "" });
  const criticalMissing = issue({ id: "critical-missing", date: "2026-10-11", priority: "critique", reportedBy: " ", assignee: "  " });
  const source = [missing, assigned, criticalMissing,
    issue({ priority: "critique", status: "resolu" }),
    issue({ priority: "critique", location: "Chambre 1204" }),
    issue({ priority: "critique", date: "2026-10-09" }),
    issue({ priority: "critique", date: "2026-10-13" }),
    issue({ priority: "critique", category: "Plomberie" }),
    issue({ priority: "critique", title: "Prise cassée" }),
  ];
  const filters: IssueFilters = { ...defaultIssueFilters, query: "204 eclairage", category: "Électricité", from: "2026-10-10", to: "2026-10-12", sort: "oldest", status: "resolu", priority: "haute", unassigned: true };
  const originalFilters = { ...filters }, originalSource = structuredClone(source);
  const shortcuts = issueShortcuts(source, filters);
  assert.deepEqual(shortcuts.map(s => ({ id: s.id, count: s.count, selected: s.selected })), [
    { id: "pending", count: 3, selected: false },
    { id: "critical", count: 2, selected: false },
    { id: "unassigned", count: 2, selected: false },
  ]);
  const expectedIds = [[assigned.id, criticalMissing.id, missing.id], [assigned.id, criticalMissing.id], [criticalMissing.id, missing.id]];
  for (const [index, shortcut] of shortcuts.entries()) {
    assert.deepEqual(selectIssues(source, shortcut.filters).map(i => i.id), expectedIds[index]);
    const { query, from, to, category, sort } = shortcut.filters;
    assert.deepEqual({ query, from, to, category, sort }, { query: "204 eclairage", from: "2026-10-10", to: "2026-10-12", category: "Électricité", sort: "oldest" });
  }
  assert.deepEqual(issueShortcuts(source, { ...filters, from: "2026-10-13" }).map(s => s.count), [0, 0, 0]);
  assert.deepEqual(filters, originalFilters);
  assert.deepEqual(source, originalSource);
});

test("switching shortcuts replaces the previous view and derives the selected state from the actual filters", () => {
  const assigned = issue({ priority: "critique", assignee: "Technicien" });
  const missing = issue({ priority: "normale", reportedBy: "" });
  const source = [assigned, missing, issue({ priority: "critique", status: "resolu" })];
  const filters = { ...defaultIssueFilters, query: "204", from: "2026-10-10", to: "2026-10-10" };
  const critical = issueShortcuts(source, filters)[1];
  assert.deepEqual(selectIssues(source, critical.filters).map(i => i.id), [assigned.id]);
  const afterCritical = issueShortcuts(source, critical.filters);
  assert.deepEqual(afterCritical.filter(s => s.selected).map(s => s.id), ["critical"]);
  assert.deepEqual(afterCritical[1].filters, critical.filters);

  const unassigned = afterCritical[2];
  assert.deepEqual(selectIssues(source, unassigned.filters).map(i => i.id), [missing.id]);
  const afterUnassigned = issueShortcuts(source, unassigned.filters);
  assert.deepEqual(afterUnassigned.filter(s => s.selected).map(s => s.id), ["unassigned"]);
  const pending = afterUnassigned[0];
  assert.deepEqual(pending.filters, filters);
  assert.equal(selectIssues(source, pending.filters).length, 2);
  assert.deepEqual(issueShortcuts(source, pending.filters).filter(s => s.selected).map(s => s.id), ["pending"]);
  assert.deepEqual(issueShortcuts(source, { ...critical.filters, status: "resolu" }).filter(s => s.selected), []);
  assert.deepEqual(issueShortcuts(source, { ...critical.filters, unassigned: true }).filter(s => s.selected), []);
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
