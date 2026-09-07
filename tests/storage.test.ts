import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execute, readState, readPhoto } from "../lib/storage.ts";
test("local API storage persists photos and rejects simultaneous stale edits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "hotel-storage-test-"));
  process.env.LOCAL_DATA_DIR = directory; process.env.STORAGE_DRIVER = "local";
  try {
    const fields = { title: "Fuite", location: "204", category: "Plomberie" as const, priority: "haute" as const, description: "Eau au sol", assignee: "Paul" };
    const id = crypto.randomUUID();
    await execute({ type: "createIssue", id, date: "2026-01-01", actor: "Marie", fields, photoData: "data:image/jpeg;base64,/9j/2Q==" });
    assert.equal((await readState()).issues[0].photoId, id);
    assert.equal((await readPhoto(id)).toString("base64"), "/9j/2Q==");
    const command = { type: "updateIssue" as const, id, version: 1, fields, actor: "Paul", note: "Réparation", status: "resolu" as const };
    const results = await Promise.allSettled([execute(command), execute(command)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await readState()).issues[0].history.length, 2);
  } finally { delete process.env.LOCAL_DATA_DIR; rmSync(directory, { recursive: true }); }
});
