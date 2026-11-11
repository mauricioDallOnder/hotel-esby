import { expect, test, type Page } from "@playwright/test";
import { today, type Issue } from "../../lib/domain";
import type { WorkEvent } from "../../lib/rooms";

const sample = (): Issue => ({
  id: "bcdbf707-567b-44f8-8151-c08b51994394", version: 1,
  title: "Robinet du lavabo bloqué", description: "Le robinet du lavabo ne ferme plus.", location: "Chambre 114",
  category: "Plomberie", priority: "normale", status: "ouvert", assignee: "Test", reportedBy: "Test",
  date: today(), createdAt: `${today()}T08:00:00Z`, updatedAt: `${today()}T08:00:00Z`, photoId: null, photoIds: [], history: [],
});

async function login(page: Page) {
  const response = await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } });
  expect(response.ok()).toBeTruthy();
}

test("theme follows the device, persists a manual choice, and renders every page on a narrow phone", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/checklist");
  await expect(page.getByText("Bienvenue", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Activer le mode clair", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Activer le mode sombre", exact: true })).toBeEnabled();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);

  await login(page);
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Activer le mode sombre", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 25, 23)");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  for (const route of ["/", "/checklist", "/occupation", "/lingerie", "/objets-recuperes", "/familles", "/anomalies", "/cafards", "/rondes", "/quotidien", "/relatorios"]) {
    await page.goto(route);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activer le mode clair", exact: true })).toBeEnabled();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 25, 23)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (["/checklist", "/cafards", "/lingerie"].includes(route)) {
      await page.screenshot({ path: testInfo.outputPath(`dark-${route.slice(1)}-mobile.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test("a duplicate room fault is blocked before sending and opens the existing follow-up", async ({ page }) => {
  await login(page);
  const existing = sample();
  let writes = 0;
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() !== "GET") writes++;
    await route.fulfill({ json: { mode: "local", issues: [existing], inspections: [], workEvents: [], roomInspections: [] } });
  });
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Signaler une anomalie", exact: true });
  await dialog.getByLabel("Titre", { exact: false }).fill("Robinet du lavabo bloqué");
  await dialog.getByLabel("Lieu précis").fill("Chambre n°114");
  await dialog.getByLabel("Description du problème").fill("Le robinet du lavabo ne ferme plus.");
  await dialog.getByLabel("Signalé par").fill("Test");
  await expect(dialog.getByRole("alert").filter({ hasText: "Un problème identique" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Ouvrir le signalement existant", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Ouvrir le suivi existant ?", exact: true });
  await expect(confirm).toContainText("Le texte et les photos");
  await confirm.getByRole("button", { name: "Continuer la saisie", exact: true }).click();
  await expect(dialog.getByLabel("Description du problème")).toHaveValue(existing.description);
  await dialog.getByRole("button", { name: "Ouvrir le signalement existant", exact: true }).click();
  await confirm.getByRole("button", { name: "Abandonner les modifications", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /^Suivi de l’anomalie/ })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();

  existing.status = "resolu";
  existing.version = 2;
  await page.reload();
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  await dialog.getByLabel("Titre", { exact: false }).fill(existing.title);
  await dialog.getByLabel("Lieu précis").fill("114");
  await dialog.getByLabel("Description du problème").fill(existing.description);
  await dialog.getByLabel("Signalé par").fill("Test");
  await expect(dialog.getByText(/Un problème identique/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true })).toBeEnabled();
});

test("a background refresh does not block an intervention or restore its old unresolved status", async ({ page }) => {
  await login(page);
  let existing = sample();
  let holdRead = false, held = false, delivered = false, writes = 0;
  let releaseRead: (() => void) | undefined;
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() === "PATCH") {
      writes++;
      existing = { ...existing, version: 2, status: "resolu", updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { mode: "local", issues: [existing], inspections: [] } });
    }
    const snapshot = structuredClone(existing);
    if (holdRead) {
      held = true;
      await new Promise<void>(resolve => { releaseRead = resolve; });
    }
    await route.fulfill({ json: { mode: "local", issues: [snapshot], inspections: [] } });
    if (holdRead) delivered = true;
  });
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Suivi de l’anomalie/ });
  await dialog.getByRole("radiogroup", { name: "État de résolution", exact: true }).getByRole("radio", { name: "Résolu", exact: true }).click();
  await dialog.getByLabel("Intervention saisie par").fill("Test intervention");
  await dialog.getByLabel("Travaux effectués / résolution").fill("Robinet réparé et vérifié.");
  holdRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => held).toBe(true);
  try {
    await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toBe(1);
    await expect(page.getByRole("article")).toHaveCount(0);
    releaseRead?.();
    await expect.poll(() => delivered).toBe(true);
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article").getByText("Résolu", { exact: true })).toBeVisible();
  } finally {
    holdRead = false;
    releaseRead?.();
  }
});

test("a legacy cafard draft and its notes survive a newer follow-up and an explicit reload", async ({ page }) => {
  await login(page);
  const followup: WorkEvent = {
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "cafardFollowup", targetId: "125", room: "125",
    expectedRevision: 0, date: today(), occurredAt: new Date().toISOString(), actor: "Test suivi",
    cafardStatus: "traite", detectedOn: today(), treatedOn: today(), resolvedOn: null, product: "Gel test", notes: "Application fictive.",
    updatedAt: new Date().toISOString(), version: 1, submissionHash: "a".repeat(64),
  };
  const data = { mode: "local", issues: [], inspections: [], roomInspections: [], workEvents: [followup] };
  await page.route("**/api/hotel*", route => route.fulfill({ json: data }));
  await page.goto("/cafards");
  const notes = "Observations du brouillon antérieur à la mise à jour.";
  await page.evaluate(async ({ entry, notes }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("hotel-work", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("records");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("records", "readwrite");
        transaction.objectStore("records").put({ ...entry, id: crypto.randomUUID(), expectedRevision: 1, cafardStatus: "resolu", resolvedOn: entry.date, notes }, "draft:cafard:125:1");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, { entry: followup, notes });
  await page.getByRole("article", { name: "Chambre 125", exact: true }).getByRole("button", { name: "Mettre à jour", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cafards · chambre 125", exact: true });
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Recharger le suivi en conservant mes observations", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Produit appliqué", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();

  data.workEvents.push({ ...followup, id: crypto.randomUUID(), expectedRevision: 1, cafardStatus: "signale", notes: "Mise à jour par un autre collègue." });
  await page.reload();
  await page.getByRole("article", { name: "Chambre 125", exact: true }).getByRole("button", { name: "Mettre à jour", exact: true }).click();
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Recharger le suivi en conservant mes observations", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Cafards présents", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("Observations", { exact: true })).toHaveValue(notes);
  await expect(dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toBeEnabled();
});
