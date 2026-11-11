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
    
    const url = new URL(request.url);
    const index = Number(url.searchParams.get("index") ?? "0");
    const collection = url.searchParams.get("collection") === "roomInspections" ? "roomInspections" : "issues";
    
    const photo = await readPhoto(id, index, collection);
    const etag = `"${createHash("sha256").update(photo).digest("hex")}"`;
    
    const headers = {
      "Content-Type": "image/jpeg",
      // Photo access must be checked before both a full response and an ETag 304.
      "Cache-Control": "private, no-cache",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "Vary": "Cookie",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    };
    
    return request.headers.get("if-none-match") === etag
      ? new Response(null, { status: 304, headers })
      : new Response(new Uint8Array(photo), { headers });
      
  } catch (e) { 
    return errorResponse(e); 
  }
}
