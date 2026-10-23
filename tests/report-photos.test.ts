import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { createId, type Issue } from "../lib/domain";
import { buildReport } from "../lib/pdfExport";

const date = "2026-10-20";
// A valid 2 x 2 RGB PNG, reused deliberately to exercise image-resource deduplication.
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAAMIM/4EAAB/uBfsL2WiLAAAAAElFTkSuQmCC";
const historyEvent = (at: string, status: Issue["status"]): Issue["history"][number] => ({
  at, status, actor: "Marie", note: "Suivi de l’anomalie", priority: "normale", assignee: "",
});
const issue = (patch: Partial<Issue> = {}): Issue => {
  const day = patch.date || date;
  return {
    id: createId(), version: 1, title: "Éclairage défectueux", location: "Chambre 204",
    description: "Ampoule à remplacer près de la fenêtre.", category: "Électricité",
    priority: "normale", assignee: "", reportedBy: "Marie", status: "ouvert", date: day,
    createdAt: `${day}T10:00:00Z`, updatedAt: `${day}T10:00:00Z`, photoId: null,
    photoIds: ["photo-1", "photo-2", "photo-3"], history: [historyEvent(`${day}T10:00:00Z`, "ouvert")],
    ...patch,
  };
};
const options = (issues: Issue[], kind: "daily" | "monthly" = "daily") => ({
  kind, period: kind === "daily" ? date : date.slice(0, 7), hotelName: "Hôtel test", state: { issues, inspections: [] },
});

type Report = Awaited<ReturnType<typeof buildReport>>;
function pages(doc: Report) {
  const objects = new Map([...doc.output().matchAll(/(\d+) 0 obj\b([\s\S]*?)\bendobj\b/g)].map(match => [match[1], match[2]]));
  // Follow page /Contents references; image streams must never be decoded as page text.
  const contents = [...objects.values()].filter(object => /\/Type\s*\/Page\b/.test(object)).map(object => {
    const ref = object.match(/\/Contents\s+(\d+) 0 R/);
    assert.ok(ref, "Page is missing its content stream");
    const source = objects.get(ref[1]);
    assert.ok(source, "Page content object is missing");
    const start = source.indexOf("stream\n") + "stream\n".length;
    const header = source.slice(0, start);
    const length = header.match(/\/Length\s+(\d+)/);
    assert.ok(length, "Page content stream length is missing");
    const bytes = Buffer.from(source.slice(start, start + Number(length[1])), "binary");
    const stream = new TextDecoder("windows-1252").decode(/\/FlateDecode/.test(header) ? inflateSync(bytes) : bytes);
    const text = [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
      .map(match => match[1].replace(/\\([\\()])/g, "$1"))
      .join(" ").replace(/\s+/g, " ").trim();
    return { stream, text };
  });
  assert.equal(contents.length, doc.getNumberOfPages());
  return contents;
}
function imageCount(content: ReturnType<typeof pages>) {
  return content.reduce((count, page) => count + [...page.stream.matchAll(/\/I\d+\s+Do\b/g)].length, 0);
}

test("anomaly reports draw all three indexed photos when the legacy photoId is null", async () => {
  const record = issue(), calls: number[] = [];
  const doc = await buildReport(options([record]), async (requested, index) => {
    assert.equal(requested.id, record.id);
    calls.push(index);
    return image;
  });
  const content = pages(doc), text = content.map(page => page.text).join(" ");
  assert.deepEqual(calls, [0, 1, 2]);
  assert.equal(imageCount(content), 3);
  let previous = -1;
  for (const caption of ["Photo 1 / 3", "Photo 2 / 3", "Photo 3 / 3"]) {
    const at = text.indexOf(caption);
    assert.ok(at > previous, `Missing or out-of-order caption: ${caption}`);
    previous = at;
  }
  assert.doesNotMatch(text, /Photo indisponible/);
});

test("legacy photoId falls back to index zero and records without photos make no image request", async () => {
  const legacy = issue({ photoIds: undefined, photoId: "legacy-photo" });
  const emptyList = issue({ photoIds: [], photoId: "legacy-with-empty-list" });
  const noPhotos = issue({ title: "SANS_PHOTO", photoIds: [], photoId: null });
  const calls: string[] = [];
  const doc = await buildReport(options([legacy, emptyList, noPhotos]), async (record, index) => {
    calls.push(`${record.id}:${index}`);
    return image;
  });
  const content = pages(doc), text = content.map(page => page.text).join(" ");
  assert.deepEqual(calls, [`${legacy.id}:0`, `${emptyList.id}:0`]);
  assert.equal(imageCount(content), 2);
  assert.equal((text.match(/Photo 1 \/ 1/g) || []).length, 2);
  assert.match(text, /SANS_PHOTO/);
  assert.doesNotMatch(text, /Photo indisponible/);
});

test("a missing, rejected or corrupt middle photo keeps its caption and does not stop the other photos", async t => {
  for (const failure of ["null", "rejected", "corrupt"] as const) {
    await t.test(failure, async () => {
      const calls: number[] = [];
      const doc = await buildReport(options([issue()]), async (_record, index) => {
        calls.push(index);
        if (index !== 1) return image;
        if (failure === "rejected") throw new Error("Photo unavailable");
        return failure === "null" ? null : "data:image/png;base64,SGVsbG8=";
      });
      const content = pages(doc), text = content.map(page => page.text).join(" ");
      assert.deepEqual(calls, [0, 1, 2]);
      assert.equal(imageCount(content), 2);
      for (const caption of ["Photo 1 / 3", "Photo 2 / 3", "Photo 3 / 3"]) assert.ok(text.includes(caption));
      assert.equal((text.match(/Photo indisponible/g) || []).length, 1);
    });
  }
});

test("daily and monthly photos respect report dates and historical status rather than today's status", async t => {
  const oldPending = issue({ title: "ANCIEN_EN_ATTENTE", date: "2026-09-10" });
  const onDay = issue({ title: "CREE_CE_JOUR" });
  const resolvedLater = issue({ title: "OUVERT_A_LA_DATE", date: "2026-10-10", status: "resolu", history: [
    historyEvent("2026-10-10T10:00:00Z", "ouvert"), historyEvent("2026-11-01T10:00:00Z", "resolu"),
  ] });
  const resolvedOnDay = issue({ title: "RESOLU_CE_JOUR", date: "2026-10-10", status: "resolu", history: [
    historyEvent("2026-10-10T10:00:00Z", "ouvert"), historyEvent(`${date}T10:00:00Z`, "resolu"),
  ] });
  const reopenedLater = issue({ title: "REOUVERT_APRES_PERIODE", date: "2026-10-10", history: [
    historyEvent("2026-10-10T10:00:00Z", "ouvert"), historyEvent("2026-10-15T10:00:00Z", "resolu"), historyEvent("2026-11-02T10:00:00Z", "ouvert"),
  ] });
  const laterInMonth = issue({ title: "PLUS_TARD_CE_MOIS", date: "2026-10-21" });
  const nextMonth = issue({ title: "MOIS_FUTUR", date: "2026-11-01" });
  const previouslyResolved = issue({ title: "DEJA_RESOLU", date: "2026-09-01", status: "resolu", history: [
    historyEvent("2026-09-01T10:00:00Z", "ouvert"), historyEvent("2026-09-02T10:00:00Z", "resolu"),
  ] });
  const source = [oldPending, resolvedOnDay, onDay, nextMonth, reopenedLater, resolvedLater, laterInMonth, previouslyResolved];
  for (const kind of ["daily", "monthly"] as const) {
    await t.test(kind, async () => {
      const calls: string[] = [];
      const expected = kind === "daily" ? [oldPending, onDay, resolvedLater] : [oldPending, onDay, resolvedLater, laterInMonth];
      const doc = await buildReport(options(source, kind), async (record, index) => {
        calls.push(`${record.id}:${index}`);
        return image;
      });
      const content = pages(doc), text = content.map(page => page.text).join(" ");
      assert.deepEqual(calls.sort(), expected.flatMap(record => [0, 1, 2].map(index => `${record.id}:${index}`)).sort());
      assert.equal(imageCount(content), expected.length * 3);
      for (const record of expected) assert.ok(text.includes(record.title), `Missing eligible issue: ${record.title}`);
      for (const record of source.filter(record => !expected.includes(record))) assert.ok(!text.includes(record.title), `Unexpected issue: ${record.title}`);
    });
  }
});

test("the first anomaly with 34 description lines and three photos stays on one page", async () => {
  const record = issue({ title: "Première anomalie", location: "Chambre 204", description: "Observation.\n".repeat(33) + "FIN" });
  const doc = await buildReport(options([record]), async () => image);
  const content = pages(doc);
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(content[0].text.includes(record.title));
  assert.match(content[0].text, /FIN/);
  assert.equal(imageCount(content), 3);
});

test("many anomalies retain all photos and the end of descriptions that continue across pages", async () => {
  const records = Array.from({ length: 12 }, (_, index) => issue({
    title: `ANOMALIE_${String(index + 1).padStart(2, "0")}`,
    description: (index === 0 ? "Contrôler la fenêtre et les équipements.\n".repeat(90) : "Vérifier la chambre. ".repeat(15)) + `FIN_DESCRIPTION_${String(index + 1).padStart(2, "0")}`,
  }));
  assert.ok(records.every(record => record.description.length <= 4000));
  const calls: string[] = [];
  const doc = await buildReport(options(records), async (record, index) => {
    calls.push(`${record.id}:${index}`);
    return image;
  });
  const content = pages(doc), text = content.map(page => page.text).join(" ");
  assert.ok(doc.getNumberOfPages() > 1);
  assert.ok(content[0].text.includes(records[0].title));
  assert.equal(imageCount(content), records.length * 3);
  assert.equal(calls.length, records.length * 3);
  assert.equal(new Set(calls).size, calls.length);
  records.forEach((record, index) => {
    assert.ok(text.includes(record.title));
    assert.ok(text.includes(`FIN_DESCRIPTION_${String(index + 1).padStart(2, "0")}`), `Truncated description: ${record.title}`);
  });
  for (const caption of ["Photo 1 / 3", "Photo 2 / 3", "Photo 3 / 3"]) {
    assert.equal(text.split(caption).length - 1, records.length);
  }
  content.forEach((page, index) => assert.ok(page.text.includes(`Page ${index + 1} / ${content.length}`)));
});

test("the default photo loader requests each index from the issue photo endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const originalReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  const requests: URL[] = [];
  const record = issue();
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
  try {
    Object.defineProperty(globalThis, "FileReader", { value: Reader, configurable: true, writable: true });
    globalThis.fetch = async (input, init) => {
      requests.push(new URL(String(input), "https://hotel.test"));
      assert.equal(init?.cache, "no-store");
      return new Response(new Uint8Array(Buffer.from(image.split(",")[1], "base64")), { headers: { "Content-Type": "image/png" } });
    };
    const doc = await buildReport(options([record]));
    assert.equal(imageCount(pages(doc)), 3);
    assert.deepEqual(requests.map(url => url.searchParams.get("index")), ["0", "1", "2"]);
    requests.forEach(url => {
      assert.equal(url.pathname, `/api/photos/${record.id}`);
      assert.equal(url.searchParams.get("collection"), "issues");
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalReader) Object.defineProperty(globalThis, "FileReader", originalReader);
    else Reflect.deleteProperty(globalThis, "FileReader");
  }
});
