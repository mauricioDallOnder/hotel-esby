import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "Réessayer la photo 1" }).click();
  await expect(page.getByRole("img", { name: "Photo à recharger · photo 1" })).toHaveJSProperty("naturalWidth", 1);
  expect(reads).toBe(2);
  expect(photoReads).toBe(2);
  await expect(page.getByRole("button", { name: "Déconnexion", exact: true })).toBeVisible();
});
