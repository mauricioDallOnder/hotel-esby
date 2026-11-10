import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import webpush from "web-push";
import { POST } from "../app/api/laundry/notifications/dispatch/route";
import { createId } from "../lib/domain";
import { laundryMachines } from "../lib/laundry";
import { listLaundryPushSubscriptions, saveLaundryPushSubscription } from "../lib/laundryPushStorage";
import { executeEntry } from "../lib/storage";

function fixture(t: TestContext) {
  const previous = { ...process.env }, directory = mkdtempSync(path.join(tmpdir(), "hotel-dispatch-"));
  t.after(() => {
    for (const key of ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_API_TOKEN", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"])
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    rmSync(directory, { recursive: true, force: true });
  });
  const keys = webpush.generateVAPIDKeys();
  Object.assign(process.env, { STORAGE_DRIVER: "local", LOCAL_DATA_DIR: directory, GOOGLE_API_TOKEN: "test-dispatch-token",
    VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:notifications@example.test" });
  return (authorized = true) => POST(new Request("https://hotel.example.test/api/laundry/notifications/dispatch", {
    method: "POST", headers: authorized ? { authorization: "Bearer test-dispatch-token" } : {},
  }));
}

async function device(number: number) {
  return saveLaundryPushSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/fictional-" + number,
    keys: { p256dh: createECDH("prime256v1").generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") } });
}

async function start(index: number) {
  const machine = laundryMachines[index], startedAt = new Date(Date.now() - (machine.durationMinutes - 9) * 60_000).toISOString();
  await executeEntry({ type: "createWorkEvent", kind: "laundryCycle", id: createId(), targetId: machine.id, expectedRevision: 0,
    room: "101", date: startedAt.slice(0, 10), actor: "Agent fictif", notes: "", occurredAt: startedAt,
    laundryCycleId: createId(), laundryStartedAt: startedAt, laundryStatus: "en_cours", laundryCollectedAt: null, laundryCollectedBy: "", laundryOwner: "" });
}

test("dispatch authenticates, batches more than fifty deliveries without starving later devices, and skips sent notices", async t => {
  const dispatch = fixture(t), sent: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); });
  assert.equal((await dispatch(false)).status, 401);
  assert.equal(sent.length, 0);
  for (let i = 0; i < 6; i++) await start(i);
  for (let i = 0; i < 11; i++) await device(i);
  const first = await dispatch();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { processed: 50, retry: 0 });
  assert.deepEqual(await (await dispatch()).json(), { processed: 16, retry: 0 });
  assert.deepEqual(await (await dispatch()).json(), { processed: 0, retry: 0 });
  assert.equal(sent.length, 66);
  assert.equal(new Set(sent).size, 11);
});

test("dispatch releases failed deliveries for retry and removes expired device subscriptions", async t => {
  const dispatch = fixture(t), sent: string[] = [];
  await start(0);
  for (let i = 0; i < 3; i++) await device(i);
  let recovered = false;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const endpoint = String(url); sent.push(endpoint);
    return new Response(null, { status: endpoint.endsWith("-1") ? 410 : endpoint.endsWith("-2") && !recovered ? 503 : 201 });
  });
  assert.deepEqual(await (await dispatch()).json(), { processed: 3, retry: 1 });
  assert.equal((await listLaundryPushSubscriptions()).length, 2);
  recovered = true;
  assert.deepEqual(await (await dispatch()).json(), { processed: 1, retry: 0 });
  assert.equal(sent.length, 4);
  assert.equal(sent.filter(url => url.endsWith("-1")).length, 1);
  assert.equal(sent.filter(url => url.endsWith("-0")).length, 1);
});
