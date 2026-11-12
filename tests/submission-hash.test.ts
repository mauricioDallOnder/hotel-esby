import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { sha256Fallback, submissionHash } from "../lib/submissionHash";

test("receipt hashes agree with the server for Unicode, padding boundaries and photo-sized submissions", async () => {
  for (const value of ["", "abc", "Observations : éclairage réparé, chambre 114. 🔧", JSON.stringify({ notes: "Éléments : água, réparation ✔", photosData: ["data:image/jpeg;base64,YQ=="] }), ...[55, 56, 63, 64, 65, 127, 128, 65_536, 1_500_000].map(length => "a".repeat(length))]) {
    const expected = createHash("sha256").update(value).digest("hex");
    assert.equal(await sha256Fallback(new TextEncoder().encode(value)), expected);
    assert.equal(await submissionHash(value), expected);
  }
});

test("HTTP local-network clients verify receipts when SubtleCrypto is unavailable", async t => {
  t.mock.getter(globalThis, "crypto", () => undefined);
  assert.equal(await submissionHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
