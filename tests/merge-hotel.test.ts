import assert from "node:assert/strict";
import { test } from "node:test";
import { type Issue, type State } from "../lib/domain";
import { mergeHotel } from "../lib/mergeHotel";

const issue = (patch: Partial<Issue> = {}): Issue => ({
  id: "11111111-1111-4111-8111-111111111111", version: 1,
  title: "Robinet bloqué", location: "Chambre 101", category: "Plomberie", priority: "normale",
  description: "Le robinet ne ferme plus.", assignee: "Test", reportedBy: "Test", status: "ouvert",
  date: "2026-11-11", createdAt: "2026-11-11T08:00:00Z", updatedAt: "2026-11-11T08:00:00Z",
  photoId: null, history: [], ...patch,
});
const state = (issues: Issue[] = []): State & { mode: string } => ({
  mode: "sheets", issues, inspections: [], roomInspections: [], familyEvents: [], workEvents: [], deletedFamilyEventIds: [],
});

test("a delayed refresh retains an issue created by a checklist receipt", () => {
  const saved = issue();
  const result = mergeHotel(state([saved]), state());
  assert.deepEqual(result.issues, [saved]);
  assert.equal(result.issues[0], saved);
});

test("a delayed read cannot undo a resolution or a more recent intervention", () => {
  const saved = issue({ version: 3, status: "resolu" });
  const result = mergeHotel(state([saved]), state([issue({ version: 2, status: "en_cours" })]));
  assert.equal(result.issues[0], saved);
  assert.equal(result.issues[0].status, "resolu");
});

test("a refresh accepts a newer server version and retains unchanged record references", () => {
  const first = issue(), other = issue({ id: "22222222-2222-4222-8222-222222222222" });
  const current = state([first, other]);
  const result = mergeHotel(current, state([issue({ version: 2, status: "en_cours" }), { ...other }]));
  assert.equal(result.issues[0].version, 2);
  assert.equal(result.issues[1], other);
  assert.notEqual(result, current);
});

test("an unchanged background refresh reuses the state and collections", () => {
  const current = state([issue()]);
  const result = mergeHotel(current, structuredClone(current));
  assert.equal(result, current);
  assert.equal(result.issues, current.issues);
  assert.equal(result.workEvents, current.workEvents);
});

test("changing storage source replaces rather than combines datasets", () => {
  const incoming = { ...state(), mode: "local" };
  assert.equal(mergeHotel(state([issue()]), incoming), incoming);
});
