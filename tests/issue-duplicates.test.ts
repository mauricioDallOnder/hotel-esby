import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { applyCommand, createId, today, type Issue, type IssueFields } from "../lib/domain";
import { findDuplicateOpenIssue } from "../lib/roomIssueMatching";
import { execute, readState } from "../lib/storage";

const fields: IssueFields = {
  title: "Robinet du lavabo bloqué", description: "Impossible de fermer le mitigeur du lavabo.",
  location: "Chambre 114", category: "Plomberie", priority: "normale", assignee: "",
};

function issue(patch: Partial<Issue> = {}): Issue {
  return { ...fields, id: createId(), date: today(), version: 1, status: "ouvert", createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z", reportedBy: "Agent test", photoId: null, photoIds: [], history: [], ...patch };
}

test("same room reports match meaningful normalized text and fault paraphrases, not generic titles", () => {
  const current = issue();
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "ROBINET DU LAVABO BLOQUE !" }, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "Mitigeur coincé", description: "Le robinet du lavabo est bloqué." }, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "114" }, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "Chambre n°114" }, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "Ch. 114" }, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "chambre114" }, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "Chambre 115" }, [current]), undefined);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "Chambres 114 et 115" }, [current]), undefined);
  assert.equal(findDuplicateOpenIssue({ ...fields, location: "Chambre 1140" }, [current]), undefined);
  assert.equal(findDuplicateOpenIssue(fields, [{ ...current, status: "resolu" }]), undefined);
  assert.equal(findDuplicateOpenIssue(current, [current]), undefined);
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "À réparer", description: "Voir photo" }, [issue({ title: "À réparer", description: "Voir photo" })]), undefined);
});

test("different fittings and different faults remain independently reportable", () => {
  const current = issue();
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "Robinet de douche bloqué", description: "Impossible de fermer le robinet de douche." }, [current]), undefined);
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "Robinet du lavabo cassé", description: "Le bec du robinet du lavabo est cassé." }, [current]), undefined);
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "Éclairage en panne", description: "L’ampoule est grillée." }, [current]), undefined);
});

test("manual reports recognize the open structured checklist finding in the same room", () => {
  const current = issue({ title: "Chambre 114 · Problème constaté", description: "Robinets fonctionnels : Problème",
    room: "114", roomFindings: [{ key: "taps", label: "Robinets fonctionnels : Problème" }] });
  assert.equal(findDuplicateOpenIssue(fields, [current])?.id, current.id);
  assert.equal(findDuplicateOpenIssue({ ...fields, title: "Fenêtre bloquée", description: "La fenêtre ne ferme plus." }, [current]), undefined);
});

test("domain rejects duplicate creation and reopening but permits resolution and preserves older history", () => {
  const current = issue();
  const state = { issues: [current], inspections: [] };
  assert.throws(() => applyCommand(state, { type: "createIssue", id: createId(), date: today(), actor: "Agent test", fields }), { code: 409 });
  const old = issue({ status: "resolu", history: [] });
  assert.throws(() => applyCommand({ ...state, issues: [current, old] }, {
    type: "updateIssue", id: old.id, version: 1, actor: "Direction", note: "Réouvrir", status: "ouvert", fields,
  }), { code: 409 });
  const legacyDuplicate = issue(), original = structuredClone(legacyDuplicate);
  const change = applyCommand({ ...state, issues: [current, legacyDuplicate] }, {
    type: "updateIssue", id: legacyDuplicate.id, version: 1, actor: "Direction", note: "Intervention en cours", status: "en_cours", fields,
  });
  assert.equal(change.collection, "issues");
  assert.deepEqual(legacyDuplicate, original);
  assert.doesNotThrow(() => applyCommand(state, {
    type: "updateIssue", id: current.id, version: 1, actor: "Direction", note: "Réparé", status: "resolu", fields,
  }));
});

test("changing a technical report's room also updates its stored room identity", () => {
  const current = issue({ room: "114" });
  const change = applyCommand({ issues: [current], inspections: [] }, {
    type: "updateIssue", id: current.id, version: 1, actor: "Direction", note: "Correction de chambre", status: "en_cours",
    fields: { ...fields, location: "Chambre 115" },
  });
  assert.equal(change.collection, "issues");
  if (change.collection === "issues") assert.equal(change.record.room, "115");
});

test("concurrent local submissions cannot create two unresolved copies", async t => {
  const old = { driver: process.env.STORAGE_DRIVER, directory: process.env.LOCAL_DATA_DIR };
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-duplicate-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  t.after(() => {
    if (old.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = old.driver;
    if (old.directory === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = old.directory;
    rmSync(directory, { recursive: true, force: true });
  });
  const result = await Promise.allSettled([0, 1].map(() => execute({ type: "createIssue", id: createId(), date: today(), actor: "Agent test", fields })));
  assert.equal(result.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(result.filter(value => value.status === "rejected" && value.reason.code === 409).length, 1);
  assert.equal((await readState()).issues.length, 1);
});

test("Apps Script repeats the duplicate check under its write lock for stale snapshots and older clients", () => {
  let locked = false;
  const records: Issue[] = [];
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = () => { assert.equal(locked, true); return structuredClone(records); };
  context.writeRecord_ = (_collection: string, record: Issue) => { assert.equal(locked, true); records.push(structuredClone(record)); };
  const call = (record: Issue, action = "commitIssueV2") => context.doPost({ postData: { contents: JSON.stringify({
    token: "test-token", action, collection: "issues", expectedVersion: 0, record,
  }) } });
  assert.equal(call(issue()).ok, true);
  const conflict = call(issue());
  assert.equal(conflict.ok, false); assert.equal(conflict.code, 409); assert.match(conflict.error, /déjà ouvert/);
  assert.equal(call(issue(), "commit").code, 409);
  assert.equal(records.length, 1);
  assert.equal(locked, false);
});

test("an outdated Apps Script cannot accept a manual write without the new uniqueness guard", async t => {
  const before = { driver: process.env.STORAGE_DRIVER, url: process.env.GOOGLE_SCRIPT_URL, token: process.env.GOOGLE_API_TOKEN };
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/duplicate-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  t.after(() => {
    for (const [key, value] of [["STORAGE_DRIVER", before.driver], ["GOOGLE_SCRIPT_URL", before.url], ["GOOGLE_API_TOKEN", before.token]])
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  });
  const actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    return Response.json(input.action === "list" ? { ok: true, data: { issues: [], inspections: [] } } : { ok: false, error: "Action invalide.", code: 400 });
  });
  await assert.rejects(execute({ type: "createIssue", id: createId(), date: today(), actor: "Agent test", fields }), { code: 503 });
  assert.deepEqual(actions, ["list", "commitIssueV4"]);
});
