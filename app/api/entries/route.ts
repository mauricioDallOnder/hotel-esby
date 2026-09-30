import { requireAuth } from "@/lib/auth";
import { parseEntry } from "@/lib/rooms";
import { readBody, errorResponse } from "@/lib/http";
import { executeEntry, deleteAbsence } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    await requireAuth(request);
    const legacy = request.headers.get("X-Entry-Schema") === "1";
    return Response.json(await executeEntry(parseEntry(await readBody(request, 1_600_000), legacy), legacy), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    await requireAuth(request);
    return Response.json(await deleteAbsence(await readBody(request, 1000)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
