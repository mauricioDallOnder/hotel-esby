import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { claimLaundryPushDeliveries, completeLaundryPushDeliveries, getLaundryPushScheduleStatus, listLaundryPushSubscriptions, removeLaundryPushSubscription, saveLaundryPushSubscription, type LaundryPushSubscription } from "../lib/laundryPushStorage";
import type { WorkEntry } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";

const firstTime = "2026-10-01T09:00:00.000Z";
const soon = "2026-10-01T09:30:00.000Z";
const end = "2026-10-01T09:40:00.000Z";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const key = createECDH("prime256v1");
key.generateKeys();
const subscription = (number = 1): LaundryPushSubscription => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/test-device-${number}`,
  keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
});
function local(t: TestContext) {
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"].map(name => [name, process.env[name]] as const);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-laundry-push-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = directory;
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
const cycle = (): WorkEntry => ({
  type: "createWorkEvent", id: randomUUID(), kind: "laundryCycle", targetId: "washer-1", expectedRevision: 0,
  room: "101", date: "2026-10-01", actor: "Agent fictif", notes: "", occurredAt: firstTime,
  laundryCycleId: randomUUID(), laundryStatus: "en_cours", laundryStartedAt: firstTime,
  laundryCollectedAt: null, laundryCollectedBy: "", laundryOwner: "",
});
const request = (entry: WorkEntry, index = 1) => ({
  id: digest("device-" + index), cycleId: entry.laundryCycleId!, stage: "soon" as const, expiresAt: end,
});

test("push subscriptions are private, idempotent, bounded and stored with restrictive permissions", async t => {
  const directory = local(t), device = subscription();
  const saved = await saveLaundryPushSubscription(device);
  const initial = (await listLaundryPushSubscriptions())[0];
  assert.equal(saved.id, digest(device.endpoint));
  await saveLaundryPushSubscription({ ...device, keys: { ...device.keys, auth: randomBytes(16).toString("base64url") } });
  const subscriptions = await listLaundryPushSubscriptions();
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].createdAt, initial.createdAt);
  assert.notEqual(subscriptions[0].subscription.keys.auth, initial.subscription.keys.auth);
  assert.equal(JSON.stringify(await readState()).includes(device.endpoint), false);
  assert.equal(statSync(path.join(directory, "laundry-notifications.json")).mode & 0o777, 0o600);
  for (let index = 2; index <= 50; index++) await saveLaundryPushSubscription(subscription(index));
  await assert.rejects(saveLaundryPushSubscription(subscription(51)), { code: 409 });
  await saveLaundryPushSubscription(device);
  assert.equal((await listLaundryPushSubscriptions()).length, 50);
  await removeLaundryPushSubscription(device.endpoint);
  await removeLaundryPushSubscription(device.endpoint);
  assert.equal((await listLaundryPushSubscriptions()).length, 49);
  await assert.rejects(saveLaundryPushSubscription({ ...subscription(), expirationTime: 1 }), { code: 400 });
  assert.deepEqual(await getLaundryPushScheduleStatus(), { configured: false });
});

test("competing dispatches use leases, retry safely and cannot acknowledge a replacement lease", async t => {
  local(t);
  const entry = cycle(), job = request(entry);
  await executeEntry(entry);
  const [first, second] = await Promise.all([
    claimLaundryPushDeliveries([job], soon), claimLaundryPushDeliveries([job], soon),
  ]);
  assert.equal(first.length, 1); assert.equal(second.length, 0);
  const replacement = await claimLaundryPushDeliveries([job], "2026-10-01T09:32:00.000Z");
  assert.equal(replacement.length, 1);
  assert.notEqual(replacement[0].leaseToken, first[0].leaseToken);
  await completeLaundryPushDeliveries([{ ...first[0], outcome: "sent" }], "2026-10-01T09:32:01.000Z");
  await completeLaundryPushDeliveries([{ ...replacement[0], outcome: "retry" }], "2026-10-01T09:32:02.000Z");
  const retried = await claimLaundryPushDeliveries([job], "2026-10-01T09:32:03.000Z");
  assert.equal(retried.length, 1, "Stale acknowledgement must not mark the delivery as sent");
  await completeLaundryPushDeliveries([{ ...retried[0], outcome: "sent" }], "2026-10-01T09:32:04.000Z");
  await completeLaundryPushDeliveries([{ ...retried[0], outcome: "retry" }], "2026-10-01T09:32:05.000Z");
  assert.deepEqual(await claimLaundryPushDeliveries([job], "2026-10-01T09:35:00.000Z"), []);
});

test("claims enforce the current machine, notification windows and collection state", async t => {
  local(t);
  const entry = cycle(); await executeEntry(entry);
  assert.deepEqual(await claimLaundryPushDeliveries([request(entry)], "2026-10-01T09:29:59.999Z"), []);
  assert.deepEqual(await claimLaundryPushDeliveries([{ ...request(entry), expiresAt: "2026-10-01T10:00:00.000Z" }], soon), []);
  assert.deepEqual(await claimLaundryPushDeliveries([request(entry)], end), []);
  const finished = { ...request(entry, 2), stage: "finished" as const, expiresAt: "2026-10-01T09:55:00.000Z" };
  assert.equal((await claimLaundryPushDeliveries([finished], end)).length, 1);
  assert.deepEqual(await claimLaundryPushDeliveries([{ ...finished, id: digest("late") }], finished.expiresAt), []);
  await executeEntry({ ...entry, id: randomUUID(), expectedRevision: 1, expectedPreviousEventId: entry.id, laundryStatus: "recupere",
    occurredAt: "2026-10-01T09:42:00.000Z", laundryCollectedAt: "2026-10-01T09:42:00.000Z", laundryCollectedBy: entry.actor });
  assert.deepEqual(await claimLaundryPushDeliveries([{ ...finished, id: digest("collected") }], "2026-10-01T09:43:00.000Z"), []);
  await assert.rejects(claimLaundryPushDeliveries([{ ...request(entry), id: "invalid" }], soon), { code: 400 });
});

test("delivered candidates do not starve other devices in the next bounded batch", async t => {
  local(t);
  const entry = cycle(); await executeEntry(entry);
  const jobs = Array.from({ length: 60 }, (_, index) => request(entry, index));
  const first = await claimLaundryPushDeliveries(jobs, soon);
  assert.equal(first.length, 50);
  await completeLaundryPushDeliveries(first.map(claim => ({ ...claim, outcome: "sent" })), soon);
  const second = await claimLaundryPushDeliveries(jobs, soon);
  assert.equal(second.length, 10);
  assert.ok(second.every(claim => !first.some(prior => prior.id === claim.id)));
});

test("local notification claims reject an old plan and follow each extension without repeating an immediate short warning", async t => {
  local(t);
  const entry = cycle(); await executeEntry(entry);
  const original = await claimLaundryPushDeliveries([request(entry)], soon);
  await completeLaundryPushDeliveries(original.map(claim => ({ ...claim, outcome: "sent" })), soon);
  const extended: WorkEntry = { ...entry, id: randomUUID(), expectedRevision: 1, expectedPreviousEventId: entry.id,
    occurredAt: "2026-10-01T09:31:00.000Z", laundryAddedMinutes: 5, laundryEndsAt: "2026-10-01T09:45:00.000Z" };
  await executeEntry(extended);
  const currentTime = "2026-10-01T09:36:00.000Z";
  assert.deepEqual(await claimLaundryPushDeliveries([request(entry, 2)], currentTime), [], "The old end is stale even while both warning windows overlap");
  const updated = { ...request(entry, 3), expiresAt: extended.laundryEndsAt! };
  assert.equal((await claimLaundryPushDeliveries([updated], currentTime)).length, 1);
  assert.equal((await claimLaundryPushDeliveries([{ ...request(entry, 4), stage: "finished", expiresAt: "2026-10-01T10:00:00.000Z" }], extended.laundryEndsAt!)).length, 1);
  const overdue: WorkEntry = { ...extended, id: randomUUID(), expectedRevision: 2, expectedPreviousEventId: extended.id,
    occurredAt: "2026-10-01T09:50:00.000Z", laundryEndsAt: "2026-10-01T09:55:00.000Z" };
  await executeEntry(overdue);
  assert.deepEqual(await claimLaundryPushDeliveries([{ ...request(entry, 5), expiresAt: overdue.laundryEndsAt! }], overdue.occurredAt), [], "Adding five minutes after zero must not emit a new ten-minute warning");
  assert.equal((await claimLaundryPushDeliveries([{ ...request(entry, 6), stage: "finished", expiresAt: "2026-10-01T10:10:00.000Z" }], overdue.laundryEndsAt!)).length, 1);
});

test("damaged private storage is surfaced instead of silently dropping notification registrations", async t => {
  const directory = local(t);
  writeFileSync(path.join(directory, "laundry-notifications.json"), "not valid JSON");
  await assert.rejects(listLaundryPushSubscriptions(), SyntaxError);
  assert.equal(readFileSync(path.join(directory, "laundry-notifications.json"), "utf8"), "not valid JSON");
});

test("Sheets push operations use dedicated authenticated actions and never the public hotel state", async t => {
  local(t);
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/laundry-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const actions: string[] = [], device = subscription(), entry = cycle();
  t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    assert.equal(input.token, "test-token");
    assert.ok(options?.signal);
    const data = input.action === "laundryPushSave" ? { id: digest(device.endpoint) }
      : input.action === "laundryPushStatus" ? { configured: true, lastRunAt: soon }
      : input.action === "laundryPushList" || input.action === "laundryPushClaim" ? [] : {};
    return Response.json({ ok: true, data });
  });
  await saveLaundryPushSubscription(device);
  await listLaundryPushSubscriptions();
  await claimLaundryPushDeliveries([request(entry)], soon);
  await completeLaundryPushDeliveries([], soon);
  await removeLaundryPushSubscription(device.endpoint);
  assert.deepEqual(await getLaundryPushScheduleStatus(), { configured: true, lastRunAt: soon });
  assert.deepEqual(actions, ["laundryPushSave", "laundryPushList", "laundryPushClaim", "laundryPushComplete", "laundryPushDelete", "laundryPushStatus"]);
});
