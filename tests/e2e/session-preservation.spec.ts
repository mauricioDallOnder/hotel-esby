import { expect, test } from "@playwright/test";

const photo = { name: "constat.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") };

for (const width of [390, 1280]) test(`an expired session preserves the open issue, photo and recoverable draft at ${width}px`, async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width, height: 844 });
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  let rejectRefresh = false;
  await page.route("**/api/hotel*", async route => {
    if (rejectRefresh) return route.fulfill({ status: 401, json: { error: "Session expirée. Reconnectez-vous." } });
    return route.fulfill({ json: { mode: "local", issues: [], inspections: [], roomInspections: [], workEvents: [], familyEvents: [] } });
  });
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  const issue = page.getByRole("dialog", { name: "Signaler une anomalie", exact: true });
  await issue.getByLabel("Titre", { exact: true }).fill("Étagère fissurée au-dessus du bureau");
  await issue.getByLabel("Lieu précis", { exact: true }).fill("Chambre 114");
  await issue.getByLabel("Description du problème", { exact: true }).fill("Constat à conserver pendant la reconnexion.");
  await issue.getByLabel("Signalé par", { exact: true }).fill("Agent de test");
  await issue.locator('input[type="file"][multiple]').setInputFiles(photo);
  await expect(issue.getByText("1 / 3 photos · facultatif", { exact: true })).toBeVisible();
  rejectRefresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const login = page.getByRole("dialog", { name: "Reconnectez-vous", exact: true });
  await expect(login).toBeVisible({ timeout: 40_000 });
  await login.getByLabel(/Mot de passe/).fill("test-employee");
  rejectRefresh = false;
  await login.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(login).toHaveCount(0);
  await expect(issue).toBeVisible();
  await expect(issue.getByLabel("Titre", { exact: true })).toHaveValue("Étagère fissurée au-dessus du bureau");
  await expect(issue.getByLabel("Description du problème", { exact: true })).toHaveValue("Constat à conserver pendant la reconnexion.");
  await expect(issue.getByText("1 / 3 photos · facultatif", { exact: true })).toBeVisible();
  await expect(issue.getByText(/Brouillon et photos conservés/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Reprendre le brouillon", exact: true }).click();
  await expect(issue.getByLabel("Titre", { exact: true })).toHaveValue("Étagère fissurée au-dessus du bureau");
  await expect(issue.getByLabel("Description du problème", { exact: true })).toHaveValue("Constat à conserver pendant la reconnexion.");
  await expect(issue.getByText("1 / 3 photos · facultatif", { exact: true })).toBeVisible();
});
