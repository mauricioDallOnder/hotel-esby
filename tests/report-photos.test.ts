import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { applyCommand, createId, issueResponsible, monthlySummary, type Issue, type State } from "../lib/domain";
import { buildReport } from "../lib/pdfExport";
import { indexReportPhotos } from "../lib/reportPhotos";
import { reportPendingIssues, reportPhotos } from "../lib/reportData";
import type { RoomInspection } from "../lib/rooms";

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

test("reports keep the reporter responsible and preserve the real author of each intervention", async () => {
  const legacy = issue({ reportedBy: "Marie", assignee: "Technicien", photoIds: [], history: [
    { ...historyEvent(`${date}T10:00:00Z`, "ouvert"), assignee: "Technicien" },
  ] });
  const original = structuredClone(legacy);
  const change = applyCommand({ issues: [legacy], inspections: [] }, {
    type: "updateIssue", id: legacy.id, version: legacy.version, actor: "Salima",
    note: "Ampoule vérifiée, remplacement en cours.", status: "en_cours",
    fields: { title: legacy.title, location: legacy.location, description: legacy.description,
      category: legacy.category, priority: legacy.priority, assignee: "Technicien" },
  }, `${date}T14:00:00Z`);
  assert.equal(change.collection, "issues");
  if (change.collection !== "issues") throw new Error("Expected an issue update");
  const updated = change.record, snapshot = structuredClone(updated);
  assert.equal(issueResponsible(updated), "Marie");
  const summary = monthlySummary({ issues: [updated], inspections: [] }, date.slice(0, 7));
  assert.equal(summary.interventions.length, 1);
  assert.equal(summary.interventions[0].event.actor, "Salima");
  assert.equal(issueResponsible(summary.interventions[0].issue), "Marie");
  assert.deepEqual(updated.history[0], original.history[0]);
  assert.equal(updated.history[0].assignee, "Technicien");
  for (const kind of ["daily", "monthly"] as const) {
    const doc = await buildReport(options([updated], kind));
    assert.ok(pages(doc).some(page => page.text.includes(updated.title)));
    assert.deepEqual(updated, snapshot, `${kind} export must not rewrite authors or history`);
  }
  assert.deepEqual(legacy, original);
});

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
      assert.equal(init?.cache, "no-cache");
      return new Response(new Uint8Array(Buffer.from(image.split(",")[1], "base64")), { headers: { "Content-Type": "image/png" } });
    };
    const doc = await buildReport(options([record]));
    assert.equal(imageCount(pages(doc)), 3);
    assert.deepEqual(requests.map(url => url.searchParams.get("index")), ["0", "1", "2"]);
    requests.forEach(url => {
      assert.equal(url.pathname, `/api/photos/${record.id}`);
      assert.equal(url.searchParams.get("collection"), "issues");
      assert.equal(url.searchParams.get("v"), "2");
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalReader) Object.defineProperty(globalThis, "FileReader", originalReader);
    else Reflect.deleteProperty(globalThis, "FileReader");
  }
});

function roomControl(issueId: string, photoIds: string[], patch: Partial<RoomInspection> = {}): RoomInspection {
  return {
    type: "createRoomInspection", id: createId(), room: "204", date,
    actor: "Marie", notes: "Les bagages encombrent la chambre.", condition: "a_revoir", occupied: true,
    cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non", bugs: "non", checks: [],
    version: 1, updatedAt: `${date}T12:00:00Z`, submissionHash: "saved-control", photoIds, photoId: photoIds[0] || null,
    relatedIssueIds: [issueId], issueSyncVersion: 2, createdIssue: false, ...patch,
  };
}

test("a shared inspection keeps distinct source indices for each linked issue", () => {
  const first = issue({ photoIds: ["original"] });
  const second = issue({ photoIds: [] });
  const shared = roomControl(first.id, ["original", "shared"], { relatedIssueIds: [second.id, first.id, first.id] });
  const getPhotos = indexReportPhotos({ issues: [first, second], inspections: [], roomInspections: [shared] }, date);
  assert.deepEqual(getPhotos(first).map(p => [p.sourceId, p.index]), [[first.id, 0], [shared.id, 1]]);
  assert.deepEqual(getPhotos(second).map(p => [p.sourceId, p.index]), [[shared.id, 0], [shared.id, 1]]);
});

test("clutter reports include all original and explicitly linked control photos once, within the period", async t => {
  const clutter = issue({ title: "Chambre encombrée d’affaires", description: "Des bagages occupent une grande partie de la chambre.",
    room: "204", roomFindings: [{ key: "room_clutter", label: "Chambre encombrée d’affaires", problemType: "room_cluttered" }] });
  const second = roomControl(clutter.id, ["followup-1", "followup-2"]);
  const state: State = { issues: [clutter, issue({ title: "ÉCLAIRAGE_SEUL" })], inspections: [], roomInspections: [
    roomControl(clutter.id, clutter.photoIds!, { id: clutter.id, createdIssue: true, relatedIssueIds: [] }),
    second,
    roomControl(clutter.id, ["future-photo"], { date: "2026-11-01", updatedAt: "2026-11-01T10:00:00Z" }),
    roomControl(createId(), ["unrelated-photo"]),
    // An unconfirmed form's desired link is not evidence that this issue was used.
    roomControl(createId(), ["unconfirmed-link"], { relatedIssueIds: [], issueLinks: [{ key: "room_clutter", issueId: clutter.id }] }),
  ] };
  const snapshot = structuredClone(state);
  for (const kind of ["daily", "monthly"] as const) {
    await t.test(kind, async () => {
      const calls: { sourceId: string; index: number; collection: string; galleryIndex: number }[] = [];
      const doc = await buildReport({ ...options(state.issues, kind), state, scope: "room_clutter" }, async (requested, galleryIndex, photo) => {
        assert.equal(requested.id, clutter.id);
        calls.push({ sourceId: photo.sourceId, index: photo.index, collection: photo.collection, galleryIndex });
        return image;
      });
      const content = pages(doc), text = content.map(page => page.text).join(" ");
      assert.equal(imageCount(content), 5);
      assert.match(text, /Chambres encombrées/);
      assert.doesNotMatch(text, /ÉCLAIRAGE_SEUL/);
      assert.deepEqual(calls, [
        ...[0, 1, 2].map(index => ({ sourceId: clutter.id, index, collection: "issues", galleryIndex: index })),
        ...[0, 1].map(index => ({ sourceId: second.id, index, collection: "roomInspections", galleryIndex: index + 3 })),
      ]);
      for (let index = 1; index <= 5; index++) assert.ok(text.includes(`Photo ${index} / 5`));
      assert.equal(reportPhotos(clutter, state, kind === "daily" ? date : "2026-10-31").length, 5);
    });
  }
  assert.deepEqual(state, snapshot, "reporting must not rewrite source issues or controls");
});

test("the clutter filter follows individual resolution at the report date and ignores radiator obstructions", async () => {
  const grouped = issue({ status: "en_cours", photoIds: [], roomFindings: [
    { key: "room_clutter", label: "Chambre encombrée d’affaires", problemType: "room_cluttered", status: "resolu" },
    { key: "lights", label: "Ampoule à remplacer", status: "ouvert" },
  ], history: [historyEvent("2026-10-10T10:00:00Z", "ouvert"), {
    ...historyEvent("2026-10-21T10:00:00Z", "en_cours"),
    findingStates: [{ key: "room_clutter", status: "resolu" }, { key: "lights", status: "ouvert" }],
    findingDetails: [{ key: "room_clutter", label: "Chambre encombrée d’affaires", problemType: "room_cluttered" }, { key: "lights", label: "Ampoule à remplacer" }],
  }] });
  const radiator = issue({ problemType: "radiator_obstructed", roomFindings: [{ key: "radiator_clear", label: "Radiateur caché ou encombré" }] });
  const manual = issue({ problemType: "room_cluttered", photoIds: [] });
  const state: State = { issues: [grouped, radiator, manual], inspections: [] };
  assert.deepEqual(reportPendingIssues(state, "daily", date, "room_clutter").map(record => record.id), [grouped.id, manual.id]);
  assert.deepEqual(reportPendingIssues(state, "monthly", "2026-10", "room_clutter").map(record => record.id), [manual.id]);
  assert.equal(reportPendingIssues(state, "monthly", "2026-10").length, 3);
  const doc = await buildReport({ ...options([radiator]), scope: "room_clutter" }, async () => {
    assert.fail("empty clutter export must not request unrelated photos");
  });
  assert.match(pages(doc).map(page => page.text).join(" "), /Aucune chambre encombrée en attente/);
});

test("a corrected issue no longer uses an invalidated clutter classification in the current report", () => {
  const corrected = issue({ title: "Éclairage en panne", roomFindingsActive: false, updatedAt: "2026-10-21T10:00:00Z",
    roomFindings: [{ key: "room_clutter", label: "Chambre encombrée d’affaires" }], history: [
      historyEvent("2026-10-10T10:00:00Z", "ouvert"),
      { ...historyEvent("2026-10-21T10:00:00Z", "ouvert"), findingDetails: [{ key: "room_clutter", label: "Chambre encombrée d’affaires" }] },
    ] });
  const state: State = { issues: [corrected], inspections: [] };
  assert.equal(reportPendingIssues(state, "daily", date, "room_clutter").length, 1);
  assert.equal(reportPendingIssues(state, "monthly", "2026-10", "room_clutter").length, 0);
});

test("the default report loader uses the authenticated room-control endpoint for linked photos", async () => {
  const originalFetch = globalThis.fetch;
  const originalReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  const requests: URL[] = [];
  const record = issue({ photoIds: [] });
  const control = roomControl(record.id, ["linked-1", "linked-2"]);
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
      assert.equal(init?.cache, "no-cache");
      return new Response(new Uint8Array(Buffer.from(image.split(",")[1], "base64")), { headers: { "Content-Type": "image/png" } });
    };
    const doc = await buildReport({ ...options([record]), state: { issues: [record], inspections: [], roomInspections: [control] } });
    assert.equal(imageCount(pages(doc)), 2);
    assert.deepEqual(requests.map(url => url.searchParams.get("index")), ["0", "1"]);
    requests.forEach(url => {
      assert.equal(url.pathname, `/api/photos/${control.id}`);
      assert.equal(url.searchParams.get("collection"), "roomInspections");
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalReader) Object.defineProperty(globalThis, "FileReader", originalReader);
    else Reflect.deleteProperty(globalThis, "FileReader");
  }
});

test("technical and clutter PDFs isolate the selected findings of a mixed room inspection", async () => {
  const grouped = issue({
    title: "Contrôle de chambre", description: "FUITE_ACTIVE\nVALISES_ENTREE\nBLATTES_DETECTEES",
    roomFindings: [
      { key: "leaks", label: "FUITE_ACTIVE" },
      { key: "room_clutter", label: "VALISES_ENTREE" },
      { key: "bugs", label: "BLATTES_DETECTEES" },
    ],
  });
  const pests = issue({ title: "Cafards dans la chambre", description: "Présence de cafards dans la chambre." });
  for (const scope of ["technical", "room_clutter"] as const) {
    const doc = await buildReport({ ...options([grouped, pests]), scope }, async record => {
      assert.equal(record.id, grouped.id);
      return image;
    });
    const text = pages(doc).map(page => page.text).join(" ");
    assert.ok(text.includes(scope === "technical" ? "FUITE_ACTIVE" : "VALISES_ENTREE"));
    assert.ok(!text.includes(scope === "technical" ? "VALISES_ENTREE" : "FUITE_ACTIVE"));
    assert.doesNotMatch(text, /BLATTES_DETECTEES|Présence de cafards dans la chambre/);
    assert.equal(imageCount(pages(doc)), 3);
  }
});

test("resolved and complete PDFs use resolution transitions, Paris dates and individual finding states", async () => {
  const opened = historyEvent("2026-09-01T09:00:00Z", "ouvert");
  const resolution = { ...historyEvent("2026-10-19T22:30:00Z", "resolu"), actor: "Alex", note: "Pièce remplacée." };
  const grouped = issue({ date: "2026-09-01", title: "Contrôle groupé", description: "POIGNEE_REPAREE\nPRISE_EN_PANNE\nPrévenir la réception avant la visite.",
    status: "en_cours", roomFindings: [{ key: "handle", label: "POIGNEE_REPAREE" }, { key: "socket", label: "PRISE_EN_PANNE" }],
    history: [opened, { ...resolution, status: "en_cours", findingStates: [{ key: "handle", status: "resolu" }, { key: "socket", status: "ouvert" }] }],
  });
  const closed = issue({ title: "RESOLUTION_DU_JOUR", date: "2026-09-01", history: [opened, resolution,
    { ...resolution, at: date + "T15:00:00Z", actor: "Marc", note: "Correction administrative." },
    historyEvent("2026-11-01T10:00:00Z", "ouvert")] });
  const reopened = issue({ title: "DEJA_REOUVERT", history: [opened, resolution, historyEvent(date + "T12:00:00Z", "ouvert")] });
  const old = issue({ title: "RESOLUTION_ANCIENNE", date: "2026-09-01", status: "resolu",
    history: [opened, historyEvent("2026-09-30T08:00:00Z", "resolu"), { ...resolution, note: "Note seule." }] });
  for (const kind of ["daily", "monthly"] as const) {
    for (const scope of ["resolved", "complete"] as const) {
      const calls: string[] = [];
      const doc = await buildReport({ ...options([grouped, closed, reopened, old], kind), scope }, async record => {
        calls.push(record.id);
        return image;
      });
      const text = pages(doc).map(page => page.text).join(" ");
      assert.match(text, /RESOLUTION_DU_JOUR/);
      assert.match(text, /POIGNEE_REPAREE/);
      assert.match(text, /20\/10\/2026/);
      assert.match(text, /Alex/);
      assert.match(text, /Pièce remplacée/);
      assert.doesNotMatch(text, /RESOLUTION_ANCIENNE|Correction administrative/);
      assert.equal(text.includes("DEJA_REOUVERT"), scope === "complete");
      assert.equal(text.includes("PRISE_EN_PANNE"), scope === "complete");
      assert.equal(text.includes("Prévenir la réception avant la visite."), scope === "complete");
      assert.equal(calls.filter(id => id === grouped.id).length, 3, "one gallery for a partially resolved room");
      assert.ok(!calls.includes(old.id));
    }
  }
});

test("a closed legacy issue without events uses its only known timestamp and labels that limitation", async () => {
  const legacy = issue({ title: "FICHE_ANCIENNE", date: "2026-09-01", updatedAt: date + "T11:00:00Z", status: "resolu", history: [] });
  const old = issue({ title: "ARCHIVE_SEPTEMBRE", date: "2026-09-01", status: "resolu", history: [] });
  const doc = await buildReport({ ...options([legacy, old]), scope: "resolved" }, async () => null);
  const text = pages(doc).map(page => page.text).join(" ");
  assert.match(text, /FICHE_ANCIENNE/);
  assert.match(text, /date de résolution inconnue/);
  assert.match(text, /Dernière mise à jour le 20\/10\/2026/);
  assert.doesNotMatch(text, /ARCHIVE_SEPTEMBRE|Résolu le 20/);
});

test("a canonical pest resolution and an outstanding repair share a room without duplicating the legacy pest finding", async () => {
  const grouped = issue({ room: "204", title: "Contrôle de chambre", description: "ROBINET_EN_PANNE\nANCIEN_CONSTAT_CAFARDS",
    roomFindings: [{ key: "taps", label: "ROBINET_EN_PANNE" }, { key: "bugs", label: "ANCIEN_CONSTAT_CAFARDS" }] });
  const state: State = { issues: [grouped], inspections: [], workEvents: [{
    id: createId(), type: "createWorkEvent", kind: "cafardFollowup", room: "204", targetId: "204", date,
    occurredAt: date + "T17:00:00Z", updatedAt: date + "T17:00:00Z", expectedRevision: 0, version: 1,
    cafardStatus: "resolu", detectedOn: date, resolvedOn: date, product: "", treatedOn: null,
    notes: "Vérification terminée.", actor: "Anna", submissionHash: "test",
  }] };
  for (const scope of ["complete", "resolved"] as const) {
    const doc = await buildReport({ ...options(state.issues), state, scope }, async () => image);
    const text = pages(doc).map(page => page.text).join(" ");
    assert.match(text, /Cafards · Chambre 204/);
    assert.match(text, /Vérification terminée/);
    assert.doesNotMatch(text, /ANCIEN_CONSTAT_CAFARDS/);
    assert.equal(text.includes("ROBINET_EN_PANNE"), scope === "complete");
  }
});
