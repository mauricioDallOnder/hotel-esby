import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { applyCommand, createId, today, type Command, type State } from "../lib/domain";
import { commandOperation, stampCommandReceipt } from "../lib/commandReceipt";
import { execute } from "../lib/storage";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "hotel-command-receipts-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_DATA_DIR = directory;
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; rmSync(directory, { recursive: true, force: true }); });
const fields = { title: "Prise près du bureau cassée", location: "Chambre 114", category: "Électricité" as const, priority: "normale" as const,
  description: "Prise près du bureau cassée", assignee: "" };
const create = (): Extract<Command, { type: "createIssue" }> => ({ type: "createIssue", id: createId(), date: today(), actor: "Test", fields });

function googleFixture() {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = `https://script.google.com/macros/s/test-${createId()}/exec`;
  process.env.GOOGLE_API_TOKEN = "test-token";
  const state: State = { issues: [], inspections: [], workEvents: [], roomInspections: [], familyEvents: [] };
  let failLock = false, lockHeld = false, writes = 0;
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() { if (failLock) throw new Error("Temporary lock timeout"); lockHeld = true; }, hasLock: () => lockHeld, releaseLock() { lockHeld = false; } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.records_ = (collection: keyof State) => structuredClone(state[collection] || []);
  context.deletedAbsences_ = () => [];
  context.table_ = () => ({});
  context.writeRecord_ = (collection: "issues" | "inspections", record: State["issues"][number]) => {
    assert.equal(lockHeld, true, "The write must stay inside the lock");
    writes++;
    Object.assign(state, { [collection]: [...state[collection].filter(item => item.id !== record.id), structuredClone(record)] });
  };
  const call = (input: Record<string, unknown>) => context.doPost({ postData: { contents: JSON.stringify({ ...input, token: "test-token" }) } });
  globalThis.fetch = async (_url, options) => Response.json(call(JSON.parse(options!.body as string)));
  return { state, call, get writes() { return writes; }, set failLock(value: boolean) { failLock = value; } };
}

test("manual issue retries return their receipt after later interventions without duplicating history", async () => {
  const command = create();
  await execute(command);
  const first: Command = { type: "updateIssue", id: command.id, commandId: createId(), version: 1, actor: "Direction", note: "Intervention commencée", status: "en_cours", fields };
  await execute(first);
  await execute({ ...first, commandId: createId(), version: 2, note: "Réparation terminée", status: "resolu" });
  for (const retry of [command, first]) {
    const state = await execute(retry);
    assert.equal(state.issues.length, 1);
    assert.equal(state.issues[0].version, 3);
    assert.equal(state.issues[0].status, "resolu");
    assert.equal(state.issues[0].history.length, 3);
  }
  await assert.rejects(execute({ ...first, note: "Different payload under the same operation" }), { code: 409 });
});

test("a confirmed Google commit does not depend on a second full read", async () => {
  const fixture = googleFixture(), transport = globalThis.fetch;
  const actions: string[] = [];
  globalThis.fetch = async (url, options) => {
    const input = JSON.parse(options!.body as string); actions.push(input.action);
    if (input.action === "list" && fixture.writes) throw new Error("The post-commit read is unavailable");
    return transport(url, options);
  };
  const result = await execute(create());
  assert.deepEqual(actions, ["list", "commitIssueV4"]);
  assert.equal(result.issues.length, 1);
  assert.equal(fixture.writes, 1);
  assert.equal(result.issues[0].history.length, 1);
});

test("a lost Google response is reconciled by an exact retry, including after a later edit", async () => {
  const fixture = googleFixture(), transport = globalThis.fetch;
  let loseResponse = true;
  globalThis.fetch = async (url, options) => {
    const input = JSON.parse(options!.body as string);
    const response = await transport(url, options);
    if (input.action === "commitIssueV4" && loseResponse) { loseResponse = false; throw new TypeError("Synthetic lost response"); }
    return response;
  };
  const command = create();
  await assert.rejects(execute(command), { code: 503 });
  assert.equal(fixture.state.issues.length, 1);
  await execute({ type: "updateIssue", id: command.id, commandId: createId(), version: 1, actor: "Direction", note: "Réparé depuis un autre poste", status: "resolu", fields });
  const retry = await execute(command);
  assert.equal(retry.issues[0].status, "resolu");
  assert.equal(retry.issues[0].history.length, 2);
  assert.equal(fixture.writes, 2);
});

test("Apps Script checks the command receipt inside the lock before version conflicts", () => {
  const fixture = googleFixture(), command = create();
  const change = applyCommand(fixture.state, command), operation = commandOperation(command)!;
  assert.ok(change.collection === "issues");
  stampCommandReceipt(change, operation);
  const input = { action: "commitIssueV4", ...change, operation };
  assert.equal(fixture.call(input).ok, true);
  assert.equal(fixture.call(input).ok, true);
  assert.equal(fixture.writes, 1);
  const different = { id: operation.id, hash: "b".repeat(64) };
  const record = { ...change.record, history: change.record.history.map(event => ({ ...event, commandHash: different.hash })) };
  assert.equal(fixture.call({ ...input, operation: different, record }).code, 409);
  assert.equal(fixture.writes, 1);
});

test("temporary Apps Script lock errors stay retryable while invalid requests remain 400", () => {
  const fixture = googleFixture(), command = create();
  const change = applyCommand(fixture.state, command), operation = commandOperation(command)!;
  stampCommandReceipt(change, operation);
  const input = { action: "commitIssueV4", ...change, operation };
  fixture.failLock = true;
  assert.equal(fixture.call(input).code, 503);
  assert.equal(fixture.writes, 0);
  fixture.failLock = false;
  assert.equal(fixture.call(input).ok, true);
  assert.equal(fixture.writes, 1);
  assert.equal(fixture.call({ action: "unknown" }).code, 400);
  assert.equal(fixture.call({ action: "commitIssueV4", collection: "issues", record: { id: "invalid" }, expectedVersion: 0 }).code, 400);
});
