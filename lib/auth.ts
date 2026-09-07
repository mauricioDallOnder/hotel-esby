import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DomainError } from "./domain";

const cookieName = "hotel-session";
function secret() {
  return process.env.APP_PASSWORD || "";
}
function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}
export function passwordMatches(value: string) {
  const a = Buffer.from(signature(value));
  const b = Buffer.from(signature(secret()));
  return !!secret() && timingSafeEqual(a, b);
}
export async function authorized() {
  if (!secret())
    return (
      process.env.NODE_ENV !== "production" &&
      process.env.STORAGE_DRIVER !== "sheets"
    );
  const token = (await cookies()).get(cookieName)?.value || "";
  const [expires, signed] = token.split(".");
  if (!expires || !signed || Number(expires) <= Date.now()) return false;
  const a = Buffer.from(signed);
  const b = Buffer.from(signature(expires));
  return a.length === b.length && timingSafeEqual(a, b);
  }
export async function requireAuth(request: Request) {
  console.log("### REQUIRE AUTH CHAMADO ###");
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("method:", request.method);
  console.log("url:", request.url);
  console.log("origin:", request.headers.get("origin"));
  console.log("host:", request.headers.get("host"));

  if (!(await authorized())) {
    console.log("### SEM AUTORIZACAO / COOKIE ###");
    throw new DomainError("Connexion requise.", 401);
  }

  // Em desenvolvimento, NÃO verificar origem.
  if (process.env.NODE_ENV !== "production") {
    console.log("### DEV: VERIFICACAO DE ORIGIN IGNORADA ###");
    return;
  }

  const origin = request.headers.get("origin");

  if (origin && origin !== new URL(request.url).origin) {
    console.log("### ORIGIN BLOQUEADA EM PRODUCAO ###");
    console.log("origin:", origin);
    console.log("expected:", new URL(request.url).origin);

    throw new DomainError(
      "ORIGIN_BLOCK_AUTH_TS_2026",
      403
    );
  }
}
export async function setSession() {
  const expires = String(Date.now() + 12 * 60 * 60 * 1000);
  (await cookies()).set(cookieName, `${expires}.${signature(expires)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}
export async function clearSession() {
  (await cookies()).delete(cookieName);
}
