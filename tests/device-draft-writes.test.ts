import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceDraftWrites } from "../lib/deviceDraftWrites";

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("draft writes coalesce waiting versions and stay saving until the latest content is durable", async () => {
  const calls: { key: string; value: unknown; gate: ReturnType<typeof deferred> }[] = [];
  const writer = new DeviceDraftWrites(async (key, value) => {
    const gate = deferred(); calls.push({ key, value, gate }); await gate.promise;
  }, async () => {});
  const first = writer.save("room:101", "A"); await tick();
  const second = writer.save("room:101", "AB"), third = writer.save("room:101", "ABC");
  let flushed = false;
  const flush = writer.flush().then(() => { flushed = true; });
  calls[0].gate.resolve(); await first; await tick();
  assert.equal(writer.status("room:101").saving, true);
  assert.equal(flushed, false);
  assert.deepEqual(calls.map(call => call.value), ["A", "ABC"]);
  calls[1].gate.resolve(); await Promise.all([second, third, flush]);
  assert.deepEqual(writer.status("room:101"), { saving: false, error: "" });
});

test("a cleared or successfully rewritten draft no longer blocks flushing with its previous failure", async () => {
  let fail = true;
  const deleted: string[] = [];
  const writer = new DeviceDraftWrites(async () => { if (fail) throw new Error("Disk full"); }, async key => { deleted.push(key); });
  await assert.rejects(writer.save("failed", "A"), /Disk full/);
  await assert.rejects(writer.flush(), /Disk full/);
  assert.equal(writer.status("failed").error, "Disk full");
  await writer.clear("failed"); await writer.flush();
  assert.deepEqual(deleted, ["failed"]);
  assert.deepEqual(writer.status("failed"), { saving: false, error: "" });
  await assert.rejects(writer.save("retry", "B"), /Disk full/);
  fail = false;
  await writer.save("retry", "BC"); await writer.flush();
  assert.equal(writer.status("retry").error, "");
});

test("clear orders behind old writes and cannot erase a newly started draft", async () => {
  const first = deferred(), calls: string[] = [];
  const writer = new DeviceDraftWrites(async (_, value) => { calls.push(String(value)); if (value === "old") await first.promise; }, async () => { calls.push("delete"); });
  const old = writer.save("same", "old"); await tick();
  const clear = writer.clear("same"), fresh = writer.save("same", "fresh");
  let reopened = false;
  const wait = writer.wait("same").then(() => { reopened = true; });
  await tick(); assert.equal(reopened, false);
  first.resolve(); await Promise.all([old, clear, fresh, wait]);
  assert.deepEqual(calls, ["old", "delete", "fresh"]);
  assert.equal(reopened, true);
});

test("flush waits for all draft keys and failed obsolete versions are recovered by a queued replacement", async () => {
  const a = deferred(), b = deferred();
  const writer = new DeviceDraftWrites(async (key, value) => {
    if (key === "a" && value === "old") await a.promise;
    if (key === "b") await b.promise;
  }, async () => {});
  const failed = writer.save("a", "old").catch(() => {}); await tick();
  const saved = writer.save("a", "new"), other = writer.save("b", "other");
  const flush = writer.flush();
  a.reject(new Error("Temporary failure")); await tick();
  assert.equal(writer.status("a").error, "");
  assert.equal(writer.status("b").saving, true);
  b.resolve(); await Promise.all([failed, saved, other, flush]);
});
