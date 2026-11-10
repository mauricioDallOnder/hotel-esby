import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { laundryVapidConfig } from "@/lib/laundryPush";
import { getLaundryPushScheduleStatus } from "@/lib/laundryPushStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const config = laundryVapidConfig();
    const schedule: { configured: boolean; lastRunAt?: string } = config ? await getLaundryPushScheduleStatus() : { configured: false };
    const age = schedule.lastRunAt ? Date.now() - Date.parse(schedule.lastRunAt) : NaN;
    const recent = Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
    return Response.json({
      publicKey: config?.publicKey || null,
      backgroundConfigured: !!config && schedule.configured,
      schedulerRecent: recent,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
