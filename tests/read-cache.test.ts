import assert from "node:assert/strict";
import { test } from "node:test";
import { ReadCache } from "../lib/readCache";

test("concurrent reads share a request and failed reads remain retryable", async () => {
  const cache = new ReadCache<number>(1000, 2);
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get("a", load), cache.get("a", load)]), [1, 1]);
  assert.equal(await cache.get("a", load), 1);
  assert.equal(calls, 1);
  await assert.rejects(cache.get("b", async () => { throw new Error("offline"); }));
  assert.equal(await cache.get("b", load), 2);
});

test("invalidation during a read cannot put stale data back into the cache", async () => {
  const cache = new ReadCache<number>(1000, 1);
  let resolve!: (value: number) => void;
  const old = cache.get("a", () => new Promise<number>((done) => { resolve = done; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get("a", async () => 2), 2);
  resolve(1);
  assert.equal(await old, 1);
  assert.equal(await cache.get("a", async () => 3), 2);
});

test("cache expires and evicts photos to stay within its memory limit", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const cache = new ReadCache<string>(100, 5, (value) => value.length);
  await cache.get("a", async () => "aaa");
  await cache.get("b", async () => "bbb");
  assert.equal(await cache.get("a", async () => "aa"), "aa");
  t.mock.timers.tick(101);
  assert.equal(await cache.get("a", async () => "new"), "new");
});
