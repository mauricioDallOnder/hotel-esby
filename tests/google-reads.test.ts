import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { execute, readPhoto, readState } from "../lib/storage";
import { createId, today } from "../lib/domain";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const empty = { issues: [], inspections: [] };
beforeEach(() => {
  process.env.STORAGE_DRIVER = "sheets";
  process.env.GOOGLE_SCRIPT_URL = `https://script.google.com/macros/s/test-${createId()}/exec`;
  process.env.GOOGLE_API_TOKEN = "test-token";
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

test("state reads share a Google request; manual refresh bypasses the cache", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ok: true, data: empty }); };
  await Promise.all([readState(), readState()]);
  await readState();
  assert.equal(calls, 1);
  await readState({ fresh: true });
  assert.equal(calls, 2);
});

test("photos load directly without list calls and repeated requests reuse bytes", async () => {
  const indexes: number[] = [];
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options!.body as string);
    assert.equal(input.action, "photo");
    indexes.push(input.index);
    return Response.json({ ok: true, data: { base64: Buffer.from(`photo-${input.index}`).toString("base64") } });
  };
  const id = createId();
  const results = await Promise.all([readPhoto(id, 0), readPhoto(id, 0), readPhoto(id, 1)]);
  assert.deepEqual(results.map((buffer) => buffer.toString()), ["photo-0", "photo-0", "photo-1"]);
  await readPhoto(id, 0);
  assert.deepEqual(indexes, [0, 1]);
  await assert.rejects(readPhoto(id, 3), { code: 404 });
  assert.equal(indexes.length, 2);
});

for (const failure of ["network", "timeout", "http", "non-JSON"] as const) {
  test(`Google reads recover from a transient ${failure} failure`, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls === 1) {
        if (failure === "non-JSON") return new Response("<html>Temporary failure</html>");
        if (failure === "http") return new Response("Unavailable", { status: 503 });
        if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
        throw new TypeError("fetch failed");
      }
      return Response.json({ ok: true, data: empty });
    };
    assert.deepEqual(await readState(), empty);
    assert.equal(calls, 2);
  });
}

test("persistent failures are bounded and not cached as successful data", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("Unavailable", { status: 503 }); };
  await assert.rejects(readState(), { code: 503 });
  assert.equal(calls, 2);
  globalThis.fetch = async () => Response.json({ ok: true, data: empty });
  assert.deepEqual(await readState(), empty);
});

test("Google authorization failures do not expire the hotel session or retry", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ ok: false, code: 401, error: "Accès refusé." });
  };
  await assert.rejects(readState(), { code: 503 });
  assert.equal(calls, 1);
});

test("persistent non-JSON deployment responses produce a useful error after one retry", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("<html>Login</html>"); };
  await assert.rejects(readState(), { code: 502, message: "Réponse Google invalide. Vérifiez le déploiement Apps Script." });
  assert.equal(calls, 2);
});

test("failed commits are never automatically repeated and invalidate cached state", async () => {
  const actions: string[] = [];
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options!.body as string);
    actions.push(input.action);
    if (input.action === "commit") throw new TypeError("fetch failed");
    return Response.json({ ok: true, data: empty });
  };
  await readState();
  await assert.rejects(execute({
    type: "createIssue", id: createId(), date: today(), actor: "Test",
    fields: { title: "Test", description: "Test", category: "Autre", priority: "normale", location: "204", assignee: "" },
  }), { code: 503 });
  await readState();
  assert.deepEqual(actions, ["list", "list", "commit", "list"]);
});
