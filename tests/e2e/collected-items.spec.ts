import { expect, test, type Page } from "@playwright/test";
import { displayDate, today, type State } from "../../lib/domain";
import type { WorkEntry } from "../../lib/rooms";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}
async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}
async function savedItems(page: Page, room: string) {
  return (await state(page)).workEvents?.filter(event => event.kind === "collectedItem" && event.room === room) || [];
}
async function send(page: Page, entry: WorkEntry) {
  const response = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: entry });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("an object without a room label can be returned and identified later without losing its history", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/objets-recuperes");
  await page.getByRole("button", { name: "Ajouter un objet", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Ajouter un objet", exact: true });
  await expect(add.getByLabel(/^Chambre/)).toHaveValue("");
  await add.getByLabel(/^Chambre/).selectOption({ label: "Chambre non identifiée" });
  await add.getByRole("textbox", { name: /^Objet/ }).fill("Multiprise bleue sans étiquette de test");
  await add.getByLabel(/^Récupéré par/).fill("Agent exemple sans étiquette");
  await add.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un objet", exact: true }).click();
  await expect(add.locator("select option:checked")).toHaveText("Chambre non identifiée");
  await expect(add.getByRole("textbox", { name: /^Objet/ })).toHaveValue("Multiprise bleue sans étiquette de test");
  await add.getByRole("button", { name: "Enregistrer l’objet", exact: true }).click();
  await expect(add).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "")).length).toBe(1);
  const original = (await savedItems(page, ""))[0];
  expect(original.roomUnidentified).toBe(true);
  expect(original.collectedBy).toBe("Agent exemple sans étiquette");
  expect(original.notes).toBe("");

  await page.reload();
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("non identifiee");
  const unknown = page.getByRole("article", { name: "Chambre non identifiée · Multiprise bleue sans étiquette de test", exact: true });
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(unknown).toContainText("Non identifiée");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("unidentified-item-mobile.png"), fullPage: true, animations: "disabled" });
  await unknown.getByRole("button", { name: "Restituer", exact: true }).click();
  const giveBack = page.getByRole("dialog", { name: "Restituer l’objet", exact: true });
  await expect(giveBack).toContainText("Chambre non identifiée");
  await giveBack.getByLabel(/^Restitué par/).fill("Agent restitution test");
  await giveBack.getByRole("button", { name: "Confirmer la restitution", exact: true }).click();
  await expect(giveBack).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "")).length).toBe(2);
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await expect(unknown).toContainText("Agent restitution test");

  await unknown.getByRole("button", { name: "Corriger la fiche", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "Corriger la fiche", exact: true });
  await expect(correction.locator("select option:checked")).toHaveText("Chambre non identifiée");
  await correction.getByLabel(/^Chambre/).selectOption("101");
  await correction.getByRole("button", { name: "Enregistrer la correction", exact: true }).click();
  await expect(correction).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "101")).length).toBe(1);
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("101");
  const identified = page.getByRole("article", { name: "Chambre 101 · Multiprise bleue sans étiquette de test", exact: true });
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(identified).toContainText("Agent restitution test");
  await page.reload();
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await identified.getByRole("button", { name: /^Historique/ }).click();
  await expect(identified).toContainText("Chambre non identifiée");
  await expect(identified).toContainText("Agent exemple sans étiquette");
  const events = (await state(page)).workEvents?.filter(event => event.targetId === original.targetId) || [];
  expect(events).toHaveLength(3);
  expect(events.map(event => event.room)).toEqual(["", "", "101"]);
  expect(events.map(event => event.roomUnidentified)).toEqual([true, true, undefined]);
  expect(new Set(events.map(event => event.targetId)).size).toBe(1);

  await page.goto("/cafards");
  await page.getByRole("button", { name: "Ajouter une chambre", exact: true }).click();
  const otherRoomSelector = page.getByRole("dialog", { name: "Ajouter une chambre au suivi", exact: true });
  await expect(otherRoomSelector.locator("option", { hasText: "Chambre non identifiée" })).toHaveCount(0);
});

test("employees can find, return and correct separate objects from the same room on mobile", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  await page.getByRole("link", { name: "Problèmes techniques", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Problèmes techniques", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  await page.getByRole("link", { name: "Objets récupérés", exact: true }).click();
  await expect(page).toHaveURL(/\/objets-recuperes$/);
  await expect(page.getByRole("heading", { name: "Objets récupérés", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ajouter un objet", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Ajouter un objet", exact: true });
  await expect(add.getByLabel(/^Récupéré par/)).toHaveValue("");
  await expect(add.getByLabel(/^Date de récupération/)).toHaveValue(today());
  await add.getByLabel(/^Chambre/).selectOption("101");
  await add.getByRole("button", { name: "Plaque de cuisson", exact: true }).click();
  await add.getByRole("textbox", { name: /^Objet\b/ }).fill("Plaque rouge de démonstration");
  await add.getByLabel(/^Date de récupération/).fill("2025-06-01");
  await add.getByLabel(/^Récupéré par/).fill("Agent exemple");
  await add.getByLabel("Motif (facultatif)", { exact: true }).fill("Appareil non autorisé. Cordon conservé avec l’objet.");
  await page.screenshot({ path: test.info().outputPath("collected-items-add-mobile.png"), animations: "disabled" });
  await add.getByRole("button", { name: "Enregistrer l’objet", exact: true }).click();
  await expect(add).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "101")).length).toBe(1);

  await page.getByRole("button", { name: "Ajouter un objet", exact: true }).click();
  await add.getByLabel(/^Chambre/).selectOption("101");
  await add.getByRole("button", { name: "Multiprise", exact: true }).click();
  await add.getByLabel(/^Récupéré par/).fill("Autre agent exemple");
  await expect(add.getByLabel("Motif (facultatif)", { exact: true })).toHaveValue("");
  await add.getByRole("button", { name: "Enregistrer l’objet", exact: true }).click();
  await expect(add).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "101")).length).toBe(2);
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("101");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Chambre 101 · Multiprise");
  const plaque = page.getByRole("article", { name: "Chambre 101 · Plaque rouge de démonstration", exact: true });
  await expect(plaque).toContainText("01/06/2025");
  await expect(plaque).toContainText("Agent exemple");
  await expect(plaque).toContainText("Cordon conservé avec l’objet.");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath("collected-items-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1280);
  await page.screenshot({ path: test.info().outputPath("collected-items-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByLabel("Rechercher un objet", { exact: true }).fill("plaque rouge");
  await expect(page.getByRole("article")).toHaveCount(1);
  await plaque.getByRole("button", { name: "Restituer", exact: true }).click();
  const giveBack = page.getByRole("dialog", { name: "Restituer l’objet", exact: true });
  await expect(giveBack.getByLabel(/^Restitué par/)).toHaveValue("");
  await giveBack.getByLabel(/^Date de restitution/).fill("");
  await giveBack.getByLabel(/^Restitué par/).fill("Agent restitution");
  await giveBack.getByRole("button", { name: "Confirmer la restitution", exact: true }).click();
  await expect(giveBack.getByLabel(/^Date de restitution/)).toHaveAttribute("aria-invalid", "true");
  await expect(giveBack.getByText("Renseignez la date de restitution.", { exact: true })).toBeVisible();
  await giveBack.getByLabel(/^Date de restitution/).fill("2025-06-03");
  await page.screenshot({ path: test.info().outputPath("collected-items-return-mobile.png"), animations: "disabled" });
  await giveBack.getByRole("button", { name: "Confirmer la restitution", exact: true }).click();
  await expect(giveBack).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "101")).length).toBe(3);
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await expect(plaque).toContainText("Restitué");
  await expect(plaque).toContainText("03/06/2025");
  await expect(plaque).toContainText("Agent restitution");
  await expect(plaque).toContainText("Agent exemple");

  await plaque.getByRole("button", { name: "Corriger la fiche", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "Corriger la fiche", exact: true });
  await expect(correction.getByLabel(/^Récupéré par/)).toHaveValue("Agent exemple");
  await correction.getByRole("textbox", { name: /^Objet\b/ }).fill("Plaque rouge avec cordon");
  await correction.getByRole("button", { name: "Enregistrer la correction", exact: true }).click();
  await expect(correction).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "101")).length).toBe(4);
  const corrected = page.getByRole("article", { name: "Chambre 101 · Plaque rouge avec cordon", exact: true });
  await expect(corrected).toContainText("Agent restitution");
  await corrected.getByRole("button", { name: /^Historique/ }).click();
  await expect(corrected).toContainText("Plaque rouge de démonstration");
  await expect(corrected).toContainText("Employé");

  await corrected.getByRole("button", { name: "Annuler la restitution", exact: true }).click();
  const restore = page.getByRole("dialog", { name: "Annuler la restitution", exact: true });
  await restore.getByLabel(/^Annulation enregistrée par/).fill("Agent correction");
  await restore.getByRole("button", { name: "Confirmer l’annulation", exact: true }).click();
  await expect(restore).toHaveCount(0);
  await expect.poll(async () => (await savedItems(page, "101")).length).toBe(5);
  await page.getByRole("button", { name: /^En armoire :/ }).click();
  await expect(corrected).toContainText("En armoire");
  await expect(corrected.getByRole("button", { name: "Restituer", exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("101");
  await expect(page.getByRole("article")).toHaveCount(2);
  await corrected.getByRole("button", { name: /^Historique/ }).click();
  await expect(corrected).toContainText("Agent restitution");
  await expect(corrected).toContainText("Agent correction");
  const events = await savedItems(page, "101");
  expect(events.filter(event => event.itemName === "Multiprise")).toHaveLength(1);
  expect(events.find(event => event.itemName === "Multiprise")?.notes).toBe("");
  expect(new Set(events.map(event => event.targetId)).size).toBe(2);
});

test("offline custody and return survive reload and a lost receipt without duplicate objects", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/objets-recuperes");
  await page.getByRole("button", { name: "Ajouter un objet", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Ajouter un objet", exact: true });
  await add.getByLabel(/^Chambre/).selectOption("202");
  await add.getByRole("button", { name: "Appareil > 100 W", exact: true }).click();
  await add.getByRole("textbox", { name: /^Objet\b/ }).fill("Appareil test hors connexion");
  await add.getByLabel(/^Récupéré par/).fill("Agent collecte hors ligne");
  await context.setOffline(true);
  await add.getByRole("button", { name: "Enregistrer l’objet", exact: true }).click();
  await expect(add).toHaveCount(0);
  const card = page.getByRole("article", { name: "Chambre 202 · Appareil test hors connexion", exact: true });
  await expect(card.getByText("En attente d’envoi", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Restituer", exact: true }).click();
  const giveBack = page.getByRole("dialog", { name: "Restituer l’objet", exact: true });
  await giveBack.getByLabel(/^Restitué par/).fill("Agent restitution hors ligne");
  await giveBack.getByRole("button", { name: "Confirmer la restitution", exact: true }).click();
  await expect(giveBack).toHaveCount(0);
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await expect(card).toContainText("Agent collecte hors ligne");
  await expect(card).toContainText("Agent restitution hors ligne");

  let acceptWrites = false, lostReceipt = false;
  await page.route("**/api/entries", async route => {
    if (route.request().method() !== "POST" || acceptWrites) return route.continue();
    if (!lostReceipt) {
      lostReceipt = true;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
    }
    // The first write reaches the server, but its receipt is lost. Following
    // requests stay unavailable while the browser reloads its durable queue.
    await route.abort("internetdisconnected");
  });
  await context.setOffline(false);
  await expect.poll(async () => (await savedItems(page, "202")).length).toBe(1);
  const original = (await savedItems(page, "202"))[0];
  await page.reload();
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("202");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card.getByText("En attente d’envoi", { exact: true })).toBeVisible();
  await expect(card).toContainText("Agent collecte hors ligne");
  await expect(card).toContainText("Agent restitution hors ligne");
  await card.getByRole("button", { name: /^Historique/ }).click();
  await expect(card.getByRole("button", { name: "Historique (2)", exact: true })).toHaveAttribute("aria-expanded", "true");

  acceptWrites = true;
  await page.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  await expect.poll(async () => (await savedItems(page, "202")).map(event => event.expectedRevision)).toEqual([0, 1]);
  await expect(card.getByText("En attente d’envoi", { exact: true })).toHaveCount(0);
  expect((await savedItems(page, "202"))[0]).toEqual(original);
  await page.reload();
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("202");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card).toContainText(displayDate(today()));
  await expect(card).toContainText("Agent restitution hors ligne");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("a concurrent item return is refused with useful details and never replaces a colleague's history", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const original: WorkEntry = {
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "collectedItem", targetId: crypto.randomUUID(), expectedRevision: 0,
    room: "303", date: today(), occurredAt: new Date().toISOString(), actor: "Agent collecte test", notes: "",
    itemName: "Multiprise de conflit", collectedOn: today(), collectedBy: "Agent collecte test", returnedOn: null, returnedBy: "",
  };
  await send(page, original);
  await page.goto("/objets-recuperes");
  await page.getByLabel("Rechercher un objet", { exact: true }).fill("303");
  const card = page.getByRole("article", { name: "Chambre 303 · Multiprise de conflit", exact: true });
  await card.getByRole("button", { name: "Restituer", exact: true }).click();
  const giveBack = page.getByRole("dialog", { name: "Restituer l’objet", exact: true });
  await giveBack.getByLabel(/^Restitué par/).fill("Agent restitution en retard");
  const colleague: WorkEntry = {
    ...original, id: crypto.randomUUID(), expectedRevision: 1, occurredAt: new Date().toISOString(),
    actor: "Collègue exemple", returnedOn: today(), returnedBy: "Collègue exemple",
  };
  await send(page, colleague);
  const response = page.waitForResponse(res => res.url().endsWith("/api/entries") && res.request().method() === "POST");
  await giveBack.getByRole("button", { name: "Confirmer la restitution", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(giveBack).toHaveCount(0);
  const connection = page.getByRole("region", { name: "État des enregistrements", exact: true });
  await expect(connection.getByRole("alert")).toContainText("Ces modifications nécessitent votre attention.");
  await expect(connection.getByRole("alert")).toContainText("Ch. 303");
  await expect(connection.getByRole("alert")).toContainText("Multiprise de conflit");
  await expect(connection.getByRole("alert")).toContainText("Agent collecte test");
  await expect(connection.getByRole("alert")).toContainText("Restitution demandée");
  await expect(connection.getByRole("alert")).toContainText("Agent restitution en retard");
  await connection.getByRole("button", { name: "Actualiser", exact: true }).click();
  await page.getByRole("button", { name: /^Restitués :/ }).click();
  await expect(card).toContainText("Collègue exemple");
  await expect(card).not.toContainText("Agent restitution en retard");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  expect((await savedItems(page, "303")).map(event => event.id)).toEqual([original.id, colleague.id]);
  await connection.getByRole("button", { name: "Annuler cette modification en attente", exact: true }).click();
  await expect(connection.getByRole("alert")).toHaveCount(0);
  await expect(card).toContainText("Collègue exemple");
  expect((await savedItems(page, "303")).length).toBe(2);
});
