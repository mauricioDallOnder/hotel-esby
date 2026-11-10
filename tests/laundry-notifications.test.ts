import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { test } from "node:test";
import webpush from "web-push";
import { createId } from "../lib/domain";
import { laundryCycles } from "../lib/laundry";
import { laundryForegroundReady, laundryNoticeForCycle, laundryNotices } from "../lib/laundryNotifications";
import { isLaundryPushEndpoint, laundryDeliveryId, laundryPushSubscriptionSchema, laundryVapidConfig, requireLaundryDispatch, sendLaundryPush } from "../lib/laundryPush";
import type { WorkEntry } from "../lib/rooms";

const startedAt = "2026-11-10T09:00:00.000Z";
const entry = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), kind: "laundryCycle", targetId: "washer-1", expectedRevision: 0,
  room: "101", date: "2026-11-10", actor: "Agent de démonstration", notes: "", occurredAt: startedAt,
  laundryCycleId: createId(), laundryStatus: "en_cours", laundryStartedAt: startedAt,
  laundryCollectedAt: null, laundryCollectedBy: "", laundryOwner: "Nom privé du résident", ...patch,
});
const subscription = () => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/fictional-test-endpoint",
  expirationTime: null,
  keys: { p256dh: createECDH("prime256v1").generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") },
});
const vapid = () => ({ ...webpush.generateVAPIDKeys(), subject: "mailto:notifications@example.test" });

test("notices become due exactly at ten minutes and completion, never replaying expired stages", () => {
  const cycle = laundryCycles([entry()])[0];
  assert.equal(laundryNoticeForCycle(cycle, Date.parse("2026-11-10T09:29:59.999Z")), null);
  const soon = laundryNoticeForCycle(cycle, Date.parse("2026-11-10T09:30:00.000Z"))!;
  assert.equal(soon.stage, "soon");
  assert.equal(soon.expiresAt, cycle.endsAt);
  assert.equal(laundryNoticeForCycle(cycle, Date.parse("2026-11-10T09:39:59.999Z"))?.id, soon.id);
  const finished = laundryNoticeForCycle(cycle, Date.parse("2026-11-10T09:40:00.000Z"))!;
  assert.equal(finished.stage, "finished");
  assert.notEqual(finished.id, soon.id);
  assert.equal(finished.expiresAt, "2026-11-10T09:55:00.000Z");
  assert.equal(laundryNoticeForCycle(cycle, Date.parse("2026-11-10T09:54:59.999Z"))?.id, finished.id);
  assert.equal(laundryNoticeForCycle(cycle, Date.parse("2026-11-10T09:55:00.000Z")), null);
  assert.equal(laundryNoticeForCycle(cycle, NaN), null);
  assert.equal(laundryNoticeForCycle({ ...cycle, endsAt: "invalid" }), null);
  assert.equal(JSON.stringify(soon).includes(cycle.owner), false);
  assert.match(soon.body, /Machine à laver 1 · chambre 101/);
});

test("collected, cancelled and superseded machine reservations cannot generate a notice", () => {
  const first = entry();
  const now = Date.parse("2026-11-10T09:35:00.000Z");
  const collected = { ...first, id: createId(), expectedRevision: 1, laundryStatus: "recupere" as const, occurredAt: "2026-11-10T09:34:00.000Z", laundryCollectedAt: "2026-11-10T09:34:00.000Z", laundryCollectedBy: "Agent" };
  assert.equal(laundryNotices([first], now).length, 1);
  assert.deepEqual(laundryNotices([collected, first], now), []);
  assert.deepEqual(laundryNotices([first, { ...collected, laundryStatus: "annule" as const }], now), []);
  const replacement = entry({ expectedRevision: 2, laundryStartedAt: "2026-11-10T09:34:00.000Z", occurredAt: "2026-11-10T09:34:00.000Z" });
  assert.deepEqual(laundryNotices([replacement, first], now), []);
  const washer = entry({ targetId: "washer-3" }), dryer = entry({ targetId: "dryer-3", laundryStartedAt: "2026-11-10T08:10:00.000Z", occurredAt: "2026-11-10T08:10:00.000Z" });
  const two = laundryNotices([washer, dryer], Date.parse("2026-11-10T09:30:00.000Z"));
  assert.deepEqual(two.map(notice => notice.machineId), ["washer-3", "dryer-3"]);
  assert.notEqual(two[0].id, two[1].id);
});

test("a healthy scheduler only delays foreground fallback for ninety seconds, including a failed push service", () => {
  const cycle = laundryCycles([entry()])[0];
  for (const dueAt of ["2026-11-10T09:30:00.000Z", "2026-11-10T09:40:00.000Z"]) {
    const now = Date.parse(dueAt), notice = laundryNoticeForCycle(cycle, now)!;
    assert.equal(laundryForegroundReady(notice, false, now), true, "Offline, queued or unavailable background delivery falls back immediately");
    assert.equal(laundryForegroundReady(notice, true, now), false);
    assert.equal(laundryForegroundReady(notice, true, now + 89_999), false);
    assert.equal(laundryForegroundReady(notice, true, now + 90_000), true, "An unacknowledged push cannot suppress the whole phase");
    assert.equal(laundryForegroundReady(notice, true, Date.parse(notice.expiresAt)), false);
  }
});

test("push subscriptions allow browser providers and reject SSRF, credentials, redirects and malformed keys", () => {
  for (const url of ["https://fcm.googleapis.com/fcm/send/example", "https://updates.push.services.mozilla.com/wpush/v2/example", "https://web.push.apple.com/example", "https://wns2-par02p.notify.windows.com/w/?token=example"])
    assert.equal(isLaundryPushEndpoint(url), true, url);
  for (const url of ["http://fcm.googleapis.com/fcm/send/x", "https://127.0.0.1/private", "https://169.254.169.254/latest/meta-data", "https://localhost/push", "https://fcm.googleapis.com.attacker.test/push", "https://fcm.googleapis.com@attacker.test/push", "https://user@fcm.googleapis.com/push", "https://fcm.googleapis.com:8443/push", "https://fcm.googleapis.com/push#fragment", "https://fcm.googleapis.com/", "https://attacker.test/redirect-to-push"])
    assert.equal(isLaundryPushEndpoint(url), false, url);
  const valid = subscription();
  assert.equal(laundryPushSubscriptionSchema.safeParse(valid).success, true);
  assert.equal(laundryPushSubscriptionSchema.safeParse({ ...valid, keys: { ...valid.keys, auth: "short" } }).success, false);
  assert.equal(laundryPushSubscriptionSchema.safeParse({ ...valid, keys: { ...valid.keys, p256dh: Buffer.alloc(65).toString("base64url") } }).success, false);
  assert.equal(laundryPushSubscriptionSchema.safeParse({ ...valid, title: "Arbitrary message" }).success, false);
});

test("VAPID configuration requires a matching persistent key pair and a valid sender contact", () => {
  const config = vapid();
  const env = { VAPID_PUBLIC_KEY: config.publicKey, VAPID_PRIVATE_KEY: config.privateKey, VAPID_SUBJECT: config.subject };
  assert.deepEqual(laundryVapidConfig(env), config);
  assert.equal(laundryVapidConfig({}), null);
  assert.equal(laundryVapidConfig({ ...env, VAPID_PRIVATE_KEY: vapid().privateKey }), null);
  assert.equal(laundryVapidConfig({ ...env, VAPID_PUBLIC_KEY: "invalid" }), null);
  assert.equal(laundryVapidConfig({ ...env, VAPID_SUBJECT: "http://example.test" }), null);
  assert.equal(laundryVapidConfig({ ...env, VAPID_SUBJECT: "https://user:password@example.test" }), null);
  assert.notEqual(laundryVapidConfig({ ...env, VAPID_SUBJECT: "https://example.test/contact" }), null);
});

test("dispatch requires the scheduler secret, including malformed and non-ASCII authorization headers", () => {
  const env = { GOOGLE_API_TOKEN: "test-only-token" };
  const request = (token?: string) => new Request("https://hotel.example.test/api/laundry/notifications/dispatch", { method: "POST", headers: token ? { authorization: token } : {} });
  assert.doesNotThrow(() => requireLaundryDispatch(request("Bearer test-only-token"), env));
  for (const token of [undefined, "test-only-token", "Bearer wrong-token", "Bearer tést-only-token"])
    assert.throws(() => requireLaundryDispatch(request(token), env), { code: 401 });
  assert.throws(() => requireLaundryDispatch(request("Bearer undefined"), {}), { code: 401 });
  const id = laundryDeliveryId("device-a", "cycle:soon");
  assert.equal(id, laundryDeliveryId("device-a", "cycle:soon"));
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.notEqual(id, laundryDeliveryId("device-b", "cycle:soon"));
  assert.notEqual(id, laundryDeliveryId("device-a", "cycle:finished"));
});

test("push uses encrypted library delivery with bounded expiry and never sends an expired warning", async t => {
  const calls: { endpoint: string; options?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    calls.push({ endpoint: String(input), options }); return new Response("", { status: 201 });
  });
  const now = Date.parse("2026-11-10T09:30:00.000Z"), config = vapid(), device = subscription();
  const notice = laundryNotices([entry()], now)[0];
  await sendLaundryPush(device, notice, config, now);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, device.endpoint);
  const headers = new Headers(calls[0].options?.headers);
  assert.equal(headers.get("TTL"), "600");
  assert.equal(headers.get("Urgency"), "high");
  assert.equal(headers.get("Topic")?.length, 32);
  assert.equal(headers.get("Content-Encoding"), "aes128gcm");
  assert.match(headers.get("Authorization") || "", /^vapid t=/);
  assert.ok(calls[0].options?.signal instanceof AbortSignal);
  assert.equal(calls[0].options?.redirect, "error");
  const encrypted = calls[0].options?.body as Uint8Array;
  assert.ok(encrypted.length > 100);
  assert.equal(Buffer.from(encrypted).includes(Buffer.from(notice.body)), false);
  await sendLaundryPush(device, notice, config, Date.parse(notice.expiresAt));
  assert.equal(calls.length, 1);
  await assert.rejects(sendLaundryPush({ ...device, endpoint: "https://127.0.0.1/secret" }, notice, config, now));
  assert.equal(calls.length, 1);
});
