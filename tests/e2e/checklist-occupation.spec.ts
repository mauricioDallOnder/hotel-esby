import { expect, test, type Page } from "./fixtures";
import { today, type State } from "../../lib/domain";
import { roomChecks, type RoomEntry } from "../../lib/rooms";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}
async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}

test("a room marked free in Occupation leaves every checklist view and returns with its history when occupied again", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const inspection: RoomEntry = {
    type: "createRoomInspection", schemaVersion: 5, id: crypto.randomUUID(), room: "106", date: "2026-10-01",
    inspectedAt: "2026-10-01T09:00:00.000Z", actor: "Test historique occupation", notes: "Observation fictive à conserver.",
    condition: "mauvais", occupied: true, cleaning: null, carpet: "ok", carpetNotes: "",
    microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
  };
  expect((await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: inspection })).ok()).toBeTruthy();
  const original = (await state(page)).roomInspections!.find(record => record.id === inspection.id);
  await page.goto("/checklist");
  await expect(page.getByRole("article", { name: "Chambre 106", exact: true })).toBeVisible();
  // Fair rotation may place never-completed rooms before this overdue room.
  await page.getByRole("group", { name: "Filtrer les contrôles", exact: true }).getByRole("button", { name: "À contrôler", exact: true }).click();
  await expect(page.getByRole("article", { name: "Chambre 106", exact: true })).toBeVisible();
  await page.goto("/occupation");
  const occupied = page.getByRole("checkbox", { name: "Chambre 106 occupée", exact: true });
  await expect(occupied).toBeChecked();
  await occupied.click();
  await expect(occupied).not.toBeChecked();
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "106").map(event => event.free)).toEqual([true]);

  await page.goto("/checklist");
  const hidden = page.getByRole("article", { name: "Chambre 106", exact: true });
  await expect(hidden).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir la chambre 106 dans la tournée", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toutes : 84", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Chambre 107", exact: true }).getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  await expect(page.getByRole("button", { name: /^Libres :/ })).toHaveCount(0);
  for (const filter of ["Tournée du jour", "À contrôler", "Problèmes techniques"]) {
    await page.getByRole("group", { name: "Filtrer les contrôles", exact: true }).getByRole("button", { name: filter, exact: true }).click();
    await expect(hidden).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("106");
  await expect(hidden).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toutes : 0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await page.getByRole("button", { name: "Imprimer le checklist (PDF)", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Derniers contrôles des chambres affichées (84)", exact: true })).toBeEnabled();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Historique de tous les contrôles", exact: true }).click();
  await expect(page.getByRole("button", { name: /Test historique occupation/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("group", { name: "Filtrer par occupation", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("checklist-occupied-rooms-mobile.png") });

  await page.goto("/occupation");
  await expect(occupied).not.toBeChecked();
  await occupied.click();
  await expect(occupied).toBeChecked();
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "106").map(event => event.free)).toEqual([true, false]);
  await page.goto("/checklist");
  await expect(hidden).toBeVisible();
  await expect(page.getByRole("button", { name: "Toutes : 85", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filtrer les contrôles", exact: true }).getByRole("button", { name: "À contrôler", exact: true }).click();
  await expect(hidden).toBeVisible();
  await page.getByRole("button", { name: "Historique de la chambre 106", exact: true }).click();
  await expect(page.getByRole("button", { name: /Test historique occupation/ })).toBeVisible();
  expect((await state(page)).roomInspections!.find(record => record.id === inspection.id)).toEqual(original);
});

test("an accepted offline free change hides the room immediately while a blocked change keeps its last accepted occupation", async ({ page, context }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/checklist");
  const offlineRoom = page.getByRole("article", { name: "Chambre 107", exact: true });
  await expect(offlineRoom.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  const markFree = offlineRoom.getByRole("button", { name: "Marquer libre", exact: true });
  await markFree.scrollIntoViewIfNeeded();
  await expect(markFree).toBeVisible();
  await context.setOffline(true);
  await markFree.click({ timeout: 10000 });
  await expect(offlineRoom).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir la chambre 107 dans la tournée", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toutes : 84", exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "107").map(event => event.free)).toEqual([true]);

  await page.route("**/api/entries", async route => {
    const entry = route.request().postDataJSON();
    if (entry.kind === "roomAvailability" && entry.room === "108") return route.fulfill({ status: 409, json: { error: "Conflit simulé pour ce test." } });
    return route.continue();
  });
  const blockedRoom = page.getByRole("article", { name: "Chambre 108", exact: true });
  const rejected = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.status() === 409);
  await blockedRoom.getByRole("button", { name: "Marquer libre", exact: true }).click();
  await rejected;
  await expect(blockedRoom).toBeVisible();
  await expect(blockedRoom.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  await expect(blockedRoom.getByRole("button", { name: "Vérifier la modification", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voir tous les envois (1)", exact: true }).click();
  const pending = page.getByRole("dialog", { name: "Envois de cet appareil · 1", exact: true });
  await expect(pending).toContainText("Occupation · Ch. 108");
  await expect(pending).toContainText("Conflit simulé pour ce test.");
  await pending.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Toutes : 84", exact: true })).toBeVisible();
  expect((await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "108") || []).toEqual([]);

  // The E2E server is shared across tests; restore eligibility for later flows.
  const previous = (await state(page)).workEvents!.find(event => event.kind === "roomAvailability" && event.room === "107")!;
  expect((await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: {
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "roomAvailability", targetId: "107", room: "107",
    expectedRevision: 1, expectedPreviousEventId: previous.id, date: today(), actor: "Test occupation", notes: "", free: false, occurredAt: new Date().toISOString(),
  } })).ok()).toBeTruthy();
});
