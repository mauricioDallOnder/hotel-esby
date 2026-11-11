import assert from "node:assert/strict";
import { test } from "node:test";
import { compressPhoto, loadPhotoData, photoSource, preparePhotos, type PhotoProgress } from "../lib/photos";

/** Browser encoding stand-ins expose resource lifetime and output size. */
function browserHarness(options: { oversized?: boolean; failDecode?: boolean } = {}) {
  const originals = new Map(["Image", "FileReader", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
  const files = new Map<string, File>();
  const encoded: { width: number; height: number; quality: number }[] = [];
  let active = 0, peak = 0, serial = 0;
  class ImageStub {
    naturalWidth = 4000;
    naturalHeight = 3000;
    source = "";
    set src(value: string) { this.source = value; active++; peak = Math.max(peak, active); }
    async decode() {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (options.failDecode) throw new Error("Unsupported image");
    }
    removeAttribute() { active--; }
  }
  class Reader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      }, () => this.onerror?.());
    }
  }
  class Canvas {
    width = 0;
    height = 0;
    source = "";
    getContext() {
      return { fillStyle: "", fillRect() {}, drawImage: (image: ImageStub) => { this.source = image.source; } };
    }
    toBlob(done: (blob: Blob) => void, mime: string, quality: number) {
      encoded.push({ width: this.width, height: this.height, quality });
      const content = options.oversized && this.width > 1100 ? "x".repeat(400_000) : files.get(this.source)?.name || "photo";
      setTimeout(() => done(new Blob([content], { type: mime })), 0);
    }
  }
  Object.defineProperty(globalThis, "Image", { value: ImageStub, configurable: true });
  Object.defineProperty(globalThis, "FileReader", { value: Reader, configurable: true });
  Object.defineProperty(globalThis, "document", { value: { createElement: () => new Canvas() }, configurable: true });
  URL.createObjectURL = blob => { const url = `blob:test-${serial++}`; files.set(url, blob as File); return url; };
  URL.revokeObjectURL = url => { files.delete(url); };
  return {
    encoded,
    peak: () => peak,
    active: () => active,
    resources: () => files.size,
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    },
  };
}

test("multi-photo preparation preserves order while decoding one camera image at a time", async () => {
  const browser = browserHarness(), progress: PhotoProgress[] = [];
  try {
    const files = ["first.jpg", "second.jpg", "third.jpg"].map(name => new File(["image"], name, { type: "image/jpeg" }));
    const prepared = await preparePhotos(files, value => progress.push(value));
    assert.deepEqual(prepared.map(photo => Buffer.from(photo.split(",")[1], "base64").toString()), files.map(file => file.name));
    assert.equal(browser.peak(), 1, "Never hold three full-resolution decoded photos at once");
    assert.equal(browser.active(), 0);
    assert.equal(browser.resources(), 0);
    assert.deepEqual(progress, [0, 1, 2, 3].map(completed => ({ completed, total: 3 })));
    assert.equal(browser.encoded.length, 3, "A sufficiently small JPEG is encoded only once per photo");
    assert.ok(browser.encoded.every(size => size.width === 1280 && size.height === 960));
  } finally { browser.restore(); }
});

test("detailed photos reduce dimensions to fit the saved-entry limit instead of failing", async () => {
  const browser = browserHarness({ oversized: true });
  try {
    const result = await compressPhoto(new File(["image"], "detailed.jpg", { type: "image/jpeg" }), true);
    assert.ok(result.length <= 500_000);
    assert.ok(browser.encoded.some(size => size.width < 1280));
    assert.equal(browser.resources(), 0);
  } finally { browser.restore(); }
});

test("unsupported images fail clearly and release the decoded image and object URL", async () => {
  const browser = browserHarness({ failDecode: true });
  try {
    await assert.rejects(compressPhoto(new File(["broken"], "bad.heic", { type: "image/heic" }), true), /Format non reconnu/);
    assert.equal(browser.active(), 0);
    assert.equal(browser.resources(), 0);
    await assert.rejects(compressPhoto(new File(["text"], "notes.txt", { type: "text/plain" })), /Choisissez une photo/);
  } finally { browser.restore(); }
});

test("private photo loads revalidate cached bytes and do not retry an expired session or missing attachment", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403, 404]) {
      let requests = 0;
      globalThis.fetch = async (_input, init) => {
        requests++;
        assert.equal(init?.cache, "no-cache");
        assert.ok(init?.signal);
        return new Response(null, { status });
      };
      assert.equal(await loadPhotoData(photoSource("room-id", 1, "roomInspections")), null);
      assert.equal(requests, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("photo URLs are versioned so previous public immutable entries are no longer used by the app", () => {
  const source = new URL(photoSource("some/id", 2, "roomInspections"), "https://hotel.test");
  assert.equal(source.pathname, "/api/photos/some%2Fid");
  assert.equal(source.searchParams.get("index"), "2");
  assert.equal(source.searchParams.get("collection"), "roomInspections");
  assert.equal(source.searchParams.get("v"), "2");
});
