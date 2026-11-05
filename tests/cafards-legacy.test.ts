import assert from "node:assert/strict";
import { test } from "node:test";
import { createId, type Event, type Issue } from "../lib/domain";
import { cafardSeedsFromIssues } from "../lib/cafardsLegacy";

const event = (note: string, at = "2025-06-02T10:00:00.000Z"): Event => ({
  at, note, actor: "Agent test", status: "resolu", priority: "normale", assignee: "",
});
const issue = (patch: Partial<Issue> = {}): Issue => ({
  id: createId(), version: 1, date: "2025-06-01", location: "Chambre 101",
  title: "Présence de cafards", description: "Cafards détectés près du lavabo.",
  category: "Autre", priority: "normale", assignee: "", reportedBy: "Agent test", status: "resolu",
  photoId: null, createdAt: "2025-06-01T09:00:00.000Z", updatedAt: "2025-06-02T10:00:00.000Z", history: [], ...patch,
});

test("legacy cafards are identified from findings or text and unrelated repairs do not resolve them", () => {
  const first = issue({ title: "Contrôle regroupé", description: "Robinet à remplacer.", roomFindings: [{ key: "bugs", label: "Nuisibles" }],
    history: [event("Robinet remplacé, problème résolu.")] });
  const duplicate = issue({ date: "2025-05-31", createdAt: "2025-05-31T09:00:00.000Z", roomFindings: [{ key: "fridge_cleaning", label: "Nettoyage" }] });
  const second = issue({ location: "102", title: "Blattes", description: "Blattes dans la chambre." });
  const unrelated = issue({ location: "103", title: "Lampe", description: "Ampoule à remplacer.", history: [event("Ampoule remplacée.")] });
  const ambiguous = issue({ location: "Chambres 101 et 102" });
  const source = [first, duplicate, second, unrelated, ambiguous], snapshot = structuredClone(source);
  const records = cafardSeedsFromIssues(source);
  assert.deepEqual(records.map(record => record.room), ["101", "102"]);
  assert.equal(records[0].status, "a_verifier");
  assert.equal(records[0].detectedOn, "2025-05-31");
  assert.equal(records[0].updatedOn, "2025-06-01");
  assert.equal(records[0].treatedOn, null);
  assert.equal(records[0].resolvedOn, null);
  assert.deepEqual(new Set(records[0].sourceIssueIds), new Set([first.id, duplicate.id]));
  assert.deepEqual(source, snapshot);
});

test("documented gel applications use Paris dates, keep previous treatments and never imply resolution", () => {
  const first = issue({ history: [
    event("Application de gel.", "2025-06-01T22:30:00.000Z"),
    event("Gel appliqué.", "2025-06-04T08:00:00.000Z"),
  ] });
  const duplicate = issue({ history: [event("Application de gel.", "2025-06-01T22:31:00.000Z")] });
  const [record] = cafardSeedsFromIssues([first, duplicate]);
  assert.equal(record.status, "a_verifier");
  assert.equal(record.product, "Gel");
  assert.equal(record.treatedOn, "2025-06-04");
  assert.equal(record.updatedOn, "2025-06-04");
  assert.equal(record.resolvedOn, null);
  assert.deepEqual(record.treatments.map(item => item.date), ["2025-06-02", "2025-06-04"]);
  assert.deepEqual(new Set(record.treatments[0].sourceIssueIds), new Set([first.id, duplicate.id]));
});

test("only an explicit negative cafard check resolves a case and later persistence reopens it", () => {
  const clear = issue({ location: "102", history: [event("Application de gel."),
    event("Aucun cafard détecté lors du contrôle.", "2025-06-03T09:00:00.000Z"),
    event("Poignée réparée.", "2025-06-05T09:00:00.000Z"),
  ] });
  const recurring = issue({ location: "103", history: [event("Application de gel."),
    event("Pas de cafards observés.", "2025-06-03T09:00:00.000Z"),
    event("Des cafards sont toujours présents.", "2025-06-04T09:00:00.000Z"),
  ] });
  const [resolved, present] = cafardSeedsFromIssues([clear, recurring]);
  assert.equal(resolved.status, "resolu");
  assert.equal(resolved.resolvedOn, "2025-06-03");
  assert.equal(resolved.updatedOn, "2025-06-03");
  assert.equal(resolved.notes, clear.history[1].note);
  assert.equal(present.status, "signale");
  assert.equal(present.resolvedOn, null);
  assert.equal(present.updatedOn, "2025-06-04");
  assert.equal(present.treatedOn, "2025-06-02");
});

test("planned or explicitly unperformed applications remain unknown", () => {
  for (const note of ["Application du produit prévue demain.", "Application de gel non réalisée.",
    "Pas d’application de gel.", "Gel non appliqué."]) {
    const [record] = cafardSeedsFromIssues([issue({ history: [event(note)] })]);
    assert.equal(record.treatedOn, null, note);
    assert.equal(record.product, "", note);
    assert.deepEqual(record.treatments, [], note);
    assert.equal(record.status, "a_verifier", note);
    assert.equal(record.updatedOn, "2025-06-01", note);
  }
  const [unknownProduct] = cafardSeedsFromIssues([issue({ history: [event("Produit appliqué.")] })]);
  assert.equal(unknownProduct.treatedOn, "2025-06-02");
  assert.equal(unknownProduct.product, "");
});

test("unknown dates and conditional absence stay unknown without a fabricated detection or resolution", () => {
  const unknown = issue({ date: "", createdAt: "", history: [event("Application de gel.", "date inconnue")] });
  const [undated] = cafardSeedsFromIssues([unknown]);
  assert.equal(undated.detectedOn, null);
  assert.equal(undated.treatedOn, null);
  assert.equal(undated.updatedOn, null);
  const [conditional] = cafardSeedsFromIssues([issue({ history: [event("Vérifier s’il n’y a plus de cafards.")] })]);
  assert.equal(conditional.status, "a_verifier");
  assert.equal(conditional.resolvedOn, null);
  assert.equal(conditional.updatedOn, "2025-06-01");
});

test("the initialization checkpoint is stable and advances only from a relevant source event", () => {
  const original = issue(), initial = cafardSeedsFromIssues([original])[0];
  assert.equal(cafardSeedsFromIssues([structuredClone(original)])[0].importedAt, initial.importedAt);
  const later = new Date(Date.parse(initial.importedAt) + 86_400_000).toISOString();
  const irrelevant = cafardSeedsFromIssues([{ ...original, updatedAt: later, history: [event("Robinet réparé.", later)] }])[0];
  assert.equal(irrelevant.importedAt, initial.importedAt);
  const relevant = cafardSeedsFromIssues([{ ...original, history: [event("Aucun cafard observé.", later)] }])[0];
  assert.equal(relevant.importedAt, later);
  assert.equal(relevant.status, "resolu");
});
