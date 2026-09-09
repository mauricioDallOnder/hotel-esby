import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DomainError } from "./domain";
import { isRole, type Role } from "./roles";

const cookieName = "hotel-session";
function passwordFor(role: Role) {
  return role === "direction"
    ? process.env.APP_DIRECTION_PASSWORD || process.env.APP_PASSWORD || ""
    : process.env.APP_EMPLOYEE_PASSWORD || "";
}
export function configuredRoles(): Role[] {
  return (["direction", "employe"] as const).filter((role) => !!passwordFor(role));
}
function signature(value: string, role: Role) {
  return createHmac("sha256", passwordFor(role)).update(value).digest("hex");
}
export function passwordMatches(value: string, role: Role) {
  if (!passwordFor(role)) return false;
  return timingSafeEqual(
    Buffer.from(signature(value, role)),
    Buffer.from(signature(passwordFor(role), role))
  );
}
export function createSessionToken(role: Role, now = Date.now()) {
  if (!passwordFor(role)) throw new DomainError("Accès non configuré.", 503);
  const payload = `${role}.${now + 12 * 60 * 60 * 1000}`;
  return `${payload}.${signature(payload, role)}`;
}
export function verifySessionToken(token: string, now = Date.now()): Role | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, expires, signed] = parts;
  if (!isRole(role) || !passwordFor(role) || !/^\d+$/.test(expires) || Number(expires) <= now)
    return null;
  const expected = Buffer.from(signature(`${role}.${expires}`, role));
  const received = Buffer.from(signed);
  return received.length === expected.length && timingSafeEqual(received, expected)
    ? role
    : null;
}
export async function sessionRole(): Promise<Role | null> {
  return verifySessionToken((await cookies()).get(cookieName)?.value || "");
}
export async function requireAuth(request: Request): Promise<Role> {
  const role = await sessionRole();
  if (!role) throw new DomainError("Connexion requise.", 401);
  if (process.env.NODE_ENV === "production") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new DomainError("Origine non autorisée.", 403);
  }
  return role;
}
export async function setSession(role: Role) {
  (await cookies()).set(cookieName, createSessionToken(role), {
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
