import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createId } from "../lib/domain";
import type { PendingEntry } from "../lib/entryQueue";
import { buildRecoveredLaundryEntry, inspectLaundryRecovery, sameLaundryRecoveryReview } from "../lib/laundryRecovery";
import { workEntrySchema, type WorkEntry, type WorkEvent } from "../lib/rooms";
import { getLaundryEndsAt, getLaundryMachine, validateWorkEntry } from "../lib/work";

const start = (patch: Partial<WorkEntry> = {}): WorkEntry => {
  const entry: WorkEntry = {
    type: "createWorkEvent", kind: "laundryCycle", id: createId(), targetId: "washer-1", expectedRevision: 0,
    room: "328", date: "2026-11-10", actor: "Mauricio", notes: "Sac bleu", occurredAt: "2026-11-10T09:00:00.000Z",
    laundryCycleId: createId(), laundryStatus: "en_cours", laundryStartedAt: "2026-11-10T09:00:00.000Z",
    laundryOwner: "Repère du linge", laundryCollectedAt: null, laundryCollectedBy: "", ...patch,
  };
  return workEntrySchema.parse({ ...entry, expectedPreviousEventId: entry.expectedRevision === 0 ? null : entry.expectedPreviousEventId,
    laundryEndsAt: new Date(Date.parse(entry.laundryStartedAt!) + getLaundryMachine(entry.targetId)!.durationMinutes * 60_000).toISOString(),
  });
};
const terminal = (first: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry => {
  const result: WorkEntry = {
    ...first, id: createId(), expectedRevision: first.expectedRevision + 1, expectedPreviousEventId: first.id,
    laundryStatus: "recupere", occurredAt: "2026-11-10T09:45:00.000Z", laundryCollectedAt: "2026-11-10T09:45:00.000Z",
    laundryCollectedBy: first.actor, ...patch,
  };
  delete result.laundryAddedMinutes;
  return workEntrySchema.parse(result);
};
const extend = (first: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry => workEntrySchema.parse({
  ...first, id: createId(), expectedRevision: first.expectedRevision + 1, expectedPreviousEventId: first.id,
  actor: "Belkacem", occurredAt: "2026-11-10T09:30:00.000Z", laundryAddedMinutes: 5,
  laundryEndsAt: new Date(Date.parse(getLaundryEndsAt(first)!) + 5 * 60_000).toISOString(), ...patch,
});
const saved = (entry: WorkEntry): WorkEvent => ({
  ...entry, version: 1, updatedAt: entry.occurredAt,
  submissionHash: createHash("sha256").update(JSON.stringify(workEntrySchema.parse(entry))).digest("hex"),
});
const queued = (entry: WorkEntry): PendingEntry => ({ entry, protocol: 2, attempted: true, blocked: true, error: "Ce suivi a été modifié ailleurs." });
const confirmation = () => ({ id: createId(), at: "2026-11-10T09:50:00.000Z", date: "2026-11-10" });

test("an exact saved receipt settles only its own payload, even after later machine revisions", () => {
  const first = start(), collected = terminal(first), receipt = saved(collected);
  const next = start({ expectedRevision: 2, laundryStartedAt: "2026-11-10T09:49:00.000Z", occurredAt: "2026-11-10T09:49:00.000Z" });
  const review = inspectLaundryRecovery(collected, [saved(first), receipt, saved(next)], [queued(collected)]);
  assert.equal(review.kind, "saved");
  assert.equal(review.confirmed, receipt);
  assert.equal(review.original, collected);
  // Receipt metadata and property ordering do not change the submitted payload.
  const reversed = Object.fromEntries(Object.entries(receipt).reverse()) as WorkEvent;
  assert.equal(inspectLaundryRecovery(collected, [reversed], []).kind, "saved");
});

test("a reused event ID with different data or an incomplete receipt never settles or retries", () => {
  const first = start(), collected = terminal(first);
  const other = saved({ ...collected, actor: "Autre agent", laundryCollectedBy: "Autre agent" });
  for (const receipt of [other, { ...saved(collected), notes: "Autre note" }, { ...saved(collected), version: 2 },
    { ...saved(collected), submissionHash: "incomplet" }, { ...saved(collected), updatedAt: "inconnu" }]) {
    const review = inspectLaundryRecovery(collected, [saved(first), receipt], [queued(collected)]);
    assert.equal(review.kind, "review");
    assert.equal(review.confirmed, undefined);
    assert.throws(() => buildRecoveredLaundryEntry(review, confirmation()));
  }
  assert.equal(inspectLaundryRecovery(collected, [saved(collected), other], []).kind, "review");
});

test("the two room 328 washer requests remain independent and valid originals can be retried unchanged", () => {
  const washer1 = start(), washer3 = start({ targetId: "washer-3", actor: "Belkacem" });
  const one = terminal(washer1), three = terminal(washer3);
  const entries = [queued(one), queued(three)];
  const events = [saved(washer1), saved(washer3)];
  for (const entry of [one, three]) {
    const review = inspectLaundryRecovery(entry, events, entries);
    assert.equal(review.kind, "retry");
    assert.equal(review.original, entry);
    assert.equal(review.current?.targetId, entry.targetId);
  }
  const otherReceipt = saved(terminal(washer3, { actor: "Agent soir", laundryCollectedBy: "Agent soir" }));
  assert.equal(inspectLaundryRecovery(one, [...events, otherReceipt], entries).kind, "retry");
  assert.equal(inspectLaundryRecovery(three, [...events, otherReceipt], entries).kind, "completed");
});

test("a completed same cycle is recognized after the machine is reused without changing actual collector or time", () => {
  const first = start(), requested = terminal(first);
  const actual = saved(terminal(first, { actor: "Belkacem", laundryCollectedBy: "Belkacem", notes: "Retiré par le collègue",
    occurredAt: "2026-11-10T09:46:00.000Z", laundryCollectedAt: "2026-11-10T09:46:00.000Z" }));
  const newer = saved(start({ expectedRevision: 2, laundryStartedAt: "2026-11-10T09:48:00.000Z", occurredAt: "2026-11-10T09:48:00.000Z" }));
  const review = inspectLaundryRecovery(requested, [newer, actual, saved(first)], [queued(requested)]);
  assert.equal(review.kind, "completed");
  assert.equal(review.confirmed, actual);
  assert.equal(review.current, newer);
  assert.equal(review.confirmed?.laundryCollectedBy, "Belkacem");
  assert.equal(review.confirmed?.laundryCollectedAt, "2026-11-10T09:46:00.000Z");
  assert.equal(review.original.notes, "Sac bleu");
  assert.throws(() => buildRecoveredLaundryEntry(review, confirmation()));
});

test("opposite terminal states need review and a different load in the same room is never an equivalent receipt", () => {
  const first = start(), collected = terminal(first), cancelled = terminal(first, { laundryStatus: "annule", laundryCollectedAt: null, laundryCollectedBy: "" });
  for (const [request, actual] of [[collected, cancelled], [cancelled, collected]]) {
    const review = inspectLaundryRecovery(request, [saved(first), saved(actual)], [queued(request)]);
    assert.equal(review.kind, "review");
    assert.equal(review.confirmed?.laundryStatus, actual.laundryStatus);
  }
  const other = start(), otherCollected = terminal(other);
  assert.equal(inspectLaundryRecovery(collected, [saved(other), saved(otherCollected)], [queued(collected)]).kind, "review");
  assert.equal(inspectLaundryRecovery(cancelled, [saved(first), saved(cancelled)], []).kind, "saved");
  const duplicateCancel = terminal(first, { laundryStatus: "annule", laundryCollectedAt: null, laundryCollectedBy: "" });
  assert.equal(inspectLaundryRecovery(cancelled, [saved(first), saved(duplicateCancel)], []).kind, "completed");
});

test("a stale retrieval after an extension can be explicitly reconfirmed on the same active load", () => {
  const first = start(), requested = terminal(first), extended = extend(first);
  const events = [saved(first), saved(extended)], queue = [queued(requested)];
  const before = structuredClone({ requested, events, queue });
  const review = inspectLaundryRecovery(requested, events, queue);
  assert.equal(review.kind, "reconfirm");
  const details = confirmation(), replacement = buildRecoveredLaundryEntry(review, details);
  assert.equal(replacement.id, details.id);
  assert.equal(replacement.expectedRevision, 2);
  assert.equal(replacement.laundryEndsAt, extended.laundryEndsAt);
  assert.equal(replacement.occurredAt, details.at);
  assert.equal(replacement.laundryCollectedAt, details.at);
  assert.equal(replacement.actor, requested.actor);
  assert.equal(replacement.laundryCollectedBy, requested.actor);
  assert.equal(replacement.notes, requested.notes);
  for (const field of ["laundryCycleId", "targetId", "room", "laundryOwner", "laundryStartedAt"] as const)
    assert.equal(replacement[field], requested[field]);
  assert.equal(replacement.laundryAddedMinutes, undefined);
  assert.equal(validateWorkEntry(replacement, events, []), undefined);
  assert.deepEqual({ requested, events, queue }, before);
});

test("explicit cancellation recovery retains custody fields and legacy planned ends", () => {
  const first = start(); delete first.laundryEndsAt;
  const requested = terminal(first, { laundryStatus: "annule", laundryCollectedAt: null, laundryCollectedBy: "" });
  const extended = extend(first);
  const review = inspectLaundryRecovery(requested, [saved(first), saved(extended)], [queued(requested)]);
  assert.equal(review.kind, "reconfirm");
  const replacement = buildRecoveredLaundryEntry(review, confirmation());
  assert.equal(replacement.laundryStatus, "annule");
  assert.equal(replacement.laundryCollectedAt, null);
  assert.equal(replacement.laundryCollectedBy, "");
  assert.equal(replacement.laundryEndsAt, extended.laundryEndsAt);
  assert.equal(replacement.laundryAddedMinutes, undefined);
});

test("offline dependent machine requests block retries and rebasing while unrelated machines do not", () => {
  const first = start(), requested = terminal(first), extended = extend(first);
  const next = start({ expectedRevision: 2, laundryStartedAt: "2026-11-10T09:48:00.000Z", occurredAt: "2026-11-10T09:48:00.000Z" });
  for (const events of [[saved(first)], [saved(first), saved(extended)]]) {
    const review = inspectLaundryRecovery(requested, events, [queued(requested), queued(next)]);
    assert.equal(review.kind, "review");
    assert.match(review.message, /D’autres demandes/);
  }
  const competing = terminal(first);
  assert.equal(inspectLaundryRecovery(requested, [saved(first)], [queued(requested), queued(competing)]).kind, "review");
  // A durable queue copy with an exact receipt is not an unsaved dependency.
  assert.equal(inspectLaundryRecovery(requested, [saved(first), saved(extended)], [queued(requested), queued(extended)]).kind, "reconfirm");
  const otherMachine = terminal(start({ targetId: "washer-3" }));
  assert.equal(inspectLaundryRecovery(requested, [saved(first), saved(extended)], [queued(requested), queued(otherMachine)]).kind, "reconfirm");
});

test("starts and extensions are never silently rebased after the machine changes", () => {
  const first = start(), extended = extend(first), extra = extend(first, { laundryAddedMinutes: 10, laundryEndsAt: "2026-11-10T09:54:00.000Z" });
  assert.equal(inspectLaundryRecovery(first, [], [queued(first)]).kind, "retry");
  assert.equal(inspectLaundryRecovery(extended, [saved(first)], [queued(extended)]).kind, "retry");
  assert.equal(inspectLaundryRecovery(extra, [saved(first), saved(extended)], [queued(extra)]).kind, "review");
  const staleStart = { ...first, id: createId(), laundryCycleId: createId() };
  assert.equal(inspectLaundryRecovery(staleStart, [saved(first)], [queued(staleStart)]).kind, "review");
});

test("same cycle ID never overrides different immutable identities or a conflicting history", () => {
  const first = start(), requested = terminal(first);
  for (const patch of [{ room: "325" }, { laundryOwner: "Autre linge" }, { targetId: "washer-3" },
    { laundryStartedAt: "2026-11-10T08:50:00.000Z", occurredAt: "2026-11-10T08:50:00.000Z" }]) {
    const different = start({ ...first, ...patch });
    assert.equal(inspectLaundryRecovery(requested, [saved(different)], [queued(requested)]).kind, "review");
  }
  const duplicateRevision = saved({ ...first, id: createId(), laundryCycleId: createId() });
  assert.equal(inspectLaundryRecovery(requested, [saved(first), duplicateRevision], []).kind, "review");
});

test("invalid pending payloads and impossible original revisions require manual review", () => {
  const first = start(), requested = terminal(first), extended = extend(first);
  const invalid = [
    { ...requested, actor: "" }, { ...requested, laundryAddedMinutes: 5 },
    { ...requested, laundryCollectedAt: null }, { ...requested, laundryEndsAt: "2026-11-10T09:00:00.000Z" },
    { ...requested, expectedRevision: 0 }, { ...requested, expectedRevision: 4 },
    { ...requested, laundryEndsAt: "2026-11-10T09:42:00.000Z" },
  ];
  for (const entry of invalid)
    assert.equal(inspectLaundryRecovery(entry, [saved(first), saved(extended)], [queued(entry)]).kind, "review");
  const damaged = { ...saved(first), submissionHash: "missing" };
  assert.equal(inspectLaundryRecovery(requested, [damaged], []).kind, "review");
});

test("reconfirmation requires a new valid ID and a clock after the latest update", () => {
  const first = start(), requested = terminal(first), extended = extend(first, { occurredAt: "2026-11-10T09:47:00.000Z", laundryEndsAt: "2026-11-10T09:52:00.000Z" });
  const review = inspectLaundryRecovery(requested, [saved(first), saved(extended)], [queued(requested)]);
  assert.equal(review.kind, "reconfirm");
  for (const id of [first.id, requested.id, extended.id, "not-a-uuid"])
    assert.throws(() => buildRecoveredLaundryEntry(review, { ...confirmation(), id }));
  assert.throws(() => buildRecoveredLaundryEntry(review, { ...confirmation(), at: "2026-11-10T09:46:00.000Z" }), /dernière mise à jour/);
  assert.throws(() => buildRecoveredLaundryEntry(review, { ...confirmation(), date: "invalide" }));
  assert.throws(() => buildRecoveredLaundryEntry({ ...review, current: saved(start()) }, confirmation()));
});

test("unrelated writes and field ordering do not invalidate the same laundry recovery review", () => {
  const first = start(), requested = terminal(first), extended = extend(first);
  const events = [saved(first), saved(extended)], pending = [queued(requested)];
  const displayed = inspectLaundryRecovery(requested, events, pending);
  const otherMachine = saved(start({ targetId: "washer-3" }));
  const refreshed = inspectLaundryRecovery(requested, [...events, otherMachine], pending);
  assert.notDeepEqual(displayed.savedEventIds, refreshed.savedEventIds);
  assert.equal(sameLaundryRecoveryReview(displayed, refreshed), true);
  const reversed = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).reverse()) as T;
  assert.equal(sameLaundryRecoveryReview(displayed, {
    ...displayed, original: reversed(displayed.original), current: reversed(displayed.current!),
  }), true);
  assert.equal(sameLaundryRecoveryReview(displayed, { ...displayed, savedEventIds: [] }), true);
});

test("changed machine, original request, receipt metadata, or recovery decision invalidates a displayed review", () => {
  const first = start(), requested = terminal(first), extended = extend(first);
  const displayed = inspectLaundryRecovery(requested, [saved(first), saved(extended)], [queued(requested)]);
  for (const current of [
    { ...displayed.current!, id: createId() }, { ...displayed.current!, notes: "Nouvelle note" },
    { ...displayed.current!, expectedRevision: 3 }, { ...displayed.current!, laundryEndsAt: "2026-11-10T09:59:00.000Z" },
    { ...displayed.current!, updatedAt: "2026-11-10T09:35:00.000Z" }, { ...displayed.current!, submissionHash: "a".repeat(64) },
  ]) assert.equal(sameLaundryRecoveryReview(displayed, { ...displayed, current }), false);
  assert.equal(sameLaundryRecoveryReview(displayed, { ...displayed, current: undefined }), false);
  assert.equal(sameLaundryRecoveryReview(displayed, { ...displayed, original: { ...requested, notes: "Autre demande" } }), false);
  assert.equal(sameLaundryRecoveryReview(displayed, { ...displayed, kind: "review" }), false);
  assert.equal(sameLaundryRecoveryReview(displayed, { ...displayed, message: "D’autres demandes en attente concernent cette machine." }), false);
  const actual = saved(terminal(first));
  const completed = inspectLaundryRecovery(requested, [saved(first), actual], []);
  assert.equal(completed.kind, "completed");
  assert.equal(sameLaundryRecoveryReview(completed, { ...completed, confirmed: { ...actual, actor: "Autre agent", laundryCollectedBy: "Autre agent" } }), false);
  assert.equal(sameLaundryRecoveryReview(completed, { ...completed, confirmed: { ...actual, laundryCollectedAt: "2026-11-10T09:46:00.000Z", occurredAt: "2026-11-10T09:46:00.000Z" } }), false);
  assert.equal(sameLaundryRecoveryReview(completed, { ...completed, confirmed: undefined }), false);
  const invalid = { ...requested, actor: "" };
  const manual = inspectLaundryRecovery(invalid, [], []);
  assert.equal(sameLaundryRecoveryReview(manual, { ...manual }), true);
  assert.equal(sameLaundryRecoveryReview(manual, { ...manual, original: { ...invalid, notes: "Autre demande invalide" } }), false);
});
