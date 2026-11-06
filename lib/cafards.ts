import { today } from "./domain";
import { rooms, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "./rooms";

export type CafardStatus = NonNullable<WorkEntry["cafardStatus"]>;
export const cafardStatusLabels: Record<CafardStatus, string> = {
  a_verifier: "À vérifier", signale: "Cafards présents", traite: "Produit appliqué", resolu: "Résolu",
};

export type CafardHistoryEvent = {
  id: string;
  kind: "inspection" | "followup" | "initial";
  date: string | null;
  at: string | null;
  actor: string;
  notes: string;
  status: CafardStatus;
  detectedOn: string | null;
  treatedOn: string | null;
  resolvedOn: string | null;
  product: string;
};

export type CafardCase = {
  room: string;
  status: CafardStatus;
  detectedOn: string | null;
  treatedOn: string | null;
  updatedOn: string | null;
  resolvedOn: string | null;
  product: string;
  notes: string;
  history: CafardHistoryEvent[];
  // The next revision belongs only to explicit follow-ups, not to inspections.
  revision: number;
  lastEventId: string | null;
};

export type CafardTreatmentReminder = { dueOn: string; due: boolean };

function calendarDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value ? day : null;
}

/**
 * A treatment awaiting verification needs a visit from its seventh calendar
 * day, including imported applications marked "a_verifier". Keep its history
 * and status unchanged, and compare with the current civil day in Paris.
 * UTC arithmetic keeps the visit date stable across daylight-saving changes.
 */
export function cafardTreatmentReminder(
  record: Pick<CafardCase, "status" | "treatedOn">,
  day = today(),
): CafardTreatmentReminder | null {
  if (record.status !== "traite" && record.status !== "a_verifier") return null;
  const application = calendarDay(record.treatedOn), current = calendarDay(day);
  if (!application || !current) return null;
  application.setUTCDate(application.getUTCDate() + 7);
  const dueOn = application.toISOString().split("T")[0];
  if (!calendarDay(dueOn)) return null;
  return { dueOn, due: application.getTime() <= current.getTime() };
}

export type CafardSeed = Omit<CafardCase, "history" | "revision" | "lastEventId"> & {
  importedAt: string;
  sourceIssueIds: readonly string[];
  treatments: readonly { date: string; product: string; sourceIssueIds?: readonly string[] }[];
};

type Inspection = RoomEntry | RoomInspection;
type Work = WorkEntry | WorkEvent;

function uniqueById<T extends { id: string }>(records: readonly T[]): T[] {
  return [...new Map(records.map(record => [record.id, record])).values()];
}

function matchingTime(date: string, at?: string | null): string | null {
  if (!at) return null;
  const instant = new Date(at);
  return Number.isFinite(instant.getTime()) && today(instant) === date ? instant.toISOString() : null;
}

// Compare the business day first. A timestamp helps only when it belongs to that
// day in Paris. In particular, a delayed server receipt is never a new detection.
// Without a time, an old inspection cannot displace an explicit same-day review.
function observationOrder(date: string, at?: string | null, endOfDay = false): string {
  return date + "|" + (matchingTime(date, at) || (endOfDay ? "~" : ""));
}

function seedHistory(seed: CafardSeed): CafardHistoryEvent[] {
  const snapshot: CafardHistoryEvent = {
    id: "initial:" + seed.room, kind: "initial", date: seed.updatedOn, at: null, actor: "",
    notes: seed.notes, status: seed.status, detectedOn: seed.detectedOn, treatedOn: seed.treatedOn,
    resolvedOn: seed.resolvedOn, product: seed.product,
  };
  return [snapshot, ...seed.treatments.map((treatment, index): CafardHistoryEvent => ({
    id: "initial-treatment:" + seed.room + ":" + index, kind: "initial", date: treatment.date, at: null, actor: "",
    notes: "Application de produit documentée dans le suivi initial.", status: "traite",
    detectedOn: seed.detectedOn, treatedOn: treatment.date, resolvedOn: null, product: treatment.product,
  }))];
}

function followupHistory(event: Work): CafardHistoryEvent {
  return {
    id: event.id, kind: "followup", date: event.date, at: event.occurredAt, actor: event.actor,
    notes: event.notes, status: event.cafardStatus!, detectedOn: event.detectedOn ?? null,
    treatedOn: event.treatedOn ?? null, resolvedOn: event.resolvedOn ?? null, product: event.product || "",
  };
}

function inspectionHistory(record: Inspection): CafardHistoryEvent {
  return {
    id: record.id, kind: "inspection", date: record.date, at: matchingTime(record.date, record.inspectedAt),
    actor: record.actor, notes: record.notes || "Cafards détectés lors du contrôle de la chambre.",
    status: "signale", detectedOn: record.date, treatedOn: null, resolvedOn: null, product: "",
  };
}

/**
 * One follow-up per room, projected from existing immutable observations.
 * A positive control appears here without a second write or a maintenance anomaly.
 * Explicit follow-ups are snapshots ordered by revision; the initial list never
 * replaces them. A newer positive observation reopens the follow-up. A negative
 * control alone does not assert that treatment is finished or resolve a case.
 */
export function cafardCases(
  inspections: readonly Inspection[],
  workEvents: readonly Work[],
  seeds: readonly CafardSeed[] = [],
): CafardCase[] {
  const positives = uniqueById(inspections).filter(record => rooms.includes(record.room) && record.bugs === "oui")
    .sort((a, b) => observationOrder(a.date, a.inspectedAt).localeCompare(observationOrder(b.date, b.inspectedAt)) || a.id.localeCompare(b.id));
  const followups = uniqueById(workEvents).filter(event => event.kind === "cafardFollowup" &&
    event.targetId === event.room && rooms.includes(event.room) && event.cafardStatus !== undefined)
    .sort((a, b) => a.expectedRevision - b.expectedRevision || a.id.localeCompare(b.id));
  const initial = new Map(seeds.filter(seed => rooms.includes(seed.room)).map(seed => [seed.room, seed]));
  const trackedRooms = new Set([...initial.keys(), ...positives.map(record => record.room), ...followups.map(event => event.room)]);

  return [...trackedRooms].sort().map(room => {
    const seed = initial.get(room), observations = positives.filter(record => record.room === room);
    const updates = followups.filter(event => event.room === room), latest = updates.at(-1);
    const history = [...(seed ? seedHistory(seed) : []), ...observations.map(inspectionHistory), ...updates.map(followupHistory)]
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.at || "").localeCompare(a.at || "") || b.id.localeCompare(a.id));
    const record: CafardCase = {
      room, status: seed?.status || "a_verifier", detectedOn: seed?.detectedOn ?? null,
      treatedOn: seed?.treatedOn ?? null, updatedOn: seed?.updatedOn ?? null, resolvedOn: seed?.resolvedOn ?? null,
      product: seed?.product || "", notes: seed?.notes || "", history,
      revision: latest ? latest.expectedRevision + 1 : 0, lastEventId: latest?.id || null,
    };
    // importedAt is an initialization checkpoint, not a fabricated business date.
    // It keeps an old positive control from undoing the user's reviewed room list.
    let reviewedThrough = seed ? observationOrder(today(new Date(seed.importedAt)), seed.importedAt) : "";
    if (latest) {
      Object.assign(record, {
        status: latest.cafardStatus!, detectedOn: latest.detectedOn ?? null, treatedOn: latest.treatedOn ?? null,
        updatedOn: latest.date, resolvedOn: latest.resolvedOn ?? null, product: latest.product || "", notes: latest.notes,
      });
      const reviewDate = latest.cafardStatus === "resolu" ? latest.resolvedOn || latest.date : latest.date;
      reviewedThrough = observationOrder(reviewDate, latest.occurredAt, true);
    }
    for (const observation of observations) {
      const order = observationOrder(observation.date, observation.inspectedAt);
      if (order <= reviewedThrough) continue;
      record.status = "signale";
      record.lastEventId = observation.id;
      // Keep the original detection and previous applications useful. The new
      // observation has its own dated history row; only the resolution is cleared.
      // An earlier documented treatment can exist while the original detection
      // date is unknown. Do not invent that date from a later observation.
      if (!record.detectedOn && (!record.treatedOn || observation.date <= record.treatedOn)) record.detectedOn = observation.date;
      record.resolvedOn = null;
      if (!record.updatedOn || record.updatedOn < observation.date) record.updatedOn = observation.date;
      record.notes = observation.notes || "Cafards détectés lors du contrôle de la chambre.";
      reviewedThrough = order;
    }
    return record;
  });
}
