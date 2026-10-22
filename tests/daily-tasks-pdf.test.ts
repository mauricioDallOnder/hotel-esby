import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { createId } from "../lib/domain";
import { buildDailyTasksPdf } from "../lib/dailyTasksPdf";
import type { WorkEntry, WorkEvent } from "../lib/rooms";
import { dailyTasks } from "../lib/work";

const date = "2026-10-20";
const task = (patch: Partial<WorkEntry> = {}): WorkEntry => ({
  type: "createWorkEvent", id: createId(), targetId: createId(), kind: "dailyTask", expectedRevision: 0,
  room: "", date, actor: "Employé", notes: "Préparer les clés", occurredAt: `${date}T08:00:00Z`,
  done: false, deleted: false, ...patch,
});
const saved = (patch: Partial<WorkEvent> = {}): WorkEvent => ({
  ...task(), version: 1, updatedAt: `${date}T08:00:00Z`, submissionHash: "hash", ...patch,
});
const revision = (entry: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry => ({
  ...entry, id: createId(), expectedRevision: entry.expectedRevision + 1, ...patch,
});

// The exporter uses standard fonts and compressed page streams, without embedded images.
function pageText(doc: ReturnType<typeof buildDailyTasksPdf>) {
  return [...doc.output().matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match => {
    const stream = new TextDecoder("windows-1252").decode(inflateSync(Buffer.from(match[1], "binary")));
    return [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
      .map(text => text[1].replace(/\\([\\()])/g, "$1"))
      .join(" ").replace(/\s+/g, " ").trim();
  });
}

test("a blank daily task sheet fits one portrait A4 page with a date field and space for notes", () => {
  const doc = buildDailyTasksPdf({ mode: "blank", hotelName: "Hôtel test" });
  assert.match(doc.output(), /^%PDF/);
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(doc.internal.pageSize.getHeight() - 297) < 0.1);
  const [text] = pageText(doc);
  assert.match(text, /Tâches du jour/);
  assert.match(text, /Hôtel test/);
  assert.match(text, /Date\s*:/);
  assert.match(text, /Notes et suivi/);
  assert.match(text, /Page 1 \/ 1/);
  assert.doesNotMatch(text, /Aucune tâche enregistrée pour cette date/);
});

test("a selected day exports only the latest visible task revisions in screen order, including pending changes", () => {
  const old = saved({ notes: "ANCIEN_TEXTE" });
  const pending = revision(old, { notes: "Clés et badges à préparer", occurredAt: "2026-10-22T07:00:00Z" });
  const first = saved({ notes: "Contrôler les arrivées", occurredAt: `${date}T09:00:00Z` });
  const unfinished = saved({ notes: "ANCIENNE_ACTION" });
  const completed = revision(unfinished, { done: true, notes: "Vérifier la réserve", occurredAt: "2026-10-22T12:00:00Z" });
  const moved = saved({ notes: "TACHE_DEPLACEE" });
  const movedRevision = revision(moved, { date: "2026-10-21", occurredAt: "2026-10-22T09:00:00Z" });
  const removed = saved({ notes: "TACHE_SUPPRIMEE" });
  const removedRevision = revision(removed, { deleted: true, occurredAt: "2026-10-22T10:00:00Z" });
  const otherDay = saved({ date: "2026-10-19", notes: "AUTRE_JOUR" });
  const familyComment = saved({ kind: "familyComment", room: "201", familyEventId: createId(), notes: "COMMENTAIRE_FAMILLE" });
  const events = [completed, movedRevision, removedRevision, pending, otherDay, familyComment, old, moved, unfinished, first, removed, first];
  const expected = [first.notes, pending.notes, completed.notes];
  assert.deepEqual(dailyTasks(events, date).map(entry => entry.notes), expected);
  const doc = buildDailyTasksPdf({ mode: "day", hotelName: "Test", date, events, pendingIds: [pending.id, removedRevision.id], cachedAt: "2026-10-22T12:00:00Z" });
  const text = pageText(doc).join(" ");
  assert.match(text, /20\/10\/2026/);
  assert.doesNotMatch(text, /ANCIEN_TEXTE|ANCIENNE_ACTION|TACHE_DEPLACEE|TACHE_SUPPRIMEE|AUTRE_JOUR|COMMENTAIRE_FAMILLE/);
  let previous = -1;
  for (const notes of expected) {
    const at = text.indexOf(notes);
    assert.ok(at > previous, `Task missing or out of order: ${notes}`);
    assert.equal(text.indexOf(notes, at + notes.length), -1, `Duplicate task: ${notes}`);
    previous = at;
  }
  assert.match(text, /Clés et badges à préparer En attente d[’']envoi/);
  assert.equal((text.match(/En attente d[’']envoi/g) || []).length, 1);
  assert.match(text, /3 tâche\(s\) au total\s*-\s*2 à faire\s*-\s*1 terminée\(s\)/);
  assert.match(text, /Données conservées sur cet appareil/);
  assert.match(text, /Notes et suivi/);
});

test("an empty selected day produces a one-page dated sheet with a clear empty message", () => {
  const doc = buildDailyTasksPdf({ mode: "day", hotelName: "Test", date: "2026-09-15", events: [saved({ notes: "AUTRE_DATE" })] });
  assert.equal(doc.getNumberOfPages(), 1);
  const [text] = pageText(doc);
  assert.match(text, /15\/09\/2026/);
  assert.match(text, /Aucune tâche enregistrée pour cette date\./);
  assert.match(text, /Notes et suivi/);
  assert.match(text, /Page 1 \/ 1/);
  assert.doesNotMatch(text, /AUTRE_DATE/);
});

test("many long French task descriptions retain their final markers across numbered pages", () => {
  const events = Array.from({ length: 24 }, (_, index) => {
    const marker = `FIN_TACHE_${String(index + 1).padStart(2, "0")}`;
    return saved({
      notes: "Vérifier l’éclairage, les clés et la fenêtre côté cour (entrée). ".repeat(10).slice(0, 480) + ` ${marker}`,
      occurredAt: `${date}T08:${String(index).padStart(2, "0")}:00Z`, done: index % 4 === 0,
    });
  });
  assert.ok(events.every(event => event.notes.length <= 500));
  const doc = buildDailyTasksPdf({ mode: "day", hotelName: "Hôtel test", date, events });
  const pages = pageText(doc), text = pages.join(" ");
  assert.ok(doc.getNumberOfPages() > 1);
  assert.equal(pages.length, doc.getNumberOfPages());
  assert.match(text, /Vérifier l’éclairage, les clés et la fenêtre côté cour \(entrée\)/);
  events.forEach((_, index) => assert.ok(text.includes(`FIN_TACHE_${String(index + 1).padStart(2, "0")}`), `Truncated task ${index + 1}`));
  pages.forEach((page, index) => {
    assert.match(page, /Tâches du jour/);
    assert.match(page, /20\/10\/2026/);
    assert.ok(page.includes(`Page ${index + 1} / ${pages.length}`));
  });
  assert.match(pages.at(-1)!, /Notes et suivi/);
});
