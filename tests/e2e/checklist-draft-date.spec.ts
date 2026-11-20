import { expect, test, type Page } from "./fixtures";
import { displayDate, today, type State } from "../../lib/domain";
import { roomChecks, type RoomEntry } from "../../lib/rooms";

const day = today();
const priorDay = today(new Date(Date.parse(day + "T12:00:00Z") - 7 * 86_400_000));
const clutter = "Chambre encombrée d’affaires";

function visit(date: string): RoomEntry {
  return {
    type: "createRoomInspection", schemaVersion: 7, id: crypto.randomUUID(), room: "314", date,
    actor: "Agent de test", notes: "Observation de test", condition: "bon", occupied: true, cleaning: null,
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non",
    checks: roomChecks.map(check => ({ key: check.key, result: check.key === "room_clutter" ? "probleme" : "ok" })),
    problemDetails: [{ key: "room_clutter", problemType: "room_cluttered" }], photosData: [],
  };
}

async function seedDraft(page: Page, entry: RoomEntry) {
  await page.evaluate(async draft => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("hotel-work", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("records");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        tx.objectStore("records").put(draft, "draft:room:314");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, entry);
}

async function openChecklist(page: Page) {
  await page.clock.setFixedTime(new Date(day + "T12:00:00Z"));
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  await page.goto("/checklist");
  await expect(page.getByRole("button", { name: "Contrôler la chambre 314", exact: true })).toBeVisible();
}

async function savePriorVisit(page: Page, prior: RoomEntry) {
  const response = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: prior });
  expect(response.status(), await response.text()).toBe(200);
  await page.reload();
}

for (const visitToday of [true, false]) {
  test(`a seven-day-old 314 draft saves the explicitly selected ${visitToday ? "current" : "historical"} visit day`, async ({ page }) => {
    await openChecklist(page);
    const prior = visit(priorDay);
    await savePriorVisit(page, prior);
    const draft = visit(priorDay);
    draft.notes = "Les mêmes affaires encombrent toujours la chambre.";
    draft.photosData = [await page.evaluate(() => document.createElement("canvas").toDataURL("image/jpeg"))];
    draft.inspectedAt = priorDay + "T15:15:00.000Z";
    await seedDraft(page, draft);
    await page.getByRole("button", { name: "Contrôler la chambre 314", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const room = page.getByRole("article", { name: "Chambre 314", exact: true });
    await expect(dialog.getByText(/Quel jour avez-vous effectué la visite/)).toBeVisible();
    await dialog.getByRole("button", { name: "3. Résumé", exact: true }).click();
    const save = dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true });
    await save.click();
    await expect(dialog.getByText(/Confirmez la date de cette visite/)).toBeVisible();
    await dialog.getByRole("button", { name: visitToday ? /^Visite d’aujourd’hui/ : /^Garder le / }).click();
    await expect(dialog.getByLabel("Observations et problèmes constatés", { exact: true })).toHaveValue(draft.notes);
    await expect(dialog.getByRole("img", { name: "Photo du contrôle 1" })).toHaveCount(1);
    await expect(dialog.getByText("Élément suivi · " + clutter, { exact: true })).toBeVisible();
    const posted = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
    await (visitToday ? dialog.getByRole("button", { name: /^Enregistrer et passer à/ }) : save).click();
    const response = await posted;
    expect(response.status(), await response.text()).toBe(200);
    await page.reload();
    const data: State = await (await page.request.get("/api/hotel?fresh=1")).json();
    expect(data.roomInspections).toHaveLength(2);
    expect(data.issues).toHaveLength(1);
    const added = data.roomInspections!.find(record => record.id !== prior.id)!;
    expect(added.date).toBe(visitToday ? day : priorDay);
    expect(added.checks).toEqual(draft.checks);
    expect(added.notes).toBe(draft.notes);
    expect(added.photoIds).toHaveLength(1);
    expect(added.issueAssociations).toEqual([expect.objectContaining({ key: "room_clutter", issueId: prior.id, outcome: "present" })]);
    expect(data.issues[0].history.filter(event => event.inspectionId === added.id)).toHaveLength(1);
    if (visitToday) {
      expect(added.id).not.toBe(draft.id);
      expect(today(new Date(added.inspectedAt!))).toBe(day);
      await expect(room.getByText("Fait", { exact: true })).toBeVisible();
      await page.getByRole("group", { name: "Filtrer les contrôles" }).getByRole("button", { name: /À contrôler/ }).click();
      await expect(room).toHaveCount(0);
    } else {
      expect(added.id).toBe(draft.id);
      expect(added.inspectedAt).toBe(draft.inspectedAt);
      await expect(room).toBeVisible();
      await expect(room.getByText("Fait", { exact: true })).toHaveCount(0);
    }
  });
}

test("an already submitted draft opens a blank new control only on explicit request", async ({ page }) => {
  await openChecklist(page);
  const prior = visit(priorDay);
  await savePriorVisit(page, prior);
  await seedDraft(page, prior);
  await page.getByRole("button", { name: "Contrôler la chambre 314", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/figure déjà dans les enregistrements/)).toBeVisible();
  await dialog.getByRole("button", { name: "Commencer un nouveau contrôle", exact: true }).click();
  await expect(dialog).toContainText(displayDate(day));
  await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
});

test("crossing midnight requires a date choice before the next timer tick", async ({ page }) => {
  await openChecklist(page);
  await seedDraft(page, visit(day));
  await page.getByRole("button", { name: "Contrôler la chambre 314", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "3. Résumé", exact: true }).click();
  const afterMidnight = new Date(day + "T23:00:01Z");
  await page.clock.setFixedTime(afterMidnight);
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Visite d’aujourd’hui · " + displayDate(today(afterMidnight)), exact: true })).toBeVisible();
  const data: State = await (await page.request.get("/api/hotel?fresh=1")).json();
  expect(data.roomInspections || []).toHaveLength(0);
});
