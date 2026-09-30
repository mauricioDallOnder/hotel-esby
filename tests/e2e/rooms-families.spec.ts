import { expect, test, type Page } from "@playwright/test";
async function login(page: Page) { await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } }); }
async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: ?\\*)?$") }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("mobile room inspection validates carpet, compresses photos, and shows saved history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  await page.goto("/checklist");
  await expect(page.getByRole("button", { name: "Contrôler la chambre", exact: false })).toHaveCount(89);
  await page.getByRole("button", { name: "Contrôler la chambre 112", exact: true }).click();
  await page.getByLabel("Inspecteur").fill("Test mobile");
  await select(page, "État général de la chambre", "À revoir");
  await select(page, "Nettoyage / ménage", "Non faite");
  await select(page, "Robinets fonctionnels", "Problème");
  await select(page, "État de la moquette", "Sale");
  await page.getByLabel("Précisez les taches ou salissures").fill("Boue près de la fenêtre");
  await page.getByLabel("Observations et problèmes constatés").fill("Robinet bloqué");
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") });
  await expect(page.getByAltText("Photo du problème 1")).toBeVisible();
  const send = page.waitForResponse(r => r.url().endsWith("/api/entries") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  expect((await send).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Voir le contrôle" }).first().click();
  await expect(page.getByText("Moquette : Sale Boue près de la fenêtre")).toBeVisible();
  await page.getByRole("button", { name: "Afficher les 1 photo(s)" }).click();
  await expect(page.getByRole("img", { name: "Chambre 112 · photo 1" })).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
test("family drafts survive reload and offline entries synchronize without losing data", async ({ page, context }) => {
  await login(page); await page.goto("/familles");
  await page.getByLabel(/^Chambre/).selectOption("332");
  await page.getByLabel(/^Famille/).fill("Famille hors réseau");
  await page.getByLabel("Signalé par").fill("Marie");
  await page.getByLabel("Observations", { exact: true }).fill("Retour lundi");
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("hotel-work", 1); r.onsuccess = () => resolve(r.result); });
    return new Promise<string>(resolve => { const r = db.transaction("records").objectStore("records").get("draft:family"); r.onsuccess = () => { resolve(r.result?.notes); db.close(); }; });
  })).toBe("Retour lundi");
  await page.reload(); await expect(page.getByLabel(/^Famille/)).toHaveValue("Famille hors réseau");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Enregistrer l’événement" }).click();
  await expect(page.getByText("En attente d’envoi", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("Enregistré sur le serveur", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ch. 332 · Famille hors réseau", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel(/^Famille/)).toHaveValue("");
});
test("a lost save receipt can be retried without duplicating a family departure", async ({ page }) => {
  await login(page); await page.goto("/familles");
  await page.route("**/api/entries", async route => { await route.fetch(); await route.abort("failed"); }, { times: 1 });
  await page.getByLabel(/^Chambre/).selectOption("201");
  await page.getByLabel(/^Famille/).fill("Famille reçu perdu");
  await page.getByLabel("Signalé par").fill("Marie");
  await select(page, "Événement", "Départ définitif");
  await expect(page.getByLabel("Retour prévu (facultatif)")).toHaveCount(0);
  await page.getByRole("button", { name: "Enregistrer l’événement" }).click();
  await expect(page.getByText(/Connexion interrompue ou lente/)).toBeVisible();
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByText("En attente d’envoi", { exact: true })).toHaveCount(0);
  const state = await (await page.request.get("/api/hotel")).json();
  expect(state.familyEvents.filter((r: { family: string }) => r.family === "Famille reçu perdu")).toHaveLength(1);
});
