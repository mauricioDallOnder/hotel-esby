import type { WorkEntry, WorkEvent } from "./rooms";
import { getLaundryEndsAt, getLaundryMachine, latestWork, laundryMachines, type LaundryMachine, type LaundryMachineId, type LaundryStatus } from "./work";

export { getLaundryEndsAt, getLaundryMachine, laundryMachines } from "./work";
export type { LaundryMachine, LaundryMachineId, LaundryStatus } from "./work";

type Work = WorkEntry | WorkEvent;
export type LaundryCycle = {
  cycleId: string;
  machineId: LaundryMachineId;
  room: string;
  owner: string;
  startedAt: string;
  endsAt: string;
  initialDurationMinutes: number;
  addedMinutes: number;
  extensionId?: string;
  status: LaundryStatus;
  collectedAt: string | null;
  collectedBy: string;
  actor: string;
  revision: number;
  lastEventId: string;
  history: Work[];
  notes: string;
  updatedAt: string;
  cancelledAt: string | null;
};
export type LaundryPhase = "running" | "soon" | "ready" | "collected" | "cancelled";

// Keep every cycle, not just the latest one on a machine, for the custody log.
export function laundryCycles(events: Work[]): LaundryCycle[] {
  const groups = new Map<string, Work[]>();
  for (const event of events) {
    if (event.kind !== "laundryCycle" || !event.laundryCycleId || !event.laundryStartedAt || !event.laundryStatus ||
      !getLaundryEndsAt(event)) continue;
    const group = groups.get(event.laundryCycleId) || [];
    if (!group.some(item => item.id === event.id)) group.push(event);
    groups.set(event.laundryCycleId, group);
  }
  return [...groups.entries()].map(([cycleId, history]) => {
    history.sort((a, b) => b.expectedRevision - a.expectedRevision || b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    const current = history[0], first = history.at(-1)!;
    const machine = getLaundryMachine(current.targetId)!;
    const planned = history.find(event => event.laundryEndsAt !== undefined) || first;
    const extension = history.find(event => event.laundryAddedMinutes !== undefined);
    return {
      cycleId, machineId: machine.id, room: current.room, owner: current.laundryOwner || "",
      startedAt: current.laundryStartedAt!,
      endsAt: getLaundryEndsAt(planned)!,
      initialDurationMinutes: (Date.parse(getLaundryEndsAt(first)!) - Date.parse(first.laundryStartedAt!)) / 60_000,
      addedMinutes: history.reduce((minutes, event) => minutes + (event.laundryAddedMinutes || 0), 0),
      ...(extension ? { extensionId: extension.id } : {}),
      status: current.laundryStatus!, collectedAt: current.laundryCollectedAt || null,
      collectedBy: current.laundryCollectedBy || "", actor: first.actor,
      revision: current.expectedRevision + 1, lastEventId: current.id,
      history, notes: current.notes, updatedAt: current.occurredAt,
      cancelledAt: current.laundryStatus === "annule" ? current.occurredAt : null,
    };
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.cycleId.localeCompare(a.cycleId));
}

export function laundryTiming(cycle: Pick<LaundryCycle, "startedAt" | "endsAt">, now = Date.now()) {
  const endsAt = cycle.endsAt;
  const totalMs = Date.parse(endsAt) - Date.parse(cycle.startedAt);
  const remainingMs = Math.max(0, Date.parse(endsAt) - now);
  const progress = Math.min(100, Math.max(0, (totalMs - remainingMs) / totalMs * 100));
  return { endsAt, remainingMs, totalMs, progress };
}

export function laundryPhase(cycle: LaundryCycle, now = Date.now()): LaundryPhase {
  if (cycle.status === "recupere") return "collected";
  if (cycle.status === "annule") return "cancelled";
  const { remainingMs } = laundryTiming(cycle, now);
  return remainingMs === 0 ? "ready" : remainingMs <= 10 * 60_000 ? "soon" : "running";
}

export function activeLaundryCycle(machineId: string, events: Work[]) {
  const current = latestWork(events, "laundryCycle").get(machineId);
  if (current?.laundryStatus !== "en_cours") return undefined;
  return laundryCycles(events).find(cycle => cycle.cycleId === current.laundryCycleId && cycle.machineId === machineId);
}

export type LaundryMachineState = {
  machine: LaundryMachine;
  cycle?: LaundryCycle;
  revision: number;
  lastEventId?: string;
  phase: "available" | LaundryPhase;
  remainingMs: number;
  totalMs: number;
  progress: number;
  endsAt: string | null;
};

export type LaundryMachineSnapshot = Pick<LaundryMachineState, "machine" | "cycle" | "revision" | "lastEventId">;

/** Project immutable history once; clock updates only need the six snapshots. */
export function projectLaundry(events: Work[]) {
  const latest = latestWork(events, "laundryCycle");
  const cycles = laundryCycles(events);
  const byId = new Map(cycles.map(cycle => [cycle.cycleId, cycle]));
  const machines: LaundryMachineSnapshot[] = laundryMachines.map(machine => {
    const current = latest.get(machine.id);
    const cycle = current?.laundryStatus === "en_cours" ? byId.get(current.laundryCycleId!) : undefined;
    return { machine, cycle, revision: current ? current.expectedRevision + 1 : 0, lastEventId: current?.id };
  });
  return { cycles, machines };
}

export function laundryStatesAt(machines: readonly LaundryMachineSnapshot[], now = Date.now()): LaundryMachineState[] {
  return machines.map(({ machine, cycle, revision, lastEventId }) => ({ machine, cycle, revision, lastEventId,
      phase: cycle ? laundryPhase(cycle, now) : "available",
      ...(cycle ? laundryTiming(cycle, now) : { remainingMs: 0, totalMs: machine.durationMinutes * 60_000, progress: 0, endsAt: null }),
  }));
}

export function laundryMachineStates(events: Work[], now = Date.now()): LaundryMachineState[] {
  return laundryStatesAt(projectLaundry(events).machines, now);
}

/** History only changes phase at these boundaries, not every countdown second. */
export function nextLaundryPhaseAt(machines: readonly LaundryMachineSnapshot[], now = Date.now()): number | null {
  const times = machines.flatMap(({ cycle }) => cycle ? [Date.parse(cycle.endsAt) - 10 * 60_000, Date.parse(cycle.endsAt)] : [])
    .filter(time => Number.isFinite(time) && time > now);
  return times.length ? Math.min(...times) : null;
}
