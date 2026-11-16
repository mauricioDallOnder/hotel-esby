import { expect, test, type Locator, type Page } from "./fixtures";
import { today, type State } from "../../lib/domain";
import type { WorkEntry, WorkEvent } from "../../lib/rooms";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}

function vacancyDialog(page: Page, room: string) {
  return page.getByRole("dialog", { name: `Disponibilité · chambre ${room}`, exact: true });
}

async function seedAvailability(page: Page, room: string, free: boolean, options: {
  vacancyReason?: WorkEntry["vacancyReason"];
  notes?: string;
  previous?: WorkEvent;
} = {}): Promise<WorkEvent> {
  const entry: WorkEntry = {
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "roomAvailability", targetId: room, room,
    expectedRevision: options.previous ? options.previous.expectedRevision + 1 : 0,
    expectedPreviousEventId: options.previous?.id || null, date: today(), actor: "Test occupation",
    notes: options.notes || "", occurredAt: new Date().toISOString(), free,
    ...(options.vacancyReason ? { vacancyReason: options.vacancyReason } : {}),
  };
  const response = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: entry });
  const result = await response.json();
  expect(response.status(), JSON.stringify(result)).toBe(200);
  return result.record;
}

async function saveDialog(page: Page, dialog: Locator): Promise<WorkEvent> {
  const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const response = await sent;
  const result = await response.json();
  expect(response.status(), JSON.stringify(result)).toBe(200);
  await expect(dialog).toHaveCount(0);
  return result.record;
}

async function deviceVacancyDraft(page: Page, room: string, entry?: WorkEntry): Promise<WorkEntry | undefined> {
  return page.evaluate(async ({ room, entry }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("hotel-work", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("records");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      return await new Promise<WorkEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("records", entry ? "readwrite" : "readonly");
        const store = transaction.objectStore("records");
        const key = "draft:room-availability:" + room;
        const request = entry ? store.put(entry, key) : store.get(key);
        transaction.oncomplete = () => resolve(entry || request.result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, { room, entry });
}

test("mobile occupancy distinguishes works from available rooms, keeps the note and clears vacancy details when occupied again", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  const occupied = await seedAvailability(page, "226", false);
  // Existing records without a reason remain available, without a data migration.
  const legacyFree = await seedAvailability(page, "227", true);
  await page.goto("/occupation");
  const card = page.getByRole("article", { name: "Chambre 226", exact: true });
  const checkbox = card.getByRole("checkbox", { name: "Chambre 226 occupée", exact: true });
  await expect(checkbox).toBeChecked();
  await expect(card.getByText("Occupée", { exact: true })).toBeVisible();
  await checkbox.click();
  const dialog = vacancyDialog(page, "226");
  await dialog.getByRole("radio", { name: "En travaux", exact: true }).click();
  const notes = "Remplacement du radiateur. Attendre la fin des travaux avant attribution.";
  await dialog.getByLabel("Observation (facultative)", { exact: true }).fill(notes);
  // Choosing a reason and cancelling must never publish a temporary free state.
  expect((await state(page)).workEvents).toEqual([occupied, legacyFree]);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(checkbox).toBeChecked();
  expect((await state(page)).workEvents).toEqual([occupied, legacyFree]);

  await checkbox.click();
  await dialog.getByRole("radio", { name: "En travaux", exact: true }).click();
  await dialog.getByLabel("Observation (facultative)", { exact: true }).fill(notes);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("room-vacancy-dialog-mobile-dark.png"), animations: "disabled" });
  const works = await saveDialog(page, dialog);
  expect(works).toMatchObject({ free: true, vacancyReason: "works", notes, expectedPreviousEventId: occupied.id, expectedRevision: 1 });
  await expect(checkbox).not.toBeChecked();
  await expect(card.getByText("En travaux", { exact: true })).toBeVisible();
  await expect(card.getByText(notes, { exact: true })).toBeVisible();
  const filters = page.getByRole("group", { name: "Filtrer par occupation", exact: true });
  await expect(filters.getByRole("button", { name: "Occupées : 0", exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "En travaux : 1", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card).toBeVisible();
  await filters.getByRole("button", { name: "Libres : 1", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Chambre 227", exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText(notes, { exact: true })).toBeVisible();
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("226");
  await expect(filters.getByRole("button", { name: "En travaux : 1", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Libres : 0", exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("room-vacancy-card-mobile-dark.png"), animations: "disabled" });

  await page.goto("/checklist");
  for (const room of ["226", "227"]) {
    await expect(page.getByRole("article", { name: `Chambre ${room}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Ouvrir la chambre ${room} dans la tournée`, exact: true })).toHaveCount(0);
  }
  await page.goto("/occupation");
  await card.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "En travaux", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Observation (facultative)", { exact: true })).toHaveValue(notes);
  await dialog.getByRole("radio", { name: "Libre", exact: true }).click();
  await dialog.getByLabel("Observation (facultative)", { exact: true }).fill("Travaux terminés, chambre prête.");
  const available = await saveDialog(page, dialog);
  expect(available).toMatchObject({ free: true, vacancyReason: "available", expectedPreviousEventId: works.id, expectedRevision: 2 });
  await expect(card.getByText("Libre", { exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Libres : 2", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "En travaux : 0", exact: true })).toBeVisible();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(card.getByText("Occupée", { exact: true })).toBeVisible();
  await expect(card.getByText("Travaux terminés, chambre prête.", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.room === "226").length).toBe(4);
  const after = await state(page);
  const history = after.workEvents!.filter(event => event.room === "226");
  expect(history.map(event => event.free)).toEqual([false, true, true, false]);
  expect(history[3].vacancyReason).toBeUndefined();
  expect(history[3].notes).toBe("");
  expect(history[1]).toEqual(works);
  expect(after.issues).toHaveLength(0);
  expect(after.roomInspections || []).toHaveLength(0);
  await page.goto("/checklist");
  await expect(card).toBeVisible();
});

test("an unknown room can be marked under works offline without a temporary available event and keeps its note after synchronization", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/occupation");
  const card = page.getByRole("article", { name: "Chambre 231", exact: true });
  await expect(card.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  await card.getByRole("button", { name: "Marquer libre", exact: true }).click();
  const dialog = vacancyDialog(page, "231");
  await dialog.getByRole("radio", { name: "En travaux", exact: true }).click();
  const notes = "Peinture en cours. Laisser sécher avant le retour des occupants.";
  await dialog.getByLabel("Observation (facultative)", { exact: true }).fill(notes);
  await context.setOffline(true);
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole("checkbox")).not.toBeChecked();
  await expect(card.getByRole("checkbox")).toHaveAttribute("data-indeterminate", "false");
  await expect(card.getByText("En travaux", { exact: true })).toBeVisible();
  await expect(card.getByText(notes, { exact: true })).toBeVisible();
  await expect(card.getByText(/En attente d’envoi/)).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.room === "231").length).toBe(1);
  const event = (await state(page)).workEvents!.find(event => event.room === "231")!;
  expect(event).toMatchObject({ free: true, vacancyReason: "works", notes, expectedRevision: 0, expectedPreviousEventId: null });
  await page.reload();
  await expect(card.getByText("En travaux", { exact: true })).toBeVisible();
  await expect(card.getByText(notes, { exact: true })).toBeVisible();
  await expect(card.getByText(/^Enregistré ·/)).toBeVisible();
  await expect(page.getByRole("button", { name: "En travaux : 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Libres : 0", exact: true })).toBeVisible();
});

test("a concurrent room availability update requires a fresh review without erasing the chosen reason or observation", async ({ page }) => {
  await login(page);
  const previous = await seedAvailability(page, "320", true, { vacancyReason: "works", notes: "Radiateur à remplacer." });
  await page.goto("/occupation");
  const card = page.getByRole("article", { name: "Chambre 320", exact: true });
  await expect(card.getByText("En travaux", { exact: true })).toBeVisible();
  // A normal refresh can complete while another colleague has a dialog open.
  let release!: () => void;
  const heldRead = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/hotel?fresh=1", async route => { await heldRead; await route.continue(); }, { times: 1 });
  await page.getByRole("region", { name: "État des enregistrements", exact: true }).getByRole("button", { name: "Actualiser", exact: true }).click();
  await card.getByRole("button", { name: "Modifier", exact: true }).click();
  const dialog = vacancyDialog(page, "320");
  const notes = "Radiateur remplacé, vérification finale faite.";
  let colleague: WorkEvent;
  try {
    await dialog.getByRole("radio", { name: "Libre", exact: true }).click();
    await dialog.getByLabel("Observation (facultative)", { exact: true }).fill(notes);
    colleague = await seedAvailability(page, "320", true, { vacancyReason: "works", notes: "Nouveau contrôle demandé par le collègue.", previous });
  } finally { release(); }
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: "Libre", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Observation (facultative)", { exact: true })).toHaveValue(notes);
  expect((await state(page)).workEvents).toHaveLength(2);
  await dialog.getByRole("button", { name: "Recharger la situation actuelle", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("radio", { name: "Libre", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Observation (facultative)", { exact: true })).toHaveValue(notes);
  await expect(dialog).toContainText("Nouveau contrôle demandé par le collègue.");
  const saved = await saveDialog(page, dialog);
  expect(saved).toMatchObject({ vacancyReason: "available", notes, expectedRevision: 2, expectedPreviousEventId: colleague!.id });
  expect((await state(page)).workEvents).toHaveLength(3);
});

test("a retained vacancy draft with a confirmed operation ID preserves different answers until an explicit fresh review and amendment", async ({ page }) => {
  await login(page);
  const original = await seedAvailability(page, "228", true, { vacancyReason: "works", notes: "Travaux encore en cours." });
  await page.goto("/occupation");
  const card = page.getByRole("article", { name: "Chambre 228", exact: true });
  await expect(card.getByText("En travaux", { exact: true })).toBeVisible();
  const notes = "Travaux terminés. Chambre vérifiée et prête pour une nouvelle occupation.";
  const retained: WorkEntry = { ...original, vacancyReason: "available", notes };
  await deviceVacancyDraft(page, "228", retained);
  await card.getByRole("button", { name: "Modifier", exact: true }).click();
  const dialog = vacancyDialog(page, "228");
  await expect(dialog.getByRole("radio", { name: "Libre", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Observation (facultative)", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
  expect((await deviceVacancyDraft(page, "228"))?.id).toBe(original.id);
  expect((await state(page)).workEvents).toEqual([original]);

  await dialog.getByRole("button", { name: "Recharger la situation actuelle", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("radio", { name: "Libre", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Observation (facultative)", { exact: true })).toHaveValue(notes);
  await expect.poll(async () => (await deviceVacancyDraft(page, "228"))?.expectedPreviousEventId).toBe(original.id);
  const recovered = await deviceVacancyDraft(page, "228");
  expect(recovered?.id).not.toBe(original.id);
  expect(recovered).toMatchObject({ expectedRevision: 1, vacancyReason: "available", notes });
  // Reloading only prepares a new amendment; it never saves or replaces history.
  expect((await state(page)).workEvents).toEqual([original]);
  const saved = await saveDialog(page, dialog);
  expect(saved).toMatchObject({ id: recovered!.id, expectedPreviousEventId: original.id, expectedRevision: 1, vacancyReason: "available", notes });
  expect((await state(page)).workEvents).toEqual([original, saved]);
  await page.reload();
  await expect(card.getByText("Libre", { exact: true })).toBeVisible();
  await expect(card.getByText(notes, { exact: true })).toBeVisible();
});
