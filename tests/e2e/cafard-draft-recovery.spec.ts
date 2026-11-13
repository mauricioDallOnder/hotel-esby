import { expect, test, type Locator, type Page } from "./fixtures";
import { today, type State } from "../../lib/domain";
import type { PendingEntry } from "../../lib/entryQueue";
import { roomChecks, workEntrySchema, type Entry, type EntryChange, type RoomEntry, type WorkEntry, type WorkEvent } from "../../lib/rooms";

const room = "110";
const detectedOn = "2026-10-19";
const treatedOn = "2026-11-05";
const reloadLabel = "Recharger le suivi en conservant mes observations";

async function login(page: Page) {
  const response = await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } });
  expect(response.ok()).toBeTruthy();
}

async function saveEntry(page: Page, entry: Entry): Promise<EntryChange> {
  const response = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: entry });
  const change = await response.json();
  expect(response.status(), JSON.stringify(change)).toBe(200);
  return change;
}

async function state(page: Page): Promise<State> {
  const response = await page.request.get("/api/hotel?fresh=1");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function seedTreatmentAndDetection(page: Page) {
  const treatment: WorkEntry = {
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "cafardFollowup", targetId: room, room,
    expectedRevision: 0, expectedPreviousEventId: null, date: treatedOn, occurredAt: treatedOn + "T10:00:00.000Z",
    actor: "Agent traitement", notes: "Application initiale à conserver dans l’historique.",
    cafardStatus: "traite", detectedOn, treatedOn, resolvedOn: null, product: "Gel", cafardObservationId: null,
  };
  const first = await saveEntry(page, treatment);
  if (first.collection !== "workEvents") throw new Error("Expected a treatment receipt.");
  const inspection: RoomEntry = {
    type: "createRoomInspection", schemaVersion: 6, id: crypto.randomUUID(), room, date: today(), inspectedAt: new Date().toISOString(),
    actor: "Agent contrôle", notes: "Des cafards sont toujours présents lors du nouveau contrôle.",
    condition: "bon", occupied: true, cleaning: null, carpet: "ok", carpetNotes: "",
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
    microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "oui", photosData: [],
    problemDetails: [], issueLinks: [],
  };
  const detection = await saveEntry(page, inspection);
  if (detection.collection !== "roomInspections") throw new Error("Expected a room inspection receipt.");
  return { treatment: first.record, inspection: detection.record };
}

async function openFollowup(page: Page) {
  await page.getByRole("article", { name: `Chambre ${room}`, exact: true }).getByRole("button", { name: "Mettre à jour", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Cafards · chambre ${room}`, exact: true });
  await expect(dialog.getByLabel("Observations", { exact: true })).toBeVisible();
  return dialog;
}

async function expectTreatment(dialog: Locator, application = treatedOn, product = "Gel") {
  await expect(dialog.getByLabel("Date de détection", { exact: true })).toHaveValue(detectedOn);
  await expect(dialog.getByLabel(/^Date d’application du produit\s*\*?$/)).toHaveValue(application);
  await expect(dialog.getByLabel("Produit utilisé (facultatif)", { exact: true })).toHaveValue(product);
}

async function saveFollowup(page: Page, dialog: Locator) {
  const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  const response = await sent;
  const change = await response.json();
  expect(response.status(), JSON.stringify(change)).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "État des enregistrements", exact: true }).getByRole("status")).toHaveText("Enregistrements à jour");
  return change.record as WorkEvent;
}

async function putDraft(page: Page, draft: WorkEntry, queued?: PendingEntry) {
  await page.evaluate(async ({ value, queued }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("hotel-work", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("records");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("records", "readwrite");
        transaction.objectStore("records").put(value, "draft:cafard-room:" + value.room);
        if (queued) transaction.objectStore("records").put(queued, "queue:" + queued.entry.id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, { value: draft, queued });
}

async function storedDraft(page: Page): Promise<WorkEntry | undefined> {
  return page.evaluate(async roomNumber => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hotel-work", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<WorkEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const request = transaction.objectStore("records").get("draft:cafard-room:" + roomNumber);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, room);
}

test("mobile cafards follow-up after a newer positive checklist keeps its treatment and saves against the previous follow-up", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  const initial = await seedTreatmentAndDetection(page);
  await page.goto("/cafards");
  const dialog = await openFollowup(page);
  await expect(dialog.getByRole("button", { name: reloadLabel, exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();
  await expectTreatment(dialog);
  await dialog.getByRole("radio", { name: "Cafards présents", exact: true }).click();
  const notes = "Les cafards sont toujours présents derrière le minibar après le traitement.";
  await dialog.getByLabel("Observations", { exact: true }).fill(notes);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("cafards-present-ready-mobile.png"), animations: "disabled" });
  const saved = await saveFollowup(page, dialog);
  expect(saved.expectedRevision).toBe(1);
  expect(saved.expectedPreviousEventId).toBe(initial.treatment.id);
  expect(saved.expectedPreviousEventId).not.toBe(initial.inspection.id);
  expect(saved.cafardObservationId).toBe(initial.inspection.id);
  expect(saved.cafardStatus).toBe("signale");
  expect(saved.notes).toBe(notes);
  expect(saved.detectedOn).toBe(detectedOn);
  expect(saved.treatedOn).toBe(treatedOn);
  expect(saved.product).toBe("Gel");
  expect(saved.actor).toBe("Direction");
  const after = await state(page);
  expect(after.issues).toHaveLength(0);
  expect(after.workEvents).toHaveLength(2);
  expect(after.workEvents![0]).toEqual(initial.treatment);
  expect(after.roomInspections).toEqual([initial.inspection]);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").getByText("Cafards présents", { exact: true })).toBeVisible();
  const reopened = await openFollowup(page);
  await expect(reopened.getByRole("button", { name: reloadLabel, exact: true })).toHaveCount(0);
  await expect(reopened.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();
  await expectTreatment(reopened);
});

test("an already stored cafard draft using the inspection as predecessor recovers once without losing the presence observation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const initial = await seedTreatmentAndDetection(page);
  await page.goto("/cafards");
  await expect(page.getByRole("article", { name: `Chambre ${room}`, exact: true })).toBeVisible();
  const notes = "Les cafards sont toujours présents. Observation conservée malgré le blocage.";
  const brokenDraft: WorkEntry = {
    ...initial.treatment, id: crypto.randomUUID(), expectedRevision: 1,
    expectedPreviousEventId: initial.inspection.id, cafardObservationId: initial.inspection.id,
    date: today(), occurredAt: new Date().toISOString(), cafardStatus: "signale", notes,
  };
  await putDraft(page, brokenDraft);
  const dialog = await openFollowup(page);
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  let unavailable = true;
  let liveReads = 0;
  await page.route("**/api/hotel?fresh=1", route => {
    liveReads++;
    return unavailable ? route.fulfill({ status: 503, json: { error: "Lecture actuelle indisponible pour ce test." } }) : route.continue();
  });
  await dialog.getByRole("button", { name: reloadLabel, exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Lecture actuelle indisponible pour ce test." })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("radio", { name: "Cafards présents", exact: true })).toHaveAttribute("aria-checked", "true");
  await expectTreatment(dialog);
  expect(liveReads).toBe(1);
  expect((await storedDraft(page))?.id).toBe(brokenDraft.id);

  unavailable = false;
  await dialog.getByRole("button", { name: reloadLabel, exact: true }).click();
  await expect(dialog.getByRole("button", { name: reloadLabel, exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("radio", { name: "Cafards présents", exact: true })).toHaveAttribute("aria-checked", "true");
  await expectTreatment(dialog);
  expect(liveReads).toBe(2);
  const saved = await saveFollowup(page, dialog);
  expect(saved.id).not.toBe(brokenDraft.id);
  expect(saved.expectedPreviousEventId).toBe(initial.treatment.id);
  expect(saved.cafardObservationId).toBe(initial.inspection.id);
  expect(saved.cafardStatus).toBe("signale");
  expect(saved.notes).toBe(notes);
  expect((await state(page)).workEvents).toHaveLength(2);
  await page.reload();
  const reopened = await openFollowup(page);
  await expect(reopened.getByRole("button", { name: reloadLabel, exact: true })).toHaveCount(0);
  await expect(reopened.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();
});

test("a genuinely newer cafard treatment still blocks an older resolution draft and reloads current treatment details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const initial = await seedTreatmentAndDetection(page);
  await page.goto("/cafards");
  let dialog = await openFollowup(page);
  await dialog.getByRole("radio", { name: "Résolu", exact: true }).click();
  const notes = "Observation en cours de rédaction avant la mise à jour du collègue.";
  await dialog.getByLabel("Observations", { exact: true }).fill(notes);
  await expect.poll(async () => (await storedDraft(page))?.notes).toBe(notes);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();

  const newer = await saveEntry(page, {
    ...initial.treatment, id: crypto.randomUUID(), expectedRevision: 1,
    expectedPreviousEventId: initial.treatment.id, cafardObservationId: initial.inspection.id,
    date: today(), occurredAt: new Date().toISOString(), actor: "Autre collègue", cafardStatus: "traite",
    treatedOn: today(), product: "Gel complémentaire", notes: "Nouvelle application documentée par un collègue.",
  });
  if (newer.collection !== "workEvents") throw new Error("Expected a new treatment receipt.");
  await page.reload();
  dialog = await openFollowup(page);
  await expect(dialog.getByRole("radio", { name: "Résolu", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: reloadLabel, exact: true }).click();
  await expect(dialog.getByRole("button", { name: reloadLabel, exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Produit appliqué", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("radio", { name: "Résolu", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expectTreatment(dialog, today(), "Gel complémentaire");
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();

  // The operator can now record a new result using the colleague's current treatment.
  await dialog.getByRole("radio", { name: "Cafards présents", exact: true }).click();
  const saved = await saveFollowup(page, dialog);
  expect(saved.expectedRevision).toBe(2);
  expect(saved.expectedPreviousEventId).toBe(newer.record.id);
  expect(saved.cafardObservationId).toBe(initial.inspection.id);
  expect(saved.cafardStatus).toBe("signale");
  expect(saved.treatedOn).toBe(today());
  expect(saved.product).toBe("Gel complémentaire");
  expect(saved.notes).toBe(notes);
  const after = await state(page);
  expect(after.workEvents).toHaveLength(3);
  expect(after.workEvents?.find(event => event.id === newer.record.id)).toEqual(newer.record);
  expect(after.issues).toHaveLength(0);
});

test("a blocked cafard request cannot be rewritten through draft reload or duplicated by a replacement submission", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const initial = await seedTreatmentAndDetection(page);
  const brokenDraft = workEntrySchema.parse({
    ...initial.treatment, id: crypto.randomUUID(), expectedRevision: 1,
    expectedPreviousEventId: initial.inspection.id, cafardObservationId: initial.inspection.id,
    date: today(), occurredAt: new Date().toISOString(), cafardStatus: "signale",
    notes: "Observation de la demande refusée à conserver sans modification.",
  });
  const refused = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: brokenDraft });
  expect(refused.status()).toBe(409);
  const queued: PendingEntry = { entry: brokenDraft, protocol: 2, attempted: true, blocked: true, blockedReason: "conflict", error: (await refused.json()).error };
  await page.goto("/cafards");
  await expect(page.getByRole("article", { name: `Chambre ${room}`, exact: true })).toBeVisible();
  await putDraft(page, brokenDraft, queued);
  let submissions = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/entries" && request.method() === "POST") submissions++; });
  await page.reload();
  const dialog = await openFollowup(page);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: reloadLabel, exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Cette demande est déjà dans les envois en attente." })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(brokenDraft.notes);
  expect(await storedDraft(page)).toEqual(brokenDraft);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("hotel-work", 1);
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    try {
      return await new Promise<PendingEntry[]>((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const request = transaction.objectStore("records").getAll(IDBKeyRange.bound("queue:", "queue:\uffff"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
  expect(stored).toEqual([queued]);
  expect(submissions).toBe(0);
  expect((await state(page)).workEvents).toEqual([initial.treatment]);
});
