import type { PendingEntry } from "./entryQueue";
import { workEntrySchema, type WorkEntry, type WorkEvent } from "./rooms";
import { getLaundryEndsAt, latestWork, validateWorkEntry } from "./work";

export type LaundryRecoveryReview = {
  kind: "saved" | "completed" | "retry" | "reconfirm" | "review";
  original: WorkEntry;
  message: string;
  /** Latest saved event on the machine; it may belong to a newer load. */
  current?: WorkEvent;
  /** The actual saved action, whose author and time must remain authoritative. */
  confirmed?: WorkEvent;
  /** Used only when creating a fresh, explicitly reconfirmed action. */
  savedEventIds?: readonly string[];
};

function canonicalLaundryEntry(value: WorkEntry) {
  const parsed = workEntrySchema.safeParse(value);
  return parsed.success && parsed.data.kind === "laundryCycle" ? parsed.data : undefined;
}

function samePayload(left: WorkEntry, right: WorkEntry) {
  // The schema strips receipt metadata and emits fields in a stable order.
  // It also preserves optional legacy timing fields rather than inventing them.
  const a = canonicalLaundryEntry(left), b = canonicalLaundryEntry(right);
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}

function isSavedLaundryEvent(event: WorkEvent) {
  return !!canonicalLaundryEntry(event) && event.version === 1 &&
    typeof event.submissionHash === "string" && /^[a-f0-9]{64}$/.test(event.submissionHash) &&
    typeof event.updatedAt === "string" && Number.isFinite(Date.parse(event.updatedAt));
}

function sameCycle(left: WorkEntry, right: WorkEntry) {
  return left.kind === "laundryCycle" && right.kind === "laundryCycle" &&
    !!left.laundryCycleId && left.laundryCycleId === right.laundryCycleId &&
    left.targetId === right.targetId && left.laundryStartedAt === right.laundryStartedAt &&
    left.room === right.room && (left.laundryOwner || "") === (right.laundryOwner || "");
}

function isTerminal(entry: WorkEntry) {
  return entry.laundryStatus === "recupere" || entry.laundryStatus === "annule";
}

function reviewPayload(entry: WorkEntry) {
  const canonical = canonicalLaundryEntry(entry);
  // Invalid requests still need a stable identity for explicit manual review.
  // Work entries contain scalar fields only; sorting also handles older key order.
  return JSON.stringify(canonical || Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))));
}

function sameReviewedRecord(left?: WorkEvent, right?: WorkEvent) {
  if (!left || !right) return left === right;
  return reviewPayload(left) === reviewPayload(right) && left.version === right.version &&
    left.updatedAt === right.updatedAt && left.submissionHash === right.submissionHash;
}

/** Ignore unrelated hotel writes while retaining the exact machine/custody facts reviewed. */
export function sameLaundryRecoveryReview(left: LaundryRecoveryReview, right: LaundryRecoveryReview): boolean {
  return left.kind === right.kind && left.message === right.message &&
    reviewPayload(left.original) === reviewPayload(right.original) &&
    sameReviewedRecord(left.current, right.current) && sameReviewedRecord(left.confirmed, right.confirmed);
}

/**
 * Inspect only a freshly read server snapshot, never optimistic queued events.
 * This does not write, dismiss, or rebase anything. A matching completed cycle
 * still needs an explicit acknowledgement because its author or notes may differ.
 */
export function inspectLaundryRecovery(
  entry: WorkEntry,
  events: readonly WorkEvent[],
  pending: readonly PendingEntry[],
): LaundryRecoveryReview {
  const result = (kind: LaundryRecoveryReview["kind"], message: string, details: Partial<LaundryRecoveryReview> = {}): LaundryRecoveryReview =>
    ({ kind, original: entry, message, ...details });
  const parsed = canonicalLaundryEntry(entry);
  if (!parsed) return result("review", "Cette demande contient des informations de lingerie invalides. Consultez la machine et son historique avant de la supprimer ou de recommencer.");

  const sameId = events.filter(event => event.id === entry.id);
  if (sameId.length) {
    if (sameId.every(event => isSavedLaundryEvent(event) && samePayload(entry, event)))
      return result("saved", "Cette action est déjà enregistrée. La copie en attente peut être fermée sans modifier l’historique.", { confirmed: sameId[0] });
    return result("review", "Ce numéro de demande existe avec un contenu différent ou incomplet. La demande en attente a été conservée ; vérifiez l’historique avant de continuer.");
  }

  const relevant = events.filter(event => event.kind === "laundryCycle" &&
    (event.targetId === entry.targetId || event.laundryCycleId === entry.laundryCycleId));
  if (relevant.some(event => !isSavedLaundryEvent(event)))
    return result("review", "L’historique de cette machine contient un enregistrement incomplet. Impossible de confirmer cette demande automatiquement.");
  const current = latestWork([...events], "laundryCycle").get(entry.targetId) as WorkEvent | undefined;
  const details = { current };
  const machineHistory = relevant.filter(event => event.targetId === entry.targetId);
  const revisions = new Map<number, string>();
  for (const event of machineHistory) {
    const previous = revisions.get(event.expectedRevision);
    if (previous && previous !== event.id)
      return result("review", "Plusieurs actions de cette machine portent la même révision. Consultez son historique avant de continuer.", details);
    revisions.set(event.expectedRevision, event.id);
  }

  const cycleHistory = relevant.filter(event => event.laundryCycleId === entry.laundryCycleId);
  if (cycleHistory.some(event => !sameCycle(entry, event)))
    return result("review", "Les informations de ce cycle ne correspondent plus à cette demande. Aucun autre linge ne sera modifié.", details);
  const cycle = [...cycleHistory].sort((a, b) => b.expectedRevision - a.expectedRevision)[0];
  if (isTerminal(entry) && cycle && isTerminal(cycle)) {
    if (cycle.laundryStatus === entry.laundryStatus)
      return result("completed", entry.laundryStatus === "recupere"
        ? "Le retrait de ce linge est déjà enregistré. Vérifiez la personne et l’heure avant de fermer cette demande."
        : "L’annulation de ce cycle est déjà enregistrée. Vérifiez son historique avant de fermer cette demande.", { ...details, confirmed: cycle });
    return result("review", cycle.laundryStatus === "annule"
      ? "Ce cycle a été annulé. La demande de retrait ne peut pas remplacer cette annulation."
      : "Le retrait de ce linge est déjà enregistré. La demande d’annulation ne peut pas le remplacer.", { ...details, confirmed: cycle });
  }

  const otherPending = pending.some(item => item.entry.type === "createWorkEvent" && item.entry.kind === "laundryCycle" &&
    item.entry.targetId === entry.targetId && item.entry.id !== entry.id &&
    !events.some(event => event.id === item.entry.id && isSavedLaundryEvent(event) && samePayload(item.entry as WorkEntry, event)));
  if (otherPending)
    return result("review", "D’autres demandes en attente concernent cette machine. Vérifiez ces demandes et l’historique avant de recommencer, pour conserver leur ordre.", details);

  const conflict = validateWorkEntry(parsed, [...events], []);
  if (!conflict)
    return result("retry", "L’état actuel permet d’envoyer la demande d’origine. Ses informations et son heure seront conservées.", details);

  if (isTerminal(entry) && current?.laundryStatus === "en_cours" && sameCycle(entry, current) &&
    entry.expectedRevision < current.expectedRevision + 1) {
    // A stale action must have been valid against its original revision. This
    // rejects damaged payloads rather than silently repairing custody details.
    const originalHistory = events.filter(event => event.kind !== "laundryCycle" || event.targetId !== entry.targetId ||
      event.expectedRevision < entry.expectedRevision);
    if (!validateWorkEntry(parsed, [...originalHistory], []))
      return result("reconfirm", entry.laundryStatus === "recupere"
        ? "Le même linge est toujours suivi sur cette machine, mais le cycle a été mis à jour. Vérifiez que tout le linge a été retiré puis confirmez à nouveau."
        : "Le même cycle est toujours en cours, mais il a été mis à jour. Vérifiez que la machine est arrêtée et vide puis confirmez à nouveau son annulation.",
      { ...details, savedEventIds: events.map(event => event.id) });
  }
  return result("review", current && current.laundryCycleId !== entry.laundryCycleId
    ? "Cette machine suit maintenant un autre cycle. Cette ancienne demande ne peut pas modifier le linge actuel. Consultez l’historique avant de la fermer."
    : "Cette demande ne correspond plus à l’état enregistré. Consultez le cycle et son historique avant de la fermer ou de recommencer.", details);
}

/** Create a new action only after the operator has reviewed the same active load. */
export function buildRecoveredLaundryEntry(
  review: LaundryRecoveryReview,
  { id, at, date }: { id: string; at: string; date: string },
): WorkEntry {
  const original = canonicalLaundryEntry(review.original), current = review.current;
  if (review.kind !== "reconfirm" || !original || !current || !isSavedLaundryEvent(current) ||
    !isTerminal(original) || current.laundryStatus !== "en_cours" || !sameCycle(original, current) ||
    original.expectedRevision >= current.expectedRevision + 1)
    throw new Error("Vérifiez à nouveau l’état du cycle avant de confirmer cette demande.");
  if (id === original.id || id === current.id || review.savedEventIds?.includes(id))
    throw new Error("La nouvelle confirmation doit avoir un nouvel identifiant.");

  const replacement: WorkEntry = {
    ...original, id, expectedRevision: current.expectedRevision + 1,
    date, occurredAt: at, laundryEndsAt: getLaundryEndsAt(current),
    laundryCollectedAt: original.laundryStatus === "recupere" ? at : null,
    laundryCollectedBy: original.laundryStatus === "recupere" ? original.actor : "",
  };
  delete replacement.laundryAddedMinutes;
  const parsed = workEntrySchema.parse(replacement);
  const conflict = validateWorkEntry(parsed, [current], []);
  if (conflict) throw new Error(conflict);
  return parsed;
}
