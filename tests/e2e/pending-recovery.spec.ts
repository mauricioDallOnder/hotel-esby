import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Issue, State } from "../../lib/domain";
import type { PendingEntry } from "../../lib/entryQueue";
import { parseEntry, roomChecks, roomIssue, workEntrySchema, type Entry, type RoomEntry, type RoomInspection, type WorkEntry, type WorkEvent } from "../../lib/rooms";
import { prepareRoomIssue, validateRoomIssuePlan } from "../../lib/roomIssueMatching";
import { validateWorkEntry, validateWorkPredecessor } from "../../lib/work";

function receipt(entry: WorkEntry): WorkEvent {
  return { ...entry, version: 1, updatedAt: entry.occurredAt, submissionHash: createHash("sha256").update(JSON.stringify(workEntrySchema.parse(entry))).digest("hex") };
}
async function queued(page: Page): Promise<PendingEntry[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hotel-work", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<PendingEntry[]>((resolve, reject) => {
        const tx = db.transaction("records", "readonly");
        const request = tx.objectStore("records").getAll(IDBKeyRange.bound("queue:", "queue:\uffff"));
        tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}

async function fixture(page: Page, state: State, pending: PendingEntry[]) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  const writes: Entry[] = [];
  await page.route("**/api/hotel*", route => route.fulfill({ json: { ...state, mode: "local" } }));
  await page.route("**/api/entries", async route => {
    const entry = parseEntry(route.request().postDataJSON());
    writes.push(entry);
    if (entry.type === "createWorkEvent") {
      const conflict = validateWorkPredecessor(entry, state.workEvents || [], true) || validateWorkEntry(entry, state.workEvents || [], state.familyEvents || [], state.deletedFamilyEventIds, state.roomInspections || []);
      if (conflict) return route.fulfill({ status: 409, json: { error: conflict } });
      const record = receipt(entry);
      state.workEvents = [...(state.workEvents || []), record];
      return route.fulfill({ json: { collection: "workEvents", record } });
    }
    if (entry.type !== "createRoomInspection") return route.fulfill({ status: 400, json: { error: "Unexpected fixture operation" } });
    const { photosData, ...fields } = entry;
    const record: RoomInspection = { ...fields, version: 1, updatedAt: new Date().toISOString(),
      submissionHash: createHash("sha256").update(JSON.stringify(entry)).digest("hex"),
      photoIds: photosData.map((_, index) => `${entry.id}-${index}`), photoId: photosData.length ? `${entry.id}-0` : null };
    const conflict = validateRoomIssuePlan(roomIssue(record), record, state.issues);
    if (conflict) return route.fulfill({ status: 409, json: { error: conflict } });
    const issue = prepareRoomIssue(roomIssue(record), record, state.issues);
    state.roomInspections = [...(state.roomInspections || []), record];
    if (issue) state.issues.push(issue);
    return route.fulfill({ json: { collection: "roomInspections", record, issue } });
  });
  await page.goto("/occupation");
  await expect(page.getByRole("region", { name: "État des enregistrements", exact: true })).toBeVisible();
  await page.evaluate(async values => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hotel-work", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        for (const value of values) tx.objectStore("records").put(value, "queue:" + value.entry.id);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, pending);
  await page.reload();
  return { writes, state };
}

test("a refused checklist reopens its full local contents and is atomically replaced after correction", async ({ page }) => {
  const resolved: Issue = { id: crypto.randomUUID(), version: 2, date: "2026-10-19", createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z",
    title: "Robinet bloqué", description: "Robinet du lavabo bloqué", category: "Plomberie", priority: "normale", location: "Chambre 114", status: "resolu", assignee: "Agent", reportedBy: "Agent", photoId: null, history: [] };
  const original = parseEntry({ type: "createRoomInspection", id: crypto.randomUUID(), schemaVersion: 5, room: "114", date: "2026-10-20", inspectedAt: "2026-10-20T10:00:00.000Z",
    actor: "Agent contrôle", notes: "Observation et photos à conserver", condition: "bon", occupied: true, cleaning: null,
    checks: roomChecks.map(check => ({ key: check.key, result: check.key === "taps" ? "probleme" : "ok" })),
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non",
    photosData: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="], issueLinks: [{ key: "taps", issueId: resolved.id }], problemDetails: [],
  }) as RoomEntry;
  const control = await fixture(page, { issues: [resolved], inspections: [], roomInspections: [], workEvents: [], familyEvents: [] },
    [{ entry: original, protocol: 2, attempted: true, blocked: true, error: "Le problème associé a été résolu." }]);
  await page.getByRole("button", { name: "Voir tous les envois (1)", exact: true }).click();
  await page.getByRole("dialog", { name: "Envois de cet appareil · 1", exact: true }).getByRole("button", { name: "Vérifier et résoudre", exact: true }).click();
  await page.getByRole("button", { name: "Corriger le contrôle", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Chambre 114/ });
  await expect(dialog.getByRole("radiogroup", { name: "Robinets fonctionnels", exact: true }).getByRole("radio", { name: "Problème", exact: true })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "3. Résumé", exact: true }).click();
  await expect(dialog.getByLabel("Observations et problèmes constatés", { exact: true })).toHaveValue(original.notes);
  await expect(dialog.getByRole("img", { name: /^Photo du contrôle/ })).toHaveCount(2);
  await dialog.getByRole("button", { name: /^Date :/ }).click();
  await expect(dialog.getByLabel("Date du contrôle", { exact: true })).toHaveValue(original.date);
  await dialog.getByRole("combobox", { name: /^Associer au problème existant/ }).click();
  await page.getByRole("option", { name: "Nouveau problème, aucune fiche sélectionnée", exact: true }).click();
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await queued(page)).length).toBe(0);
  expect(control.writes).toHaveLength(1);
  const replacement = control.writes[0] as RoomEntry;
  expect(replacement.id).not.toBe(original.id);
  expect(replacement.date).toBe(original.date);
  expect(replacement.notes).toBe(original.notes);
  expect(replacement.checks).toEqual(original.checks);
  expect(replacement.photosData).toEqual(original.photosData);
  expect(control.state.roomInspections).toHaveLength(1);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("a conflict holds the next request in the same batch and keeps it held after cancelling its predecessor", async ({ page }) => {
  const base = workEntrySchema.parse({ type: "createWorkEvent", id: crypto.randomUUID(), targetId: crypto.randomUUID(), kind: "collectedItem",
    expectedRevision: 0, expectedPreviousEventId: null, room: "114", date: "2026-10-20", occurredAt: "2026-10-20T10:00:00.000Z", actor: "Agent", notes: "État initial",
    itemName: "Plaque de cuisson", collectedOn: "2026-10-20", collectedBy: "Agent", returnedOn: null, returnedBy: "" });
  const a1 = workEntrySchema.parse({ ...base, id: crypto.randomUUID(), expectedRevision: 1, expectedPreviousEventId: base.id, notes: "Demande A1" });
  const a2 = workEntrySchema.parse({ ...a1, id: crypto.randomUUID(), expectedRevision: 2, expectedPreviousEventId: a1.id, notes: "Demande A2", returnedOn: "2026-10-20", returnedBy: "Agent" });
  const b1 = workEntrySchema.parse({ ...base, id: crypto.randomUUID(), expectedRevision: 1, expectedPreviousEventId: base.id, room: "115", notes: "Chambre corrigée par B" });
  const control = await fixture(page, { issues: [], inspections: [], familyEvents: [], roomInspections: [], workEvents: [receipt(base), receipt(b1)] },
    [a1, a2].map((entry, index) => ({ entry, protocol: 2, attempted: false, queuedAt: index })));
  await expect.poll(async () => (await queued(page)).filter(item => item.blocked).length).toBe(2);
  expect(control.writes.map(entry => entry.id)).toEqual([a1.id]);
  await page.getByRole("button", { name: "Voir tous les envois (2)", exact: true }).click();
  await page.getByRole("dialog", { name: "Envois de cet appareil · 2", exact: true }).getByRole("button", { name: "Vérifier et résoudre", exact: true }).first().click();
  const review = page.getByRole("dialog", { name: /^Vérifier l’envoi/ });
  await expect(review).toContainText("Demande A1");
  await expect(review).toContainText("Chambre corrigée par B");
  await review.getByRole("button", { name: "Annuler cette demande en attente", exact: true }).click();
  await review.getByRole("checkbox", { name: "Je confirme l’annulation de cette demande.", exact: true }).check();
  await review.getByRole("button", { name: "Confirmer l’annulation", exact: true }).click();
  await expect.poll(async () => (await queued(page)).length).toBe(1);
  expect((await queued(page))[0]).toMatchObject({ entry: { id: a2.id }, blocked: true, blockedReason: "dependency", blockedBy: a1.id });
  await page.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Envois de cet appareil · 1", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Voir tous les envois (1)", exact: true })).toBeVisible();
  expect(control.writes.map(entry => entry.id)).toEqual([a1.id]);
  expect(control.state.workEvents?.at(-1)?.room).toBe("115");
});
