import { getLaundryMachine, laundryMachineStates, type LaundryCycle } from "./laundry";
import type { WorkEntry, WorkEvent } from "./rooms";

export type LaundryNoticeStage = "soon" | "finished";
export type LaundryNotice = {
  id: string;
  cycleId: string;
  extensionId?: string;
  machineId: string;
  stage: LaundryNoticeStage;
  title: string;
  body: string;
  tag: string;
  url: "/lingerie";
  expiresAt: string;
};

export function laundryNoticeId(cycle: Pick<LaundryCycle, "cycleId" | "extensionId">, stage: LaundryNoticeStage) {
  return cycle.cycleId + (cycle.extensionId ? ":" + cycle.extensionId : "") + ":" + stage;
}

export function laundryNoticeIsObsolete(cycle: LaundryCycle, id: string) {
  if (!id.startsWith(cycle.cycleId + ":")) return false;
  if (cycle.status !== "en_cours") return true;
  if ([laundryNoticeId(cycle, "soon"), laundryNoticeId(cycle, "finished")].includes(id)) return false;
  // An unseen extension may be newer than this tab's snapshot. Only retire
  // plans that this cycle's history proves were replaced, never unknown IDs.
  const knownPlans = [{ cycleId: cycle.cycleId }, ...cycle.history
    .filter(event => event.laundryAddedMinutes !== undefined)
    .map(event => ({ cycleId: cycle.cycleId, extensionId: event.id }))];
  return knownPlans.some(plan => [laundryNoticeId(plan, "soon"), laundryNoticeId(plan, "finished")].includes(id));
}

// Short expiry avoids a delayed "10 minutes left" message after the cycle ends,
// or an obsolete completion alert after the device has been offline for hours.
export function laundryNoticeForCycle(cycle: LaundryCycle, now = Date.now()): LaundryNotice | null {
  if (cycle.status !== "en_cours") return null;
  const machine = getLaundryMachine(cycle.machineId);
  const endsAt = Date.parse(cycle.endsAt);
  if (!machine || !Number.isFinite(endsAt) || !Number.isFinite(now)) return null;
  const stage = now >= endsAt ? "finished" : now >= endsAt - 10 * 60_000 ? "soon" : null;
  if (!stage) return null;
  // Adding five minutes to an already finished cycle does not create another
  // ten-minute threshold. Only rearm this warning if that threshold is ahead.
  if (stage === "soon" && cycle.extensionId && Date.parse(cycle.updatedAt) > endsAt - 10 * 60_000) return null;
  const expiresAt = stage === "soon" ? endsAt : endsAt + 15 * 60_000;
  if (now >= expiresAt) return null;
  const id = laundryNoticeId(cycle, stage);
  return {
    id, cycleId: cycle.cycleId, machineId: cycle.machineId, stage,
    ...(cycle.extensionId ? { extensionId: cycle.extensionId } : {}),
    title: stage === "soon" ? "Lingerie · bientôt terminé" : "Lingerie · cycle terminé",
    body: machine.label + " · chambre " + cycle.room + (stage === "soon"
      ? " : il reste moins de 10 minutes."
      : machine.kind === "washer" ? " : le linge est prêt à sécher." : " : le linge est prêt à récupérer."),
    tag: "laundry:" + id, url: "/lingerie", expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function laundryNotices(events: (WorkEntry | WorkEvent)[], now = Date.now()): LaundryNotice[] {
  return laundryNoticesForCycles(laundryMachineStates(events, now).flatMap(({ cycle }) => cycle ? [cycle] : []), now);
}

export function laundryNoticesForCycles(cycles: readonly LaundryCycle[], now = Date.now()): LaundryNotice[] {
  return cycles.flatMap(cycle => {
    const notice = laundryNoticeForCycle(cycle, now);
    return notice ? [notice] : [];
  });
}

/** Wake for a stage, its push grace period, or expiry; idle machines need no timer. */
export function nextLaundryNoticeAt(cycles: readonly LaundryCycle[], now = Date.now()): number | null {
  const times = cycles.filter(cycle => cycle.status === "en_cours").flatMap(cycle => {
    const end = Date.parse(cycle.endsAt), soon = end - 10 * 60_000;
    return [soon, soon + 90_000, end, end + 90_000, end + 15 * 60_000];
  }).filter(time => Number.isFinite(time) && time > now);
  return times.length ? Math.min(...times) : null;
}

// Give a healthy minute-based scheduler time to deliver first. An HTTP-success
// heartbeat does not prove a particular push arrived, so local alerts take over
// after this bounded grace even if the scheduler continues reporting success.
export function laundryForegroundReady(notice: LaundryNotice, backgroundAvailable: boolean, now = Date.now()) {
  const expires = Date.parse(notice.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || now >= expires) return false;
  if (!backgroundAvailable) return true;
  const dueAt = expires - (notice.stage === "soon" ? 10 : 15) * 60_000;
  return now >= dueAt + 90_000;
}
