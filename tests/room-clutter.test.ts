import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createId, type Issue } from "../lib/domain";
import { normalizeRoomDraft, parseEntry, roomChecks, roomCheckResultLabel, roomEntrySchema, roomFindings, roomIssue, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { completeRoomInspection } from "../lib/roomRotation";
import { findDuplicateOpenIssue, matchesRoomFinding, planRoomIssue } from "../lib/roomIssueMatching";
import { executeEntry, readPhoto, readState } from "../lib/storage";

const entry = (result: "ok" | "probleme" = "probleme", patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", schemaVersion: 6, id: createId(), room: "114", date: "2026-11-12",
  actor: "Marie", notes: "", occupied: true, condition: "bon", cleaning: null,
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre",
  bugs: "non", photosData: [], checks: roomChecks.map(check => ({ key: check.key, result: check.key === "room_clutter" ? result : "ok" })),
  ...patch,
});
const saved = (input: RoomEntry): RoomInspection => {
  const { photosData, ...fields } = input;
  const photoIds = photosData.map((_, index) => `${input.id}-${index}`);
  return { ...fields, version: 1, updatedAt: "2026-11-12T10:30:00.000Z", submissionHash: "a".repeat(64), photoIds, photoId: photoIds[0] || null };
};
const manual = (description: string, patch: Partial<Issue> = {}): Issue => ({
  id: createId(), version: 1, room: "114", location: "Chambre 114", title: "Observation de chambre", description,
  category: "Autre", priority: "normale", status: "ouvert", assignee: "Marie", reportedBy: "Marie",
  date: "2026-11-12", createdAt: "2026-11-12T10:00:00Z", updatedAt: "2026-11-12T10:00:00Z",
  history: [], photoId: null, photoIds: [], ...patch,
});
const oldFixture = JSON.parse(readFileSync("tests/fixtures/room-v5-control.json", "utf8")) as { input: RoomEntry; submissionHash: string };

test("room clutter requires an explicit Non/Oui, with Oui creating a photo-linked finding even without optional details", () => {
  for (const result of ["ok", "probleme", "non_verifie", "absent"] as const) {
    const input = entry("ok"); input.checks.find(check => check.key === "room_clutter")!.result = result;
    assert.equal(roomEntrySchema.safeParse(input).success, result === "ok" || result === "probleme");
    assert.equal(completeRoomInspection(input), result === "ok" || result === "probleme");
  }
  assert.equal(roomCheckResultLabel("room_clutter", "ok"), "Non");
  assert.equal(roomCheckResultLabel("room_clutter", "probleme"), "Oui");
  assert.deepEqual(roomFindings(entry("ok")), []);
  assert.equal(roomIssue(saved(entry("ok"))), undefined);
  const record = saved(entry("probleme", { photosData: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg==", "data:image/jpeg;base64,Yw=="] }));
  const issue = roomIssue(record)!;
  assert.deepEqual(issue.roomFindings, [{ key: "room_clutter", problemType: "room_cluttered", label: "Chambre encombrée d’affaires" }]);
  assert.equal(issue.description, "Chambre encombrée d’affaires");
  assert.equal(issue.room, record.room);
  assert.equal(issue.reportedBy, record.actor);
  assert.deepEqual(issue.photoIds, record.photoIds);
});

test("the exact published V5 receipt hash is preserved and only editable drafts gain the unanswered clutter question", () => {
  // Captured from origin/main before schema 6, including original field order.
  const parsed = parseEntry(oldFixture.input) as RoomEntry;
  assert.deepEqual(parsed, oldFixture.input);
  assert.equal(createHash("sha256").update(JSON.stringify(parsed)).digest("hex"), oldFixture.submissionHash);
  assert.equal(completeRoomInspection(parsed), true);
  assert.equal(parsed.checks.some(check => check.key === "room_clutter"), false);
  const draft = normalizeRoomDraft(parsed);
  assert.equal(draft.schemaVersion, 6);
  assert.deepEqual(draft.checks, [...parsed.checks, { key: "room_clutter", result: "non_verifie" }]);
  assert.equal(roomEntrySchema.safeParse(draft).success, false);
  assert.deepEqual(draft.photosData, parsed.photosData);
  assert.deepEqual(parseEntry(parsed), oldFixture.input);
});

test("one room clutter follow-up is reused while radiator obstruction, negated clutter and resolved findings remain separate", () => {
  const record = saved(entry("probleme", { problemDetails: [{ key: "room_clutter", problemType: "room_cluttered" }] }));
  const candidate = roomIssue(record)!;
  for (const description of ["Chambre encombrée d’affaires", "Chambre 114 très encombrée de valises", "Bagages qui encombrent toute la chambre", "Chambre pleine de bagages"]) {
    const known = manual(description), plan = planRoomIssue(candidate, record, [known]);
    assert.equal(plan.issue, undefined, description);
    assert.deepEqual(plan.relatedIssueIds, [known.id], description);
    assert.deepEqual(plan.conflicts, [], description);
  }
  for (const description of ["Radiateur caché par les bagages", "Chambre 114 : radiateur encombré d’affaires", "Poignée de porte cachée", "Chambre non encombrée", "La chambre n’est plus encombrée", "Aucun encombrement de la chambre"]) {
    const plan = planRoomIssue(candidate, record, [manual(description)]);
    assert.deepEqual(plan.issue?.roomFindings, candidate.roomFindings, description);
    assert.deepEqual(plan.relatedIssueIds, [], description);
  }
  const known = { ...candidate, id: createId(), roomFindings: [{ ...candidate.roomFindings![0], description: "Valises près du lit" }] };
  const relocated = roomIssue(saved(entry("probleme", { problemDetails: [{ key: "room_clutter", problemType: "room_cluttered", description: "Bagages près de l’entrée" }] })))!;
  assert.deepEqual(planRoomIssue(relocated, record, [known]).relatedIssueIds, [known.id]);
  assert.equal(findDuplicateOpenIssue(relocated, [known])?.id, known.id);
  for (const resolved of [{ ...known, status: "resolu" as const }, { ...known, roomFindings: [{ ...known.roomFindings[0], status: "resolu" as const }] }]) {
    assert.deepEqual(planRoomIssue(candidate, record, [resolved]).relatedIssueIds, []);
    assert.ok(planRoomIssue(candidate, record, [resolved]).issue);
  }
  assert.ok(planRoomIssue(candidate, record, [{ ...known, room: "115", location: "Chambre 115" }]).issue);
  const ambiguous = planRoomIssue(candidate, record, [known, { ...known, id: createId() }]);
  assert.deepEqual(ambiguous.requiresChoice, ["room_clutter"]);
  assert.equal(ambiguous.issue, undefined);
});

test("a known clutter-only follow-up does not make Rien de cassé look like an unresolved equipment fault", () => {
  const issue = roomIssue(saved(entry()))!;
  const damage = { key: "damage", label: "Rien de cassé : Problème" };
  assert.equal(matchesRoomFinding(issue, damage), false);
  assert.equal(matchesRoomFinding(manual("Bagages", { problemType: "room_cluttered" }), damage), false);
  const mixed = { ...issue, roomFindings: [...issue.roomFindings!, { key: "taps", label: "Robinet cassé" }] };
  assert.equal(matchesRoomFinding(mixed, damage), true);
  assert.equal(matchesRoomFinding({ ...mixed, roomFindings: [issue.roomFindings![0], { ...mixed.roomFindings[1], status: "resolu" }] }, damage), false);
  assert.equal(matchesRoomFinding(manual("Chambre encombrée, chaise cassée"), damage), true, "An unclassified report can still describe damage");
});

function googleFixture() {
  type Stored = RoomInspection | Issue;
  const collections = new Map<string, Stored[]>([["roomInspections", []], ["issues", []]]);
  const files = new Map<string, Buffer>();
  const file = (name: string) => ({ getId: () => name, getBlob: () => ({ getBytes: () => files.get(name) }) });
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => key === "API_TOKEN" ? "test-token" : "folder" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: { base64Encode: (bytes: Buffer) => bytes.toString("base64"), base64Decode: (data: string) => Buffer.from(data, "base64"), newBlob: (bytes: Buffer, _mime: string, name: string) => ({ bytes, name }) },
    DriveApp: { getFileById: file, getFolderById: () => ({ getFilesByName: (name: string) => ({ hasNext: () => files.has(name), next: () => file(name) }),
      createFile: ({ bytes, name }: { bytes: Buffer; name: string }) => { files.set(name, bytes); return file(name); } }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.deletedAbsences_ = () => [];
  context.records_ = (collection: string) => structuredClone(collections.get(collection) || []);
  context.writeRecord_ = (collection: string, record: Stored) => {
    const records = collections.get(collection)!;
    const index = records.findIndex(item => item.id === record.id);
    if (index < 0) records.push(structuredClone(record)); else records[index] = structuredClone(record);
  };
  return { call: (input: object) => context.doPost({ postData: { contents: JSON.stringify(input) } }), files, collections };
}

for (const driver of ["local", "sheets"] as const) test(`${driver} clutter saves all photos, reuses the same problem and preserves original receipts`, async t => {
  const previous = ["STORAGE_DRIVER", "LOCAL_DATA_DIR", "GOOGLE_SCRIPT_URL", "GOOGLE_API_TOKEN"].map(key => [key, process.env[key]] as const);
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-clutter-"));
  t.after(() => {
    previous.forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    rmSync(directory, { recursive: true, force: true });
  });
  process.env.STORAGE_DRIVER = driver; process.env.LOCAL_DATA_DIR = directory;
  const google = googleFixture(), actions: string[] = [];
  if (driver === "sheets") {
    process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/room-clutter-test/exec";
    process.env.GOOGLE_API_TOKEN = "test-token";
    t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
      const input = JSON.parse(String(options?.body)); actions.push(input.action);
      return Response.json(google.call(input));
    });
  }
  const clear = await executeEntry(entry("ok"));
  assert.equal(clear.collection, "roomInspections");
  if (clear.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.equal(clear.record.createdIssue, false);
  const input = entry("probleme", { problemDetails: [{ key: "room_clutter", problemType: "room_cluttered" }],
    photosData: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg==", "data:image/jpeg;base64,Yw=="] });
  const first = await executeEntry(input);
  assert.equal(first.collection, "roomInspections");
  if (first.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.equal(first.record.createdIssue, true);
  assert.equal(first.issue?.photoIds?.length, 3);
  assert.deepEqual(first.record.photoIds, first.issue?.photoIds);
  assert.deepEqual(await executeEntry(input), first);
  const repeatedInput = entry("probleme", { photosData: input.photosData });
  const repeated = await executeEntry(repeatedInput);
  assert.equal(repeated.collection, "roomInspections");
  if (repeated.collection !== "roomInspections") throw new Error("Expected room inspection");
  assert.equal(repeated.record.createdIssue, false);
  assert.deepEqual(repeated.record.relatedIssueIds, [input.id]);
  assert.equal(repeated.record.photoIds.length, 3);
  assert.deepEqual(await executeEntry(repeatedInput), repeated);
  const state = await readState({ fresh: true });
  assert.equal(state.issues.length, 1);
  assert.deepEqual(state.issues[0], first.issue);
  assert.equal((await readPhoto(input.id, 2, "issues")).toString(), "c");
  assert.equal((await readPhoto(repeatedInput.id, 1, "roomInspections")).toString(), "b");
  const legacy = await executeEntry(oldFixture.input);
  assert.equal(legacy.record.submissionHash, oldFixture.submissionHash);
  assert.deepEqual(await executeEntry(oldFixture.input), legacy);
  if (driver === "sheets") {
    assert.equal(actions.filter(action => action === "commitRoomInspectionV4").length, 5);
    assert.equal(actions.filter(action => action === "commitRoomInspectionV3").length, 2);
    assert.equal(google.files.size, 7);
    const rejected = google.call({ token: "test-token", action: "commitRoomInspectionV3", collection: "roomInspections", record: saved(entry()) });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "Utilisez commitRoomInspectionV4.");
    assert.equal(google.collections.get("roomInspections")!.length, 4);
  }
});
