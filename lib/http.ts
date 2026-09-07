import { ZodError } from "zod";
import { DomainError } from "./domain";
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      { error: error.issues.map((i) => i.message).join(" ") },
      { status: 400 }
    );
  if (error instanceof DomainError)
    return Response.json({ error: error.message }, { status: error.code });
  console.error("[hotel]", error);
  return Response.json(
    { error: "Une erreur est survenue. Actualisez avant de réessayer." },
    { status: 500 }
  );
}
export async function readBody(request: Request, limit = 3_000_000) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new DomainError("Le fichier est trop volumineux.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Requête vide.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new DomainError("Le fichier est trop volumineux.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("JSON invalide.");
  }
}
