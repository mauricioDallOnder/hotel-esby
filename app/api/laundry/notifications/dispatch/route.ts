import { DomainError, type State } from "@/lib/domain";
import { errorResponse } from "@/lib/http";
import { laundryNotices } from "@/lib/laundryNotifications";
import { laundryDeliveryId, laundryVapidConfig, requireLaundryDispatch, sendLaundryPush } from "@/lib/laundryPush";
import { claimLaundryPushDeliveries, completeLaundryPushDeliveries, listLaundryPushSubscriptions, removeLaundryPushSubscription } from "@/lib/laundryPushStorage";
import { google, readState, storageMode } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    requireLaundryDispatch(request);
    const config = laundryVapidConfig();
    if (!config) throw new DomainError("Notifications non configurées.", 503);
    const now = Date.now();
    const [state, subscriptions] = await Promise.all([
      storageMode() === "sheets" ? google<State>({ action: "list" }, 8_000) : readState({ fresh: true }),
      listLaundryPushSubscriptions(),
    ]);
    const notices = laundryNotices(state.workEvents || [], now);
    const jobs = subscriptions.flatMap(device => notices.map(notice => ({
      id: laundryDeliveryId(device.id, notice.id), subscription: device.subscription, notice,
    })));
    if (!jobs.length) return Response.json({ processed: 0 });
    const leases = await claimLaundryPushDeliveries(jobs.map(job => ({
      id: job.id, cycleId: job.notice.cycleId, stage: job.notice.stage, expiresAt: job.notice.expiresAt,
    })), new Date(now).toISOString());
    const outcomes: { id: string; leaseToken: string; outcome: "sent" | "retry" }[] = [];
    const expiredEndpoints = new Set<string>();
    // At most 50 leases: two bounded batches leave time for acknowledgement.
    for (let index = 0; index < leases.length; index += 25) {
      if (Date.now() - now > 35_000) {
        outcomes.push(...leases.slice(index).map(lease => ({ ...lease, outcome: "retry" as const })));
        break;
      }
      await Promise.all(leases.slice(index, index + 25).map(async lease => {
        const job = jobs.find(item => item.id === lease.id);
        if (!job) return;
        try {
          await sendLaundryPush(job.subscription, job.notice, config);
          outcomes.push({ ...lease, outcome: "sent" });
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            expiredEndpoints.add(job.subscription.endpoint);
            outcomes.push({ ...lease, outcome: "sent" });
          } else {
            // Do not log provider errors: they can include the private endpoint.
            outcomes.push({ ...lease, outcome: "retry" });
          }
        }
      }));
    }
    await completeLaundryPushDeliveries(outcomes, new Date().toISOString());
    if (Date.now() - now < 42_000)
      await Promise.allSettled([...expiredEndpoints].map(endpoint => removeLaundryPushSubscription(endpoint)));
    return Response.json({ processed: outcomes.length, retry: outcomes.filter(item => item.outcome === "retry").length });
  } catch (error) { return errorResponse(error); }
}
