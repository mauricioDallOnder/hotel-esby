import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { readPhoto } from "@/lib/storage";
import { createHash } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(request);
    const { id } = await context.params;
    const index = Number(new URL(request.url).searchParams.get("index") ?? "0");
    const photo = await readPhoto(id, index);
    const etag = `"${createHash("sha256").update(photo).digest("hex")}"`;
    const headers = {
      "Content-Type": "image/jpeg",
      // Revalidate every use so authentication is checked even for a cached image.
      "Cache-Control": "private, no-cache",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    };
    return request.headers.get("if-none-match") === etag
      ? new Response(null, { status: 304, headers })
      : new Response(new Uint8Array(photo), { headers });
  } catch (e) { return errorResponse(e); }
}
