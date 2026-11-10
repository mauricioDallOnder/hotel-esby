import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import type { WorkEntry } from "../lib/rooms";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const firstTime = "2026-11-10T10:00:00.000Z";
const warningTime = "2026-11-10T10:30:00.000Z";
const endTime = "2026-11-10T10:40:00.000Z";
const expiryTime = "2026-11-10T10:55:00.000Z";
const subscription = (number = 1, expirationTime: number | null = null) => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/fictional-device-" + number,
  expirationTime,
  keys: { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, number).toString("base64url") },
});
const cycle = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: randomUUID(), kind: "laundryCycle", targetId: "washer-1", expectedRevision: 0,
  room: "101", date: "2026-11-10", actor: "Agent fictif", notes: "", occurredAt: firstTime,
  laundryCycleId: randomUUID(), laundryStatus: "en_cours", laundryStartedAt: firstTime,
  laundryCollectedAt: null, laundryCollectedBy: "", laundryOwner: "Exemple", ...patch,
});
type SheetRow = (string | number)[];

// Exercise the deployable Apps Script rather than duplicating its storage rules.
// Sheet writes assert that the script lock is held, including pruning and setup.
function googleFixture() {
  let locked = false;
  const clock = { now: Date.parse(warningTime) };
  const props = new Map<string, string>([["API_TOKEN", "fictional-test-token"], ["PHOTO_FOLDER_ID", "fictional-folder"]]);
  const work: WorkEntry[] = [];
  class Sheet {
    rows: SheetRow[] = [];
    capacity = 1000;
    writes = 0;
    getLastRow() {
      for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(value => value !== "")) return i + 1;
      return 0;
    }
    getMaxRows() { return this.capacity; }
    insertRowsAfter(after: number, count: number) {
      assert.equal(locked, true); assert.equal(after, this.capacity); this.capacity += count;
    }
    setFrozenRows() { return this; }
    getRange(row: number, column: number, height: number, width: number) {
      type Range = { getValues: () => SheetRow[]; setNumberFormat: () => Range; setValues: (values: SheetRow[]) => Range };
      const range: Range = {
        getValues: () => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.rows[row - 1 + y]?.[column - 1 + x] ?? "")),
        setNumberFormat: () => range,
        setValues: (values: SheetRow[]) => {
          assert.equal(locked, true, "Private state must be written under the script lock");
          assert.equal(values.length, height); assert.ok(values.every(value => value.length === width));
          for (let y = 0; y < height; y++) {
            this.rows[row - 1 + y] ??= [];
            for (let x = 0; x < width; x++) this.rows[row - 1 + y][column - 1 + x] = values[y][x];
          }
          this.writes++;
          return range;
        },
      };
      return range;
    }
  }
  const sheets = new Map<string, Sheet>();
  const triggers: { handler: string; minutes: number; getHandlerFunction: () => string }[] = [];
  function trigger(handler: string, minutes: number) {
    return { handler, minutes, getHandlerFunction: () => handler };
  }
  triggers.push(trigger("existingUnrelatedJob", 10), trigger("dispatchLaundryNotifications", 5), trigger("dispatchLaundryNotifications", 10));
  let status = 200;
  let onFetch: (() => void) | undefined;
  const fetches: { url: string; options: Record<string, unknown> }[] = [];
  const properties = {
    getProperty: (key: string) => props.get(key) ?? null,
    setProperty(key: string, value: string) { props.set(key, value); return this; },
    deleteProperty(key: string) { props.delete(key); return this; },
  };
  const context = vm.createContext({
    clock,
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({
      waitLock() { assert.equal(locked, false, "A callback must not re-enter an already held script lock"); locked = true; },
      hasLock: () => locked,
      releaseLock() { assert.equal(locked, true); locked = false; },
    }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name: string) => sheets.get(name),
        insertSheet(name: string) { assert.equal(locked, true); const sheet = new Sheet(); sheets.set(name, sheet); return sheet; },
      }),
      flush() {},
    },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: (_algorithm: string, value: string) => [...createHash("sha256").update(value).digest()] },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (value: typeof triggers[number]) => triggers.splice(triggers.indexOf(value), 1),
      newTrigger(handler: string) {
        let minutes = 0;
        return {
          timeBased() { return this; },
          everyMinutes(value: number) { minutes = value; return this; },
          create() { assert.equal(locked, true); const value = trigger(handler, minutes); triggers.push(value); return value; },
        };
      },
    },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => {
      assert.equal(locked, false, "The callback calls the app which must be able to acquire this script lock");
      fetches.push({ url, options }); onFetch?.(); return { getResponseCode: () => status };
    } },
  });
  vm.runInContext("const RealDate = Date; Date = class extends RealDate { constructor(value) { super(arguments.length ? value : clock.now); } static now() { return clock.now; } };", context);
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.records_ = (collection: string) => collection === "workEvents" ? structuredClone(work) : [];
  context.deletedAbsences_ = () => [];
  type Response = { ok: boolean; data?: unknown; code?: number; error?: string };
  const call = (input: object): Response => context.doPost({ postData: { contents: JSON.stringify({ token: "fictional-test-token", ...input }) } });
  const successful = <T>(input: object): T => {
    const result = call(input); assert.equal(result.ok, true, result.error); return result.data as T;
  };
  return {
    call, successful, clock, work, props, sheets, triggers, fetches,
    setStatus: (value: number) => { status = value; },
    onFetch: (callback: () => void) => { onFetch = callback; },
    setup: () => context.setupLaundryNotifications(),
    dispatch: () => context.dispatchLaundryNotifications(),
    baseSetup: () => { context.table_ = () => undefined; context.setupRooms_ = () => undefined; context.setup(); },
    privateRows: () => (sheets.get("Notifications lingerie")?.rows.slice(1) || []).filter(row => row[0]),
  };
}

type Lease = { id: string; leaseToken: string };
const request = (entry: WorkEntry, patch: object = {}) => ({ id: hash("fictional delivery"), cycleId: entry.laundryCycleId, stage: "soon", expiresAt: endTime, ...patch });

test("Google push subscriptions are private, idempotent, removable and never exposed by the ordinary app list", () => {
  const google = googleFixture(), device = subscription(), id = hash(device.endpoint);
  assert.equal(google.call({ action: "laundryPushList", token: "wrong" }).code, 401);
  assert.equal(google.sheets.size, 0);
  google.successful({ action: "laundryPushSave", id, subscription: device });
  const first = google.successful<{ id: string; createdAt: string; updatedAt: string }[]>({ action: "laundryPushList" });
  google.clock.now += 60_000;
  google.successful({ action: "laundryPushSave", id, subscription: device });
  const current = google.successful<typeof first>({ action: "laundryPushList" });
  assert.equal(current.length, 1);
  assert.equal(current[0].createdAt, first[0].createdAt);
  assert.notEqual(current[0].updatedAt, first[0].updatedAt);
  assert.ok(google.privateRows().every(row => String(row[2]).startsWith("j")));
  const ordinary = google.successful<Record<string, unknown>>({ action: "list" });
  assert.ok(!JSON.stringify(ordinary).includes(device.endpoint));
  assert.deepEqual(Object.keys(ordinary).sort(), ["deletedFamilyEventIds", "entryVersion", "familyEvents", "inspections", "issues", "maxIssuePhotos", "roomInspections", "workEvents"]);
  assert.equal(google.call({ action: "laundryPushUnknown" }).code, 400);
  google.successful({ action: "laundryPushDelete", endpoint: device.endpoint });
  google.successful({ action: "laundryPushDelete", endpoint: device.endpoint });
  assert.deepEqual(google.successful({ action: "laundryPushList" }), []);
  assert.deepEqual(google.work, []);
  assert.ok(google.sheets.get("Notifications lingerie")!.rows.slice(1).every(row => row.every(value => value === "")), "Removed cells are padded blank in one replacement write");
});

test("Google push limits registered devices and prunes expired subscriptions without erasing active devices", () => {
  const google = googleFixture();
  for (let i = 0; i < 50; i++) {
    const device = subscription(i, i === 0 ? google.clock.now + 60_000 : null);
    google.successful({ action: "laundryPushSave", id: hash(device.endpoint), subscription: device });
  }
  const extra = subscription(50);
  assert.equal(google.call({ action: "laundryPushSave", id: hash(extra.endpoint), subscription: extra }).code, 409);
  const existing = subscription(1);
  google.successful({ action: "laundryPushSave", id: hash(existing.endpoint), subscription: existing });
  google.clock.now += 60_001;
  assert.equal(google.successful<unknown[]>({ action: "laundryPushList" }).length, 49);
  google.successful({ action: "laundryPushSave", id: hash(extra.endpoint), subscription: extra });
  assert.equal(google.successful<unknown[]>({ action: "laundryPushList" }).length, 50);
  assert.equal(google.call({ action: "laundryPushSave", id: hash("wrong hash"), subscription: extra }).code, 400);
  assert.equal(google.call({ action: "laundryPushSave", id: hash("https://internal.example/private"), subscription: { ...extra, endpoint: "https://internal.example/private" } }).code, 400);
  assert.equal(google.successful<unknown[]>({ action: "laundryPushList" }).length, 50);
});

test("Google push leases prevent concurrent duplicates, allow retries and reject stale worker completion", () => {
  const google = googleFixture(), running = cycle(); google.work.push(running);
  const candidate = request(running);
  const claim = () => google.successful<Lease[]>({ action: "laundryPushClaim", requests: [candidate], now: new Date(google.clock.now).toISOString() });
  const complete = (lease: Lease, outcome: "sent" | "retry") => google.successful({ action: "laundryPushComplete", results: [{ ...lease, outcome }], now: new Date(google.clock.now).toISOString() });
  const [first] = claim(); assert.ok(first.leaseToken);
  assert.deepEqual(claim(), []);
  complete({ ...first, leaseToken: randomUUID() }, "sent");
  assert.deepEqual(claim(), []);
  complete(first, "retry");
  const [second] = claim(); assert.notEqual(second.leaseToken, first.leaseToken);
  complete(first, "sent");
  assert.deepEqual(claim(), [], "A stale worker cannot complete another worker's replacement lease");
  google.clock.now += 120_001;
  const [third] = claim(); assert.notEqual(third.leaseToken, second.leaseToken);
  complete(second, "retry");
  assert.deepEqual(claim(), []);
  complete(third, "sent");
  assert.deepEqual(claim(), []);
  google.clock.now = Date.parse(endTime) + 60 * 60_000;
  google.successful({ action: "laundryPushList" });
  assert.equal(google.privateRows().filter(row => row[0] === "delivery").length, 0);
  assert.deepEqual(google.work, [running], "Sending notifications never changes the original laundry history");
});

test("Google push rechecks active custody and exact stage windows before issuing a delivery lease", () => {
  const google = googleFixture(), running = cycle(); google.work.push(running);
  let sequence = 0;
  const claim = (patch: object = {}) => google.successful<Lease[]>({ action: "laundryPushClaim", requests: [request(running, { id: hash(String(sequence++)), ...patch })], now: new Date(google.clock.now).toISOString() });
  google.clock.now = Date.parse(warningTime) - 1;
  assert.deepEqual(claim(), []);
  google.clock.now++;
  assert.equal(claim().length, 1);
  assert.deepEqual(claim({ expiresAt: expiryTime }), [], "A warning cannot remain valid after the cycle ends");
  assert.deepEqual(claim({ stage: "finished", expiresAt: expiryTime }), []);
  google.clock.now = Date.parse(endTime);
  assert.deepEqual(claim(), []);
  assert.equal(claim({ stage: "finished", expiresAt: expiryTime }).length, 1);
  google.clock.now = Date.parse(expiryTime);
  assert.deepEqual(claim({ stage: "finished", expiresAt: expiryTime }), []);
  google.clock.now = Date.parse(warningTime);
  google.work.push({ ...running, id: randomUUID(), expectedRevision: 1, laundryStatus: "recupere", laundryCollectedAt: warningTime, laundryCollectedBy: "Agent fictif", occurredAt: warningTime });
  assert.deepEqual(claim(), [], "An old start is not active after clothes were collected");
  google.work[1] = { ...google.work[1], laundryStatus: "annule", laundryCollectedAt: null, laundryCollectedBy: "" };
  assert.deepEqual(claim(), []);
  google.work.push(cycle({ expectedRevision: 2, laundryStartedAt: warningTime, occurredAt: warningTime }));
  assert.deepEqual(claim(), [], "A replacement cycle must not inherit the previous cycle's notification");
});

test("Google push grants the next pending notifications after skipping a completed batch", () => {
  const google = googleFixture(), running = cycle(); google.work.push(running);
  const requests = Array.from({ length: 60 }, (_, index) => request(running, { id: hash("candidate " + index) }));
  const first = google.successful<Lease[]>({ action: "laundryPushClaim", requests, now: warningTime });
  assert.equal(first.length, 50);
  google.successful({ action: "laundryPushComplete", results: first.map(lease => ({ ...lease, outcome: "sent" })), now: warningTime });
  const next = google.successful<Lease[]>({ action: "laundryPushClaim", requests, now: warningTime });
  assert.equal(next.length, 10);
  assert.ok(next.every(lease => !first.some(previous => previous.id === lease.id)));
  assert.equal(google.call({ action: "laundryPushClaim", requests: Array.from({ length: 301 }, () => requests[0]), now: warningTime }).code, 400);
  assert.equal(google.call({ action: "laundryPushComplete", results: [{ ...next[0], leaseToken: "invalid", outcome: "sent" }], now: warningTime }).code, 400);
});

test("Google notification setup preserves unrelated triggers and dispatches without a held lock or redirected credentials", () => {
  const google = googleFixture();
  assert.deepEqual(google.successful({ action: "laundryPushStatus" }), { configured: false });
  for (const origin of ["http://app.example", "https://user:secret@app.example", "https://app.example/path", "https://app.example?token=secret", "https://app.example#fragment"]) {
    google.props.set("LAUNDRY_APP_URL", origin); assert.throws(google.setup);
  }
  google.props.set("LAUNDRY_APP_URL", "https://app.example/");
  google.props.set("LAUNDRY_PUSH_LAST_RUN_AT", firstTime);
  google.setup(); google.setup();
  assert.equal(google.triggers.length, 2);
  assert.equal(google.triggers.filter(trigger => trigger.handler === "dispatchLaundryNotifications").length, 1);
  assert.equal(google.triggers.find(trigger => trigger.handler === "dispatchLaundryNotifications")?.minutes, 1);
  assert.ok(google.triggers.some(trigger => trigger.handler === "existingUnrelatedJob"));
  assert.deepEqual(google.successful({ action: "laundryPushStatus" }), { configured: true });
  google.onFetch(() => google.successful({ action: "laundryPushClaim", requests: [], now: new Date(google.clock.now).toISOString() }));
  google.dispatch();
  assert.equal(google.props.get("LAUNDRY_PUSH_LAST_RUN_AT"), warningTime);
  assert.equal(google.fetches[0].url, "https://app.example/api/laundry/notifications/dispatch");
  assert.equal(google.fetches[0].options.followRedirects, false);
  assert.equal(google.fetches[0].options.muteHttpExceptions, true);
  assert.deepEqual(JSON.parse(JSON.stringify(google.fetches[0].options.headers)), { Authorization: "Bearer fictional-test-token" });
  google.clock.now += 60_000;
  for (const status of [503, 302]) {
    google.setStatus(status); assert.throws(google.dispatch);
    assert.equal(google.props.get("LAUNDRY_PUSH_LAST_RUN_AT"), warningTime, "A failed callback must not advertise a fresh heartbeat");
  }
  const calls = google.fetches.length;
  google.props.set("LAUNDRY_PUSH_ENABLED", "0"); google.dispatch();
  assert.equal(google.fetches.length, calls);
  assert.equal(google.successful<{ configured: boolean }>({ action: "laundryPushStatus" }).configured, false);
});

test("the ordinary Apps Script setup never enables notification callbacks automatically", () => {
  const google = googleFixture();
  const before = [...google.triggers];
  google.baseSetup();
  assert.deepEqual(google.triggers, before);
  assert.equal(google.props.get("LAUNDRY_PUSH_ENABLED"), undefined);
});
