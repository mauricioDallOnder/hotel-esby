import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain";
import { errorResponse, readBody } from "@/lib/http";
import { laundryPushEndpointSchema, laundryPushSubscriptionSchema, laundryVapidConfig } from "@/lib/laundryPush";
import { removeLaundryPushSubscription, saveLaundryPushSubscription } from "@/lib/laundryPushStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireAuth(request);
    if (!laundryVapidConfig()) throw new DomainError("Les notifications en arrière-plan ne sont pas encore activées.", 503);
    const subscription = laundryPushSubscriptionSchema.parse(await readBody(request, 8_000));
    return Response.json(await saveLaundryPushSubscription(subscription), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    await requireAuth(request);
    const { endpoint } = laundryPushEndpointSchema.parse(await readBody(request, 4_000));
    await removeLaundryPushSubscription(endpoint);
    return Response.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
