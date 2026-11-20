import { requireAuth } from "@/lib/auth";
import { errorResponse, readBody } from "@/lib/http";
import { importOccupancy } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireAuth(request);
    return Response.json(await importOccupancy(await readBody(request, 128_000)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) { return errorResponse(error); }
}
