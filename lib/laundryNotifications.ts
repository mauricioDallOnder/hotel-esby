import { getLaundryMachine, laundryMachineStates, type LaundryCycle } from "./laundry";
import type { WorkEntry, WorkEvent } from "./rooms";

export type LaundryNoticeStage = "soon" | "finished";
export type LaundryNotice = {
  id: string;
  cycleId: string;
  machineId: string;
  stage: LaundryNoticeStage;
  title: string;
  body: string;
  tag: string;
  url: "/lingerie";
  expiresAt: string;
};

// Short expiry avoids a delayed "10 minutes left" message after the cycle ends,
// or an obsolete completion alert after the device has been offline for hours.
export function laundryNoticeForCycle(cycle: LaundryCycle, now = Date.now()): LaundryNotice | null {
  if (cycle.status !== "en_cours") return null;
  const machine = getLaundryMachine(cycle.machineId);
  const endsAt = Date.parse(cycle.endsAt);
  if (!machine || !Number.isFinite(endsAt) || !Number.isFinite(now)) return null;
  const stage = now >= endsAt ? "finished" : now >= endsAt - 10 * 60_000 ? "soon" : null;
  if (!stage) return null;
  const expiresAt = stage === "soon" ? endsAt : endsAt + 15 * 60_000;
  if (now >= expiresAt) return null;
  const id = cycle.cycleId + ":" + stage;
  return {
    id, cycleId: cycle.cycleId, machineId: cycle.machineId, stage,
    title: stage === "soon" ? "Lingerie · bientôt terminé" : "Lingerie · cycle terminé",
    body: machine.label + " · chambre " + cycle.room + (stage === "soon"
      ? " : il reste moins de 10 minutes."
      : " : le linge est prêt à récupérer."),
    tag: "laundry:" + id, url: "/lingerie", expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function laundryNotices(events: (WorkEntry | WorkEvent)[], now = Date.now()): LaundryNotice[] {
  return laundryMachineStates(events, now).flatMap(({ cycle }) => {
    const notice = cycle && laundryNoticeForCycle(cycle, now);
    return notice ? [notice] : [];
  });
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
