import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { execute } from "../lib/storage";
import { createId, today } from "../lib/domain";

test("Apps Script stores all photo links, serves each photo and preserves legacy records", () => {
  let saved: Record<string, unknown> | undefined;
  let savedLinks = "";
  const files = new Map<string, { getId: () => string; getBlob: () => { getBytes: () => Buffer } }>();
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name: string) => name === "API_TOKEN" ? "test-token" : "folder" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: {
      base64Decode: (value: string) => Buffer.from(value, "base64"),
      base64Encode: (value: Buffer) => value.toString("base64"),
      newBlob: (bytes: Buffer, _type: string, name: string) => ({ bytes, name }),
    },
    DriveApp: {
      getFolderById: () => ({
        getFilesByName: (name: string) => ({ hasNext: () => files.has(name), next: () => files.get(name) }),
        createFile: ({ bytes, name }: { bytes: Buffer; name: string }) => {
          const file = { getId: () => name, getBlob: () => ({ getBytes: () => bytes }) };
          files.set(name, file);
          return file;
        },
      }),
      getFileById: (id: string) => files.get(id),
    },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.records_ = () => saved ? [saved] : [];
  context.table_ = () => ({
    getLastRow: () => saved ? 2 : 1,
    getRange: () => ({
      getValues: () => [[saved?.id]],
      setNumberFormat: () => ({ setValues: ([row]: string[][]) => {
        saved = JSON.parse(row.slice(10).map((chunk) => chunk.slice(1)).join(""));
        savedLinks = row[8];
      } }),
    }),
  });
  const call = (input: Record<string, unknown>) => context.doPost({ postData: { contents: JSON.stringify({ ...input, token: "test-token" }) } });
  const id = createId();
  const photosData = ["first", "second", "third"].map((value) => `data:image/jpeg;base64,${Buffer.from(value).toString("base64")}`);
  const result = call({ action: "commit", collection: "issues", expectedVersion: 0, record: { id, version: 1 }, photosData });
  assert.equal(result.ok, true);
  assert.equal((saved?.photoIds as string[]).length, 3);
  assert.equal(savedLinks.split("\n").length, 3);
  assert.equal(files.size, 3);
  for (const [index, value] of ["first", "second", "third"].entries()) {
    const result = call({ action: "photo", issueId: id, index });
    assert.equal(Buffer.from(result.data.base64, "base64").toString(), value);
  }
  assert.equal(call({ action: "photo", issueId: id, index: 3 }).code, 404);
  assert.equal(call({ action: "list" }).data.maxIssuePhotos, 3);
  assert.equal(call({ action: "commit", collection: "issues", expectedVersion: 1, record: { ...saved, version: 2, status: "resolu" } }).ok, true);
  assert.equal((saved?.photoIds as string[]).length, 3);
  delete saved!.photoIds;
  assert.equal(Buffer.from(call({ action: "photo", issueId: id }).data.base64, "base64").toString(), "first");
  assert.equal(call({ action: "commit", collection: "issues", expectedVersion: 0, record: { id: createId(), version: 1 }, photosData: [...photosData, photosData[0]] }).ok, false);
});

test("an old Google deployment cannot silently discard multiple photos", async () => {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const originalFetch = globalThis.fetch;
  const actions: string[] = [];
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options!.body as string);
    actions.push(input.action);
    return Response.json({ ok: true, data: { issues: [], inspections: [] } });
  };
  try {
    await assert.rejects(execute({
      type: "createIssue", id: createId(), date: today(), actor: "Test",
      fields: { title: "Test", description: "Test", category: "Autre", priority: "normale", location: "204", assignee: "" },
      photosData: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="],
    }), { code: 503 });
    assert.deepEqual(actions, ["list"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
