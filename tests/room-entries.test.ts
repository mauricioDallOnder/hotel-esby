import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { mergeHotel } from "../lib/mergeHotel";
import { entrySchema, roomChecks, roomGroups, rooms, parseEntry, roomEntrySchema, roomIssue, normalizeRoomDraft, countRoomsOnDate, cleaningText, type RoomEntry, type FamilyEntry } from "../lib/rooms";
import { createId, today } from "../lib/domain";
import { deleteAbsence, executeEntry, readPhoto, readState } from "../lib/storage";

const roomEntry = (): RoomEntry => ({ type: "createRoomInspection", id: createId(), room: "114", date: today(), actor: "Marie", condition: "bon", occupied: true, cleaning: "faite", carpet: "ok", carpetNotes: "", microwave: "oui", microwaveCleaning: "propre", fridgeCleaning: "propre", notes: "", photosData: [], checks: roomChecks.map(c => ({ key: c.key, result: "ok" })) });
const familyEntry = (): FamilyEntry => ({ type: "createFamilyEvent", id: createId(), room: "332", date: today(), actor: "Marie", family: "Famille test", notes: "", kind: "absence", returnDate: "" });

test("exactly the 85 requested rooms", () => {
  assert.equal(rooms.length, 85); assert.equal(new Set(rooms).size, 85);
  assert.deepEqual(roomGroups.map(g => g.rooms.length), [23, 32, 30]);
  const expected = "101 102 103 104 105 106 107 108 109 110 114 115 116 117 118 119 120 121 122 123 124 125 126 201 202 203 204 205 206 207 208 209 210 211 212 214 215 216 217 218 219 220 221 222 223 224 225 226 227 228 229 230 231 232 233 302 303 304 305 306 307 308 309 310 311 312 314 315 316 317 318 319 320 321 322 323 324 325 326 327 328 329 330 331 332".split(" ");
  assert.deepEqual(rooms, expected);
  for (const room of ["111", "112", "113", "213", "301", "313"]) {
    assert.equal(rooms.includes(room), false);
    assert.equal(entrySchema.safeParse({ ...roomEntry(), room }).success, false);
    assert.equal(entrySchema.safeParse({ ...familyEntry(), room }).success, false);
  }
  assert.equal(entrySchema.safeParse({ ...roomEntry(), room: "233" }).success, true);
});
test("free rooms require cleaning, occupied rooms clear it, and all equipment must be checked", () => {
  for (const occupied of [null, undefined]) assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), occupied }).success, false);
  for (const cleaning of [null, undefined, "faite", "non_faite"]) assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), cleaning }).success, true);
  for (const cleaning of [null, undefined]) assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), occupied: false, cleaning }).success, false);
  for (const cleaning of ["faite", "non_faite"]) assert.equal(roomEntrySchema.parse({ ...roomEntry(), occupied: false, cleaning }).cleaning, cleaning);
  assert.equal(roomEntrySchema.parse(roomEntry()).cleaning, null);
  for (const field of ["microwaveCleaning", "fridgeCleaning"]) for (const value of [null, undefined, "non_verifie"]) assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), [field]: value }).success, false);
  for (const check of roomChecks) {
    const entry = roomEntry(); entry.checks.find(c => c.key === check.key)!.result = "non_verifie";
    assert.equal(roomEntrySchema.safeParse(entry).success, false, check.key);
    entry.checks.find(c => c.key === check.key)!.result = "absent";
    assert.equal(roomEntrySchema.safeParse(entry).success, true);
  }
  assert.equal(roomChecks.at(-1)?.key, "door_handle_clear");
  assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), checks: roomEntry().checks.slice(0, -1) }).success, false);
  assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), microwave: "non_verifie" }).success, false);
  for (const carpet of ["sale", "tachee"]) assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), carpet }).success, false);
  for (const condition of ["a_revoir", "mauvais"]) assert.equal(roomEntrySchema.safeParse({ ...roomEntry(), condition }).success, false);
  assert.equal(cleaningText({ occupied: true }), "Non applicable");
  assert.equal(cleaningText({ occupied: false, cleaning: "faite" }), "Faite");
  assert.equal(cleaningText({ cleaning: "faite" }), "Faite");
});
test("legacy drafts gain unanswered fields without changing existing values or photos", () => {
  const draft = { ...roomEntry(), occupied: undefined, photosData: ["data:image/jpeg;base64,YQ=="], checks: roomEntry().checks.slice(0, -1) };
  const normalized = normalizeRoomDraft(draft);
  assert.equal(normalized.occupied, null);
  assert.equal(normalized.checks.at(-1)?.result, "non_verifie");
  assert.deepEqual(normalized.checks.slice(0, -1), draft.checks);
  assert.deepEqual(normalized.photosData, draft.photosData);
  assert.equal(normalized.id, draft.id);
  assert.equal(draft.checks.length, 10);
});
test("daily counter deduplicates rooms including pending and resets at Paris midnight", () => {
  const history = [{ room: "114", date: "2026-09-29" }, { room: "115", date: "2026-09-30" }, { room: "115", date: "2026-09-30" }, { room: "116", date: "2026-09-30" }, { room: "112", date: "2026-09-30" }];
  assert.equal(countRoomsOnDate(history, today(new Date("2026-09-30T21:59:59Z"))), 2);
  assert.equal(countRoomsOnDate(history, today(new Date("2026-09-30T22:00:00Z"))), 0);
  assert.equal(history.length, 5);
});
test("v1 queue preserves the old hash, IDs and removed rooms across retries", async () => {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-legacy-"));
  // The precise original Zod output order is part of the v1 hash contract.
  const legacy = { type: "createRoomInspection" as const, id: createId(), room: "112", date: today(), actor: "Marie", notes: "", condition: "bon" as const, cleaning: "faite" as const, checks: roomEntry().checks.slice(0, -1), carpet: "ok" as const, carpetNotes: "", microwave: "non_verifie" as const, photosData: ["data:image/jpeg;base64,YQ=="] };
  assert.deepEqual(parseEntry(legacy, true), legacy);
  const first = await executeEntry(legacy, true);
  assert.equal(first.record.submissionHash, createHash("sha256").update(JSON.stringify(legacy)).digest("hex"));
  assert.deepEqual(await executeEntry(legacy, true), first);
  assert.equal("occupied" in first.record, false);
  assert.equal((await readState()).roomInspections?.[0].room, "112");
  assert.throws(() => parseEntry(legacy));
  assert.throws(() => parseEntry({ ...legacy, occupied: true, schemaVersion: 2 }, true));
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
  assert.equal((await readPhoto(entry.id, 0)).toString(), "a");
  assert.equal((await readState()).issues.length, 1);
  assert.deepEqual((await readState()).issues[0].photoIds, (await readState()).roomInspections?.[0].photoIds);
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
      deleteRow: (n: number) => { rows.splice(n - 1, 1); },
      getRange: (r: number, c: number, h: number, w: number) => {
        const range = {
          getValues: () => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => rows[r - 1 + y]?.[c - 1 + x] ?? "")),
          setValues: (values: Cell[][]) => { values.forEach((row, y) => row.forEach((v, x) => { (rows[r - 1 + y] ||= [])[c - 1 + x] = v; })); return range; },
          clearContent: () => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[r - 1 + y]) rows[r - 1 + y][c - 1 + x] = ""; while (rows.length && rows.at(-1)!.every(v => v === "")) rows.pop(); return range; },
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
  assert.equal(tables.get("Chambres")?.length, 86);
  tables.get("Chambres")!.push(["112", "ancien"], ["313", "ancien"]);
  context.setup(); context.setup();
  assert.deepEqual(tables.get("Chambres")!.slice(1).map(r => r[0]), rooms);
  assert.equal(new Set(tables.get("Chambres")!.slice(1).map(r => r[0])).size, 85);
  // Simulate the exact previous room header, including an existing data row.
  const roomTable = tables.get("Contrôles chambres")!;
  roomTable[0].pop();
  roomTable.push(["old-history", "1", "old-date"]);
  context.setup(); context.setup();
  assert.equal(roomTable[0].at(-1), "Poignée dégagée");
  assert.deepEqual(roomTable[1], ["old-history", "1", "old-date"]);
  roomTable.pop();
  const call = (input: object) => context.doPost({ postData: { contents: JSON.stringify({ ...input, token: "test-token" }) } });
  const legacy = { id: createId(), version: 1, title: "Old issue" };
  assert.equal(call({ action: "commit", collection: "issues", expectedVersion: 0, record: legacy }).ok, true);
  const old = JSON.stringify(tables.get("Anomalies"));
  context.setup(); assert.equal(JSON.stringify(tables.get("Anomalies")), old);
  const entry = roomEntry();
  const record = { ...entry, photosData: undefined, version: 1, updatedAt: new Date().toISOString(), submissionHash: "a".repeat(64), photoIds: [], photoId: null };
  const input = { action: "commitEntry", collection: "roomInspections", expectedVersion: 0, record, issue: roomIssue(record, true), photosData: ["data:image/jpeg;base64,YQ=="] };
  const result = call(input);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(call(input), result);
  assert.equal(files.size, 1);
  assert.equal(call({ action: "photo", collection: "issues", issueId: entry.id, index: 0 }).data.base64, "YQ==");
  // A missing anomaly after an interrupted write is repaired by the same retry.
  tables.get("Anomalies")!.pop();
  assert.deepEqual(call(input), result);
  assert.equal(files.size, 1);
  assert.equal(call({ ...input, record: { ...input.record, submissionHash: "b".repeat(64) } }).code, 409);
  assert.equal(call({ action: "photo", collection: "roomInspections", issueId: entry.id, index: 0 }).data.base64, "YQ==");
  const fam = familyEntry(); fam.notes = "=IMPORTXML(test)";
  assert.equal(call({ action: "commitEntry", collection: "familyEvents", expectedVersion: 0, record: { ...fam, version: 1, submissionHash: "c".repeat(64) } }).ok, true);
  assert.equal(tables.get("Absences et départs")?.[1][7], "'=IMPORTXML(test)");
  const state = call({ action: "list" }).data;
  assert.equal(state.issues.length, 2); assert.equal(state.roomInspections.length, 1); assert.equal(state.familyEvents.length, 1);
  assert.equal(state.familyEvents[0].notes, fam.notes);
  assert.equal(state.roomInspections[0].occupied, true);
  assert.equal(state.roomInspections[0].checks.at(-1).key, "door_handle_clear");
  for (const collection of ["issues", "inspections", "roomInspections"]) assert.equal(call({ action: "deleteEntry", collection, id: fam.id }).ok, false);
  assert.equal(call({ action: "deleteEntry", collection: "familyEvents", id: "invalid" }).ok, false);
  assert.equal(call({ action: "deleteEntry", collection: "familyEvents", id: createId() }).code, 404);
  const departure = { ...familyEntry(), kind: "depart" };
  assert.equal(call({ action: "commitEntry", collection: "familyEvents", expectedVersion: 0, record: { ...departure, version: 1, submissionHash: "d".repeat(64) } }).ok, true);
  assert.equal(call({ action: "deleteEntry", collection: "familyEvents", id: departure.id }).ok, false);
  assert.equal(call({ action: "deleteEntry", collection: "familyEvents", id: fam.id }).data.deleted, true);
  assert.equal(call({ action: "deleteEntry", collection: "familyEvents", id: fam.id }).data.deleted, true);
  const after = call({ action: "list" }).data;
  assert.equal(after.familyEvents.length, 1);
  assert.equal(after.familyEvents[0].id, departure.id);
  assert.equal(after.deletedFamilyEventIds[0], fam.id);
  assert.equal(call({ action: "commitEntry", collection: "familyEvents", expectedVersion: 0, record: { ...fam, version: 1, submissionHash: "c".repeat(64) } }).code, 409);
  assert.equal(after.roomInspections.length, 1);
  assert.equal(JSON.stringify(tables.get("Anomalies")!.slice(0, 2)), old);
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

test("local absence deletion is selective, idempotent and prevents resurrection", async () => {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-delete-"));
  const absence = familyEntry(), departure = { ...familyEntry(), kind: "depart" as const }, other = familyEntry();
  await executeEntry(absence); await executeEntry(departure); await executeEntry(other); await executeEntry(roomEntry());
  for (const input of [{ collection: "issues", id: absence.id }, { collection: "familyEvents", id: "invalid" }, { collection: "familyEvents", id: departure.id }]) await assert.rejects(deleteAbsence(input));
  await assert.rejects(deleteAbsence({ collection: "familyEvents", id: createId() }), { code: 404 });
  const stale = { ...await readState(), mode: "local" };
  assert.deepEqual(await deleteAbsence({ collection: "familyEvents", id: absence.id }), { deleted: true, id: absence.id });
  await deleteAbsence({ collection: "familyEvents", id: absence.id });
  const after = { ...await readState(), mode: "local" };
  assert.deepEqual(after.familyEvents?.map(r => r.id), [departure.id, other.id]);
  assert.equal(after.roomInspections?.length, 1);
  assert.equal(mergeHotel(after, stale).familyEvents?.some(r => r.id === absence.id), false);
  assert.equal(mergeHotel(stale, after).familyEvents?.some(r => r.id === absence.id), false);
  await assert.rejects(executeEntry(absence), { code: 409 });
});
test("Google deletion invalidates cached state and requires an explicit matching receipt", async () => {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/delete-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const original = globalThis.fetch, entry = familyEntry(); let deleted = false, lists = 0;
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options!.body as string);
    if (input.action === "list") { lists++; return Response.json({ ok: true, data: { issues: [], inspections: [], familyEvents: deleted ? [] : [entry] } }); }
    assert.equal(input.action, "deleteEntry"); deleted = true;
    return Response.json({ ok: true, data: { deleted: true, id: input.id } });
  };
  try {
    assert.equal((await readState()).familyEvents?.length, 1);
    await deleteAbsence({ collection: "familyEvents", id: entry.id });
    assert.equal((await readState()).familyEvents?.length, 0); assert.equal(lists, 2);
    globalThis.fetch = async () => Response.json({ ok: true, data: {} });
    await assert.rejects(deleteAbsence({ collection: "familyEvents", id: entry.id }), { code: 502 });
  } finally { globalThis.fetch = original; }
});
