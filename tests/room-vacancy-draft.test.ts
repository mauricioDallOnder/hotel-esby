import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../lib/domain";
import { sameRoomVacancyDraftAnswers } from "../lib/roomVacancyDraft";
import type { WorkEntry } from "../lib/rooms";

function submitted(): WorkEntry {
  return {
    type: "createWorkEvent", kind: "roomAvailability", id: createId(), targetId: "226", room: "226",
    expectedRevision: 2, expectedPreviousEventId: createId(), actor: "Direction",
    date: "2026-11-16", occurredAt: "2026-11-16T08:00:00.000Z", free: true,
    vacancyReason: "works", notes: "Peinture en cours.",
  };
}

test("retrying the same vacancy answers tolerates parsed whitespace and submit-time metadata without changing either operation", () => {
  const previous = Object.freeze(submitted());
  const draft = Object.freeze({ ...previous, notes: "  Peinture en cours.\n", actor: "Employé", occurredAt: "2026-11-16T08:05:00.000Z" });
  assert.equal(sameRoomVacancyDraftAnswers(draft, previous), true);
  assert.equal(previous.notes, "Peinture en cours.");
  assert.equal(draft.notes, "  Peinture en cours.\n");
  assert.equal(sameRoomVacancyDraftAnswers({ ...previous, vacancyReason: "available" }, { ...previous, vacancyReason: undefined }), true,
    "A historical free room has the same available meaning without rewriting its original payload");
});

test("a same-ID vacancy draft with new answers or a different predecessor must never reuse or clear the earlier request", () => {
  const previous = Object.freeze(submitted());
  const changes: Partial<WorkEntry>[] = [
    { notes: "Travaux terminés." }, { vacancyReason: "available" }, { date: "2026-11-17" },
    { free: false }, { kind: "dailyTask" }, { room: "227" }, { targetId: "227" },
    { expectedRevision: 3 }, { expectedPreviousEventId: createId() },
    { expectedPreviousEventId: undefined }, { id: createId() },
  ];
  for (const patch of changes) assert.equal(sameRoomVacancyDraftAnswers({ ...previous, ...patch }, previous), false,
    `Changed ${Object.keys(patch).join(", ")} cannot be treated as an identical retry`);
  assert.equal(previous.notes, "Peinture en cours.");
  assert.equal(previous.vacancyReason, "works");
});
