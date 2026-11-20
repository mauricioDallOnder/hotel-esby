import { expect, test, type Page } from "./fixtures";
import { today, type State } from "../../lib/domain";
import { roomChecks, type RoomEntry } from "../../lib/rooms";
import { roomReceipt, workReceipt } from "./helpers/receipts";

function obstructedRadiator(date: string): RoomEntry {
  return { type: "createRoomInspection", id: crypto.randomUUID(), schemaVersion: 6, room: "114", date,
    inspectedAt: date + "T08:00:00.000Z", actor: "Test tournée", notes: "", occupied: true,
    condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non",
    microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: check.key === "radiator_clear" ? "probleme" : "ok" })) };
}

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

test("completed rooms count towards coverage and the floor shortcut opens just the rooms left to cover", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const inspection = obstructedRadiator(today());
  const save = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: inspection });
  expect(save.status(), await save.text()).toBe(200);
  await page.goto("/checklist");
  const coverage = page.getByRole("region", { name: "Couverture par étage" });
  await expect(coverage).toContainText("1 / 85");
  const card = page.getByRole("article", { name: "Chambre 114", exact: true });
  await expect(card.getByText("Fait", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer la tournée · chambre 101" })).toBeVisible();
  await expect(page.getByText(/risque d.incendie/i)).toHaveCount(0);
  await coverage.getByRole("button", { name: "Voir les 22 chambres à couvrir · 1er étage", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(22);
  await expect(page.getByRole("article", { name: "Chambre 201", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", {name: "Imprimer le checklist (PDF)"}).click();
  const print = page.getByRole("dialog", {name: "Imprimer le checklist des chambres"});
  await print.getByRole("radio", {name: "Feuille de tournée du jour (14)"}).check();
  const download = page.waitForEvent("download");
  await print.getByRole("button", {name: "Télécharger le PDF"}).click();
  expect((await download).suggestedFilename()).toBe(`tournee-chambres-${inspection.date}.pdf`);
  const data: State = await (await page.request.get("/api/hotel?fresh=1")).json();
  expect(data.issues.find(issue => issue.id === inspection.id)?.status).toBe("ouvert");
});

test("a works room stays outside coverage and can be inspected manually by number", async ({ page }) => {
  const day = today();
  const inspection = roomReceipt(obstructedRadiator(day));
  await login(page);
  await page.route("**/api/hotel*", route => route.fulfill({ json: {
    mode: "local", inspections: [], familyEvents: [], roomInspections: [inspection.record], issues: [inspection.issue!],
    workEvents: [workReceipt({ type: "createWorkEvent", id: crypto.randomUUID(), kind: "roomAvailability",
      targetId: "114", room: "114", expectedRevision: 0, expectedPreviousEventId: null, free: true,
      vacancyReason: "works", notes: "", actor: "Test", date: day, occurredAt: day + "T10:00:00.000Z" })],
  } }));
  await page.goto("/checklist");
  await expect(page.getByRole("region", { name: "Couverture par étage" })).toContainText("0 / 84");
  await expect(page.getByRole("button", { name: "Ouvrir la chambre 114 dans la tournée" })).toHaveCount(0);
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("114");
  await page.getByRole("button", { name: "Contrôle manuel de la chambre 114", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Chambre 114");
  await expect(dialog.getByRole("button", { name: "Reporter à demain", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radiogroup", { name: "Chauffage / radiateur", exact: true })).toBeVisible();
});
