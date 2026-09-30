import { requireAuth } from "@/lib/auth";
import { entrySchema } from "@/lib/rooms";
import { readBody, errorResponse } from "@/lib/http";
import { executeEntry } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    await requireAuth(request);
    return Response.json(await executeEntry(entrySchema.parse(await readBody(request, 1_600_000))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
