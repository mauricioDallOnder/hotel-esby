// Pure append-only operations shared by Next.js and the deployable Apps Script.
import type { FamilyEntry, FamilyEvent, RoomEntry, RoomInspection, WorkEntry, WorkEvent } from "./rooms";

type Work = WorkEntry | WorkEvent;
export function latestWork(events: Work[], kind: Work["kind"]) {
  const latest = new Map<string, Work>();
  for (const event of events.filter(e => e.kind === kind)) {
    const previous = latest.get(event.targetId);
    if (!previous || previous.expectedRevision < event.expectedRevision) latest.set(event.targetId, event);
  }
  return latest;
}

export function validateWorkEntry(entry: WorkEntry, events: Work[], families: (FamilyEntry | FamilyEvent)[], deletedFamilies: string[] = []) {
  const current = latestWork(events, entry.kind).get(entry.targetId);
  if ((current ? current.expectedRevision + 1 : 0) !== entry.expectedRevision)
    return "Ce suivi a été modifié ailleurs. Actualisez, annulez la modification en attente puis recommencez.";
  if (current?.deleted) return "Cette tâche a déjà été supprimée.";
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
