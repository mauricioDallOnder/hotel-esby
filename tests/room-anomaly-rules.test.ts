import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createId, today, type Issue } from "../lib/domain";
import { parseEntry, roomChecks, roomFindings, roomIssue, roomProblems, type EntryChange, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { prepareRoomIssue } from "../lib/roomIssueMatching";
import { executeEntry, readPhoto, readState } from "../lib/storage";

const allowed = ["taps", "switches", "leaks", "lights", "smoke", "damage", "window", "radiator_clear", "room_clutter"];
const excluded = ["bed", "mattress", "fridge", "door_closer", "door_handle_clear"];
const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", schemaVersion: 6, id: createId(), room: "114", date: today(), actor: "Marie",
  notes: "", occupied: true, condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "",
  microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), ...patch,
});
const checks = (keys: string[], result: RoomEntry["checks"][number]["result"] = "probleme") =>
  roomChecks.map(check => ({ key: check.key, result: keys.includes(check.key) ? result : "ok" as const }));
function saved(input: RoomEntry, patch: Partial<RoomInspection> = {}): RoomInspection {
  const { photosData, ...fields } = input;
  const photoIds = photosData.map((_, index) => input.id + "-" + index);
  return { ...fields, version: 1, updatedAt: "2026-10-20T10:00:00Z", submissionHash: "a".repeat(64),
    photoIds, photoId: photoIds[0] || null, ...patch };
}
const observationsOnly = (): RoomEntry => entry({
  checks: checks(excluded), condition: "mauvais", occupied: false, cleaning: "non_faite",
  carpet: "sale", carpetNotes: "Tache près de la porte", microwave: "oui",
  microwaveCleaning: "sale", fridgeCleaning: "sale", notes: "À revoir à la prochaine visite.",
  photosData: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="],
});
const anomaly = (patch: Partial<Issue> = {}): Issue => ({
  id: createId(), version: 1, room: "114", location: "Chambre 114", date: today(),
  createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
  title: "Robinet cassé", description: "Mitigeur bloqué", category: "Plomberie", priority: "haute",
  status: "en_cours", assignee: "Technicien", reportedBy: "Marie", photoIds: [], photoId: null,
  roomFindings: [{ key: "taps", label: "Robinets fonctionnels : Problème" }], history: [], ...patch,
});
const plain = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));

// Execute the deployable script with in-memory storage and Drive only.
// Sheet serialization and header upgrades remain covered by room-entries.test.ts.
function googleFixture(inspections: RoomInspection[] = [], issues: Issue[] = []) {
  type Stored = RoomInspection | Issue;
  const collections = new Map<string, Stored[]>([
    ["roomInspections", structuredClone(inspections)], ["issues", structuredClone(issues)],
  ]);
  const files = new Map<string, Buffer>();
  const file = (name: string) => ({ getId: () => name, getBlob: () => ({ getBytes: () => files.get(name) }) });
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => key === "API_TOKEN" ? "test-token" : "folder" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: { base64Encode: (bytes: Buffer) => bytes.toString("base64"), base64Decode: (data: string) => Buffer.from(data, "base64"),
      newBlob: (bytes: Buffer, _mime: string, name: string) => ({ bytes, name }) },
    DriveApp: { getFileById: file, getFolderById: () => ({
      getFilesByName: (name: string) => ({ hasNext: () => files.has(name), next: () => file(name) }),
      createFile: ({ bytes, name }: { bytes: Buffer; name: string }) => { files.set(name, bytes); return file(name); },
    }) },
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
  const call = (input: object) => plain(context.doPost({ postData: { contents: JSON.stringify({ ...input, token: "test-token" }) } }));
  return { call, files, records: (collection: string) => structuredClone(collections.get(collection) || []) };
}

function restoreEnvironment(t: TestContext) {
  const keys = ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"];
  const previous = keys.map(key => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }));
}
function assertSavedWithoutAnomaly(receipt: EntryChange, input: RoomEntry) {
  assert.equal(receipt.collection, "roomInspections");
  if (receipt.collection !== "roomInspections") throw new Error("Expected a room receipt");
  assert.equal(receipt.issue, undefined);
  const parsed = parseEntry(input) as RoomEntry;
  const { photosData, ...fields } = parsed;
  for (const [key, value] of Object.entries(fields))
    assert.deepEqual((receipt.record as unknown as Record<string, unknown>)[key], value, key);
  assert.equal(receipt.record.photoIds.length, photosData.length);
  assert.equal(receipt.record.photoId, receipt.record.photoIds[0]);
  assert.equal(receipt.record.submissionHash, createHash("sha256").update(JSON.stringify(parsed)).digest("hex"));
  assert.equal(receipt.record.issueSyncVersion, 2);
  assert.equal(receipt.record.createdIssue, false);
  assert.deepEqual(receipt.record.newIssueFindingKeys, []);
  assert.deepEqual(receipt.record.relatedIssueIds, []);
}

test("only Problème on eligible repair checks or Caché on the radiator triggers an automatic anomaly", () => {
  for (const key of allowed) for (const result of ["ok", "non_verifie", "absent", "probleme"] as const) {
    const record = saved(entry({ checks: checks([key], result) }));
    const expected = result === "probleme" ? [key] : [];
    assert.deepEqual(roomFindings(record).map(finding => finding.key), expected, key + " / " + result);
    assert.deepEqual(roomIssue(record)?.roomFindings?.map(finding => finding.key) || [], expected);
    assert.equal(!!roomIssue(record), expected.length > 0);
  }
  for (const bugs of [undefined, "non", "non_verifie", "oui"] as const) {
    const record = saved(entry({ bugs }));
    assert.deepEqual(roomFindings(record), []);
    assert.equal(roomIssue(record), undefined);
    assert.equal(roomProblems(record).includes("Cafards / nuisibles détectés"), bugs === "oui");
  }
});

test("a hidden radiator produces a clear technical problem and keeps the inspector and photos", () => {
  const record = saved(entry({ checks: checks(["radiator_clear"]), notes: "Un meuble devant le radiateur.", photosData: ["data:image/jpeg;base64,YQ=="] }));
  const issue = roomIssue(record)!;
  assert.deepEqual(issue.roomFindings, [{ key: "radiator_clear", label: "Chauffage / radiateur : Caché" }]);
  assert.equal(issue.description, "Chauffage / radiateur : Caché\nUn meuble devant le radiateur.");
  assert.equal(issue.assignee, record.actor);
  assert.equal(issue.reportedBy, record.actor);
  assert.deepEqual(issue.photoIds, record.photoIds);
  assert.deepEqual(roomProblems(record), ["Chauffage / radiateur : Caché"]);
  const clear = saved(entry());
  assert.equal(roomIssue(clear), undefined);
  assert.deepEqual(roomProblems(clear), []);
});

test("excluded equipment, condition, cleaning, observations and photos never trigger by themselves", () => {
  const patches: Partial<RoomEntry>[] = [
    ...excluded.flatMap(key => (["probleme", "absent"] as const).map(result => ({ checks: checks([key], result) }))),
    { condition: "mauvais" }, { condition: "a_revoir" }, { occupied: false, cleaning: "non_faite" },
    { carpet: "sale", carpetNotes: "Tache" }, { carpet: "tachee", carpetNotes: "Tache" },
    { microwave: "oui", microwaveCleaning: "sale" }, { fridgeCleaning: "sale" },
    { notes: "Observation sans défaut sélectionné" }, { photosData: ["data:image/jpeg;base64,YQ=="] },
    observationsOnly(),
  ];
  for (const patch of patches) {
    const record = saved(entry(patch));
    assert.deepEqual(roomFindings(record), []);
    assert.equal(roomIssue(record), undefined);
  }
});

test("mixed controls keep only eligible findings in the anomaly and retain all other observations in history", () => {
  const record = saved({ ...observationsOnly(), checks: checks([...excluded, "taps", "lights", "damage"]), bugs: "oui" });
  const original = structuredClone(record);
  const issue = roomIssue(record)!;
  assert.deepEqual(issue.roomFindings?.map(finding => finding.key), ["taps", "lights", "damage"]);
  assert.match(issue.description, /Robinets fonctionnels : Problème/);
  assert.doesNotMatch(issue.description, /Cafards \/ nuisibles détectés/);
  assert.ok(issue.description.includes(record.notes));
  assert.doesNotMatch(issue.description, /Lit en bon état|Matelas|Minibar|Ferme-porte|Poignée|Mauvais état|Moquette|Ménage|Micro-ondes/);
  assert.deepEqual(issue.photoIds, record.photoIds);
  const history = roomProblems(record).join("\n");
  for (const text of ["Cafards / nuisibles détectés", "Mauvais état", "Lit en bon état", "Matelas en bon état", "Minibar", "Ferme-porte", "Poignée", "Moquette", "Ménage non fait", "Micro-ondes sale"])
    assert.ok(history.includes(text), text);
  assert.deepEqual(record, original);
});

test("local storage preserves full controls and photos without an anomaly, including retries", async t => {
  restoreEnvironment(t);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-room-rules-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  const input = observationsOnly();
  const receipt = await executeEntry(input);
  assertSavedWithoutAnomaly(receipt, input);
  assert.deepEqual(await executeEntry(input), receipt);
  const state = await readState();
  assert.equal(state.issues.length, 0);
  assert.deepEqual(state.roomInspections, [receipt.record]);
  assert.equal((await readPhoto(input.id, 0, "roomInspections")).toString(), "a");
  assert.equal((await readPhoto(input.id, 1, "roomInspections")).toString(), "b");
  await assert.rejects(readPhoto(input.id, 0, "issues"), { code: 404 });
});

test("Google storage preserves full controls and photos without an anomaly or duplicate uploads on retry", async t => {
  restoreEnvironment(t);
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/room-rules-test/exec";
  process.env.GOOGLE_API_TOKEN = "test-token";
  const google = googleFixture(), actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)); actions.push(input.action);
    return Response.json(google.call(input));
  });
  const input = observationsOnly();
  const receipt = await executeEntry(input);
  assert.deepEqual(actions, ["commitRoomInspectionV4"]);
  assertSavedWithoutAnomaly(receipt, input);
  assert.deepEqual(await executeEntry(input), receipt);
  assert.equal(google.files.size, 2);
  assert.deepEqual(google.records("issues"), []);
  assert.deepEqual(google.records("roomInspections"), [receipt.record]);
  assert.equal((await readPhoto(input.id, 0, "roomInspections")).toString(), "a");
  assert.equal((await readPhoto(input.id, 1, "roomInspections")).toString(), "b");
  await assert.rejects(readPhoto(input.id, 0, "issues"), { code: 404 });
});

function assertReplay(record: RoomInspection, candidate: Issue | undefined, issues: Issue[], expected: Issue | undefined) {
  const original = structuredClone(record), originalIssues = structuredClone(issues);
  assert.deepEqual(prepareRoomIssue(candidate, record, issues), expected);
  assert.deepEqual(record, original);
  assert.deepEqual(issues, originalIssues);
  const google = googleFixture([original], originalIssues);
  const input = { action: "commitRoomInspectionV2", collection: "roomInspections", expectedVersion: 0, record, issue: candidate };
  const receipt = google.call(input);
  assert.equal(receipt.ok, true, receipt.error);
  assert.deepEqual(receipt.data.record, original);
  assert.deepEqual(receipt.data.issue, expected);
  assert.deepEqual(google.call(input), receipt);
  assert.deepEqual(google.records("roomInspections"), [original]);
  assert.deepEqual(google.records("issues"), expected && !originalIssues.some(issue => issue.id === expected.id) ? [...originalIssues, expected] : originalIssues);
}

const legacyEntry = (patch: Partial<RoomEntry> = {}): RoomEntry => {
  const input = entry(patch);
  return { ...input, schemaVersion: 5, checks: input.checks.filter(check => check.key !== "room_clutter") };
};

test("legacy replays preserve an existing resolved anomaly and a saved no-creation decision", () => {
  const previous = saved(legacyEntry({ checks: checks(["bed"]) }), {
    issueSyncVersion: 2, createdIssue: true, newIssueFindingKeys: ["bed"], relatedIssueIds: [],
  });
  const existing = anomaly({ id: previous.id, version: 3, status: "resolu", title: "Lit réparé",
    description: "Signalement ancien conservé", roomFindings: [{ key: "bed", label: "Lit en bon état : Problème" }] });
  assert.equal(roomIssue(previous), undefined);
  assertReplay(previous, undefined, [existing], existing);
  const known = anomaly({ status: "resolu" });
  const linked = saved(legacyEntry({ checks: checks(["taps"]) }), {
    issueSyncVersion: 2, createdIssue: false, newIssueFindingKeys: [], relatedIssueIds: [known.id],
  });
  assertReplay(linked, roomIssue(linked), [known], undefined);
});

test("partial legacy writes never replace excluded findings and repair only the saved eligible findings", () => {
  const known = anomaly({ status: "resolu" });
  const excludedRepair = saved(legacyEntry({ checks: checks(["taps", "bed"]) }), {
    issueSyncVersion: 2, createdIssue: true, newIssueFindingKeys: ["bed"], relatedIssueIds: [known.id],
  });
  assertReplay(excludedRepair, roomIssue(excludedRepair), [known], undefined);
  const oldPhotoOnly = saved(legacyEntry({ photosData: ["data:image/jpeg;base64,YQ=="] }), {
    issueSyncVersion: 2, createdIssue: true, newIssueFindingKeys: [], relatedIssueIds: [],
  });
  assertReplay(oldPhotoOnly, roomIssue(oldPhotoOnly), [], undefined);
  const permittedRepair = saved(legacyEntry({ checks: checks(["taps", "lights", "bed"]), notes: "Note de visite." }), {
    issueSyncVersion: 2, createdIssue: true, newIssueFindingKeys: ["lights", "bed"], relatedIssueIds: [known.id],
  });
  const candidate = roomIssue(permittedRepair)!;
  const expected = { ...candidate, roomFindings: candidate.roomFindings!.filter(finding => finding.key === "lights"),
    description: "Éclairage fonctionnel : Problème\nNote de visite." };
  assertReplay(permittedRepair, candidate, [known], expected);
});
