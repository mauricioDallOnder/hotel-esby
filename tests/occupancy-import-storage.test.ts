import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { workEntrySchema, type WorkEvent } from "../lib/rooms";
import { validateWorkEntry, visibleWorkEvents } from "../lib/work";
import type { OccupancyImport } from "../lib/occupancyImport";
import { executeEntry, importOccupancy, readState } from "../lib/storage";
import { roomAvailabilityView } from "../lib/roomAvailabilityView";

test("import is atomic, retries keep manual edits and a later roster clears expired stay details", async () => {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-occupancy-"));
  const command: OccupancyImport = {
    id: randomUUID(), actor: "Réception", date: "2026-11-20", rows: [
      { room: "101", status: "occupied", guestName: "Famille Exemple", stayUntil: "2026-11-22", expectedPreviousEventId: null },
      { room: "102", status: "works", expectedPreviousEventId: null },
      { room: "103", status: "available", expectedPreviousEventId: null },
    ],
  };
  const first = await importOccupancy(command);
  const states = async () => roomAvailabilityView((await readState()).workEvents || [], new Map());
  const view = await states();
  assert.equal(view.get("101")?.source?.guestName, "Famille Exemple");
  assert.equal(view.get("101")?.source?.stayUntil, "2026-11-22");
  assert.equal(view.get("102")?.vacancyReason, "works");
  assert.equal(view.get("103")?.vacancyReason, "available");
  const manual = await executeEntry({
    type: "createWorkEvent", kind: "roomAvailability", id: randomUUID(), room: "102", targetId: "102",
    date: command.date, occurredAt: new Date().toISOString(), actor: "Réception", notes: "",
    expectedPreviousEventId: first.records[1].id, expectedRevision: 1, free: false,
    guestName: "Autre famille", stayUntil: "2026-11-25",
  });
  assert.deepEqual(await importOccupancy(command), first);
  assert.equal((await states()).get("102")?.source?.id, manual.record.id);
  const stale = { ...command, id: randomUUID(), rows: command.rows.map((row, i) => ({
    ...row, expectedPreviousEventId: first.records[i].id,
  })) };
  await assert.rejects(importOccupancy(stale), /Chambre 102/);
  assert.equal((await readState()).workEvents?.length, 4);
  await assert.rejects(importOccupancy({ ...command, actor: "Autre" }), /contenu différent/);
  await assert.rejects(importOccupancy({ ...command, rows: [command.rows[0], command.rows[0]] }), /plusieurs fois/);
  await importOccupancy({ ...command, id: randomUUID(), date: "2026-11-24", rows: [
    { room: "101", status: "available", expectedPreviousEventId: first.records[0].id },
  ] });
  assert.equal((await states()).get("101")?.source?.guestName, undefined);
  assert.equal((await states()).get("101")?.free, true);
  assert.equal((await states()).get("102")?.source?.guestName, "Autre famille");
  const history = (await readState()).workEvents!;
  assert.equal(history.length, 5);
  const visible = visibleWorkEvents(history);
  assert.equal(visible.length, 3);
  assert.ok(visible.some(event => event.id === manual.record.id));
  assert.equal(visibleWorkEvents(visible), visible);
});

test("manual stay fields accept an occupied room and reject invalid or misplaced details", () => {
  const record = workEntrySchema.parse({
    id: randomUUID(), type: "createWorkEvent", kind: "roomAvailability", targetId: "101", room: "101",
    date: "2026-11-20", actor: "Réception", notes: "", occurredAt: "2026-11-20T11:00:00Z",
    expectedRevision: 0, expectedPreviousEventId: null, free: false, guestName: " Exemple ", stayUntil: "2026-12-01",
  });
  assert.equal(record.guestName, "Exemple");
  assert.equal(validateWorkEntry(record, [], []), undefined);
  for (const fields of [{ guestName: " " }, { stayUntil: "2026-02-30" }, { free: true }, { kind: "dailyTask" }])
    assert.equal(workEntrySchema.safeParse({ ...record, ...fields }).success, false);
  assert.ok(validateWorkEntry({ ...record, free: true }, [], []));
});

test("Apps Script atomically appends a complete roster under the write lock and returns the first receipt on replay", async t => {
  const config = { STORAGE_DRIVER: "sheets", GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/occupancy-test/exec", GOOGLE_API_TOKEN: "occupancy-test" };
  const saved = Object.keys(config).map(key => [key, process.env[key]] as const);
  t.after(() => saved.forEach(([key, v]) => { if (v === undefined) delete process.env[key]; else process.env[key] = v; }));
  Object.assign(process.env, config);
  let locked = false, batchCalls = 0;
  const records: WorkEvent[] = [];
  type Batch = { requests: { appendCells: { sheetId: number; rows: { values: { userEnteredValue: { stringValue: string } }[] }[] } }[] };
  const sandbox = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => config.GOOGLE_API_TOKEN }) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (body: string) => ({ setMimeType: () => JSON.parse(body) }) },
    Sheets: { Spreadsheets: { batchUpdate(batch: Batch) {
      assert.ok(locked);
      assert.equal(batch.requests.length, 1);
      const { rows, sheetId } = batch.requests[0].appendCells;
      assert.equal(sheetId, 34);
      assert.equal(rows.length, 2);
      records.push(...rows.map(({ values }) => {
        const cells = values.map(cell => cell.userEnteredValue.stringValue);
        const record: WorkEvent = JSON.parse(cells.slice(10, 22).map(chunk => chunk.slice(1)).join(""));
        assert.deepEqual([cells[0], cells[3], cells[5]], [record.id, record.room, "roomAvailability"]);
        return record;
      }));
      batchCalls++;
      return { replies: [{}] };
    } } },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), sandbox);
  sandbox.table_ = (collection: string) => { assert.equal(collection, "workEvents"); return { getSheetId: () => 34 }; };
  sandbox.records_ = (collection: string) => { assert.ok(locked); assert.equal(collection, "workEvents"); return structuredClone(records); };
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, opts?: RequestInit) =>
    Response.json(sandbox.doPost({ postData: { contents: String(opts?.body) } })));
  const batch: OccupancyImport = { id: randomUUID(), actor: "Réception", date: "2026-11-20", rows: [
    { room: "101", status: "occupied", guestName: "Exemple", stayUntil: "2026-11-21", expectedPreviousEventId: null },
    { room: "102", status: "works", expectedPreviousEventId: null },
  ] };
  const first = await importOccupancy(batch);
  assert.equal(first.records[0].guestName, "Exemple");
  assert.equal(first.records[1].vacancyReason, "works");
  assert.deepEqual(await importOccupancy(batch), first);
  await assert.rejects(importOccupancy({ ...batch, id: randomUUID() }), { code: 409 });
  assert.equal(batchCalls, 1);
  assert.equal(locked, false);
});
