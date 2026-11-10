import { ECDH, createECDH, createHash, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import { DomainError } from "./domain";
import type { LaundryNotice } from "./laundryNotifications";
import type { LaundryPushSubscription } from "./laundryPushStorage";

// The subscription is a capability URL. Restrict outbound requests to browser
// push providers rather than letting an authenticated client choose any server.
export function isLaundryPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const provider = host === "fcm.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host === "web.push.apple.com"
      || /^[a-z0-9-]+\.push\.apple\.com$/.test(host)
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
    return provider && url.protocol === "https:" && !url.username && !url.password
      && (!url.port || url.port === "443") && !url.hash && url.pathname !== "/";
  } catch { return false; }
}

const base64 = (bytes: number) => z.string().max(200).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => Buffer.from(value, "base64url").length === bytes, "Clé de notification invalide.");
const publicPoint = base64(65).refine(value => {
  try {
    const key = Buffer.from(value, "base64url");
    if (key[0] !== 4) return false;
    ECDH.convertKey(key, "prime256v1"); return true;
  }
  catch { return false; }
}, "Clé de notification invalide.");
export const laundryPushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isLaundryPushEndpoint, "Service de notification non pris en charge."),
  expirationTime: z.number().finite().nonnegative().nullable().optional(),
  keys: z.object({ p256dh: publicPoint, auth: base64(16) }).strict(),
}).strict();
export const laundryPushEndpointSchema = z.object({
  endpoint: z.string().max(2048).refine(isLaundryPushEndpoint, "Service de notification non pris en charge."),
}).strict();

export type LaundryVapidConfig = { publicKey: string; privateKey: string; subject: string };
export function laundryVapidConfig(env: Record<string, string | undefined> = process.env): LaundryVapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim(), privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) return null;
    if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) {
      const contact = new URL(subject);
      if (contact.protocol !== "https:" || contact.username || contact.password) return null;
    }
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (ecdh.getPublicKey().toString("base64url") !== publicKey) return null;
    return { publicKey, privateKey, subject };
  } catch { return null; }
}

export function requireLaundryDispatch(request: Request, env: Record<string, string | undefined> = process.env) {
  const token = env.GOOGLE_API_TOKEN;
  const provided = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from("Bearer " + token);
  if (!token || provided.length !== expected.length
    || !timingSafeEqual(provided, expected))
    throw new DomainError("Accès refusé.", 401);
}

export function laundryDeliveryId(subscriptionId: string, noticeId: string) {
  return createHash("sha256").update(subscriptionId + ":" + noticeId).digest("hex");
}

export async function sendLaundryPush(subscription: LaundryPushSubscription, notice: LaundryNotice, config: LaundryVapidConfig, now = Date.now()) {
  const validated = laundryPushSubscriptionSchema.parse(subscription);
  const ttl = Math.ceil((Date.parse(notice.expiresAt) - now) / 1000);
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  const details = webpush.generateRequestDetails(validated, JSON.stringify(notice), {
    vapidDetails: config,
    TTL: Math.min(ttl, 900),
    urgency: "high",
    topic: createHash("sha256").update(notice.id).digest("base64url").slice(0, 32),
  });
  // The library handles VAPID and payload encryption. A fetch deadline covers
  // the entire request, unlike a socket inactivity timeout, and rejects redirects.
  const response = await fetch(details.endpoint, {
    method: details.method, headers: details.headers,
    body: details.body ? new Uint8Array(details.body) : undefined,
    signal: AbortSignal.timeout(8_000), redirect: "error", cache: "no-store",
  });
  await response.body?.cancel();
  if (!response.ok) throw Object.assign(new Error("Service de notification indisponible."), { statusCode: response.status });
}
