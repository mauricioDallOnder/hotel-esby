import { expect, test, type Page } from "@playwright/test";
import { today } from "../../lib/domain";
import type { WorkEntry } from "../../lib/rooms";
async function login(page: Page) { await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } }); }

test("a mobile checkbox marks a never inspected room free, persists and updates the free filter", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page); await page.goto("/checklist");
  const card = page.getByRole("article", { name: "Chambre 102", exact: true });
  const checkbox = card.getByRole("checkbox", { name: "Chambre 102 occupée", exact: true });
  const markFree = card.getByRole("button", { name: "Marquer libre", exact: true });
  await expect(markFree).toBeVisible();
  await expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  const before = await (await page.request.get("/api/hotel")).json();
  await context.setOffline(true);
  await markFree.click();
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toHaveAttribute("data-indeterminate", "false");
  await expect(card.getByRole("status").getByText("Libre", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Libres :/ }).click();
  await expect(page.getByRole("checkbox", { name: "Chambre 102 occupée", exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => (await (await page.request.get("/api/hotel?refresh=1")).json()).workEvents?.filter((e: WorkEntry) => e.kind === "roomAvailability" && e.room === "102").length).toBe(1);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect(card.getByRole("status").getByText("Libre", { exact: true })).toBeVisible();
  const after = await (await page.request.get("/api/hotel")).json();
  expect(after.roomInspections?.length || 0).toBe(before.roomInspections?.length || 0);
  expect(after.issues.length).toBe(before.issues.length);
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("family comments can be edited and added on different dates while retaining the original", async ({ page }) => {
  await login(page);
  const id = crypto.randomUUID();
  expect((await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: { type: "createFamilyEvent", id, date: today(), room: "205", family: "Famille historique", actor: "Marie", notes: "Retour lundi", kind: "depart", returnDate: "" } })).ok()).toBeTruthy();
  await page.goto("/familles");
  await page.getByLabel("Rechercher une chambre ou une famille").fill("Famille historique");
  await page.getByRole("button", { name: "Modifier le commentaire", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Commentaire/).fill("Retour mardi");
  await dialog.getByLabel("Votre nom").fill("Salima");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByText("Historique des modifications (1)").click();
  await expect(page.getByText("Retour lundi", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ Ajouter un commentaire", exact: true }).click();
  await dialog.getByLabel(/^Commentaire/).fill("Appel de suivi");
  await dialog.getByLabel("Date du commentaire").fill("2026-10-01");
  await dialog.getByLabel("Votre nom").fill("Marie");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("01/10/2026 · Marie", { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get("/api/hotel?refresh=1")).json()).workEvents?.filter((e: WorkEntry) => e.familyEventId === id).length).toBe(2);
  await page.reload();
  await expect(page.getByText("Appel de suivi", { exact: true })).toBeVisible();
  await expect(page.getByText("Retour mardi", { exact: true })).toBeVisible();
});

test("daily tasks support offline add, check and edit, ordered synchronization and deletion", async ({ page, context }) => {
  await login(page); await page.goto("/rondes");
  await expect(page).toHaveURL(/\/quotidien$/);
  await expect(page.getByRole("link", { name: "Ronde quotidienne", exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await page.getByLabel("Que faut-il faire ?").fill("Préparer les clés test");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByRole("checkbox", { name: "Terminer : Préparer les clés test", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Terminer : Préparer les clés test", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^À faire/).fill("Préparer les clés et badges test");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await context.setOffline(false);
  await expect.poll(async () => (await (await page.request.get("/api/hotel?refresh=1")).json()).workEvents?.filter((e: WorkEntry) => e.kind === "dailyTask").length).toBe(3);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Terminer : Préparer les clés et badges test", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Terminer : Préparer les clés et badges test", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get("/api/hotel?refresh=1")).json()).workEvents?.some((e: WorkEntry) => e.kind === "dailyTask" && e.deleted)).toBe(true);
  await page.reload();
  await expect(page.getByText("Préparer les clés et badges test", { exact: true })).toHaveCount(0);
});


test("a second availability click is stored while the first server request is still waiting", async ({ page }) => {
  await login(page); await page.goto("/checklist");
  const first = page.getByRole("checkbox", { name: "Chambre 103 occupée", exact: true });
  const second = page.getByRole("checkbox", { name: "Chambre 104 occupée", exact: true });
  await expect(first).toHaveAttribute("aria-checked", "mixed");
  await expect(second).toHaveAttribute("aria-checked", "mixed");
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/entries", async route => { await waiting; await route.continue(); }, { times: 1 });
  try {
    await first.click();
    await expect(first).toBeChecked();
    await second.click();
    await expect(second).toBeChecked({ timeout: 3000 });
  } finally { release(); }
  await expect.poll(async () => (await (await page.request.get("/api/hotel?refresh=1")).json()).workEvents?.filter((e: WorkEntry) => e.kind === "roomAvailability" && ["103", "104"].includes(e.room)).length).toBe(2);
});
