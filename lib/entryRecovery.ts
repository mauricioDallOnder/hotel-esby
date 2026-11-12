import type { State } from "./domain";
import { parseEntry, workEntrySchema, type Entry, type EntryChange, type RoomInspection, type WorkEntry, type WorkEvent } from "./rooms";
import { dependsOnEntry, sameWorkTarget, type PendingEntry } from "./entryQueue";
import { latestCafardObservationId, latestWork, validateWorkEntry, validateWorkPredecessor } from "./work";
import { submissionHash } from "./submissionHash";

export type EntryRecoveryReview = {
  kind: "saved" | "partial" | "missing" | "different";
  original: PendingEntry;
  receipt?: EntryChange;
  current?: WorkEvent;
  state: State;
  message: string;
  dependentIds: string[];
};

export async function entrySubmissionHash(item: PendingEntry) {
  const canonical = parseEntry(item.entry, item.protocol !== 2);
  return submissionHash(JSON.stringify(canonical));
}

export async function isCompleteEntryReceipt(item: PendingEntry, receipt: EntryChange) {
  const expectedCollection = item.entry.type === "createWorkEvent" ? "workEvents" : item.entry.type === "createRoomInspection" ? "roomInspections" : "familyEvents";
  if (receipt?.collection !== expectedCollection || receipt.record?.id !== item.entry.id || receipt.record?.version !== 1 ||
    !Number.isFinite(Date.parse(receipt.record.updatedAt)) || receipt.record.submissionHash !== await entrySubmissionHash(item)) return false;
  return receipt.collection !== "roomInspections" || receipt.record.issueSyncVersion === 2 && typeof receipt.record.createdIssue === "boolean" &&
    (!receipt.record.createdIssue || receipt.issue?.id === receipt.record.id);
}

/** A successful live read is necessary, but an ID alone is not a receipt. */
export async function inspectEntryRecovery(item: PendingEntry, state: State, pending: readonly PendingEntry[]): Promise<EntryRecoveryReview> {
  const collection = item.entry.type === "createWorkEvent" ? "workEvents" : item.entry.type === "createRoomInspection" ? "roomInspections" : "familyEvents";
  const sameId = (state[collection] || []).filter(record => record.id === item.entry.id);
  const dependentIds = pending.filter(value => dependsOnEntry(value.entry, item.entry)).map(value => value.entry.id);
  const current = item.entry.type === "createWorkEvent"
    ? latestWork(state.workEvents || [], item.entry.kind).get(item.entry.targetId) as WorkEvent | undefined : undefined;
  const base = { original: item, state, current, dependentIds };
  if (sameId.length) {
    const hash = await entrySubmissionHash(item);
    if (sameId.length === 1 && sameId[0].submissionHash === hash && sameId[0].version === 1 &&
      Number.isFinite(Date.parse(sameId[0].updatedAt))) {
      const record = sameId[0];
      const receipt = { collection, record,
        ...(collection === "roomInspections" ? { issue: state.issues.find(issue => issue.id === record.id) } : {}),
      } as EntryChange;
      if (collection === "roomInspections") {
        const inspection = record as RoomInspection;
        if (inspection.issueSyncVersion !== 2 || typeof inspection.createdIssue !== "boolean" ||
          inspection.createdIssue && !state.issues.some(issue => issue.id === inspection.id))
          return { ...base, kind: "partial", receipt, message: "Le contrôle est présent, mais la confirmation de son suivi technique est incomplète. Réessayez cet envoi d’origine pour terminer la synchronisation sans créer un autre contrôle." };
      }
      return { ...base, kind: "saved", receipt, message: "Cet envoi est déjà enregistré. Sa confirmation retire la copie en attente et conserve tout l’historique." };
    }
    return { ...base, kind: "different", message: "Ce numéro existe avec un contenu différent ou une confirmation incomplète. La demande reste conservée. Vérifiez l’historique avant de l’annuler." };
  }
  return { ...base, kind: "missing", message: item.blockedReason === "dependency"
    ? "Cette action dépendait d’un envoi refusé. Comparez votre demande avec le suivi enregistré avant de décider."
    : item.entry.type === "createRoomInspection"
      ? "Ce contrôle n’a pas été enregistré. Vous pouvez retrouver ses réponses et ses photos pour le corriger."
      : "Cette demande n’a pas été enregistrée. Comparez les informations avant de confirmer une nouvelle action." };
}

export function recoveryStateIdentity(review: EntryRecoveryReview) {
  const entry = review.original.entry;
  return JSON.stringify({ kind: review.kind, original: entry, current: review.current, receipt: review.receipt,
    dependentIds: [...review.dependentIds].sort(),
    observation: entry.type === "createWorkEvent" && entry.kind === "cafardFollowup"
      ? latestCafardObservationId(review.state.roomInspections || [], entry.room) : undefined,
    family: entry.type === "createWorkEvent" && entry.kind === "familyComment"
      ? (review.state.familyEvents || []).find(record => record.id === entry.familyEventId) : undefined,
    familyDeleted: entry.type === "createWorkEvent" && entry.kind === "familyComment"
      ? review.state.deletedFamilyEventIds?.includes(entry.familyEventId!) : undefined,
  });
}

export function canReplaceWorkRequest(review: EntryRecoveryReview, pending: readonly PendingEntry[]) {
  const entry = review.original.entry;
  return review.kind === "missing" && entry.type === "createWorkEvent" && entry.kind !== "laundryCycle" &&
    !workRecoveryBlockReason(review, pending);
}

export function workRecoveryBlockReason(review: EntryRecoveryReview, pending: readonly PendingEntry[]) {
  const entry = review.original.entry;
  if (entry.type !== "createWorkEvent") return undefined;
  if (pending.some(item => item.entry.id !== entry.id && sameWorkTarget(item.entry, entry)))
    return "D’autres demandes concernent ce suivi. Vérifiez-les avant de confirmer une nouvelle modification.";
  if (review.current?.deleted) return "Cette tâche a été supprimée. Cette demande ne peut pas la rétablir.";
  if (entry.kind === "familyComment" && (!(review.state.familyEvents || []).some(record => record.id === entry.familyEventId) ||
    review.state.deletedFamilyEventIds?.includes(entry.familyEventId!)))
    return "L’événement familial n’existe plus. Vous pouvez conserver le texte affiché puis annuler cette demande en attente.";
  return undefined;
}

/** Only called after explicit comparison/confirmation and a second live read.
 * A new ID distinguishes this decision from the immutable refused operation. */
export function buildRecoveredWorkEntry(review: EntryRecoveryReview, pending: readonly PendingEntry[], { id, at, date }: { id: string; at: string; date: string }): WorkEntry {
  if (!canReplaceWorkRequest(review, pending) || review.original.entry.type !== "createWorkEvent")
    throw new Error("Vérifiez les autres demandes de ce suivi avant de confirmer une nouvelle action.");
  const original = review.original.entry;
  if (id === original.id || (review.state.workEvents || []).some(event => event.id === id))
    throw new Error("La nouvelle confirmation doit avoir un nouvel identifiant.");
  const entry = workEntrySchema.parse({ ...original, id, date: ["dailyTask", "familyComment"].includes(original.kind) ? original.date : date, occurredAt: at,
    expectedRevision: review.current ? review.current.expectedRevision + 1 : 0,
    expectedPreviousEventId: review.current?.id || null,
    ...(original.kind === "cafardFollowup" ? { cafardObservationId: latestCafardObservationId(review.state.roomInspections || [], original.room) } : {}),
  });
  const error = validateWorkPredecessor(entry, review.state.workEvents || [], true) ||
    validateWorkEntry(entry, review.state.workEvents || [], review.state.familyEvents || [], review.state.deletedFamilyEventIds, review.state.roomInspections || []);
  if (error) throw new Error(error);
  return entry;
}

export function pendingEntryLabel(entry: Entry) {
  if (entry.type === "createRoomInspection") return `Contrôle · Ch. ${entry.room} · ${entry.date.split("-").reverse().join("/")}`;
  if (entry.type === "createFamilyEvent") return `${entry.kind === "absence" ? "Absence" : "Départ"} · Ch. ${entry.room} · ${entry.family}`;
  const labels = { roomAvailability: "Occupation", familyComment: "Commentaire", dailyTask: "Tâche", cafardFollowup: "Cafards", collectedItem: "Objet récupéré", laundryCycle: "Lingerie" };
  return `${labels[entry.kind]}${entry.room ? ` · Ch. ${entry.room}` : ""}${entry.kind === "collectedItem" ? ` · ${entry.itemName}` : ""}`;
}

export function workRequestDetails(entry: WorkEntry) {
  const lines = [`${entry.date.split("-").reverse().join("/")} · ${entry.actor}`];
  if (entry.kind === "roomAvailability") lines.push(entry.free ? "Chambre libre" : "Chambre occupée");
  if (entry.kind === "dailyTask") lines.push(entry.deleted ? "Suppression de la tâche" : entry.done ? "Tâche terminée" : "Tâche à faire");
  if (entry.kind === "collectedItem") {
    lines.push(`${entry.itemName} · ${entry.room ? `Chambre ${entry.room}` : "Chambre non identifiée"}`);
    lines.push(`Récupéré le ${entry.collectedOn} · ${entry.collectedBy}`);
    lines.push(entry.returnedOn ? `Restitué le ${entry.returnedOn} · ${entry.returnedBy}` : "Objet en armoire");
  }
  if (entry.kind === "cafardFollowup") {
    const labels = { a_verifier: "À vérifier", signale: "Signalé", traite: "Produit appliqué", resolu: "Résolu" };
    lines.push(entry.cafardStatus ? labels[entry.cafardStatus] : "État non renseigné");
    lines.push(`Détection : ${entry.detectedOn || "inconnue"} · Application : ${entry.treatedOn || "aucune"} · Résolution : ${entry.resolvedOn || "non résolu"}`);
    if (entry.product) lines.push(`Produit : ${entry.product}`);
  }
  if (entry.notes) lines.push(entry.notes);
  return lines.join("\n");
}
