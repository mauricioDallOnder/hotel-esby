import { expect, test, type Page } from "@playwright/test";
import { today, type State } from "../../lib/domain";
import { rooms, type WorkEvent } from "../../lib/rooms";
import { workReceipt } from "./helpers/receipts";

async function login(page: Page) {
  const response = await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  expect(response.ok()).toBeTruthy();
}

async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}

test("the mobile occupancy menu keeps unknown rooms separate and synchronizes the occupied checkbox with the checklist", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const before = await state(page);
  await page.goto("/occupation");
  await expect(page.getByRole("checkbox", { name: /^Chambre \d+ occupée$/ })).toHaveCount(85);
  const card = page.getByRole("article", { name: "Chambre 101", exact: true });
  const checkbox = card.getByRole("checkbox", { name: "Chambre 101 occupée", exact: true });
  await expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  await expect(card.getByText("Occupation non renseignée", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Libres :/ }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: /^Toutes :/ }).click();
  await expect(checkbox).toHaveAttribute("aria-checked", "mixed");

  await context.setOffline(true);
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(card.getByRole("status").getByText("Occupée", { exact: true })).toBeVisible();
  await expect(card.getByText(/En attente d’envoi/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await context.setOffline(false);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "101").map(event => event.free)).toEqual([false]);
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(card.getByText(/^Enregistré ·/)).toBeVisible();

  await page.goto("/checklist");
  await expect(page.getByRole("checkbox", { name: "Chambre 101 occupée", exact: true })).toBeChecked();
  await page.goto("/occupation");
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toHaveAttribute("data-indeterminate", "false");
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "101").map(event => event.free)).toEqual([false, true]);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect(card.getByText("Libre", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Enregistré ·/)).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.goto("/checklist");
  await expect(page.getByRole("article", { name: "Chambre 101", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir la chambre 101 dans la tournée", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Chambre 103", exact: true })).toBeVisible();

  const after = await state(page);
  expect(after.roomInspections?.length || 0).toBe(before.roomInspections?.length || 0);
  expect(after.issues.length).toBe(before.issues.length);
});

test("an unknown room can be marked free directly without recording a temporary occupied state", async ({ page }) => {
  await login(page);
  await page.goto("/occupation");
  const card = page.getByRole("article", { name: "Chambre 110", exact: true });
  await expect(card.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  await card.getByRole("button", { name: "Marquer libre", exact: true }).click();
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "110").map(event => event.free)).toEqual([true]);
  await expect(card.getByRole("checkbox")).not.toBeChecked();
  await expect(card.getByRole("checkbox")).toHaveAttribute("data-indeterminate", "false");
  await expect(card.getByRole("status").getByText("Libre", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Marquer libre", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Libres :/ }).click();
  await expect(card).toBeVisible();
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("110");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("occupancy filter counts follow search and floor independently of the selected status, and reset restores all rooms", async ({ page }) => {
  await login(page);
  const availability = (room: string, free: boolean, previous?: WorkEvent): WorkEvent => workReceipt({
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "roomAvailability", targetId: room, room,
    expectedRevision: previous ? previous.expectedRevision + 1 : 0, expectedPreviousEventId: previous?.id || null,
    date: today(), actor: "Test occupation", notes: "", free, occurredAt: `${today()}T08:00:00.000Z`,
  });
  const data = { mode: "local", issues: [], inspections: [], roomInspections: [], workEvents: [
    availability("101", false), availability("102", true), availability("201", false), availability("202", true), availability("302", true),
  ] };
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: data });
  });

  for (const path of ["/occupation", "/checklist"]) {
    await page.goto(path);
    const checklist = path === "/checklist";
    const total = checklist ? 82 : 85;
    const floorTotal = checklist ? 22 : 23;
    const searchTotal = checklist ? 9 : 10;
    const filters = page.getByRole("group", { name: "Filtrer par occupation", exact: true });
    const floors = page.getByRole("group", { name: "Filtrer par étage", exact: true });
    const search = page.getByLabel("Rechercher une chambre", { exact: true });
    const reset = page.getByRole("button", { name: "Réinitialiser les filtres", exact: true });
    await expect(filters.getByRole("button", { name: `Toutes : ${total}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByRole("button", { name: "Occupées : 2", exact: true })).toBeVisible();
    if (checklist) await expect(filters.getByRole("button", { name: /^Libres :/ })).toHaveCount(0);
    else await expect(filters.getByRole("button", { name: "Libres : 3", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Non renseignées : 80", exact: true })).toBeVisible();
    await expect(reset).toBeDisabled();

    await floors.getByRole("button", { name: "1er étage", exact: true }).click();
    await expect(filters.getByRole("button", { name: `Toutes : ${floorTotal}`, exact: true })).toBeVisible();
    await search.fill("10");
    await expect(filters.getByRole("button", { name: `Toutes : ${searchTotal}`, exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Occupées : 1", exact: true })).toBeVisible();
    if (!checklist) await expect(filters.getByRole("button", { name: "Libres : 1", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Non renseignées : 8", exact: true })).toBeVisible();

    const selected = checklist ? "Occupées : 1" : "Libres : 1";
    await filters.getByRole("button", { name: selected, exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article", { name: `Chambre ${checklist ? "101" : "102"}`, exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: `Toutes : ${searchTotal}`, exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Occupées : 1", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: selected, exact: true })).toHaveAttribute("aria-pressed", "true");
    await filters.getByRole("button", { name: "Non renseignées : 8", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(8);
    if (!checklist) await expect(filters.getByRole("button", { name: "Libres : 1", exact: true })).toBeVisible();

    await search.fill("999");
    await expect(filters.getByRole("button", { name: "Toutes : 0", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Occupées : 0", exact: true })).toBeVisible();
    if (!checklist) await expect(filters.getByRole("button", { name: "Libres : 0", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Non renseignées : 0", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article")).toHaveCount(0);
    await reset.click();
    await expect(search).toHaveValue("");
    await expect(floors.getByRole("button", { name: "Tous les étages", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByRole("button", { name: `Toutes : ${total}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article")).toHaveCount(total);
    if (checklist) for (const room of ["102", "202", "302"]) {
      await expect(page.getByRole("article", { name: `Chambre ${room}`, exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Ouvrir la chambre ${room} dans la tournée`, exact: true })).toHaveCount(0);
    }
    await expect(reset).toBeDisabled();
  }

  data.workEvents = [...data.workEvents, ...rooms.map(room => availability(room, true, data.workEvents.find(event => event.room === room)))];
  await page.reload();
  await expect(page.getByText("Toutes les chambres sont marquées libres. Aucune tournée à prévoir.", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Objectif du jour", exact: true })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("button", { name: /^Continuer la tournée/ })).toHaveCount(0);
  await expect(page.getByText(/NaN/)).toHaveCount(0);
  await page.getByRole("button", { name: "Imprimer le checklist (PDF)", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Derniers contrôles des chambres affichées (0)", exact: true })).toBeDisabled();
});
