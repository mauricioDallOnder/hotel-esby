import { expect, test } from "./fixtures";

test("mobile recovers from failed data and photo loads without logging in again", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } });
  const issue = {
    id: "11111111-1111-4111-8111-111111111111", version: 1,
    date: "2026-09-01", createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
    title: "Photo à recharger", description: "Test de connexion", location: "204",
    category: "Autre", priority: "normale", status: "ouvert", assignee: "", reportedBy: "Test",
    photoId: "photo", photoIds: ["photo"], history: [],
  };
  let reads = 0;
  await page.route("**/api/hotel*", async (route) => {
    reads++;
    if (reads === 1) {
      await route.fulfill({ status: 503, json: { error: "Google temporairement indisponible." } });
    } else {
      expect(new URL(route.request().url()).searchParams.get("fresh")).toBe("1");
      await route.fulfill({ json: { issues: [issue], inspections: [], mode: "sheets" } });
    }
  });
  let photoReads = 0;
  await page.route("**/api/photos/**", async (route) => {
    photoReads++;
    if (photoReads === 1) {
      await route.fulfill({ status: 503, json: { error: "Indisponible" } });
    } else {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") });
    }
  });
  await page.goto("/anomalies");
  await expect(page.getByText("Google temporairement indisponible.")).toBeVisible();
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByText("Photo à recharger", { exact: true })).toBeVisible();
  expect(photoReads).toBe(0);
  await page.getByRole("button", { name: "Voir les photos (1)", exact: true }).click();
  await expect(page.getByRole("img", { name: "Photo à recharger · photo 1" })).toHaveJSProperty("naturalWidth", 1);
  expect(reads).toBe(2);
  expect(photoReads).toBe(2);
  await expect(page.getByRole("button", { name: "Déconnexion", exact: true })).toBeVisible();
});

test("connection status distinguishes offline mode and a failed refresh from confirmed saves", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  let failRefresh = false;
  await page.route("**/api/hotel*", route => failRefresh
    ? route.fulfill({ status: 503, json: { error: "Google temporairement indisponible." } })
    : route.fulfill({ json: { issues: [], inspections: [], mode: "sheets" } }));
  await page.goto("/occupation");
  const status = page.getByRole("region", { name: "État des enregistrements", exact: true });
  await expect(status.getByRole("status")).toHaveText("Enregistrements à jour");

  await context.setOffline(true);
  await expect(status.getByRole("status")).toHaveText("Hors connexion");
  await expect(status.getByRole("button", { name: "Actualiser", exact: true })).toBeDisabled();
  await expect(page.getByText("Connecté à Google Sheets", { exact: true })).toHaveCount(0);
  await context.setOffline(false);
  await expect(status.getByRole("status")).toHaveText("Enregistrements à jour");

  failRefresh = true;
  await status.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(status.getByRole("status")).toHaveText("Données à actualiser");
  await expect(status.getByRole("alert")).toContainText("Google temporairement indisponible.");
  await expect(page.getByRole("checkbox", { name: /^Chambre \d+ occupée$/ })).toHaveCount(85);

  failRefresh = false;
  await status.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(status.getByRole("status")).toHaveText("Enregistrements à jour");
  await expect(status.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("a failed anomaly save does not erase the warning from a failed data refresh", async ({ page }) => {
  await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  let failRefresh = false;
  let saveAttempts = 0;
  await page.route("**/api/hotel*", route => {
    if (route.request().method() !== "GET") {
      saveAttempts++;
      return route.fulfill({ status: 503, json: { error: "Enregistrement temporairement indisponible." } });
    }
    return failRefresh
      ? route.fulfill({ status: 503, json: { error: "Lecture temporairement indisponible." } })
      : route.fulfill({ json: { issues: [], inspections: [], mode: "sheets" } });
  });
  await page.goto("/anomalies");
  const status = page.getByRole("region", { name: "État des enregistrements", exact: true });
  await expect(status.getByRole("status")).toHaveText("Enregistrements à jour");
  failRefresh = true;
  await status.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(status.getByRole("status")).toHaveText("Données à actualiser");

  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Signaler une anomalie", exact: true });
  await dialog.getByLabel("Titre").fill("Robinet chambre 203");
  await dialog.getByLabel("Lieu précis").fill("Chambre 203");
  await dialog.getByLabel("Description du problème").fill("Robinet bloqué");
  await dialog.getByLabel("Signalé par").fill("Test de connexion");
  await dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Enregistrement temporairement indisponible." })).toHaveText("Enregistrement temporairement indisponible.");
  const uncertain = dialog.getByRole("alert").filter({ hasText: "L’envoi reste à confirmer." });
  await expect(uncertain).toHaveText("L’envoi reste à confirmer. Votre texte et vos photos sont conservés. Réessayez le même envoi avant de modifier ou supprimer ce brouillon.");
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Fermer sans enregistrer ?", exact: true });
  await expect(confirmation.getByRole("button", { name: "Abandonner les modifications", exact: true })).toHaveCount(0);
  await confirmation.getByRole("button", { name: "Fermer et conserver", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect(status.getByRole("status")).toHaveText("Enregistrement non confirmé");
  await expect(status.getByRole("alert").filter({ hasText: "Enregistrement temporairement indisponible." })).toBeVisible();
  await expect(status.getByRole("alert").filter({ hasText: "Lecture temporairement indisponible." })).toBeVisible();
  await status.getByRole("button", { name: "Masquer ce message", exact: true }).click();
  await expect(status.getByRole("status")).toHaveText("Données à actualiser");
  await expect(status.getByRole("alert")).toContainText("Lecture temporairement indisponible.");

  await page.getByRole("button", { name: "Reprendre le brouillon", exact: true }).click();
  await expect(dialog.getByLabel("Titre")).toHaveValue("Robinet chambre 203");
  await expect(dialog.getByLabel("Lieu précis")).toHaveValue("Chambre 203");
  await expect(dialog.getByLabel("Description du problème")).toHaveValue("Robinet bloqué");
  await expect(dialog.getByLabel("Signalé par")).toHaveValue("Test de connexion");
  await expect(dialog.getByLabel("Titre")).toBeDisabled();
  await expect(uncertain).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Réessayer le même envoi", exact: true })).toBeEnabled();
  expect(saveAttempts).toBe(1);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await confirmation.getByRole("button", { name: "Fermer et conserver", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(status.getByRole("status")).toHaveText("Données à actualiser");
  await expect(status.getByRole("alert")).toContainText("Lecture temporairement indisponible.");
});
