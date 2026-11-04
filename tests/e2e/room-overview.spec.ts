import { expect, test, type Page } from "@playwright/test";
import type { State } from "../../lib/domain";

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

  await page.getByRole("button", { name: "Libres", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Toutes", exact: true }).click();

  await context.setOffline(true);
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(card.getByText(/Occupée.*En attente d’envoi/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await context.setOffline(false);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "101").map(event => event.free)).toEqual([false]);
  await page.reload();
  await expect(checkbox).toBeChecked();

  await page.goto("/checklist");
  await expect(page.getByRole("checkbox", { name: "Chambre 101 libre", exact: true })).not.toBeChecked();
  await page.goto("/occupation");
  await checkbox.uncheck();
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "101").map(event => event.free)).toEqual([false, true]);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect(card.getByText(/^Libre ·/)).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.goto("/checklist");
  await expect(page.getByRole("checkbox", { name: "Chambre 101 libre", exact: true })).toBeChecked();

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
  await expect(card.getByRole("button", { name: "Marquer libre", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Libres", exact: true }).click();
  await expect(card).toBeVisible();
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("110");
  await expect(page.getByRole("article")).toHaveCount(1);
});
