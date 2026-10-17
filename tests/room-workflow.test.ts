import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createId, today, type Issue } from "../lib/domain";
import { normalizeRoomDraft, parseEntry, roomChecks, roomEntrySchema, roomIssue, roomProblems, rooms, type RoomEntry, type RoomInspection } from "../lib/rooms";
import { completeRoomInspection, roomRotation } from "../lib/roomRotation";
import { issueRoom, planRoomIssue, prepareRoomIssue } from "../lib/roomIssueMatching";
import { execute, executeEntry, readState } from "../lib/storage";

const entry = (patch: Partial<RoomEntry> = {}): RoomEntry => ({
  type: "createRoomInspection", id: createId(), schemaVersion: 4, room: "114", date: today(), actor: "Marie", notes: "", occupied: true, condition: "bon", cleaning: null,
  carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
  checks: roomChecks.map(c => ({ key: c.key, result: "ok" })), ...patch,
});
const problem = (keys: string[], patch: Partial<RoomEntry> = {}) => entry({ checks: roomChecks.map(c => ({ key: c.key, result: keys.includes(c.key) ? "probleme" : "ok" })), ...patch });
const saved = (input: RoomEntry): RoomInspection => ({ ...input, version: 1, updatedAt: "2026-10-17T12:00:00Z", submissionHash: "a".repeat(64), photoIds: [], photoId: null });
const manual = (patch: Partial<Issue> = {}): Issue => ({ id: createId(), version: 1, room: undefined, location: "Chambre 114", title: "Robinet cassé", description: "Mitigeur bloqué", category: "Plomberie", priority: "haute", status: "en_cours", assignee: "Technicien", date: today(), createdAt: "now", updatedAt: "now", reportedBy: "Direction", photoId: null, history: [], ...patch });

test("new checks require an explicit door closer answer, absence is a finding and old drafts gain no invented answer", () => {
  const input = entry();
  input.checks.find(c => c.key === "door_closer")!.result = "non_verifie";
  assert.equal(roomEntrySchema.safeParse(input).success, false);
  input.checks.find(c => c.key === "door_closer")!.result = "absent";
  assert.equal(roomEntrySchema.safeParse(input).success, true);
  assert.ok(roomProblems(input).some(p => /Ferme-porte.*Absent/.test(p)));
  const draft = normalizeRoomDraft({ ...input, schemaVersion: 3 as const, checks: input.checks.filter(c => c.key !== "door_closer") });
  assert.equal(draft.checks.find(c => c.key === "door_closer")?.result, "non_verifie");
  assert.equal(draft.id, input.id);
});

test("v3 replay keeps the exact original parsed payload and hash without requiring the new check", () => {
  const v3 = { type: "createRoomInspection", id: createId(), room: "114", date: today(), actor: "Marie", notes: "", condition: "bon", cleaning: null,
    checks: entry().checks.filter(c => c.key !== "door_closer"), carpet: "ok", carpetNotes: "", microwave: "non", photosData: [], bugs: "non", occupied: true, schemaVersion: 3, microwaveCleaning: null, fridgeCleaning: "propre" };
  const parsed = parseEntry(v3);
  assert.deepEqual(parsed, v3);
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(parsed), hash(v3));
  assert.equal(hash(parseEntry(parsed)), hash(v3));
});

test("rotation caps the daily workload, carries old rooms forward and never excludes defective rooms", () => {
  const history = rooms.map(room => entry({ room, date: "2026-10-01" }));
  history[0] = problem(["taps"], { room: "101", date: "2026-09-01" });
  const rotation = roomRotation(history, "2026-10-17", 10, 7);
  assert.equal(rotation.plan.length, 10); assert.equal(rotation.plan[0], "101");
  const tomorrow = roomRotation(history, "2026-10-18", 10, 7);
  assert.deepEqual(tomorrow.plan, rotation.plan);
  const done = entry({ room: "101", date: "2026-10-17" });
  const next = roomRotation([...history, done, { ...done, id: createId() }], "2026-10-17", 10, 7);
  assert.equal(next.done.length, 1); assert.equal(next.plan.length, 9); assert.equal(next.plan.includes("101"), false);
  assert.equal(roomRotation(history, "2026-10-17", 10, 7, ["101"]).plan.includes("101"), false);
  assert.equal(roomRotation(history, "2026-10-18", 10, 7).plan[0], "101");
});

test("partial and future inspections do not make a room covered; pending complete inspections count once", () => {
  const partial = entry({ room: "101", date: "2026-10-17" }); partial.checks[0].result = "non_verifie";
  assert.equal(completeRoomInspection(partial), false);
  const rotation = roomRotation([partial, entry({ room: "102", date: "2026-10-18" }), entry({ room: "103", date: "2026-10-17" })], "2026-10-17", 5, 7);
  assert.deepEqual(rotation.done, ["103"]); assert.equal(rotation.covered, 1); assert.equal(rotation.plan.length, 4);
  const boundary = roomRotation([entry({ room: "101", date: "2026-10-10" }), entry({ room: "102", date: "2026-10-11" })], "2026-10-17", 5, 7);
  assert.ok(boundary.due.includes("101")); assert.ok(!boundary.due.includes("102"));
});

test("deduplication uses the exact room and finding, supports manual links, and ignores resolved issues", () => {
  const record = saved(problem(["taps", "lights"])), issue = manual();
  const plan = planRoomIssue(roomIssue(record), record, [issue]);
  assert.deepEqual(plan.relatedIssueIds, [issue.id]);
  assert.deepEqual(plan.issue?.roomFindings?.map(f => f.key), ["lights"]);
  assert.doesNotMatch(plan.issue!.description, /Robinets/);
  for (const location of ["Chambre 1140", "Chambre 115", "Chambres 114 et 115"]) {
    assert.equal(planRoomIssue(roomIssue(record), record, [manual({ location })]).relatedIssueIds.length, 0);
  }
  assert.equal(issueRoom(manual({ location: "114" })), "114");
  assert.equal(planRoomIssue(roomIssue(record), record, [manual({ status: "resolu" })]).relatedIssueIds.length, 0);
  const unclear = manual({ title: "À réparer", description: "Voir photo" });
  const linked = { ...record, issueLinks: [{ key: "taps", issueId: unclear.id }] };
  assert.deepEqual(planRoomIssue(roomIssue(linked), linked, [unclear]).relatedIssueIds, [unclear.id]);
  assert.equal(planRoomIssue(roomIssue(linked), linked, [{ ...unclear, location: "115" }]).relatedIssueIds.length, 0);
});

test("local save deduplicates against Anomalies, keeps new findings, photos and the existing intervention untouched", async () => {
  process.env.STORAGE_DRIVER = "local"; process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "hotel-dedup-"));
  const known = manual();
  await execute({ type: "createIssue", id: known.id, date: known.date, actor: known.reportedBy, fields: known });
  const original = (await readState()).issues[0];
  const repeated = problem(["taps"], { photosData: ["data:image/jpeg;base64,YQ=="] });
  const first = await executeEntry(repeated);
  assert.equal(first.collection, "roomInspections");
  if (first.collection !== "roomInspections") return;
  assert.equal(first.issue, undefined); assert.deepEqual(first.record.relatedIssueIds, [known.id]);
  assert.equal(first.record.photoIds.length, 1); assert.equal(first.record.issueSyncVersion, 2);
  assert.deepEqual(await executeEntry(repeated), first);
  await Promise.all([executeEntry(problem(["taps", "lights"])), executeEntry(problem(["taps", "lights"]))]);
  const state = await readState(); assert.equal(state.issues.length, 2); assert.equal(state.roomInspections?.length, 3);
  assert.deepEqual(state.issues.find(i => i.id === known.id), original);
  const newIssue = state.issues.find(i => i.id !== known.id)!;
  assert.deepEqual(newIssue.roomFindings?.map(f => f.key), ["lights"]);
  await execute({ type: "updateIssue", id: known.id, version: original.version, actor: "Direction", note: "Réparé", status: "resolu", fields: original });
  await executeEntry(repeated); // A retry must not reopen or duplicate the now-resolved anomaly.
  assert.equal((await readState()).issues.length, 2);
  await executeEntry(problem(["taps"])); // A later inspection can report a recurrence.
  assert.equal((await readState()).issues.length, 3);
});

test("the deployable Google matcher makes the same decision and repairs a partial write without changing the saved links", () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync("google-apps-script/Code.gs", "utf8"), context);
  const record = saved(problem(["taps", "lights"])), known = manual();
  const candidate = roomIssue(record)!;
  const localRecord = structuredClone(record), remoteRecord = structuredClone(record);
  const local = prepareRoomIssue(candidate, localRecord, [known]);
  const remote = context.RoomIssueMatching.prepareRoomIssue(candidate, remoteRecord, [known]);
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(json(remote), json(local)); assert.deepEqual(json(remoteRecord), json(localRecord));
  const repaired = context.RoomIssueMatching.prepareRoomIssue(candidate, remoteRecord, [{ ...known, status: "resolu" }]);
  assert.deepEqual(json(repaired), json(remote));
  assert.deepEqual(json(remoteRecord.relatedIssueIds), [known.id]);
  assert.deepEqual(json(repaired.roomFindings.map((f: { key: string }) => f.key)), ["lights"]);
  const duplicate = saved(problem(["taps"]));
  assert.equal(context.RoomIssueMatching.prepareRoomIssue(roomIssue(duplicate), duplicate, [known]), undefined);
  assert.equal(context.RoomIssueMatching.prepareRoomIssue(roomIssue(duplicate), duplicate, [{ ...known, status: "resolu" }]), undefined);
});

test("a distinct defect on the same equipment can be explicitly reported without hiding it", () => {
  const record = saved(problem(["taps"], { distinctProblemKeys: ["taps"] }));
  const plan = planRoomIssue(roomIssue(record), record, [manual()]);
  assert.equal(plan.relatedIssueIds.length, 0);
  assert.deepEqual(plan.issue?.roomFindings?.map(f => f.key), ["taps"]);
});

test("old Google scripts reject the new room action before writes and keep a retryable deployment error", async () => {
  process.env.STORAGE_DRIVER = "sheets"; process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/workflow-test/exec"; process.env.GOOGLE_API_TOKEN = "test";
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.equal(JSON.parse(String(options?.body)).action, "commitRoomInspection");
    return Response.json({ ok: false, code: 400, error: "Action invalide." });
  };
  try { await assert.rejects(executeEntry(entry()), error => (error as { code: number }).code === 503 && /redéployez/.test((error as Error).message)); assert.equal(requests, 1); }
  finally { globalThis.fetch = original; }
});
