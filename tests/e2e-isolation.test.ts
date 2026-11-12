import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { today } from "../lib/domain";
import { listLaundryPushSubscriptions } from "../lib/laundryPushStorage";
import { executeEntry, readState } from "../lib/storage";
import type { WorkEntry } from "../lib/rooms";
import { e2eDataMarker, prepareE2ELocalData, resetE2ELocalData } from "./e2e/helpers/local-data";

function owned(t: TestContext) {
  const environment: Record<string, string | undefined> = {};
  const data = prepareE2ELocalData(environment);
  t.after(() => rmSync(data.directory, { recursive: true, force: true }));
  return { data, environment };
}

function outside(t: TestContext) {
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "hotel-other-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, "hotel.json"), "keep external records");
  return directory;
}

test("config re-evaluation and child workers reuse the marked directory without resetting it", t => {
  const { data, environment } = owned(t);
  writeFileSync(path.join(data.directory, "hotel.json"), "keep this attempt");
  assert.deepEqual(prepareE2ELocalData(environment), data);
  const helper = fileURLToPath(new URL("./e2e/helpers/local-data.ts", import.meta.url));
  const inherited = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "-e",
    `process.stdout.write(JSON.stringify(require(${JSON.stringify(helper)}).prepareE2ELocalData()))`,
  ], { env: { ...process.env, ...environment }, encoding: "utf8" }));
  assert.deepEqual(inherited, data);
  assert.equal(readFileSync(path.join(data.directory, "hotel.json"), "utf8"), "keep this attempt");
});

test("reset refuses unowned directories and never adopts an operational LOCAL_DATA_DIR", t => {
  const directory = outside(t), { data } = owned(t);
  assert.throws(() => resetE2ELocalData({ ...data, directory }), /Refusing to reset E2E data/);
  assert.equal(readFileSync(path.join(directory, "hotel.json"), "utf8"), "keep external records");
  const separate = prepareE2ELocalData({ LOCAL_DATA_DIR: directory });
  t.after(() => rmSync(separate.directory, { recursive: true, force: true }));
  assert.notEqual(separate.directory, directory);
  assert.equal(readFileSync(path.join(directory, "hotel.json"), "utf8"), "keep external records");
});

test("missing or mismatched ownership tokens and markers cannot clear existing records", t => {
  const { data, environment } = owned(t);
  const hotel = path.join(data.directory, "hotel.json");
  writeFileSync(hotel, "keep owned records");
  assert.throws(() => prepareE2ELocalData({ HOTEL_E2E_DATA_DIR: data.directory }), /both the directory and its token/);
  assert.throws(() => prepareE2ELocalData({ ...environment, HOTEL_E2E_DATA_TOKEN: randomUUID() }), /does not belong/);
  assert.throws(() => resetE2ELocalData({ ...data, token: randomUUID() }), /does not belong/);
  assert.equal(readFileSync(hotel, "utf8"), "keep owned records");
  unlinkSync(path.join(data.directory, e2eDataMarker));
  assert.throws(() => resetE2ELocalData(data));
  assert.equal(readFileSync(hotel, "utf8"), "keep owned records");
});

test("a hotel-e2e name cannot authorize a symlink or a directory outside the temporary root", t => {
  const directory = outside(t), { data } = owned(t);
  const alias = path.join(realpathSync(tmpdir()), `hotel-e2e-${randomUUID()}`);
  symlinkSync(directory, alias, "dir");
  t.after(() => unlinkSync(alias));
  assert.throws(() => resetE2ELocalData({ ...data, directory: alias }), /Refusing to reset E2E data/);
  const nested = path.join(directory, "hotel-e2e-nested");
  mkdirSync(nested);
  assert.throws(() => resetE2ELocalData({ ...data, directory: nested }), /directly inside tmpdir/);
  assert.equal(readFileSync(path.join(directory, "hotel.json"), "utf8"), "keep external records");
});

test("a replaced photos directory is rejected before any hotel records are reset", t => {
  const directory = outside(t), { data } = owned(t);
  const hotel = path.join(data.directory, "hotel.json");
  writeFileSync(hotel, "keep current records");
  symlinkSync(directory, path.join(data.directory, "photos"), "dir");
  assert.throws(() => resetE2ELocalData(data), /unexpected storage target: photos/);
  assert.equal(readFileSync(hotel, "utf8"), "keep current records");
  assert.equal(readFileSync(path.join(directory, "hotel.json"), "utf8"), "keep external records");
});

test("each attempt starts with fresh local records, photos and notification state in the same process", async t => {
  const { data } = owned(t);
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR"].map(key => [key, process.env[key]] as const);
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = data.directory;
  t.after(() => previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }));
  const treatment = (): WorkEntry => ({
    type: "createWorkEvent", id: randomUUID(), kind: "cafardFollowup", targetId: "125", room: "125",
    expectedRevision: 0, expectedPreviousEventId: null, date: today(), occurredAt: new Date().toISOString(), actor: "Test suivi existant",
    cafardStatus: "traite", detectedOn: today(), treatedOn: today(), resolvedOn: null,
    product: "Gel fictif", notes: "Traitement fictif de la première tentative.", cafardObservationId: null,
  });
  const first = treatment();
  await executeEntry(first);
  await assert.rejects(executeEntry(treatment()), { code: 409 });
  mkdirSync(path.join(data.directory, "photos"));
  writeFileSync(path.join(data.directory, "photos", "old.jpg"), "old photo");
  writeFileSync(path.join(data.directory, "laundry-notifications.json"), JSON.stringify({ version: 1, subscriptions: [{ id: "old-device", subscription: { expirationTime: null } }], deliveries: [] }));
  writeFileSync(path.join(data.directory, "keep.txt"), "not a storage file");
  assert.equal((await listLaundryPushSubscriptions()).length, 1);

  for (let attempt = 0; attempt < 2; attempt++) {
    resetE2ELocalData(data);
    // The application must observe the reset without a restart or a fresh-read flag.
    assert.deepEqual(await readState(), { issues: [], inspections: [], roomInspections: [], workEvents: [], familyEvents: [], deletedFamilyEventIds: [] });
    assert.deepEqual(await listLaundryPushSubscriptions(), []);
    assert.equal(existsSync(path.join(data.directory, "photos")), false);
    assert.equal(existsSync(path.join(data.directory, "laundry-notifications.json")), false);
    assert.equal(readFileSync(path.join(data.directory, "keep.txt"), "utf8"), "not a storage file");
    assert.equal(existsSync(path.join(data.directory, e2eDataMarker)), true);
    const next = treatment();
    await executeEntry(next);
    assert.deepEqual((await readState()).workEvents?.map(event => event.id), [next.id]);
  }
});
