import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { mergeHotel } from "../lib/mergeHotel";
import { entrySchema, roomChecks, rooms, type RoomEntry, type FamilyEntry } from "../lib/rooms";
import { createId, today } from "../lib/domain";
import { executeEntry, readPhoto, readState } from "../lib/storage";

const roomEntry = (): RoomEntry => ({ type: "createRoomInspection", id: createId(), room: "112", date: today(), actor: "Marie", condition: "bon", cleaning: "faite", carpet: "ok", carpetNotes: "", microwave: "oui", notes: "", photosData: [], checks: roomChecks.map(c => ({ key: c.key, result: "ok" })) });
const familyEntry = (): FamilyEntry => ({ type: "createFamilyEvent", id: createId(), room: "332", date: today(), actor: "Marie", family: "Famille test", notes: "", kind: "absence", returnDate: "" });

test("exactly the 89 requested rooms, with no 301 or invented rooms", () => {
  assert.equal(rooms.length, 89); assert.equal(new Set(rooms).size, 89);
  for (const [start, end] of [[101,126], [201,232], [302,332]]) for (let i = start; i <= end; i++) assert.ok(rooms.includes(String(i)));
  assert.equal(entrySchema.safeParse({ ...roomEntry(), room: "301" }).success, false);
});
test("room checks and family date validation reject incomplete or inconsistent records", () => {
  assert.equal(entrySchema.safeParse({ ...roomEntry(), carpet: "sale" }).success, false);
  assert.equal(entrySchema.safeParse({ ...roomEntry(), carpet: "sale", carpetNotes: "Boue près de la porte" }).success, true);
  const duplicate = roomEntry(); duplicate.checks[1] = duplicate.checks[0];
  assert.equal(entrySchema.safeParse(duplicate).success, false);
  const problem = roomEntry(); problem.checks[0].result = "probleme";
  assert.equal(entrySchema.safeParse(problem).success, false);
  assert.equal(entrySchema.safeParse({ ...problem, notes: "Robinet bloqué" }).success, true);
  assert.equal(entrySchema.safeParse({ ...familyEntry(), date: "2026-10-03", returnDate: "2026-10-02" }).success, false);
  assert.equal(entrySchema.safeParse({ ...familyEntry(), kind: "depart", returnDate: "2026-12-01" }).success, false);
  assert.equal(entrySchema.safeParse({ ...familyEntry(), family: " " }).success, false);
});
test("local entries persist, retries are idempotent, changed retries conflict and photos remain accessible", async () => {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-entries-"));
  const entry = roomEntry(); entry.photosData = ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="];
  const first = await executeEntry(entry);
  assert.deepEqual(await executeEntry(entry), first);
  await assert.rejects(executeEntry({ ...entry, notes: "different" }), { code: 409 });
  assert.equal((await readState()).roomInspections?.length, 1);
  assert.equal((await readPhoto(entry.id, 1, "roomInspections")).toString(), "b");
  await assert.rejects(readPhoto(entry.id, 0), { code: 404 });
  const family = familyEntry();
  await executeEntry(family); await executeEntry(family);
  assert.equal((await readState()).familyEvents?.length, 1);
  await assert.rejects(executeEntry({ ...roomEntry(), date: "2099-01-01" }), { code: 400 });
});

test("Apps Script setup preserves old sheets; new tabs, photos and idempotent receipts work", () => {
  type Cell = string | number;
  const tables = new Map<string, Cell[][]>();
  const files = new Map<string, Buffer>();
  const properties = new Map([["API_TOKEN", "test-token"], ["PHOTO_FOLDER_ID", "folder"]]);
  function sheet(name: string) {
    const rows = tables.get(name)!;
    return {
      getMaxColumns: () => 26, insertColumnsAfter() {}, setFrozenRows() {}, hideColumns() {},
      getLastRow: () => rows.length,
      getRange: (r: number, c: number, h: number, w: number) => {
        const range = {
          getValues: () => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => rows[r - 1 + y]?.[c - 1 + x] ?? "")),
          setValues: (values: Cell[][]) => { values.forEach((row, y) => row.forEach((v, x) => { (rows[r - 1 + y] ||= [])[c - 1 + x] = v; })); return range; },
          setFontWeight: () => range, setBackground: () => range, setFontColor: () => range, setNumberFormat: () => range,
        };
        return range;
      },
    };
  }
  const book = { getSheetByName: (name: string) => tables.has(name) ? sheet(name) : null, insertSheet: (name: string) => { tables.set(name, []); return sheet(name); } };
  function file(name: string) { return { getId: () => name, getBlob: () => ({ getBytes: () => files.get(name) }) }; }
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }) },
    SpreadsheetApp: { openById: () => book, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name: string) => properties.get(name), setProperty: (name: string, value: string) => properties.set(name, value) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: createId, base64Encode: (v: Buffer) => v.toString("base64"), base64Decode: (v: string) => Buffer.from(v, "base64"), newBlob: (bytes: Buffer, _mime: string, name: string) => ({ bytes, name }) },
    DriveApp: { getFileById: file, getFolderById: () => ({ getFilesByName: (name: string) => ({ hasNext: () => files.has(name), next: () => file(name) }), createFile: ({ bytes, name }: { bytes: Buffer; name: string }) => { files.set(name, bytes); return file(name); } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.setup();
  assert.equal(tables.get("Chambres")?.length, 90);
  const call = (input: object) => context.doPost({ postData: { contents: JSON.stringify({ ...input, token: "test-token" }) } });
  const legacy = { id: createId(), version: 1, title: "Old issue" };
  assert.equal(call({ action: "commit", collection: "issues", expectedVersion: 0, record: legacy }).ok, true);
  const old = JSON.stringify(tables.get("Anomalies"));
  context.setup(); assert.equal(JSON.stringify(tables.get("Anomalies")), old);
  const entry = roomEntry();
  const input = { action: "commitEntry", collection: "roomInspections", expectedVersion: 0, record: { ...entry, photosData: undefined, version: 1, submissionHash: "a".repeat(64) }, photosData: ["data:image/jpeg;base64,YQ=="] };
  const result = call(input);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(call(input), result);
  assert.equal(files.size, 1);
  assert.equal(call({ ...input, record: { ...input.record, submissionHash: "b".repeat(64) } }).code, 409);
  assert.equal(call({ action: "photo", collection: "roomInspections", issueId: entry.id, index: 0 }).data.base64, "YQ==");
  const fam = familyEntry(); fam.notes = "=IMPORTXML(test)";
  assert.equal(call({ action: "commitEntry", collection: "familyEvents", expectedVersion: 0, record: { ...fam, version: 1, submissionHash: "c".repeat(64) } }).ok, true);
  assert.equal(tables.get("Absences et départs")?.[1][7], "'=IMPORTXML(test)");
  const state = call({ action: "list" }).data;
  assert.equal(state.issues.length, 1); assert.equal(state.roomInspections.length, 1); assert.equal(state.familyEvents.length, 1);
  assert.equal(state.familyEvents[0].notes, fam.notes);
});

test("Google entry save uses one request and requires a matching receipt", async () => {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const original = globalThis.fetch; const actions: string[] = [];
  globalThis.fetch = async (_url, options) => { const input = JSON.parse(options!.body as string); actions.push(input.action); return Response.json({ ok: true, data: { collection: input.collection, record: input.record } }); };
  try {
    await executeEntry(familyEntry()); assert.deepEqual(actions, ["commitEntry"]);
    globalThis.fetch = async () => Response.json({ ok: true, data: {} });
    await assert.rejects(executeEntry(familyEntry()), { code: 503 });
  } finally { globalThis.fetch = original; }
});

test("a stale refresh cannot remove an acknowledged entry, and storage modes stay separate", () => {
  const record = { ...familyEntry(), version: 1, submissionHash: "hash", updatedAt: "now" };
  const current = { mode: "sheets", issues: [], inspections: [], familyEvents: [record] };
  const stale = { mode: "sheets", issues: [], inspections: [], familyEvents: [] };
  assert.equal(mergeHotel(current, stale).familyEvents.length, 1);
  assert.equal(mergeHotel(current, current).familyEvents.length, 1);
  assert.equal(mergeHotel(current, { ...stale, mode: "local" }).familyEvents.length, 0);
});
