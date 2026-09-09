import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSessionToken, passwordMatches, verifySessionToken } from "../lib/auth";
import { applyCommand, authorizeCommand, commandSchema, createId, issuePhotoIds, today, type Command, type State } from "../lib/domain";
import { execute, readPhoto, readState } from "../lib/storage";

const directory = mkdtempSync(path.join(tmpdir(), "hotel-unit-"));
process.env.LOCAL_DATA_DIR = directory;
process.env.STORAGE_DRIVER = "local";
process.env.APP_DIRECTION_PASSWORD = "test-direction";
process.env.APP_EMPLOYEE_PASSWORD = "test-employee";
after(() => rmSync(directory, { recursive: true, force: true }));

const fields = { title: "Fuite", location: "204", category: "Plomberie" as const, priority: "normale" as const, description: "Eau au sol", assignee: "" };
const create = (): Command => ({ type: "createIssue", id: createId(), date: today(), actor: "Test", fields });
const photo = (content: string) => `data:image/jpeg;base64,${Buffer.from(content).toString("base64")}`;

test("sessions bind the role, expire, reject tampering and old cookies", () => {
  assert.equal(passwordMatches("test-employee", "employe"), true);
  assert.equal(passwordMatches("test-employee", "direction"), false);
  assert.equal(passwordMatches("wrong", "employe"), false);
  const token = createSessionToken("employe", 1000);
  assert.equal(verifySessionToken(token, 1001), "employe");
  assert.equal(verifySessionToken(token.replace("employe", "direction"), 1001), null);
  assert.equal(verifySessionToken(token, 1000 + 12 * 60 * 60 * 1000), null);
  assert.equal(verifySessionToken(token + ".extra", 1001), null);
  assert.equal(verifySessionToken("9999999999999.old-signature"), null);
  process.env.APP_EMPLOYEE_PASSWORD = "changed";
  assert.equal(verifySessionToken(token, 1001), null);
  process.env.APP_EMPLOYEE_PASSWORD = "test-employee";
});

test("employees can report but cannot edit any issue status or fields", () => {
  assert.doesNotThrow(() => authorizeCommand("employe", create()));
  for (const status of ["ouvert", "en_cours", "resolu"] as const) {
    const update: Command = { type: "updateIssue", id: createId(), version: 1, actor: "Test", note: "Intervention", fields, status };
    assert.throws(() => authorizeCommand("employe", update), { code: 403 });
    assert.doesNotThrow(() => authorizeCommand("direction", update));
  }
});

test("three photos persist separately and survive status changes", async () => {
  const command = { ...create(), photosData: [photo("one"), photo("two"), photo("three")] } as Command;
  const state = await execute(command);
  const issue = state.issues[0];
  assert.equal(issue.status, "ouvert");
  assert.equal(issuePhotoIds(issue).length, 3);
  for (const [index, expected] of ["one", "two", "three"].entries())
    assert.equal((await readPhoto(issue.id, index)).toString(), expected);
  await assert.rejects(readPhoto(issue.id, 3), { code: 404 });
  await assert.rejects(readPhoto(issue.id, -1), { code: 404 });
  await assert.rejects(readPhoto(issue.id, 0.5), { code: 404 });
  await execute({ type: "updateIssue", id: issue.id, version: 1, actor: "Direction", note: "Réparé", status: "resolu", fields });
  assert.deepEqual(issuePhotoIds((await readState()).issues[0]), issue.photoIds);
  assert.equal((await readPhoto(issue.id, 2)).toString(), "three");
});

test("both new and legacy photo inputs enforce three total", () => {
  const command = create();
  assert.equal(commandSchema.safeParse({ ...command, photosData: Array(4).fill(photo("x")) }).success, false);
  assert.throws(() => applyCommand({ issues: [], inspections: [] }, { ...command, photoData: photo("x"), photosData: Array(3).fill(photo("y")) } as Command));
});

test("existing single-photo records and requests stay compatible", async () => {
  const command = create();
  const change = applyCommand({ issues: [], inspections: [] }, command);
  assert.equal(change.collection, "issues");
  if (change.collection !== "issues") return;
  const legacy = { ...change.record, photoId: change.record.id };
  delete legacy.photoIds;
  mkdirSync(path.join(directory, "photos"), { recursive: true });
  writeFileSync(path.join(directory, "photos", legacy.id + ".jpg"), "legacy-photo");
  const state: State = { issues: [legacy], inspections: [] };
  writeFileSync(path.join(directory, "hotel.json"), JSON.stringify(state));
  assert.equal((await readPhoto(legacy.id)).toString(), "legacy-photo");
  const result = await execute({ ...create(), photoData: photo("legacy-request") } as Command);
  assert.equal(issuePhotoIds(result.issues[1]).length, 1);
  assert.equal(JSON.parse(readFileSync(path.join(directory, "hotel.json"), "utf8")).issues.length, 2);
});
