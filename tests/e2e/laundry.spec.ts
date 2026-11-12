import { expect, test, type Page } from "@playwright/test";
import type { State } from "../../lib/domain";
import { getLaundryMachine } from "../../lib/laundry";
import { workEntrySchema, type WorkEvent } from "../../lib/rooms";
import { workReceipt as receipt } from "./helpers/receipts";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

async function machineEvents(page: Page, machine: string) {
  const state: State = await (await page.request.get("/api/hotel?fresh=1")).json();
  return state.workEvents?.filter(event => event.kind === "laundryCycle" && event.targetId === machine) || [];
}

function runningCycle(machineId: string, room: string, startedAt: string): WorkEvent {
  const machine = getLaundryMachine(machineId)!;
  return receipt(workEntrySchema.parse({
    type: "createWorkEvent", kind: "laundryCycle", id: crypto.randomUUID(), targetId: machineId,
    expectedRevision: 0, expectedPreviousEventId: null, room, date: startedAt.slice(0, 10), occurredAt: startedAt,
    actor: "Agent de démonstration", notes: "", laundryCycleId: crypto.randomUUID(),
    laundryOwner: "Repère fictif " + room, laundryStartedAt: startedAt, laundryStatus: "en_cours",
    laundryEndsAt: new Date(Date.parse(startedAt) + machine.durationMinutes * 60_000).toISOString(),
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
  await expect(machine).toContainText("Rapide 40 · 44 min");
  await expect(page.getByRole("article", { name: "Machine à laver 2", exact: true })).toContainText("Rapide 30 · 38 min");
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
  expect(Date.parse(original.laundryEndsAt!) - Date.parse(original.laundryStartedAt!)).toBe(44 * 60_000);
  expect(original.laundryCollectedAt).toBeNull();
  expect(original.laundryCollectedBy).toBe("");
  await expect(machine).toContainText("Sac bleu de démonstration");
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(machine).toContainText("101");
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText(/^(43|44):\d{2}$/);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("laundry-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);
  await page.screenshot({ path: test.info().outputPath("laundry-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });

  await machine.getByRole("button", { name: "Terminé · prêt à sécher", exact: true }).click();
  const collect = page.getByRole("dialog", { name: "Terminer le lavage · Machine à laver 1", exact: true });
  await expect(collect).toContainText("après avoir retiré tout le linge");
  await expect(collect.getByLabel(/^Votre nom/)).toHaveValue("Agent lavage test");
  await collect.getByLabel(/^Votre nom/).fill("Agent récupération test");
  await collect.getByRole("button", { name: "Confirmer · prêt à sécher", exact: true }).click();
  await expect(collect).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-1")).length).toBe(2);
  const recovered = (await machineEvents(page, "washer-1"))[1];
  expect(recovered.laundryCycleId).toBe(original.laundryCycleId);
  expect(recovered.laundryStartedAt).toBe(original.laundryStartedAt);
  expect(recovered.laundryEndsAt).toBe(original.laundryEndsAt);
  expect(recovered.laundryAddedMinutes).toBeUndefined();
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
  await expect(history).toContainText("Lavage terminé le");
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
    runningCycle("washer-2", "201", "2025-06-08T08:32:01.000Z"),
    runningCycle("washer-3", "202", "2025-06-08T08:21:00.000Z"),
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
  await expect(washer3.getByText("Prêt à sécher", { exact: true })).toBeVisible();
  await expect(washer3.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await expect(dryer3).toContainText("203");
  await expect(dryer3.getByLabel("Temps restant", { exact: true })).toHaveText("49:00");

  await page.clock.setFixedTime(new Date("2025-06-08T09:00:01.000Z"));
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText("10:00");
  await expect(machine.getByText("Bientôt terminé", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date("2025-06-08T09:10:01.000Z"));
  await expect(machine.getByText("Prêt à sécher", { exact: true })).toBeVisible();
  await expect(machine.getByLabel("Temps écoulé", { exact: true })).toHaveText("Terminé");
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await expect(machine.getByRole("button", { name: "Terminé · prêt à sécher", exact: true })).toBeVisible();
  await page.reload();
  await expect(machine.getByText("Prêt à sécher", { exact: true })).toBeVisible();
  await expect(dryer3.getByLabel("Temps restant", { exact: true })).toHaveText("38:59");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("laundry-ready-mobile.png"), fullPage: true, animations: "disabled" });
  expect(workEvents.every(event => event.laundryStatus === "en_cours")).toBe(true);
});

test("an offline start, added time and explicit cancellation survive a lost receipt without duplicate cycles", async ({ page, context }) => {
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
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText(/^(37|38):\d{2}$/);
  await machine.getByRole("button", { name: "Ajouter du temps", exact: true }).click();
  const extend = page.getByRole("dialog", { name: "Ajouter du temps · Machine à laver 2", exact: true });
  await expect(extend.getByLabel(/^Minutes à ajouter/)).toHaveValue("5");
  await extend.getByRole("button", { name: "Confirmer l’ajout", exact: true }).click();
  await expect(extend).toHaveCount(0);
  await expect(machine).toContainText("+5 min ajoutées");
  await expect(machine.getByLabel("Temps restant", { exact: true })).toHaveText(/^(42|43):\d{2}$/);
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
  await expect.poll(async () => (await machineEvents(page, "washer-2")).map(event => event.expectedRevision)).toEqual([0, 1, 2]);
  await expect(history.getByText("En attente d’envoi", { exact: true })).toHaveCount(0);
  const recorded = await machineEvents(page, "washer-2");
  expect(recorded[0]).toEqual(original);
  expect(recorded[1].laundryCycleId).toBe(original.laundryCycleId);
  expect(recorded[1].laundryAddedMinutes).toBe(5);
  expect(Date.parse(recorded[1].laundryEndsAt!)).toBe(Date.parse(original.laundryEndsAt!) + 5 * 60_000);
  expect(recorded[2].laundryStatus).toBe("annule");
  expect(recorded[2].laundryEndsAt).toBe(recorded[1].laundryEndsAt);
  expect(recorded[2].laundryAddedMinutes).toBeUndefined();
  expect(recorded[2].laundryCollectedAt).toBeNull();
  expect(recorded[2].laundryCollectedBy).toBe("");
  await page.reload();
  await expect(machine.getByRole("button", { name: "Démarrer", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.getByLabel("État du cycle", { exact: true }).selectOption("cancelled");
  await expect(history).toContainText("Agent hors connexion");
  await expect(history).toContainText("Agent annulation test");
});

test("staff can extend washing and drying, restart an elapsed timer and preserve the handoff history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const now = Date.parse("2025-06-08T10:00:00.000Z");
  await page.clock.setFixedTime(new Date(now));
  await login(page);
  await page.goto("/lingerie");
  const washer = page.getByRole("article", { name: "Machine à laver 3", exact: true });
  await washer.getByRole("button", { name: "Démarrer", exact: true }).click();
  const start = page.getByRole("dialog", { name: "Démarrer · Machine à laver 3", exact: true });
  await start.getByLabel(/^Chambre/).selectOption("203");
  await start.getByLabel(/^Votre nom/).fill("Agent prolongation test");
  await start.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(start).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-3")).length).toBe(1);
  const original = (await machineEvents(page, "washer-3"))[0];
  expect(Date.parse(original.laundryEndsAt!)).toBe(now + 38 * 60_000);

  await washer.getByRole("button", { name: "Ajouter du temps", exact: true }).click();
  const extend = page.getByRole("dialog", { name: "Ajouter du temps · Machine à laver 3", exact: true });
  await expect(extend.getByLabel(/^Minutes à ajouter/)).toHaveValue("5");
  await extend.getByLabel(/^Minutes à ajouter/).fill("0");
  await extend.getByRole("button", { name: "Confirmer l’ajout", exact: true }).click();
  await expect(extend.getByLabel(/^Minutes à ajouter/)).toHaveAttribute("aria-invalid", "true");
  await extend.getByRole("button", { name: "+10 min", exact: true }).click();
  await extend.getByRole("button", { name: "Fermer", exact: true }).click();
  await washer.getByRole("button", { name: "Ajouter du temps", exact: true }).click();
  await expect(extend.getByLabel(/^Minutes à ajouter/)).toHaveValue("10");
  await page.screenshot({ path: test.info().outputPath("laundry-add-time-dialog-mobile.png"), animations: "disabled" });
  await extend.getByRole("button", { name: "Confirmer l’ajout", exact: true }).click();
  await expect(extend).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-3")).length).toBe(2);
  const firstExtension = (await machineEvents(page, "washer-3"))[1];
  expect(firstExtension.laundryAddedMinutes).toBe(10);
  expect(firstExtension.laundryCycleId).toBe(original.laundryCycleId);
  expect(firstExtension.laundryStartedAt).toBe(original.laundryStartedAt);
  expect(Date.parse(firstExtension.laundryEndsAt!)).toBe(now + 48 * 60_000);
  await page.reload();
  await expect(washer.getByLabel("Temps restant", { exact: true })).toHaveText("48:00");
  await expect(washer).toContainText("+10 min ajoutées");

  // The scheduled end has passed by one minute. Five requested minutes must
  // start at confirmation, rather than losing that minute to the expired end.
  await page.clock.setFixedTime(new Date(now + 49 * 60_000));
  await expect(washer.getByText("Prêt à sécher", { exact: true })).toBeVisible();
  await washer.getByRole("button", { name: "Ajouter du temps", exact: true }).click();
  await expect(extend.getByLabel(/^Minutes à ajouter/)).toHaveValue("5");
  await extend.getByRole("button", { name: "Confirmer l’ajout", exact: true }).click();
  await expect(extend).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-3")).length).toBe(3);
  const secondExtension = (await machineEvents(page, "washer-3"))[2];
  expect(Date.parse(secondExtension.laundryEndsAt!)).toBe(now + 54 * 60_000);
  expect(Date.parse(secondExtension.laundryEndsAt!) - Date.parse(secondExtension.occurredAt)).toBe(5 * 60_000);
  await expect(washer.getByLabel("Temps restant", { exact: true })).toHaveText("05:00");
  await expect(washer).toContainText("+15 min ajoutées");
  await expect(washer.getByRole("button", { name: "Démarrer", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("laundry-added-time-mobile.png"), fullPage: true, animations: "disabled" });

  await page.clock.setFixedTime(new Date(now + 55 * 60_000));
  await washer.getByRole("button", { name: "Terminé · prêt à sécher", exact: true }).click();
  const collectWasher = page.getByRole("dialog", { name: "Terminer le lavage · Machine à laver 3", exact: true });
  await expect(collectWasher).toContainText("retiré tout le linge de la machine à laver");
  await expect(collectWasher).toContainText("ensuite démarrer un suivi sur une machine à sécher");
  await collectWasher.getByRole("button", { name: "Confirmer · prêt à sécher", exact: true }).click();
  await expect(collectWasher).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "washer-3")).length).toBe(4);
  const removedWasher = (await machineEvents(page, "washer-3"))[3];
  expect(removedWasher.laundryEndsAt).toBe(secondExtension.laundryEndsAt);
  expect(removedWasher.laundryAddedMinutes).toBeUndefined();
  await expect(washer.getByRole("button", { name: "Démarrer", exact: true })).toBeVisible();

  const dryer = page.getByRole("article", { name: "Machine à sécher 1", exact: true });
  await dryer.getByRole("button", { name: "Démarrer", exact: true }).click();
  const dryStart = page.getByRole("dialog", { name: "Démarrer · Machine à sécher 1", exact: true });
  await dryStart.getByLabel(/^Chambre/).selectOption("203");
  await expect(dryStart.getByLabel(/^Votre nom/)).toHaveValue("Agent prolongation test");
  await dryStart.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(dryStart).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "dryer-1")).length).toBe(1);
  const originalDryer = (await machineEvents(page, "dryer-1"))[0];
  expect(Date.parse(originalDryer.laundryEndsAt!) - Date.parse(originalDryer.laundryStartedAt!)).toBe(80 * 60_000);
  await page.clock.setFixedTime(new Date(now + 136 * 60_000));
  await expect(dryer.getByText("À récupérer", { exact: true })).toBeVisible();
  await dryer.getByRole("button", { name: "Ajouter du temps", exact: true }).click();
  const dryExtend = page.getByRole("dialog", { name: "Ajouter du temps · Machine à sécher 1", exact: true });
  await dryExtend.getByLabel(/^Minutes à ajouter/).fill("7");
  await dryExtend.getByRole("button", { name: "Confirmer l’ajout", exact: true }).click();
  await expect(dryExtend).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "dryer-1")).length).toBe(2);
  const extendedDryer = (await machineEvents(page, "dryer-1"))[1];
  expect(extendedDryer.laundryAddedMinutes).toBe(7);
  expect(Date.parse(extendedDryer.laundryEndsAt!)).toBe(now + 143 * 60_000);
  await expect(dryer.getByLabel("Temps restant", { exact: true })).toHaveText("07:00");
  await page.reload();
  await expect(dryer.getByLabel("Temps restant", { exact: true })).toHaveText("07:00");
  await expect(dryer.getByRole("button", { name: "Linge récupéré", exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(now + 143 * 60_000));
  await dryer.getByRole("button", { name: "Linge récupéré", exact: true }).click();
  const collectDryer = page.getByRole("dialog", { name: "Récupérer le linge · Machine à sécher 1", exact: true });
  await collectDryer.getByRole("button", { name: "Confirmer la récupération", exact: true }).click();
  await expect(collectDryer).toHaveCount(0);
  await expect.poll(async () => (await machineEvents(page, "dryer-1")).length).toBe(3);

  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.getByLabel("Rechercher du linge", { exact: true }).fill("203");
  const washerHistory = page.getByRole("article", { name: /^Machine à laver 3 · chambre 203/ });
  await expect(washerHistory).toContainText("Durée initiale : 38 min · +15 min ajoutées");
  await expect(washerHistory.getByRole("list", { name: "Ajouts de temps", exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(washerHistory).toContainText("Lavage terminé le");
  await expect(washerHistory).not.toContainText("Linge récupéré le");
  const dryerHistory = page.getByRole("article", { name: /^Machine à sécher 1 · chambre 203/ });
  await expect(dryerHistory).toContainText("Durée initiale : 80 min · +7 min ajoutées");
  await expect(dryerHistory).toContainText("Linge récupéré le");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("laundry-extended-history-mobile.png"), fullPage: true, animations: "disabled" });
});
