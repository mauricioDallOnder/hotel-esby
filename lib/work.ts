// Pure append-only operations shared by Next.js and the deployable Apps Script.
import type { FamilyEntry, FamilyEvent, RoomEntry, RoomInspection, WorkEntry, WorkEvent } from "./rooms";

type Work = WorkEntry | WorkEvent;

// The visible numbers match the physical labels. Washers and dryers have
// distinct IDs so a cycle can never reserve the wrong kind of appliance.
export const laundryMachines = [
  { id: "washer-1", label: "Machine à laver 1", kind: "washer", capacityKg: 18, durationMinutes: 44, program: "Rapide 40" },
  { id: "washer-2", label: "Machine à laver 2", kind: "washer", capacityKg: 8, durationMinutes: 38, program: "Rapide 30" },
  { id: "washer-3", label: "Machine à laver 3", kind: "washer", capacityKg: 8, durationMinutes: 38, program: "Rapide 30" },
  { id: "dryer-1", label: "Machine à sécher 1", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
  { id: "dryer-2", label: "Machine à sécher 2", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
  { id: "dryer-3", label: "Machine à sécher 3", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
] as const;
export type LaundryMachine = typeof laundryMachines[number];
export type LaundryMachineId = LaundryMachine["id"];
export type LaundryStatus = "en_cours" | "recupere" | "annule";

export function getLaundryMachine(id: string) {
  return laundryMachines.find(machine => machine.id === id);
}

// Persisted planned ends are authoritative. Older events did not store one, so
// keep their original 40/30/80-minute timing even when new machine defaults change.
export function getLaundryEndsAt(record: Pick<WorkEntry, "targetId" | "laundryStartedAt" | "laundryEndsAt">): string | undefined {
  const machine = getLaundryMachine(record.targetId), started = Date.parse(record.laundryStartedAt || "");
  if (!machine || !Number.isFinite(started)) return undefined;
  if (record.laundryEndsAt !== undefined) {
    const end = Date.parse(record.laundryEndsAt);
    return Number.isFinite(end) && end > started ? new Date(end).toISOString() : undefined;
  }
  const originalMinutes = machine.id === "washer-1" ? 40 : machine.kind === "washer" ? 30 : 80;
  return new Date(started + originalMinutes * 60_000).toISOString();
}

// This validator is bundled unchanged into Apps Script, inside its write lock.
// Reaching the scheduled end does not release a machine: the clothes stay there
// until an operator explicitly records their removal or cancels the cycle.
export function validateLaundryEntry(entry: WorkEntry, events: Work[], current?: Work): string | undefined {
  const machine = getLaundryMachine(entry.targetId);
  if (!machine || !entry.room || !entry.laundryCycleId || !entry.laundryStartedAt ||
    !entry.laundryStatus || !["en_cours", "recupere", "annule"].includes(entry.laundryStatus))
    return "Renseignez la machine, la chambre et le cycle de linge.";
  const started = Date.parse(entry.laundryStartedAt), occurred = Date.parse(entry.occurredAt);
  if (!Number.isFinite(started) || !Number.isFinite(occurred) || occurred < started)
    return "La mise à jour du linge doit suivre le démarrage du cycle.";
  const added = entry.laundryAddedMinutes;
  if (added !== undefined && (!Number.isInteger(added) || added < 1 || added > 120))
    return "Ajoutez entre 1 et 120 minutes entières.";
  if (!getLaundryEndsAt(entry)) return "L’heure de fin prévue doit suivre le démarrage du cycle.";
  if (added !== undefined && (entry.laundryStatus !== "en_cours" || !entry.laundryEndsAt))
    return "Seul un cycle en cours peut être prolongé avec une nouvelle heure de fin.";
  if (entry.laundryStatus === "recupere") {
    if (!entry.laundryCollectedAt || entry.laundryCollectedAt !== entry.occurredAt || entry.laundryCollectedBy !== entry.actor)
      return "La récupération doit indiquer sa date, son heure et la personne qui l’enregistre.";
  } else if (entry.laundryCollectedAt !== null || entry.laundryCollectedBy !== "") {
    return "Un cycle non récupéré ne peut pas avoir de date ou de responsable de récupération.";
  }
  if (entry.laundryStatus === "en_cours" && added === undefined) {
    if (current?.laundryStatus === "en_cours") return "Cette machine contient déjà du linge. Confirmez sa récupération avant de démarrer un autre cycle.";
    if (events.some(event => event.kind === "laundryCycle" && event.laundryCycleId === entry.laundryCycleId))
      return "Ce cycle de linge existe déjà. Utilisez un nouveau cycle.";
    if (entry.laundryStartedAt !== entry.occurredAt) return "Le démarrage du cycle doit correspondre à l’heure de cette action.";
    if (current && occurred < Date.parse(current.occurredAt)) return "Le nouveau cycle ne peut pas commencer avant la libération de la machine.";
    if (entry.laundryEndsAt !== undefined && Date.parse(entry.laundryEndsAt) !== started + machine.durationMinutes * 60_000)
      return "Le nouveau cycle doit utiliser la durée prévue pour cette machine.";
    return undefined;
  }
  if (!current || current.laundryStatus !== "en_cours" || current.laundryCycleId !== entry.laundryCycleId)
    return "Ce cycle n’est plus en cours sur cette machine. Actualisez la lingerie.";
  if (entry.room !== current.room || entry.laundryStartedAt !== current.laundryStartedAt ||
    (entry.laundryOwner || "") !== (current.laundryOwner || ""))
    return "Le cycle doit conserver sa chambre, son propriétaire et son heure de démarrage.";
  if (occurred < Date.parse(current.occurredAt)) return "Cette action doit suivre la dernière mise à jour du cycle.";
  const currentEnd = getLaundryEndsAt(current);
  if (!currentEnd) return "L’heure de fin de ce cycle est invalide. Actualisez la lingerie.";
  if (added !== undefined) {
    if (Date.parse(entry.laundryEndsAt!) !== Math.max(Date.parse(currentEnd), occurred) + added * 60_000)
      return "La nouvelle fin doit ajouter les minutes demandées au temps restant, ou à l’heure actuelle si le délai est dépassé.";
  } else if (entry.laundryEndsAt !== undefined && Date.parse(entry.laundryEndsAt) !== Date.parse(currentEnd)) {
    return "La récupération ou l’annulation doit conserver l’heure de fin prévue.";
  }
  return undefined;
}

export function latestWork(events: Work[], kind: Work["kind"]) {
  const latest = new Map<string, Work>();
  for (const event of events.filter(e => e.kind === kind)) {
    const previous = latest.get(event.targetId);
    if (!previous || previous.expectedRevision < event.expectedRevision) latest.set(event.targetId, event);
  }
  return latest;
}

/** Include the observation identity, not only its day, in cafard form concurrency. */
export function latestCafardObservationId(inspections: readonly (RoomEntry | RoomInspection)[], room: string): string | null {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
  let latest: { id: string; order: string } | undefined;
  for (const record of inspections) {
    if (record.room !== room || record.bugs !== "oui") continue;
    const at = record.inspectedAt ? new Date(record.inspectedAt) : null;
    const instant = at && Number.isFinite(at.getTime()) && day.format(at) === record.date ? at.toISOString() : "";
    const order = record.date + "|" + instant + "|" + record.id;
    if (!latest || order > latest.order) latest = { id: record.id, order };
  }
  return latest?.id || null;
}

export function validateWorkEntry(entry: WorkEntry, events: Work[], families: (FamilyEntry | FamilyEvent)[], deletedFamilies: string[] = [], inspections: readonly (RoomEntry | RoomInspection)[] = []) {
  const current = latestWork(events, entry.kind).get(entry.targetId);
  if ((current ? current.expectedRevision + 1 : 0) !== entry.expectedRevision)
    return "Ce suivi a été modifié ailleurs. Actualisez, annulez la modification en attente puis recommencez.";
  if (current?.deleted) return "Cette tâche a déjà été supprimée.";
  if (entry.kind === "cafardFollowup" && entry.cafardObservationId !== undefined &&
    entry.cafardObservationId !== latestCafardObservationId(inspections, entry.room))
    return "Une nouvelle détection de cafards a été enregistrée dans cette chambre. Actualisez puis ouvrez son suivi existant avant de le mettre à jour.";
  if (entry.kind === "laundryCycle") return validateLaundryEntry(entry, events, current);
  if (entry.kind === "familyComment") {
    const family = families.find(f => f.id === entry.familyEventId);
    if (!family || deletedFamilies.includes(family.id)) return "Cet événement familial n’existe plus.";
    if (family.room !== entry.room || (current && current.familyEventId !== entry.familyEventId)) return "Ce commentaire appartient à un autre événement.";
  }
  if (entry.kind === "dailyTask" && entry.deleted && !current) return "Cette tâche n’existe pas.";
  return undefined;
}

export function roomAvailability(room: string, events: Work[], latestInspection?: RoomEntry | RoomInspection) {
  const manual = latestWork(events, "roomAvailability").get(room);
  return { free: manual ? manual.free : latestInspection?.occupied === false ? true : latestInspection?.occupied === true ? false : undefined,
    source: manual, revision: manual ? manual.expectedRevision + 1 : 0 };
}

export function dailyTasks(events: Work[], date: string) {
  return [...latestWork(events, "dailyTask").values()].filter(t => !t.deleted && t.date === date)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.occurredAt.localeCompare(b.occurredAt) || a.targetId.localeCompare(b.targetId));
}

export function familyComments(family: FamilyEntry | FamilyEvent, events: Work[]) {
  const original: WorkEntry = { type: "createWorkEvent", id: family.id, kind: "familyComment", targetId: family.id, expectedRevision: -1,
    room: family.room, date: family.date, actor: family.actor, notes: family.notes, occurredAt: "updatedAt" in family ? family.updatedAt : `${family.date}T00:00:00.000Z`, familyEventId: family.id };
  const history = events.filter(e => e.kind === "familyComment" && e.familyEventId === family.id);
  const latest = latestWork(history, "familyComment");
  if (family.notes && !latest.has(family.id)) latest.set(family.id, original);
  return [...latest.values()].map(comment => ({ ...comment,
    revisions: [...(comment.targetId === family.id && family.notes ? [original] : []), ...history.filter(e => e.targetId === comment.targetId)].sort((a, b) => a.expectedRevision - b.expectedRevision),
  })).sort((a, b) => b.date.localeCompare(a.date) || b.occurredAt.localeCompare(a.occurredAt));
}
