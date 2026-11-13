import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createId, today, type Issue } from "../lib/domain";
import { executeEntry } from "../lib/storage";
import { roomChecks, type RoomEntry, type RoomInspection } from "../lib/rooms";

const entry = (result: "ok" | "probleme"): RoomEntry => ({
  type: "createRoomInspection", schemaVersion: 6, id: createId(), room: "123", date: today(),
  actor: "Test radiateur", notes: "", occupied: true, condition: "bon", cleaning: null,
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null,
  fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(check => ({ key: check.key, result: check.key === "radiator_clear" ? result : "ok" })),
});

// Execute the deployable script; the existing room-entries suite covers sheet
// column upgrades and JSON serialization, while this fixture covers transactions.
function googleFixture() {
  type Stored = RoomInspection | Issue;
  const collections = new Map<string, Stored[]>([["roomInspections", []], ["issues", []]]);
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => structuredClone(collections.get(collection) || []);
  context.deletedAbsences_ = () => [];
  context.writeRecord_ = (collection: string, record: Stored) => {
    const records = collections.get(collection) || [];
    const index = records.findIndex(item => item.id === record.id);
    if (index < 0) records.push(structuredClone(record));
    else records[index] = structuredClone(record);
    collections.set(collection, records);
  };
  return {
    call: (input: object) => context.doPost({ postData: { contents: JSON.stringify(input) } }),
    records: (collection: string) => structuredClone(collections.get(collection) || []),
    removeIssue: (id: string) => collections.set("issues", collections.get("issues")!.filter(issue => issue.id !== id)),
  };
}

test("Google radiator controls preserve Libre, create Caché, repair a partial write and link repeated findings", async t => {
  const keys = ["STORAGE_DRIVER", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"];
  const previous = keys.map(key => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }));
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/radiator-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const google = googleFixture();
  const actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    return Response.json(google.call(input));
  });

  const clear = await executeEntry(entry("ok"));
  assert.equal(clear.collection, "roomInspections");
  if (clear.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.equal(clear.record.schemaVersion, 6);
  assert.equal(clear.record.checks.find(check => check.key === "radiator_clear")?.result, "ok");
  assert.equal(clear.record.createdIssue, false);
  assert.equal(clear.issue, undefined);
  assert.deepEqual(google.records("issues"), []);

  const blocked = entry("probleme"), first = await executeEntry(blocked);
  assert.equal(first.collection, "roomInspections");
  if (first.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.equal(first.record.checks.find(check => check.key === "radiator_clear")?.result, "probleme");
  assert.equal(first.record.createdIssue, true);
  assert.deepEqual(first.record.newIssueFindingKeys, ["radiator_clear"]);
  assert.equal(first.issue?.description, "Chauffage / radiateur : Caché");
  assert.equal(first.issue?.reportedBy, blocked.actor);
  assert.deepEqual(first.issue?.roomFindings, [{ key: "radiator_clear", label: "Chauffage / radiateur : Caché" }]);
  assert.deepEqual(await executeEntry(blocked), first);
  assert.equal(google.records("roomInspections").length, 2);
  assert.equal(google.records("issues").length, 1);

  google.removeIssue(blocked.id);
  const repaired = await executeEntry(blocked);
  assert.equal(repaired.collection, "roomInspections");
  if (repaired.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.deepEqual(repaired.record, first.record);
  assert.equal(repaired.issue?.id, first.issue?.id);
  assert.equal(repaired.issue?.description, first.issue?.description);
  assert.deepEqual(repaired.issue?.roomFindings, first.issue?.roomFindings);
  assert.deepEqual(await executeEntry(blocked), repaired);
  assert.equal(google.records("issues").length, 1);

  const repeatedInput = entry("probleme"), repeated = await executeEntry(repeatedInput);
  assert.equal(repeated.collection, "roomInspections");
  if (repeated.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.equal(repeated.issue, undefined);
  assert.equal(repeated.record.createdIssue, false);
  assert.deepEqual(repeated.record.relatedIssueIds, [blocked.id]);
  assert.deepEqual(await executeEntry(repeatedInput), repeated);
  assert.equal(google.records("roomInspections").length, 3);
  assert.equal(google.records("issues").length, 1);
  assert.ok(actions.every(action => action === "commitRoomInspectionV4"));
});
