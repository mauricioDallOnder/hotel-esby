import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { readPhoto } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireAuth(request); const { id } = await context.params; const index = Number(new URL(request.url).searchParams.get("index") ?? "0"); const photo = await readPhoto(id, index); return new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); } catch (e) { return errorResponse(e); }
}
