import type { CafardCase, CafardStatus } from "./cafards";
import type { WorkEntry } from "./rooms";

export type CafardDraft = WorkEntry & {
  kind: "cafardFollowup";
  cafardStatus: CafardStatus;
  detectedOn: string | null;
  treatedOn: string | null;
  resolvedOn: string | null;
  product: string;
};

/** Older forms sometimes used the latest inspection as the work predecessor.
 * This exact mismatch can be repaired without replacing the operator's answers;
 * an unknown identity or a genuinely newer follow-up/inspection cannot. */
export function hasCafardDraftIdentityMixup(entry: WorkEntry, current: CafardCase): boolean {
  return entry.kind === "cafardFollowup" && entry.room === current.room && entry.targetId === current.room &&
    current.revision > 0 && !!current.lastFollowupEventId && entry.expectedRevision === current.revision &&
    !!current.observationId && entry.cafardObservationId === current.observationId &&
    entry.expectedPreviousEventId === current.observationId && entry.expectedPreviousEventId !== current.lastFollowupEventId;
}

/** Called only after an explicit reload and a successful current-state read.
 * Already queued submissions must be handled by receipt recovery, never edited. */
export function reloadCafardDraft(
  draft: CafardDraft,
  current: CafardCase,
  meta: { id: string; date: string; occurredAt: string },
): CafardDraft {
  if (draft.room !== current.room || draft.targetId !== current.room)
    throw new Error("Ce brouillon appartient à une autre chambre. Rouvrez le suivi de la chambre concernée.");
  if (meta.id === draft.id)
    throw new Error("La récupération du brouillon doit utiliser un nouvel identifiant.");
  const keepAnswers = hasCafardDraftIdentityMixup(draft, current);
  return {
    ...draft,
    ...(keepAnswers ? {} : {
      date: meta.date, cafardStatus: current.status,
      detectedOn: current.detectedOn, treatedOn: current.treatedOn,
      resolvedOn: current.resolvedOn, product: current.product,
    }),
    id: meta.id, occurredAt: meta.occurredAt,
    expectedRevision: current.revision, expectedPreviousEventId: current.lastFollowupEventId,
    cafardObservationId: current.observationId ?? null,
  };
}
