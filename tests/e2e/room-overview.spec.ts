import { expect, test, type Page } from "@playwright/test";
import { today, type State } from "../../lib/domain";
import type { WorkEvent } from "../../lib/rooms";

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
  await expect(page.getByRole("checkbox", { name: "Chambre 101 occupée", exact: true })).not.toBeChecked();

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
  const availability = (room: string, free: boolean): WorkEvent => ({
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "roomAvailability", targetId: room, room,
    expectedRevision: 0, date: today(), actor: "Test occupation", notes: "", free,
    occurredAt: `${today()}T08:00:00.000Z`, updatedAt: `${today()}T08:00:00.000Z`, version: 1, submissionHash: "a".repeat(64),
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
    const filters = page.getByRole("group", { name: "Filtrer par occupation", exact: true });
    const floors = page.getByRole("group", { name: "Filtrer par étage", exact: true });
    const search = page.getByLabel("Rechercher une chambre", { exact: true });
    const reset = page.getByRole("button", { name: "Réinitialiser les filtres", exact: true });
    await expect(filters.getByRole("button", { name: "Toutes : 85", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByRole("button", { name: "Occupées : 2", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Libres : 3", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Non renseignées : 80", exact: true })).toBeVisible();
    await expect(reset).toBeDisabled();

    await floors.getByRole("button", { name: "1er étage", exact: true }).click();
    await expect(filters.getByRole("button", { name: "Toutes : 23", exact: true })).toBeVisible();
    await search.fill("10");
    await expect(filters.getByRole("button", { name: "Toutes : 10", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Occupées : 1", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Libres : 1", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Non renseignées : 8", exact: true })).toBeVisible();

    await filters.getByRole("button", { name: "Libres : 1", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article", { name: "Chambre 102", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Toutes : 10", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Occupées : 1", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Libres : 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await filters.getByRole("button", { name: "Non renseignées : 8", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(8);
    await expect(filters.getByRole("button", { name: "Libres : 1", exact: true })).toBeVisible();

    await search.fill("999");
    await expect(filters.getByRole("button", { name: "Toutes : 0", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Occupées : 0", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Libres : 0", exact: true })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Non renseignées : 0", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article")).toHaveCount(0);
    await reset.click();
    await expect(search).toHaveValue("");
    await expect(floors.getByRole("button", { name: "Tous les étages", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByRole("button", { name: "Toutes : 85", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article")).toHaveCount(85);
    await expect(reset).toBeDisabled();
  }
});
