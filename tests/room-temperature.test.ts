import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createId, today } from "../lib/domain";
import { parseEntry, roomChecks, roomEntrySchema, roomFindings, roomIssue, roomProblems, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { formatRoomTemperature, latestRoomTemperatures, parseRoomTemperatureInput } from "../lib/roomTemperature";
import { completeRoomInspection } from "../lib/roomRotation";
import { executeEntry, readState } from "../lib/storage";

const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", schemaVersion: 4, id: createId(), room: "114", date: today(), actor: "Marie",
  notes: "", condition: "bon", occupied: true, cleaning: null, carpet: "ok", carpetNotes: "",
  microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch,
});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function saved(input: RoomEntry, updatedAt = input.date + "T10:00:00Z"): RoomInspection {
  const { photosData, ...fields } = input;
  assert.equal(photosData.length, 0);
  return { ...fields, version: 1, updatedAt, submissionHash: hash(input), photoIds: [], photoId: null };
}

test("temperature input accepts decimal commas and points without converting an empty or invalid value to zero", () => {
  const valid: [string, number | undefined][] = [
    ["", undefined], ["   ", undefined], ["0", 0], ["0,0", 0], ["21.5", 21.5], ["21,5", 21.5],
    [" -20 ", -20], ["60", 60], [",5", 0.5], ["-.5", -0.5], ["+22,25", 22.25],
  ];
  for (const [text, expected] of valid) assert.equal(parseRoomTemperatureInput(text), expected, text);
  for (const text of ["abc", "NaN", "Infinity", "-Infinity", "20 °C", "20,5.0", "21..5", "0x10", "1e2", "--1", "1 2", "20,", "20.", "9".repeat(400)])
    assert.equal(Number.isNaN(parseRoomTemperatureInput(text)), true, text);
  assert.equal(parseRoomTemperatureInput("60,1"), 60.1); // Validation, not parsing, rejects the range.
  assert.equal(formatRoomTemperature(0), "0 °C");
  assert.equal(formatRoomTemperature(21.5), "21,5 °C");
  assert.equal(formatRoomTemperature(0.00001), "0,00001 °C");
  for (const value of [undefined, NaN, Infinity, -Infinity, -20.1, 60.1])
    assert.equal(formatRoomTemperature(value), "Non renseignée");
});

test("the optional v4 temperature accepts finite decimals including zero and both limits", () => {
  const withoutTemperature = roomEntrySchema.parse(entry());
  assert.equal(Object.hasOwn(withoutTemperature, "temperatureC"), false);
  assert.equal(completeRoomInspection(withoutTemperature), true);
  for (const temperatureC of [-20, -0.5, 0, 20.75, 60]) {
    const result = roomEntrySchema.parse(entry({ temperatureC }));
    assert.equal(result.temperatureC, temperatureC);
    assert.equal(result.schemaVersion, 4);
    assert.deepEqual(parseEntry(result), result);
  }
  for (const temperatureC of [NaN, Infinity, -Infinity, -20.01, 60.01, null, false, "", "20.5"]) {
    const parsed = roomEntrySchema.safeParse({ ...entry(), temperatureC });
    assert.equal(parsed.success, false, String(temperatureC));
    if (!parsed.success) assert.ok(parsed.error.issues.some(issue => issue.path[0] === "temperatureC"));
  }
});

test("unchanged v1, v2, v3 and v4 queue payloads retain the exact hashes captured before this addition", () => {
  const base = {
    type: "createRoomInspection", id: "a1111111-1111-4111-8111-111111111111", room: "114",
    date: "2026-10-20", actor: "Marie", notes: "", condition: "bon", cleaning: "faite",
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
    carpet: "ok", carpetNotes: "", microwave: "oui", photosData: [],
  };
  const v1 = { ...base, room: "112", checks: base.checks.filter(check => !["door_handle_clear", "door_closer"].includes(check.key)) };
  const v2 = { ...base, checks: base.checks.filter(check => check.key !== "door_closer"), occupied: true, schemaVersion: 2 };
  const v3 = { ...v2, schemaVersion: 3, bugs: "non", microwaveCleaning: "propre", fridgeCleaning: "propre" };
  const v4 = { ...base, schemaVersion: 4, occupied: true, bugs: "non", microwaveCleaning: "propre", fridgeCleaning: "propre",
    inspectedAt: "2026-10-20T10:15:00Z", distinctProblemKeys: [], issueLinks: [] };
  const cases = [
    [v1, "af3839fc676639bdc05f2368e1442b03fefa41d8b67bfb460416f55f3b080a08"],
    [v2, "c0f43bdae462586aaf33a6d97d9a786ceffc97a5a8297e76198c2bb1172e726b"],
    [v3, "8eeedf45e79e7254bd0a41f2760e169c19c3baf78f25cd84d97c5336379ca90e"],
    [v4, "921d6548f4aee5e0ae4f5acf800af2bef0a01887d1d1552a4ed16508bb1434aa"],
  ] as const;
  cases.forEach(([input, expected], index) => {
    const parsed = parseEntry(input, index === 0);
    assert.equal(Object.hasOwn(parsed, "temperatureC"), false);
    assert.equal(hash(parsed), expected, "v" + (index + 1));
    assert.equal(hash(parseEntry(parsed, index === 0)), expected);
    if (index < 3) assert.equal(hash(parseEntry({ ...input, temperatureC: 22.5 }, index === 0)), expected);
  });
});

test("a temperature never becomes a room finding, problem or automatic anomaly", () => {
  for (const temperatureC of [-20, 0, 21.5, 60]) {
    const record = saved(entry({ temperatureC }));
    assert.deepEqual(roomFindings(record), []);
    assert.deepEqual(roomProblems(record), []);
    assert.equal(roomIssue(record), undefined);
  }
  const problem = entry();
  problem.checks.find(check => check.key === "taps")!.result = "probleme";
  assert.deepEqual(roomIssue(saved({ ...problem, temperatureC: -20 })), roomIssue(saved(problem)));
});

test("latest temperatures use measurement dates and visit times, ignore future or invalid values and preserve older readings", () => {
  const older = saved(entry({ room: "114", date: "2026-11-02", temperatureC: 18 }));
  const early = saved(entry({ room: "114", date: "2026-11-03", inspectedAt: "2026-11-03T09:00:00Z", temperatureC: 20 }));
  const late = saved(entry({ room: "114", date: "2026-11-03", inspectedAt: "2026-11-03T15:00:00Z", temperatureC: 21.5 }));
  const blank = saved(entry({ room: "114", date: "2026-11-04" }));
  const future = saved(entry({ room: "114", date: "2026-11-05", temperatureC: 25 }));
  const zero = saved(entry({ room: "115", date: "2026-11-03", temperatureC: 0 }));
  const invalid = [NaN, Infinity, 61].map(temperatureC => saved(entry({ room: "115", date: "2026-11-04", temperatureC })));
  const unknown = saved(entry({ room: "116", date: "2026-11-03" }));
  const fallbackEarly = saved(entry({ room: "117", date: "2026-11-02", temperatureC: 19 }), "2026-11-02T10:00:00Z");
  const fallbackLate = saved(entry({ room: "117", date: "2026-11-02", temperatureC: 19.5 }), "2026-11-02T11:00:00Z");
  const confirmed = saved(entry({ room: "118", date: "2026-11-04", inspectedAt: "2026-11-04T09:00:00Z", temperatureC: 22 }));
  const pending = entry({ room: "118", date: "2026-11-04", inspectedAt: "2026-11-04T12:00:00Z", temperatureC: 23 });
  const history = [blank, future, early, older, late, ...invalid, zero, unknown, fallbackEarly, fallbackLate, confirmed, pending,
    saved(entry({ room: "999", date: "2026-11-04", temperatureC: 20 }))];
  const original = structuredClone(history);
  const latest = latestRoomTemperatures(history, "2026-11-04");
  assert.equal(latest.get("114"), late);
  assert.equal(latest.get("115"), zero);
  assert.equal(latest.has("116"), false);
  assert.equal(latest.get("117"), fallbackLate);
  assert.equal(latest.get("118"), pending);
  assert.equal(latest.has("999"), false);
  assert.equal(latest.size, 4);
  assert.equal(latestRoomTemperatures(history, "2026-11-02").get("114"), older);
  assert.equal(latestRoomTemperatures(history, "2026-11-01").size, 0);
  assert.deepEqual(history, original);
});

function restoreEnvironment(t: TestContext) {
  const keys = ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"];
  const previous = keys.map(key => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }));
}

test("local temperature saves and retries preserve values, hashes and inspection immutability without an anomaly", async t => {
  restoreEnvironment(t);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-temperature-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  for (const temperatureC of [0, 21.5]) {
    const input = entry({ temperatureC }), receipt = await executeEntry(input);
    assert.equal(receipt.collection, "roomInspections");
    if (receipt.collection !== "roomInspections") throw new Error("Expected a room receipt");
    assert.equal(receipt.record.temperatureC, temperatureC);
    assert.equal(receipt.record.submissionHash, hash(parseEntry(input)));
    assert.equal(receipt.record.issueSyncVersion, 2);
    assert.equal(receipt.issue, undefined);
    assert.deepEqual(await executeEntry(input), receipt);
    await assert.rejects(executeEntry({ ...input, temperatureC: temperatureC + 1 }), { code: 409 });
  }
  const state = await readState();
  assert.deepEqual(state.roomInspections?.map(record => record.temperatureC), [0, 21.5]);
  assert.equal(state.issues.length, 0);
});

// Use the real Code.gs serialization/read functions with simulated Sheets.
function googleFixture() {
  type Cell = string | number;
  const tables = new Map<string, Cell[][]>();
  function sheet(name: string) {
    const rows = tables.get(name)!;
    return {
      getMaxColumns: () => 26, insertColumnsAfter() {}, setFrozenRows() {}, hideColumns() {},
      getLastRow: () => rows.length,
      getRange: (r: number, c: number, h: number, w: number) => {
        const range = {
          getValues: () => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => rows[r - 1 + y]?.[c - 1 + x] ?? "")),
          setValues: (values: Cell[][]) => { values.forEach((row, y) => row.forEach((value, x) => { (rows[r - 1 + y] ||= [])[c - 1 + x] = value; })); return range; },
          setFontWeight: () => range, setBackground: () => range, setFontColor: () => range, setNumberFormat: () => range,
        };
        return range;
      },
    };
  }
  const book = {
    getSheetByName: (name: string) => tables.has(name) ? sheet(name) : null,
    insertSheet: (name: string) => { tables.set(name, []); return sheet(name); },
  };
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    SpreadsheetApp: { openById: () => book, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  return (input: object) => context.doPost({ postData: { contents: JSON.stringify(input) } });
}

test("the deployable Google script stores temperature in its existing JSON data and returns stable receipts", async t => {
  restoreEnvironment(t);
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/temperature-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const call = googleFixture(), actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    return Response.json(call(input));
  });
  for (const temperatureC of [0, 21.5]) {
    const input = entry({ temperatureC }), receipt = await executeEntry(input);
    assert.equal(receipt.collection, "roomInspections");
    if (receipt.collection !== "roomInspections") throw new Error("Expected a room receipt");
    assert.equal(receipt.record.temperatureC, temperatureC);
    assert.equal(receipt.record.submissionHash, hash(parseEntry(input)));
    assert.equal(receipt.record.issueSyncVersion, 2);
    assert.equal(receipt.issue, undefined);
    assert.deepEqual(await executeEntry(input), receipt);
    await assert.rejects(executeEntry({ ...input, temperatureC: temperatureC + 1 }), { code: 409 });
  }
  assert.deepEqual(actions, Array(6).fill("commitRoomInspection"));
  const state = await readState({ fresh: true });
  assert.deepEqual(state.roomInspections?.map(record => record.temperatureC), [0, 21.5]);
  assert.equal(state.issues.length, 0);
});
