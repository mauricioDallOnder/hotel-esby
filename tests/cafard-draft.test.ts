import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCafardDraftIdentityMixup, reloadCafardDraft, type CafardDraft } from "../lib/cafardDraft";
import { emptyCafardCase, type CafardCase } from "../lib/cafards";
import { createId } from "../lib/domain";

function fixture() {
  const observationId = createId(), predecessorId = createId();
  const current: CafardCase = { ...emptyCafardCase("110"), status: "traite", revision: 2,
    lastFollowupEventId: predecessorId, lastEventId: observationId, observationId,
    detectedOn: "2026-10-19", treatedOn: "2026-11-05", resolvedOn: null, product: "Gel", updatedOn: "2026-11-13" };
  const draft: CafardDraft = {
    type: "createWorkEvent", kind: "cafardFollowup", id: createId(), targetId: "110", room: "110",
    expectedRevision: current.revision, expectedPreviousEventId: observationId, cafardObservationId: observationId,
    date: "2026-11-13", occurredAt: "2026-11-13T09:00:00.000Z", actor: "Direction",
    cafardStatus: "signale", detectedOn: "2026-10-18", treatedOn: "2026-11-06", resolvedOn: null,
    product: "Gel précisé dans le brouillon", notes: "Les cafards sont toujours présents derrière le minibar.",
  };
  const meta = { id: createId(), date: "2026-11-14", occurredAt: "2026-11-14T10:00:00.000Z" };
  return { current, draft, meta };
}

test("explicit recovery of the exact predecessor mixup keeps Cafards présents and every entered answer", () => {
  const { current, draft, meta } = fixture();
  const snapshot = structuredClone({ current, draft });
  assert.equal(hasCafardDraftIdentityMixup(draft, current), true);
  const recovered = reloadCafardDraft(draft, current, meta);
  assert.deepEqual(recovered, { ...draft, id: meta.id, occurredAt: meta.occurredAt,
    expectedPreviousEventId: current.lastFollowupEventId });
  assert.equal(recovered.date, "2026-11-13", "Recovery is not a new physical verification");
  assert.equal(recovered.cafardStatus, "signale");
  assert.deepEqual({ current, draft }, snapshot, "Neither existing state nor the original draft is rewritten");

  const resolved = { ...draft, cafardStatus: "resolu" as const, resolvedOn: draft.date };
  assert.equal(reloadCafardDraft(resolved, current, meta).resolvedOn, resolved.resolvedOn);
});

test("a real follow-up or new detection adopts current facts but keeps the operator's observations", () => {
  const { current, draft, meta } = fixture();
  const newerFollowup = { ...current, revision: 3, lastFollowupEventId: createId(), status: "resolu" as const, resolvedOn: "2026-11-14" };
  const newerInspection = { ...current, observationId: createId(), lastEventId: createId(), status: "signale" as const };
  for (const changed of [newerFollowup, newerInspection]) {
    assert.equal(hasCafardDraftIdentityMixup(draft, changed), false);
    const recovered = reloadCafardDraft(draft, changed, meta);
    assert.equal(recovered.id, meta.id);
    assert.equal(recovered.occurredAt, meta.occurredAt);
    assert.equal(recovered.expectedRevision, changed.revision);
    assert.equal(recovered.expectedPreviousEventId, changed.lastFollowupEventId);
    assert.equal(recovered.cafardObservationId, changed.observationId);
    assert.equal(recovered.date, meta.date);
    assert.equal(recovered.cafardStatus, changed.status);
    assert.equal(recovered.detectedOn, changed.detectedOn);
    assert.equal(recovered.treatedOn, changed.treatedOn);
    assert.equal(recovered.resolvedOn, changed.resolvedOn);
    assert.equal(recovered.product, changed.product);
    assert.equal(recovered.actor, draft.actor);
    assert.equal(recovered.notes, draft.notes);
  }
});

test("legacy or unrelated identities never qualify for preservation of stale business fields", () => {
  const { current, draft, meta } = fixture();
  const missingPredecessor = { ...draft }; delete missingPredecessor.expectedPreviousEventId;
  const missingObservation = { ...draft }; delete missingObservation.cafardObservationId;
  for (const entry of [missingPredecessor, missingObservation,
    { ...draft, expectedPreviousEventId: null }, { ...draft, cafardObservationId: null },
    { ...draft, expectedPreviousEventId: createId() }, { ...draft, expectedRevision: 1 },
    { ...draft, expectedPreviousEventId: current.lastFollowupEventId }]) {
    assert.equal(hasCafardDraftIdentityMixup(entry, current), false);
    const recovered = reloadCafardDraft(entry, current, meta);
    assert.equal(recovered.cafardStatus, current.status);
    assert.equal(recovered.product, current.product);
    assert.equal(recovered.notes, draft.notes);
  }
  assert.equal(hasCafardDraftIdentityMixup({ ...draft, room: "111" }, current), false);
  assert.equal(hasCafardDraftIdentityMixup({ ...draft, targetId: "111" }, current), false);
  assert.equal(hasCafardDraftIdentityMixup({ ...draft, kind: "roomAvailability" }, current), false);
  assert.equal(hasCafardDraftIdentityMixup(draft, { ...current, observationId: null }), false);
  assert.equal(hasCafardDraftIdentityMixup({ ...draft, expectedRevision: 0 }, { ...current, revision: 0, lastFollowupEventId: null }), false);
});

test("reload refuses another room or reuse of the original submission ID", () => {
  const { current, draft, meta } = fixture();
  assert.throws(() => reloadCafardDraft(draft, { ...current, room: "111" }, meta), /autre chambre/);
  assert.throws(() => reloadCafardDraft({ ...draft, targetId: "111" }, current, meta), /autre chambre/);
  assert.throws(() => reloadCafardDraft(draft, current, { ...meta, id: draft.id }), /nouvel identifiant/);
});
