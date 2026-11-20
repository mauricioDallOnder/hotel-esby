import { requireAuth } from "@/lib/auth";
import { authorizeCommand, commandSchema } from "@/lib/domain";
import { readBody, errorResponse } from "@/lib/http";
import { execute, readState, storageMode } from "@/lib/storage";
import { visibleWorkEvents } from "@/lib/work";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function snapshot(state: Awaited<ReturnType<typeof readState>>) {
  return { ...state, ...(state.workEvents && { workEvents: visibleWorkEvents(state.workEvents) }), mode: storageMode() };
}
export async function GET(request: Request) {
  try { await requireAuth(request); return Response.json(snapshot(await readState({ fresh: new URL(request.url).searchParams.get("fresh") === "1" })), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const role = await requireAuth(request);
    const command = commandSchema.parse(await readBody(request, 8_500_000));
    authorizeCommand(role, command);
    return Response.json(snapshot(await execute(command)));
  } catch (e) { return errorResponse(e); }
}
export const PATCH = POST;
