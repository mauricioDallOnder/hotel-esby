import { rooms, type WorkEntry, type WorkEvent } from "./rooms";

type Work = WorkEntry | WorkEvent;

type ItemDetails = {
  room: string;
  roomUnidentified: boolean;
  itemName: string;
  collectedOn: string;
  collectedBy: string;
  reason: string;
  returnedOn: string | null;
  returnedBy: string;
};

export type CollectedItemHistoryEvent = ItemDetails & {
  id: string;
  date: string;
  occurredAt: string;
  actor: string;
  expectedRevision: number;
};

export type CollectedItemRecord = ItemDetails & {
  // An object has its own identity: several objects may belong to one room.
  id: string;
  updatedAt: string;
  revision: number;
  lastEventId: string;
  history: CollectedItemHistoryEvent[];
};

function snapshot(event: Work): CollectedItemHistoryEvent {
  return {
    id: event.id, date: event.date, occurredAt: event.occurredAt, actor: event.actor,
    expectedRevision: event.expectedRevision, room: event.room, roomUnidentified: event.roomUnidentified === true, itemName: event.itemName!,
    collectedOn: event.collectedOn!, collectedBy: event.collectedBy!, reason: event.notes,
    returnedOn: event.returnedOn ?? null, returnedBy: event.returnedBy || "",
  };
}

export function collectedItemRoomLabel(room: string): string {
  return room ? `Chambre ${room}` : "Chambre non identifiée";
}

/**
 * Project immutable revisions into the current custody record for each object.
 * Revisions, rather than entered dates or receipt timestamps, decide the current
 * state. Replaying an accepted offline event cannot duplicate an object/history.
 */
export function collectedItems(events: readonly Work[]): CollectedItemRecord[] {
  const histories = new Map<string, Work[]>();
  const unique = new Map(events.filter(event => event.kind === "collectedItem"
    && (event.roomUnidentified === true ? event.room === "" : event.roomUnidentified === undefined && rooms.includes(event.room))
    && event.itemName && event.collectedOn && event.collectedBy).map(event => [event.id, event]));
  for (const event of unique.values()) {
    const history = histories.get(event.targetId) || [];
    history.push(event);
    histories.set(event.targetId, history);
  }
  return [...histories.entries()].map(([id, events]): CollectedItemRecord => {
    const ordered = [...events].sort((a, b) => b.expectedRevision - a.expectedRevision || b.id.localeCompare(a.id));
    const latest = ordered[0];
    const { room, roomUnidentified, itemName, collectedOn, collectedBy, reason, returnedOn, returnedBy } = snapshot(latest);
    return {
      id, room, roomUnidentified, itemName, collectedOn, collectedBy, reason, returnedOn, returnedBy,
      updatedAt: latest.occurredAt, revision: latest.expectedRevision + 1, lastEventId: latest.id,
      history: ordered.map(snapshot),
    };
  }).sort((a, b) => b.collectedOn.localeCompare(a.collectedOn) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
}

/** Every search word must match the current object, in any order or case. */
export function filterCollectedItems(records: readonly CollectedItemRecord[], query: string): CollectedItemRecord[] {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return records.filter(record => {
    const text = normalizeSearch([collectedItemRoomLabel(record.room), record.itemName, record.collectedBy, record.reason, record.returnedBy].join(" "));
    return terms.every(term => text.includes(term));
  });
}
