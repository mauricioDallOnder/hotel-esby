import { requireAuth } from "@/lib/auth";
import { commandSchema } from "@/lib/domain";
import { readBody, errorResponse } from "@/lib/http";
import { execute, readState, storageMode } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try { await requireAuth(request); return Response.json({ ...await readState(), mode: storageMode() }, { headers: { "Cache-Control": "no-store" } }); } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try { await requireAuth(request); const command = commandSchema.parse(await readBody(request)); return Response.json({ ...await execute(command), mode: storageMode() }); } catch (e) { return errorResponse(e); }
}
export const PATCH = POST;
