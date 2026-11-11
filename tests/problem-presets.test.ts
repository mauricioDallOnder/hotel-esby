import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { applyCommand, commandSchema, createId, today, type Issue } from "../lib/domain";
import { getProblemPreset, problemPresetsForCheck } from "../lib/problemPresets";
import { findDuplicateOpenIssue, isCafardTechnicalReport, matchesRoomFinding, planRoomIssue, prepareRoomIssue, validateRoomIssuePlan } from "../lib/roomIssueMatching";
import { parseEntry, roomChecks, roomEntrySchema, roomFindings, roomIssue, roomProblems, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { executeEntry, readState } from "../lib/storage";

function entry(patch: Partial<RoomEntry> = {}): RoomEntry {
  return { type: "createRoomInspection", id: createId(), room: "325", date: today(), actor: "Agent test", notes: "",
    condition: "bon", cleaning: null, checks: roomChecks.map(check => ({ key: check.key, result: check.key === "damage" ? "probleme" : "ok" })),
    carpet: "ok", carpetNotes: "", microwave: "non", photosData: [], bugs: "non", occupied: true, schemaVersion: 5,
    microwaveCleaning: null, fridgeCleaning: "propre", ...patch };
}
function saved(input: RoomEntry): RoomInspection {
  return { ...input, version: 1, updatedAt: "2026-11-01T12:00:00.000Z", submissionHash: "a".repeat(64), photoId: null, photoIds: [] };
}
function issue(patch: Partial<Issue> = {}): Issue {
  return { id: createId(), version: 1, date: today(), location: "Chambre 325", title: "Prise casse", description: "Prise cassée près du lit.",
    category: "Électricité", priority: "normale", status: "ouvert", reportedBy: "Agent test", assignee: "Agent test",
    createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", photoId: null, photoIds: [], history: [], ...patch };
}
const socket = () => entry({ problemDetails: [{ key: "damage", problemType: "electrical_socket" }] });

test("the common problem selector preserves checklist exclusions and optional legacy fields", () => {
  assert.equal(getProblemPreset("cafards"), undefined);
  assert.equal(problemPresetsForCheck("fridge").length, 0);
  assert.ok(problemPresetsForCheck("damage").some(preset => preset.id === "electrical_socket"));
  assert.equal(problemPresetsForCheck("damage").some(preset => preset.id === "fridge_fault"), false);
  assert.equal(roomEntrySchema.safeParse(socket()).success, true, "a named preset needs no repeated general note");
  assert.equal(roomEntrySchema.safeParse(entry({ problemDetails: [{ key: "damage", problemType: "other" }] })).success, false);
  assert.equal(roomEntrySchema.safeParse(entry({ problemDetails: [{ key: "damage", problemType: "other", description: "Tiroir cassé" }] })).success, true);
  assert.equal(roomEntrySchema.safeParse(entry({ problemDetails: [] })).success, false, "new generic damage needs identification");
  assert.equal(roomEntrySchema.safeParse(entry({ problemDetails: [], issueLinks: [{ key: "damage", issueId: createId() }] })).success, true);
  assert.equal(roomEntrySchema.safeParse(entry({ problemDetails: [{ key: "damage", problemType: "water_leak" }] })).success, false);
  assert.equal(roomEntrySchema.safeParse(entry({ problemDetails: [{ key: "damage", problemType: "electrical_socket" }, { key: "damage", problemType: "toilet_seat" }] })).success, false);
  const legacy = parseEntry(entry());
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal("problemDetails" in legacy, false);
  assert.equal(hash(parseEntry(legacy)), hash(legacy));
  assert.equal(commandSchema.safeParse({ type: "createIssue", id: createId(), date: today(), actor: "Agent test", fields: { ...issue(), problemType: "cafards" } }).success, false);
});

test("checklist details remain in history and issue labels even when a different-key issue is reused", () => {
  const record = saved(entry({ problemDetails: [{ key: "damage", problemType: "electrical_socket", description: "Près du lit" }] }));
  assert.ok(roomProblems(record).some(text => text.includes("Prise électrique") && text.includes("Près du lit")));
  assert.equal(roomFindings(record)[0].description, "Près du lit");
  const current = issue({ roomFindings: [{ key: "switches", label: "Ancienne classification" }] });
  record.issueLinks = [{ key: "damage", issueId: current.id }];
  const before = structuredClone(current);
  const plan = planRoomIssue(roomIssue(record), record, [current]);
  assert.equal(plan.issue, undefined);
  assert.deepEqual(plan.relatedIssueIds, [current.id]);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(current, before);
});

test("an outlet preset suggests a manual repair but cannot silently merge by type or ambiguous legacy damage", () => {
  const record = saved(socket()), current = issue();
  const broad = planRoomIssue(roomIssue(record), record, [current]);
  assert.deepEqual(broad.requiresChoice, ["damage"]);
  assert.equal(broad.issue, undefined);
  const oldDuplicate = issue({ room: "325", title: "Chambre 325 · Problème constaté", description: "Rien de cassé : Problème\nPrise cassée près du lit.", roomFindings: [{ key: "damage", label: "Rien de cassé : Problème" }] });
  assert.deepEqual(planRoomIssue(roomIssue(record), record, [current, oldDuplicate]).requiresChoice, ["damage"]);
  record.issueLinks = [{ key: "damage", issueId: current.id }];
  assert.deepEqual(planRoomIssue(roomIssue(record), record, [current, oldDuplicate]).relatedIssueIds, [current.id]);
  const precise = saved(entry({ problemDetails: [{ key: "damage", problemType: "electrical_socket", description: current.description }] }));
  assert.deepEqual(planRoomIssue(roomIssue(precise), precise, [current]).relatedIssueIds, [current.id]);
});

test("untyped damage uses a precise note and never links only by its generic equipment key", () => {
  const current = issue();
  const precise = saved(entry({ notes: current.description }));
  assert.deepEqual(planRoomIssue(roomIssue(precise), precise, [current]).relatedIssueIds, [current.id]);
  const unknown = saved(entry());
  assert.deepEqual(planRoomIssue(roomIssue(unknown), unknown, [current]).requiresChoice, ["damage"]);
  const different = saved(entry({ notes: "Abattant WC cassé" }));
  const old = issue({ title: "Problème constaté", description: "Prise cassée près du lit.", roomFindings: [{ key: "damage", label: "Rien de cassé : Problème" }] });
  assert.equal(planRoomIssue(roomIssue(different), different, [old]).relatedIssueIds.length, 0);
  assert.ok(planRoomIssue(roomIssue(different), different, [old]).issue);
});

test("two physical fittings and different heating faults stay independent despite a shared type or key", () => {
  const left = issue({ problemType: "electrical_socket", title: "Prise cassée", description: "Prise cassée près du lit à gauche." });
  const right = { ...left, id: createId(), description: "Prise cassée près du lit à droite." };
  assert.equal(findDuplicateOpenIssue(right, [left]), undefined);
  assert.equal(matchesRoomFinding(left, { key: "damage", label: getProblemPreset("electrical_socket")!.label, problemType: "electrical_socket", description: right.description }), false);
  const heaterFault = issue({ title: "Chaffauge ne marche pas", description: "Cheffauge ne marche plus" });
  assert.equal(matchesRoomFinding(heaterFault, { key: "damage", problemType: "heater_fault", label: getProblemPreset("heater_fault")!.label }), true);
  for (const type of ["heater_loose", "radiator_obstructed"]) {
    assert.equal(matchesRoomFinding(heaterFault, { key: "damage", problemType: type, label: getProblemPreset(type)!.label }), false);
  }
  const samples = [["toilet_seat", "Abbatant cassé"], ["toilet_flush", "Button du toilette ne marche pas"], ["fridge_fault", "Frigobar ne marche plus"]] as const;
  for (const [type, description] of samples) assert.equal(matchesRoomFinding(issue({ title: description, description }), { key: "damage", label: getProblemPreset(type)!.label, problemType: type }), true, description);
});

test("stale, resolved, cross-room and removed links are conflicts instead of silent replacement issues", () => {
  const current = issue(), record = saved(socket());
  record.issueLinks = [{ key: "damage", issueId: current.id }];
  for (const state of [[], [{ ...current, status: "resolu" as const }], [{ ...current, location: "Chambre 326" }]]) {
    const plan = planRoomIssue(roomIssue(record), record, state);
    assert.equal(plan.issue, undefined);
    assert.ok(plan.conflicts.length);
    assert.ok(validateRoomIssuePlan(roomIssue(record), record, state));
  }
  const noFinding = saved(entry({ checks: roomChecks.map(check => ({ key: check.key, result: "ok" })), issueLinks: record.issueLinks }));
  assert.ok(validateRoomIssuePlan(undefined, noFinding, [current]));
});

test("pure cafard reports use the follow-up, while negations and real technical repairs remain valid", () => {
  for (const description of ["Cafards présents", "Cafards près du robinet.", "Cafards près de la fenêtre.", "Pas de cafards derrière le minibar et des cafards près du lavabo."]) {
    const candidate = issue({ title: "Autre problème", description, problemType: "other" });
    assert.equal(isCafardTechnicalReport(candidate), true, description);
    assert.throws(() => applyCommand({ issues: [], inspections: [] }, { type: "createIssue", id: candidate.id, date: today(), actor: "Agent test", fields: candidate }), { code: 409 });
  }
  assert.equal(isCafardTechnicalReport(issue({ location: "Deuxième étage", title: "Cafards", description: "Cafards présents" })), true);
  for (const description of ["Pas de cafards.", "Aucun cafard détecté.", "Cafards non détectés.", "Vérifier si des cafards sont présents.", "Produit appliqué contre les cafards.", "Prise cassée. Pas de cafards.", "Robinet cassé. Cafards présents."]) {
    assert.equal(isCafardTechnicalReport(issue({ title: "Autre problème", description, problemType: "other" })), false, description);
  }
  const historical = issue({ title: "Ancien signalement", description: "Cafards présents", problemType: "other" });
  assert.doesNotThrow(() => applyCommand({ issues: [historical], inspections: [] }, { type: "updateIssue", id: historical.id, version: 1, actor: "Direction", fields: historical, status: "en_cours", note: "Suivi repris dans le menu dédié" }));
  assert.throws(() => applyCommand({ issues: [{ ...historical, status: "resolu" }], inspections: [] }, { type: "updateIssue", id: historical.id, version: 1, actor: "Direction", fields: historical, status: "ouvert", note: "Réouverture" }), { code: 409 });
});

test("local explicit reuse keeps the repair intact and retries its receipt after resolution without creating photos on conflict", async t => {
  const old = { driver: process.env.STORAGE_DRIVER, directory: process.env.LOCAL_DATA_DIR };
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-problem-links-"));
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = directory;
  t.after(() => { if (old.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = old.driver;
    if (old.directory === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = old.directory;
    rmSync(directory, { recursive: true, force: true }); });
  const current = issue();
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify({ issues: [current], inspections: [] }));
  const linked = socket(); linked.issueLinks = [{ key: "damage", issueId: current.id }];
  const first = await executeEntry(linked);
  const state = await readState();
  assert.deepEqual(state.issues, [current]);
  state.issues[0].status = "resolu";
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify(state));
  assert.deepEqual(await executeEntry(linked), first);
  await assert.rejects(executeEntry({ ...linked, id: createId(), photosData: ["data:image/jpeg;base64,YQ=="] }), { code: 409 });
  assert.equal(existsSync(path.join(directory, "photos")), false);
  assert.equal((await readState()).roomInspections?.length, 1);
});

test("Apps Script validates live links under lock before photos and preserves V2 receipts", () => {
  let locked = false, writes = 0, photoAccesses = 0;
  const current = issue(), inspections: RoomInspection[] = [], repairs: Issue[] = [current];
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, hasLock: () => locked, releaseLock() { locked = false; } }) },
    DriveApp: { getFolderById() { photoAccesses++; throw new Error("A conflict must not upload a photo"); } },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => { assert.equal(locked, true); return structuredClone(collection === "issues" ? repairs : inspections); };
  context.writeRecord_ = (collection: string, record: RoomInspection) => { assert.equal(locked, true); assert.equal(collection, "roomInspections"); writes++; inspections.push(structuredClone(record)); };
  const record = saved(entry({ issueLinks: [{ key: "damage", issueId: current.id }] }));
  const call = (input: RoomInspection, action = "commitRoomInspectionV3", photosData: string[] = []) => context.doPost({ postData: { contents: JSON.stringify({ token: "test-token", action, collection: "roomInspections", expectedVersion: 0, record: input, issue: roomIssue(input), photosData }) } });
  assert.equal(call(record).ok, true);
  assert.equal(inspections[0].issueSyncVersion, 2);
  assert.deepEqual(inspections[0].relatedIssueIds, [current.id]);
  current.status = "resolu";
  assert.equal(call(record, "commitRoomInspectionV2").ok, true, "the saved receipt wins over later target changes");
  const conflict = call({ ...record, id: createId() }, "commitRoomInspectionV3", ["data:image/jpeg;base64,YQ=="]);
  assert.equal(conflict.code, 409);
  assert.equal(writes, 1);
  assert.equal(photoAccesses, 0);
  assert.equal(locked, false);
  const local = structuredClone(record), remote = structuredClone(record);
  local.issueSyncVersion = 2; local.createdIssue = false; local.relatedIssueIds = [current.id];
  Object.assign(remote, local);
  assert.equal(prepareRoomIssue(roomIssue(local), local, []), undefined);
  assert.equal(context.RoomIssueMatching.prepareRoomIssue(roomIssue(remote), remote, []), undefined);
});

test("a historical Google receipt without a matching decision is acknowledged without replanning or new repairs", () => {
  const old = saved(entry({ issueLinks: [{ key: "damage", issueId: createId() }] }));
  const historicalLinks = [createId()]; old.relatedIssueIds = historicalLinks;
  let updated: RoomInspection | undefined;
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-token" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  context.table_ = () => ({});
  context.records_ = (collection: string) => structuredClone(collection === "roomInspections" ? [old] : [issue(), issue()]);
  context.writeRecord_ = (collection: string, record: RoomInspection) => { assert.equal(collection, "roomInspections"); updated = structuredClone(record); };
  const receipt = context.doPost({ postData: { contents: JSON.stringify({ token: "test-token", action: "commitRoomInspectionV2", collection: "roomInspections", expectedVersion: 0, record: old, issue: roomIssue(old) }) } });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.data.issue, undefined);
  assert.equal(updated?.createdIssue, false);
  assert.equal(updated?.issueSyncVersion, 2);
  assert.deepEqual(updated?.relatedIssueIds, historicalLinks);
});
