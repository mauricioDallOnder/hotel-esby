import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { State } from "../../lib/domain";
import { workEntrySchema, type WorkEntry, type WorkEvent } from "../../lib/rooms";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

async function machineEvents(page: Page, machine: string) {
  const state: State = await (await page.request.get("/api/hotel?fresh=1")).json();
  return state.workEvents?.filter(event => event.kind === "laundryCycle" && event.targetId === machine) || [];
}

function receipt(entry: WorkEntry): WorkEvent {
  return { ...entry, version: 1, updatedAt: entry.occurredAt,
    submissionHash: createHash("sha256").update(JSON.stringify(entry)).digest("hex") };
}

function runningCycle(machineId: string, room: string, startedAt: string): WorkEvent {
  return receipt(workEntrySchema.parse({
    type: "createWorkEvent", kind: "laundryCycle", id: crypto.randomUUID(), targetId: machineId,
    expectedRevision: 0, room, date: startedAt.slice(0, 10), occurredAt: startedAt,
    actor: "Agent de démonstration", notes: "", laundryCycleId: crypto.randomUUID(),
    laundryOwner: "Repère fictif " + room, laundryStartedAt: startedAt, laundryStatus: "en_cours",
    laundryCollectedAt: null, laundryCollectedBy: "",
  }));
}

test("staff can start, reload, collect and find a laundry cycle on mobile", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/occupation");
  await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  await page.getByRole("link", { name: "Lingerie", exact: true }).click();
  await expect(page).toHaveURL(/\/lingerie$/);
  await expect(page.getByRole("heading", { name: "Lingerie", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(6);
  const machine = page.getByRole("article", { name: "Machine à laver 1", exact: true });
  await expect(machine).toContainText("18 kg");
  await expect(machine).toContainText("Rapide 40 · 40 min");
  await expect(page.getByRole("article", { name: "Machine à laver 2", exact: true })).toContainText("Rapide 30 · 30 min");
  await expect(page.getByRole("article", { name: "Machine à sécher 3", exact: true })).toContainText("1 h 20");
  await machine.getByRole("button", { name: "Démarrer", exact: true }).click();
  const start = page.getByRole("dialog", { name: "Démarrer · Machine à laver 1", exact: true });
  await start.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(start).toContainText("Choisissez la chambre du linge.");
  await start.getByLabel(/^Chambre/).selectOption("101");
  await start.getByLabel("Nom ou repère du linge (facultatif)", { exact: true }).fill("Sac bleu de démonstration");
  await start.getByLabel(/^Votre nom/).fill("Agent lavage test");
  await start.getByRole("button", { name: "Fermer", exact: true }).click();
  await machine.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(start.getByLabel(/^Chambre/)).toHaveValue("101");
  await expect(start.getByLabel("Nom ou repère du linge (facultatif)", { exact: true })).toHaveValue("Sac bleu de démonstration");
  await start.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(start).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-1")).length).toBe(1);
  const original = (await machineEvents(page, "washer-1"))[0];
  expect(original.room).toBe("101");
  expect(original.laundryStatus).toBe("en_cours");
  expect(original.laundryStartedAt).toBe(original.occurredAt);
  expect(original.laundryCollectedAt).toBeNull();
  expect(original.laundryCollectedBy).toBe("");
  await expect(machine).toContainText("Sac bleu de démonstration");
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(machine).toContainText("101");
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText(/^(39|40):\d{2}$/);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("laundry-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);
  await page.screenshot({ path: test.info().outputPath("laundry-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });

  await machine.getByRole("button", { name: "Linge récupéré", exact: true }).click();
  const collect = page.getByRole("dialog", { name: "Récupérer le linge · Machine à laver 1", exact: true });
  await expect(collect).toContainText("après avoir retiré tout le linge");
  await expect(collect.getByLabel(/^Votre nom/)).toHaveValue("Agent lavage test");
  await collect.getByLabel(/^Votre nom/).fill("Agent récupération test");
  await collect.getByRole("button", { name: "Confirmer la récupération", exact: true }).click();
  await expect(collect).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-1")).length).toBe(2);
  const recovered = (await machineEvents(page, "washer-1"))[1];
  expect(recovered.laundryCycleId).toBe(original.laundryCycleId);
  expect(recovered.laundryStartedAt).toBe(original.laundryStartedAt);
  expect(recovered.laundryStatus).toBe("recupere");
  expect(recovered.laundryCollectedAt).toBe(recovered.occurredAt);
  expect(Date.parse(recovered.laundryCollectedAt!)).toBeGreaterThanOrEqual(Date.parse(original.laundryStartedAt!));
  expect(recovered.laundryCollectedBy).toBe("Agent récupération test");
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.getByLabel("Rechercher du linge", { exact: true }).fill("sac bleu");
  await page.getByLabel("État du cycle", { exact: true }).selectOption("collected");
  const history = page.getByRole("article", { name: /^Machine à laver 1 · chambre 101/ });
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(history).toContainText("Agent lavage test");
  await expect(history).toContainText("Linge récupéré le");
  await expect(history).toContainText("Agent récupération test");
  await page.getByLabel("Démarré à partir du", { exact: true }).fill("2099-01-01");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(history).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("laundry-history-mobile.png"), fullPage: true, animations: "disabled" });
});

test("absolute timers cross ten minutes and zero without freeing a machine or confusing the two number 3 labels", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2025-06-08T09:00:00.000Z"));
  await login(page);
  const workEvents = [
    runningCycle("washer-2", "201", "2025-06-08T08:40:01.000Z"),
    runningCycle("washer-3", "202", "2025-06-08T08:29:00.000Z"),
    runningCycle("dryer-3", "203", "2025-06-08T08:29:00.000Z"),
  ];
  await page.route("**/api/hotel*", route => route.fulfill({ json: { mode: "local", issues: [], inspections: [], roomInspections: [], familyEvents: [], workEvents } }));
  await page.goto("/lingerie");
  const machine = page.getByRole("article", { name: "Machine à laver 2", exact: true });
  const washer3 = page.getByRole("article", { name: "Machine à laver 3", exact: true });
  const dryer3 = page.getByRole("article", { name: "Machine à sécher 3", exact: true });
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText("10:01");
  await expect(machine.getByText("En cours", { exact: true })).toBeVisible();
  await expect(washer3).toContainText("202");
  await expect(washer3.getByText("À récupérer", { exact: true })).toBeVisible();
  await expect(washer3.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await expect(dryer3).toContainText("203");
  await expect(dryer3.getByLabel("Temps restant", { exact: true })).toHaveText("49:00");

  await page.clock.setFixedTime(new Date("2025-06-08T09:00:01.000Z"));
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText("10:00");
  await expect(machine.getByText("Bientôt terminé", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date("2025-06-08T09:10:01.000Z"));
  await expect(machine.getByText("À récupérer", { exact: true })).toBeVisible();
  await expect(machine.getByLabel("Temps écoulé", { exact: true })).toHaveText("Terminé");
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await expect(machine.getByRole("button", { name: "Linge récupéré", exact: true })).toBeVisible();
  await page.reload();
  await expect(machine.getByText("À récupérer", { exact: true })).toBeVisible();
  await expect(dryer3.getByLabel("Temps restant", { exact: true })).toHaveText("38:59");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("laundry-ready-mobile.png"), fullPage: true, animations: "disabled" });
  expect(workEvents.every(event => event.laundryStatus === "en_cours")).toBe(true);
});

test("an offline start and explicit cancellation survive a lost receipt without duplicate cycles", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/lingerie");
  const machine = page.getByRole("article", { name: "Machine à laver 2", exact: true });
  await machine.getByRole("button", { name: "Démarrer", exact: true }).click();
  const start = page.getByRole("dialog", { name: "Démarrer · Machine à laver 2", exact: true });
  await start.getByLabel(/^Chambre/).selectOption("202");
  await start.getByLabel("Nom ou repère du linge (facultatif)", { exact: true }).fill("Sac vert hors connexion");
  await start.getByLabel(/^Votre nom/).fill("Agent hors connexion");
  await context.setOffline(true);
  await start.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(start).toHaveCount(0);
  await expect(machine).toContainText("En attente d’envoi");
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText(/^(29|30):\d{2}$/);
  await machine.getByRole("button", { name: "Annuler le cycle", exact: true }).click();
  const cancel = page.getByRole("dialog", { name: "Annuler le cycle · Machine à laver 2", exact: true });
  await expect(cancel).toContainText("arrêtée et vide");
  await cancel.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await machine.getByRole("button", { name: "Annuler le cycle", exact: true }).click();
  await cancel.getByLabel(/^Votre nom/).fill("Agent annulation test");
  await cancel.getByRole("button", { name: "Confirmer l’annulation", exact: true }).click();
  await expect(cancel).toHaveCount(0);
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.getByLabel("Rechercher du linge", { exact: true }).fill("sac vert");
  const history = page.getByRole("article", { name: /^Machine à laver 2 · chambre 202/ });
  await expect(history).toContainText("Annulé");
  await expect(history).toContainText("Agent annulation test");
  await expect(history).toContainText("En attente d’envoi");

  let acceptWrites = false, lostReceipt = false;
  await page.route("**/api/entries", async route => {
    if (route.request().method() !== "POST" || acceptWrites) return route.continue();
    if (!lostReceipt) {
      lostReceipt = true;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
    }
    await route.abort("internetdisconnected");
  });
  await context.setOffline(false);
  await expect.poll(async () => (await machineEvents(page, "washer-2")).length).toBe(1);
  const original = (await machineEvents(page, "washer-2"))[0];
  await page.reload();
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.getByLabel("Rechercher du linge", { exact: true }).fill("sac vert");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(history).toContainText("Annulé");
  await expect(history).toContainText("En attente d’envoi");
  acceptWrites = true;
  await page.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  await expect.poll(async () => (await machineEvents(page, "washer-2")).map(event => event.expectedRevision)).toEqual([0, 1]);
  await expect(history.getByText("En attente d’envoi", { exact: true })).toHaveCount(0);
  const recorded = await machineEvents(page, "washer-2");
  expect(recorded[0]).toEqual(original);
  expect(recorded[1].laundryCycleId).toBe(original.laundryCycleId);
  expect(recorded[1].laundryStatus).toBe("annule");
  expect(recorded[1].laundryCollectedAt).toBeNull();
  expect(recorded[1].laundryCollectedBy).toBe("");
  await page.reload();
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.getByLabel("État du cycle", { exact: true }).selectOption("cancelled");
  await expect(history).toContainText("Agent hors connexion");
  await expect(history).toContainText("Agent annulation test");
});
