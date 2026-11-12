import { expect, test, type Page } from "@playwright/test";
import type { PendingEntry } from "../../lib/entryQueue";
import { getLaundryMachine, validateWorkEntry, validateWorkPredecessor } from "../../lib/work";
import { workEntrySchema, type WorkEntry, type WorkEvent } from "../../lib/rooms";
import { workReceipt as receipt } from "./helpers/receipts";

const startedAt = "2026-10-01T09:00:00.000Z";
const revisionMessage = "Ce suivi a été modifié ailleurs. Actualisez, annulez la modification en attente puis recommencez.";

function start(machineId: string, room: string, expectedRevision = 0, previousEventId?: string): WorkEntry {
  const machine = getLaundryMachine(machineId)!;
  return workEntrySchema.parse({
    type: "createWorkEvent", kind: "laundryCycle", id: crypto.randomUUID(), targetId: machineId,
    expectedRevision, room, date: "2026-10-01", occurredAt: startedAt,
    ...(expectedRevision === 0 ? { expectedPreviousEventId: null } : previousEventId ? { expectedPreviousEventId: previousEventId } : {}),
    actor: "Agent démarrage fictif", notes: "Sac de démonstration", laundryCycleId: crypto.randomUUID(),
    laundryOwner: "Repère fictif " + room, laundryStartedAt: startedAt,
    laundryEndsAt: new Date(Date.parse(startedAt) + machine.durationMinutes * 60_000).toISOString(),
    laundryStatus: "en_cours", laundryCollectedAt: null, laundryCollectedBy: "",
  });
}

function collect(original: WorkEntry, actor: string, at = "2026-10-01T09:45:00.000Z"): WorkEntry {
  return workEntrySchema.parse({ ...original, id: crypto.randomUUID(), expectedRevision: original.expectedRevision + 1,
    expectedPreviousEventId: original.id,
    actor, occurredAt: at, laundryStatus: "recupere", laundryCollectedAt: at, laundryCollectedBy: actor,
    laundryAddedMinutes: undefined });
}

function blocked(entry: WorkEntry): PendingEntry {
  return { entry, protocol: 2, attempted: true, queuedAt: Date.parse(entry.occurredAt), blocked: true, error: revisionMessage };
}

async function queue(page: Page): Promise<PendingEntry[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("hotel-work", 1);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      return await new Promise<PendingEntry[]>((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const read = transaction.objectStore("records").getAll(IDBKeyRange.bound("queue:", "queue:\uffff"));
        transaction.oncomplete = () => resolve(read.result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
}

async function fixture(page: Page, records: WorkEvent[], pending: PendingEntry[]) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  const control = { records, writes: [] as WorkEntry[], freshReads: 0, failFresh: false, loseNextReceipt: false };
  await page.route("**/api/hotel*", async route => {
    if (new URL(route.request().url()).searchParams.get("fresh") === "1") {
      control.freshReads++;
      if (control.failFresh) return route.fulfill({ status: 503, json: { error: "Lecture de vérification indisponible." } });
    }
    return route.fulfill({ json: { mode: "local", issues: [], inspections: [], familyEvents: [], roomInspections: [], workEvents: control.records } });
  });
  await page.route("**/api/entries", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const parsed = workEntrySchema.safeParse(route.request().postDataJSON());
    if (!parsed.success) return route.fulfill({ status: 400, json: { error: "Cycle invalide pour ce test." } });
    const entry = parsed.data;
    control.writes.push(entry);
    const candidate = receipt(entry), existing = control.records.find(record => record.id === entry.id);
    if (existing && existing.submissionHash !== candidate.submissionHash)
      return route.fulfill({ status: 409, json: { error: "Même identifiant, autre contenu." } });
    const error = existing ? undefined : validateWorkPredecessor(entry, control.records, true) || validateWorkEntry(entry, control.records, []);
    if (error) return route.fulfill({ status: 409, json: { error } });
    const saved = existing || candidate;
    if (!existing) control.records.push(saved);
    if (control.loseNextReceipt) {
      control.loseNextReceipt = false;
      return route.abort("internetdisconnected");
    }
    return route.fulfill({ json: { collection: "workEvents", record: saved } });
  });
  await page.goto("/lingerie");
  await expect(page.getByRole("heading", { name: "Lingerie", exact: true })).toBeVisible();
  await page.evaluate(async values => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("hotel-work", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("records");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("records", "readwrite");
        for (const value of values) transaction.objectStore("records").put(value, "queue:" + value.entry.id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, pending);
  await page.reload();
  await expect(page.getByRole("button", { name: "Vérifier et résoudre", exact: true })).toHaveCount(pending.length);
  return control;
}

function recoveryDialog(page: Page, number: number) {
  return page.getByRole("dialog", { name: `Vérifier la demande · Machine à laver ${number}`, exact: true });
}

test("the two blocked room 328 retrievals are closed independently after checking the recorded collections", async ({ page }) => {
  const first = start("washer-1", "328", 4), third = start("washer-3", "328", 7);
  const pendingFirst = collect(first, "Mauricio"), pendingThird = collect(third, "Belkacem");
  const savedFirst = collect(first, "Collègue retrait un", "2026-10-01T09:46:00.000Z");
  const savedThird = collect(third, "Collègue retrait trois", "2026-10-01T09:47:00.000Z");
  const next = start("washer-1", "114", 6, savedFirst.id);
  next.occurredAt = next.laundryStartedAt = "2026-10-01T10:00:00.000Z";
  next.laundryEndsAt = "2026-10-01T10:44:00.000Z";
  const recorded = [first, savedFirst, next, third, savedThird].map(receipt);
  const control = await fixture(page, structuredClone(recorded), [blocked(pendingFirst), blocked(pendingThird)]);
  const status = page.getByRole("region", { name: "État des enregistrements", exact: true });
  await status.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  const firstDialog = recoveryDialog(page, 1);
  await expect(firstDialog).toContainText("Collègue retrait un");
  await expect(firstDialog.getByRole("button", { name: "Confirmer le retrait maintenant", exact: true })).toHaveCount(0);
  await firstDialog.getByRole("button", { name: "Fermer la demande déjà traitée", exact: true }).click();
  await expect(firstDialog).toHaveCount(0);
  await expect.poll(async () => (await queue(page)).map(item => item.entry.id)).toEqual([pendingThird.id]);
  await expect(page.getByRole("article", { name: "Machine à laver 1", exact: true })).toContainText("114");

  await status.getByRole("button", { name: "Vérifier et résoudre", exact: true }).click();
  const thirdDialog = recoveryDialog(page, 3);
  await expect(thirdDialog).toContainText("Collègue retrait trois");
  await thirdDialog.getByRole("button", { name: "Fermer la demande déjà traitée", exact: true }).click();
  await expect(thirdDialog).toHaveCount(0);
  await expect.poll(async () => (await queue(page)).length).toBe(0);
  await expect(status.getByRole("alert")).toHaveCount(0);
  expect(control.writes).toEqual([]);
  expect(control.records).toEqual(recorded);
  expect(control.freshReads).toBeGreaterThanOrEqual(2);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("a retrieval behind an extension requires a physical check and creates a new current-revision action", async ({ page }) => {
  const first = start("washer-2", "202");
  const extension = workEntrySchema.parse({ ...first, id: crypto.randomUUID(), expectedRevision: 1,
    expectedPreviousEventId: first.id,
    occurredAt: "2026-10-01T09:35:00.000Z", laundryAddedMinutes: 10, laundryEndsAt: "2026-10-01T09:48:00.000Z" });
  const old = collect(first, "Agent vérification fictif");
  const control = await fixture(page, [receipt(first), receipt(extension)], [blocked(old)]);
  const machine = page.getByRole("article", { name: "Machine à laver 2", exact: true });
  await expect(machine.getByRole("button", { name: "Terminé · prêt à sécher", exact: true })).toBeDisabled();
  await machine.getByRole("button", { name: "Vérifier la demande", exact: true }).click();
  const dialog = recoveryDialog(page, 2);
  const confirm = dialog.getByRole("button", { name: "Confirmer le retrait maintenant", exact: true });
  await expect(confirm).toBeDisabled();
  expect(control.writes).toEqual([]);
  // A colleague using a different machine must not invalidate this review.
  const unrelated = receipt(start("washer-3", "203"));
  control.records.push(unrelated);
  await dialog.getByRole("checkbox", { name: "Je confirme que la machine est arrêtée et vide.", exact: true }).check();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await queue(page)).length).toBe(0);
  expect(control.writes).toHaveLength(1);
  const saved = control.writes[0];
  expect(saved.id).not.toBe(old.id);
  expect(saved.expectedRevision).toBe(2);
  expect(saved.expectedPreviousEventId).toBe(extension.id);
  expect(saved.targetId).toBe(first.targetId);
  expect(saved.laundryCycleId).toBe(first.laundryCycleId);
  expect(saved.room).toBe(first.room);
  expect(saved.laundryOwner).toBe(first.laundryOwner);
  expect(saved.laundryStartedAt).toBe(first.laundryStartedAt);
  expect(saved.laundryEndsAt).toBe(extension.laundryEndsAt);
  expect(saved.laundryAddedMinutes).toBeUndefined();
  expect(saved.actor).toBe(old.actor);
  expect(saved.laundryCollectedBy).toBe(old.actor);
  expect(saved.laundryCollectedAt).toBe(saved.occurredAt);
  expect(Date.parse(saved.occurredAt)).toBeGreaterThan(Date.parse(old.occurredAt));
  expect(control.records.map(record => record.id)).toEqual([first.id, extension.id, unrelated.id, saved.id]);
});

test("an unavailable fresh read and a different cycle cannot discard or apply the old retrieval", async ({ page }) => {
  const first = start("washer-1", "328"), old = collect(first, "Mauricio");
  const cancelled = workEntrySchema.parse({ ...first, id: crypto.randomUUID(), expectedRevision: 1,
    expectedPreviousEventId: first.id,
    occurredAt: "2026-10-01T09:43:00.000Z", laundryStatus: "annule", actor: "Agent arrêt fictif" });
  const next = start("washer-1", "110", 2, cancelled.id);
  next.occurredAt = next.laundryStartedAt = "2026-10-01T10:00:00.000Z";
  next.laundryEndsAt = "2026-10-01T10:44:00.000Z";
  const records = [first, cancelled, next].map(receipt);
  const control = await fixture(page, structuredClone(records), [blocked(old)]);
  control.failFresh = true;
  await page.getByRole("button", { name: "Vérifier et résoudre", exact: true }).click();
  const dialog = recoveryDialog(page, 1);
  await expect(dialog.getByRole("alert")).toContainText("Lecture de vérification indisponible.");
  await expect(dialog.getByRole("button", { name: "Confirmer le retrait maintenant", exact: true })).toHaveCount(0);
  expect((await queue(page))[0].entry).toEqual(old);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  control.failFresh = false;
  await page.getByRole("button", { name: "Vérifier et résoudre", exact: true }).click();
  await expect(dialog).toContainText("Agent arrêt fictif");
  await expect(dialog.getByRole("button", { name: "Confirmer le retrait maintenant", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Fermer la demande déjà traitée", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  expect((await queue(page))[0].entry).toEqual(old);
  expect(control.writes).toEqual([]);
  expect(control.records).toEqual(records);
  await expect(page.getByRole("article", { name: "Machine à laver 1", exact: true })).toContainText("110");
  await page.getByRole("button", { name: "Vérifier et résoudre", exact: true }).click();
  await dialog.getByRole("button", { name: "Annuler cette demande en attente", exact: true }).click();
  const discard = dialog.getByRole("button", { name: "Confirmer l’abandon de la demande", exact: true });
  await expect(discard).toBeDisabled();
  expect((await queue(page))[0].entry).toEqual(old);
  await dialog.getByRole("checkbox", { name: "Je confirme l’annulation de cette demande en attente.", exact: true }).check();
  await discard.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await queue(page)).length).toBe(0);
  expect(control.writes).toEqual([]);
  expect(control.records).toEqual(records);
  await expect(page.getByRole("article", { name: "Machine à laver 1", exact: true })).toContainText("110");
});

test("a lost response after a reviewed retrieval retries the exact replacement action once", async ({ page }) => {
  const first = start("washer-3", "328");
  const extension = workEntrySchema.parse({ ...first, id: crypto.randomUUID(), expectedRevision: 1,
    expectedPreviousEventId: first.id,
    occurredAt: "2026-10-01T09:35:00.000Z", laundryAddedMinutes: 5, laundryEndsAt: "2026-10-01T09:43:00.000Z" });
  const old = collect(first, "Belkacem");
  const control = await fixture(page, [receipt(first), receipt(extension)], [blocked(old)]);
  control.loseNextReceipt = true;
  await page.getByRole("button", { name: "Vérifier et résoudre", exact: true }).click();
  const dialog = recoveryDialog(page, 3);
  const confirm = dialog.getByRole("button", { name: "Confirmer le retrait maintenant", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Je confirme que la machine est arrêtée et vide.", exact: true }).check();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => control.writes.length).toBe(1);
  const replacement = structuredClone(control.writes[0]);
  await expect.poll(async () => (await queue(page))[0]?.error).toBeTruthy();
  const waiting = await queue(page);
  expect(waiting).toHaveLength(1);
  expect(waiting[0].entry).toEqual(replacement);
  expect(waiting[0].entry.id).not.toBe(old.id);
  expect(waiting[0].blocked).not.toBe(true);
  await page.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  await expect.poll(async () => (await queue(page)).length).toBe(0);
  expect(control.writes).toEqual([replacement, replacement]);
  expect(control.records.map(record => record.id)).toEqual([first.id, extension.id, replacement.id]);
});
