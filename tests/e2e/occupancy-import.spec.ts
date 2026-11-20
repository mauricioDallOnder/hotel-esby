import { expect, test } from "./fixtures";
import { makeSejoursFixture } from "../fixtures/sejours";

test("preview a stay sheet, import it, then correct and search the occupant", async ({ page }) => {
  test.setTimeout(90_000);
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  await page.goto("/occupation");
  await page.getByRole("button", { name: "Importer la fiche de séjours" }).click();
  const preview = page.getByRole("dialog", { name: "Importer la fiche de séjours" });
  await preview.getByLabel("Fiche de séjours Excel").setInputFiles({
    name: "Sejours_20261120_20261120.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await makeSejoursFixture()),
  });
  await expect(preview.getByRole("table")).toContainText("Famille Exemple");
  for (const count of ["Occupées · 1", "Libres · 1", "En travaux · 2"])
    await expect(preview.getByText(count, { exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/hotel?fresh=1")).json()).workEvents || []).toHaveLength(0);
  await preview.getByRole("button", { name: "Confirmer l’import" }).click();
  await expect(preview).toHaveCount(0);
  const card = (room: string) => page.getByRole("article", { name: `Chambre ${room}`, exact: true });
  await expect(card("101")).toContainText("Séjour jusqu’au 21/11/2026");
  await expect(card("102")).toContainText("Libre");
  await expect(card("103")).toContainText("En travaux");
  await expect(card("104")).toContainText("En travaux");
  await card("101").getByRole("button", { name: "Modifier le séjour" }).click();
  const edit = page.getByRole("dialog", { name: "Séjour · chambre 101" });
  await edit.getByLabel("Nom de l’occupant").fill("Élodie Martin");
  await edit.getByLabel("Séjour jusqu’au").fill("2026-11-24");
  const saved = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await edit.getByRole("button", { name: "Enregistrer" }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  const search = page.getByLabel("Rechercher une chambre", { exact: true });
  await search.fill("MARTIN elodie");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card("101")).toContainText("Élodie Martin");
  await expect(card("101")).toContainText("Séjour jusqu’au 24/11/2026");
  await search.fill("Famille Exemple");
  await expect(page.getByRole("article")).toHaveCount(0);

  await page.goto("/");
  const totals = page.getByRole("region", { name: "Occupation de l’hôtel" });
  for (const [label, count] of [["Chambres libres", "1"], ["Chambres occupées", "1"], ["Chambres en travaux", "2"]]) {
    await expect(totals.getByText(label, { exact: true }).locator("..").getByRole("heading")).toHaveText(count);
  }
});
