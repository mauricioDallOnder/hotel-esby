import { expect, test, type Page } from "./fixtures";
import { today, type State } from "../../lib/domain";
import { roomChecks, type RoomEntry } from "../../lib/rooms";
import { roomReceipt, workReceipt } from "./helpers/receipts";

function control(date: string, at: string, obstructed: boolean): RoomEntry {
  return { type: "createRoomInspection", id: crypto.randomUUID(), schemaVersion: 6, room: "114", date,
    inspectedAt: at, actor: "Test sécurité", notes: "Contrôle fictif du radiateur.", occupied: true,
    condition: "bon", cleaning: null, carpet: "ok", carpetNotes: "", microwave: "non",
    microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: obstructed && check.key === "radiator_clear" ? "probleme" : "ok" })) };
}
async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}
async function save(page: Page, entry: RoomEntry) {
  const response = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: entry });
  expect(response.status(), await response.text()).toBe(200);
}
async function onePerDay(page: Page) {
  await page.getByRole("button", { name: "Régler", exact: true }).click();
  await page.getByLabel("Objectif quotidien", { exact: true }).fill("1");
  await expect(page.getByLabel("Objectif quotidien", { exact: true })).toHaveValue("1");
}
function refresh(page: Page) {
  return page.getByRole("region", { name: "État des enregistrements", exact: true }).getByRole("button", { name: "Actualiser", exact: true }).click();
}
async function plannedRooms(page: Page) {
  return page.getByRole("group", { name: "Chambres de la tournée", exact: true }).getByRole("button")
    .evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")!.match(/\d+/)![0]));
}

test("a saved obstructed radiator immediately becomes a persistent priority after today's complete inspection and goal", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const day = today();
  const unsafe = control(day, new Date(Date.now() - 60000).toISOString(), true);
  await save(page, unsafe);
  await page.goto("/checklist");
  await expect(page.getByRole("alert", { name: "Priorités incendie", exact: true })).toBeVisible();
  await onePerDay(page);
  await expect.poll(() => plannedRooms(page)).toEqual(["114"]);
  const card = page.getByRole("article", { name: "Chambre 114", exact: true });
  await expect(card).toContainText("Risque d’incendie · radiateur encombré · contrôle urgent");
  await expect(card.getByText("Fait", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Contrôle urgent · chambre 114", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Objectif du jour", exact: true })).toHaveAttribute("aria-valuenow", "100");

  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("999");
  await page.getByRole("button", { name: "Voir les chambres à risque", exact: true }).click();
  await expect(page.getByLabel("Rechercher une chambre", { exact: true })).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card).toBeVisible();
  await page.getByRole("group", { name: "Filtrer les contrôles", exact: true }).getByRole("button", { name: "À contrôler", exact: true }).click();
  await expect(card).toBeVisible();
  await page.reload();
  await expect.poll(() => plannedRooms(page)).toEqual(["114"]);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("radiator-fire-priority-mobile.png"), animations: "disabled" });

  const clear = control(day, new Date().toISOString(), false);
  await save(page, clear);
  await refresh(page);
  await expect(page.getByRole("alert", { name: "Priorités incendie", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Contrôle urgent · chambre 114", exact: true })).toHaveCount(0);
  await expect(card.getByText("Fait", { exact: true })).toBeVisible();
  const state: State = await (await page.request.get("/api/hotel?fresh=1")).json();
  expect(state.roomInspections!.filter(record => record.room === "114")).toHaveLength(2);
  expect(state.issues).toHaveLength(1);
  expect(state.issues[0].id).toBe(unsafe.id);
  expect(state.issues[0].status).toBe("ouvert");
  // A safety recheck changes rotation only; it never closes or rewrites a technical issue.
});

test("a works room stays urgent until a newer Libre control and bulk OK cannot clear the radiator even without an open issue", async ({ page }, testInfo) => {
  const day = "2026-11-11";
  await page.clock.setFixedTime(new Date(`${day}T12:00:00.000Z`));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  const unsafe = roomReceipt(control(day, `${day}T09:00:00.000Z`, true));
  const data: State & { mode: "local" } = {
    mode: "local", inspections: [], familyEvents: [], roomInspections: [unsafe.record],
    issues: [{ ...unsafe.issue!, status: "resolu", version: 2 }],
    workEvents: [workReceipt({ type: "createWorkEvent", id: crypto.randomUUID(), kind: "roomAvailability",
      targetId: "114", room: "114", expectedRevision: 0, expectedPreviousEventId: null, free: true,
      vacancyReason: "works", notes: "Travaux fictifs.", actor: "Test occupation", date: day,
      occurredAt: `${day}T10:00:00.000Z` })],
  };
  await page.route("**/api/hotel*", route => route.fulfill({ json: data }));
  await page.goto("/checklist");
  const card = page.getByRole("article", { name: "Chambre 114", exact: true });
  await expect(card).toContainText("En travaux");
  await onePerDay(page);
  await expect.poll(() => plannedRooms(page)).toEqual(["114"]);
  await page.getByRole("button", { name: "Contrôle urgent · chambre 114", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert", { name: "Priorité incendie", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reporter à demain", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  const radiator = dialog.getByRole("radiogroup", { name: "Chauffage / radiateur", exact: true });
  await expect(radiator.getByRole("radio", { name: "Libre", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(radiator.getByRole("radio", { name: "Caché", exact: true })).toHaveAttribute("aria-checked", "false");
  const smoke = dialog.getByRole("radiogroup", { name: "Détecteur de fumée fonctionnel", exact: true });
  await expect(smoke.getByRole("radio", { name: "OK", exact: true })).toHaveAttribute("aria-checked", "true");
  await radiator.getByRole("radio", { name: "Libre", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reporter à demain", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Priorités incendie", exact: true })).toBeVisible();
  // An unsaved draft is not a safety receipt, including after a page reload.
  await page.reload();
  await expect.poll(() => plannedRooms(page)).toEqual(["114"]);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("radiator-fire-priority-mobile-dark.png"), animations: "disabled" });

  data.roomInspections!.push(roomReceipt(control(day, `${day}T12:00:00.000Z`, false)).record);
  await refresh(page);
  await expect(page.getByRole("alert", { name: "Priorités incendie", exact: true })).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuer la tournée · chambre 101", exact: true })).toBeVisible();
  expect(data.workEvents![0].vacancyReason).toBe("works");
});
