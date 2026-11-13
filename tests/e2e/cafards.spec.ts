import { expect, test, type Page } from "./fixtures";
import { displayDate, today, type Issue, type State } from "../../lib/domain";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}

test("the cafards menu derives follow-ups from signed-in history and keeps a gel-only closure to verify", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  // Entirely fictitious records: no operational room list is bundled in the app.
  const sample = (room: string, review?: { note: string; status: Issue["status"] }): Issue => ({
    id: crypto.randomUUID(), version: 1, room, title: "Exemple fictif de cafards", location: "Chambre " + room,
    category: "Équipements", priority: "normale", status: review?.status || "resolu", assignee: "Agent test",
    description: "Présence de cafards près du lavabo.", reportedBy: "Agent test", photoId: null, photoIds: [],
    date: "2025-06-01", createdAt: "2025-06-01T09:00:00.000Z", updatedAt: review ? "2025-06-03T10:00:00.000Z" : "2025-06-02T10:00:00.000Z",
    roomFindings: [{ key: "bugs", label: "Cafards détectés" }],
    history: [
      { at: "2025-06-01T09:00:00.000Z", note: "Présence de cafards près du lavabo.", actor: "Agent test", status: "ouvert", priority: "normale", assignee: "Agent test" },
      { at: "2025-06-02T10:00:00.000Z", note: "Application de gel.", actor: "Agent test", status: "resolu", priority: "normale", assignee: "Agent test" },
      ...(review ? [{ at: "2025-06-03T10:00:00.000Z", note: review.note, actor: "Agent test", status: review.status, priority: "normale" as const, assignee: "Agent test" }] : []),
    ],
  });
  const issues = [
    sample("101"),
    sample("102", { note: "Aucun cafard détecté lors du contrôle.", status: "resolu" }),
    sample("103", { note: "Des cafards sont toujours présents.", status: "en_cours" }),
  ];
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { mode: "local", issues, inspections: [], roomInspections: [], familyEvents: [], workEvents: [] } });
  });
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  await page.getByRole("link", { name: "Suivi des cafards", exact: true }).click();
  await expect(page).toHaveURL(/\/cafards$/);
  await expect(page.getByRole("heading", { name: "Suivi des cafards", exact: true })).toBeVisible();
  const filter = page.getByRole("combobox", { name: "État du suivi", exact: true });
  await expect(filter).toHaveValue("pending");
  await expect(page.getByRole("article")).toHaveCount(2);
  const treated = page.getByRole("article", { name: "Chambre 101", exact: true });
  await expect(treated.getByText("À vérifier", { exact: true })).toBeVisible();
  await expect(treated.getByText("Vérification à faire", { exact: true })).toBeVisible();
  await expect(treated.getByText("Produit : Gel", { exact: true })).toBeVisible();
  await expect(treated.locator("dd").filter({ hasText: "02/06/2025" })).toHaveCount(2);
  await expect(page.getByRole("article", { name: "Chambre 103", exact: true }).getByText("Cafards présents", { exact: true })).toBeVisible();
  await filter.selectOption("resolu");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Chambre 102", exact: true }).getByText("Résolu", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Chambre 103", exact: true })).toHaveCount(0);
  await filter.selectOption("all");
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("103");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(filter.locator('option[value="pending"]')).toContainText("1");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.reload();
  await expect(treated.getByText("À vérifier", { exact: true })).toBeVisible();
  await expect(treated.locator("dd").filter({ hasText: "02/06/2025" })).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath("cafards-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1280);
  await page.screenshot({ path: test.info().outputPath("cafards-desktop.png"), animations: "disabled" });
});

test("a room inspection routes a cafards detection to its own follow-up without creating an anomaly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const before = await state(page);
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Contrôler la chambre 123", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const choose = async (label: string, option: string) => {
    await dialog.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: option, exact: true }).click();
  };
  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  await choose("Détecteur de fumée fonctionnel", "OK");
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await choose("Chambre occupée", "Occupée");
  await choose("État général de la chambre", "Bon");
  await choose("Chambre encombrée d’affaires", "Non");
  await choose("Présence de cafards ou nuisibles", "Détectés");
  await expect(dialog.getByText(/cette détection apparaîtra dans « Suivi des cafards »/)).toBeVisible();
  await choose("État de la moquette", "OK");
  await choose("Micro-ondes présent ?", "Non");
  await choose("Propreté du minibar", "Propre");
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await dialog.getByLabel("Inspecteur").fill("Inspection cafards test");
  await dialog.getByLabel("Observations et problèmes constatés").fill("Cafards derrière le minibar.");
  await expect(dialog.getByText("Problèmes techniques constatés · 0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Cafards détectés : le suivi sera ajouté dans « Suivi des cafards ».", { exact: true })).toBeVisible();
  const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  expect((await sent).ok()).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  const after = await state(page);
  const inspection = after.roomInspections?.find(record => record.room === "123" && record.actor === "Inspection cafards test");
  expect(inspection?.bugs).toBe("oui");
  expect(after.issues.length).toBe(before.issues.length);
  expect(after.issues.some(issue => issue.id === inspection?.id)).toBe(false);
  await page.goto("/cafards");
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("123");
  const card = page.getByRole("article", { name: "Chambre 123", exact: true });
  await expect(card.getByText("Cafards présents", { exact: true })).toBeVisible();
  await expect(card.getByText("Cafards derrière le minibar.", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: /^Historique/ }).click();
  await expect(card.getByText("Contrôle de chambre · Inspection cafards test", { exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("cafards treatments and resolution persist through offline updates without duplicating a room", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/cafards");
  await page.getByRole("button", { name: "Ajouter une chambre", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Ajouter une chambre au suivi", exact: true });
  await chooser.getByLabel("Chambre").selectOption("229");
  await chooser.getByRole("button", { name: "Continuer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cafards · chambre 229", exact: true });
  await dialog.getByRole("radiogroup", { name: "État du suivi", exact: true }).getByRole("radio", { name: "Cafards présents", exact: true }).click();
  await dialog.getByLabel("Date de détection", { exact: true }).fill(today());
  await dialog.getByLabel("Observations", { exact: true }).fill("Cafards constatés derrière le frigo.");
  const submittedAt = await page.evaluate(() => Date.now());
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "cafardFollowup" && event.room === "229").length).toBe(1);
  const first = (await state(page)).workEvents?.find(event => event.kind === "cafardFollowup" && event.room === "229");
  expect(first?.actor).toBe("Employé");
  expect(new Date(first!.occurredAt).getTime()).toBeGreaterThanOrEqual(submittedAt);
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("229");
  const card = page.getByRole("article", { name: "Chambre 229", exact: true });
  await expect(card.getByText("Cafards présents", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Mettre à jour", exact: true }).click();
  await expect(dialog.getByLabel("Date de détection", { exact: true })).toHaveValue(today());
  await context.setOffline(true);
  await dialog.getByRole("radiogroup", { name: "État du suivi", exact: true }).getByRole("radio", { name: "Produit appliqué", exact: true }).click();
  await expect(dialog.getByLabel("Date d’application du produit")).toHaveValue(today());
  await dialog.getByLabel("Produit utilisé (facultatif)", { exact: true }).fill("Gel test");
  await dialog.getByLabel("Observations", { exact: true }).fill("Application du produit derrière le frigo.");
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByText("Produit appliqué", { exact: true })).toBeVisible();
  await expect(card.getByText("En attente d’envoi", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ajouter une chambre", exact: true }).click();
  await chooser.getByLabel("Chambre").selectOption("229");
  await expect(chooser.getByText(/Un suivi existe déjà/)).toBeVisible();
  await chooser.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  await dialog.getByRole("radiogroup", { name: "État du suivi", exact: true }).getByRole("radio", { name: "Résolu", exact: true }).click();
  await expect(dialog.getByLabel("Date de résolution")).toHaveValue(today());
  await dialog.getByLabel("Observations", { exact: true }).fill("Vérification terminée : aucun cafard retrouvé.");
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await page.getByRole("combobox", { name: "État du suivi", exact: true }).selectOption("resolu");
  await expect(card.getByText("Résolu", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "cafardFollowup" && event.room === "229").map(event => event.expectedRevision)).toEqual([0, 1, 2]);

  await page.reload();
  await page.getByRole("combobox", { name: "État du suivi", exact: true }).selectOption("resolu");
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("229");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card.getByText("Résolu", { exact: true })).toBeVisible();
  await expect(card.getByText("Produit : Gel test", { exact: true })).toBeVisible();
  await expect(card.locator("dd").filter({ hasText: displayDate(today()) })).toHaveCount(4);
  await card.getByRole("button", { name: /^Historique/ }).click();
  await expect(card.getByText("Cafards constatés derrière le frigo.", { exact: true })).toBeVisible();
  await expect(card.getByText("Application du produit derrière le frigo.", { exact: true })).toBeVisible();
  await expect(card.getByText("Vérification terminée : aucun cafard retrouvé.", { exact: true })).toHaveCount(2);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
