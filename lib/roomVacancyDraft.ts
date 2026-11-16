import type { WorkEntry } from "./rooms";

/** A confirmed or queued operation may be reused only for the same answers.
 * Submission timestamps/actors are metadata; whitespace follows schema parsing. */
export function sameRoomVacancyDraftAnswers(draft: WorkEntry, previous: WorkEntry): boolean {
  return draft.kind === "roomAvailability" && previous.kind === "roomAvailability" &&
    draft.free === true && previous.free === true && draft.id === previous.id &&
    draft.room === previous.room && draft.targetId === previous.targetId &&
    draft.expectedRevision === previous.expectedRevision &&
    draft.expectedPreviousEventId === previous.expectedPreviousEventId &&
    draft.date === previous.date &&
    (draft.vacancyReason || "available") === (previous.vacancyReason || "available") &&
    draft.notes.trim() === previous.notes.trim();
}
