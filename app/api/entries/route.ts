import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain";
import { parseEntry } from "@/lib/rooms";
import { readBody, errorResponse } from "@/lib/http";
import { executeEntry, deleteAbsence } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const role = await requireAuth(request);
    const legacy = request.headers.get("X-Entry-Schema") === "1";
    const entry = parseEntry(await readBody(request, 1_600_000), legacy);
    if (role !== "direction" && entry.type === "createRoomInspection" && entry.issueLinks?.some(link => link.outcome === "resolved"))
      throw new DomainError("Seule la direction peut résoudre une anomalie.", 403);
    return Response.json(await executeEntry(entry, legacy), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    await requireAuth(request);
    return Response.json(await deleteAbsence(await readBody(request, 1000)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
