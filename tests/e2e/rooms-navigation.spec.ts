import { expect, test, type Page } from "./fixtures";

function mainMenu(page: Page) {
  return page.getByRole("list").filter({ has: page.getByRole("link", { name: "Vue d’ensemble", exact: true }) });
}

function roomViews(page: Page) {
  return page.getByRole("navigation", { name: "Vues des chambres", exact: true });
}

test.beforeEach(async ({ page }) => {
  const session = await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  expect(session.ok()).toBeTruthy();
});

test("the desktop Chambres menu covers both room views and follows browser history", async ({ page }, testInfo) => {
  await page.goto("/checklist");
  const menu = mainMenu(page);
  const rooms = menu.getByRole("link", { name: "Chambres", exact: true });
  await expect(rooms).toHaveAttribute("href", "/checklist");
  await expect(rooms).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: /checklist|occupation/i })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Chambres", exact: true })).toHaveAttribute("href", "/checklist");

  const views = roomViews(page);
  const currentView = views.locator('a[aria-current="page"]');
  const checklist = views.getByRole("link", { name: "Checklist", exact: true });
  const occupation = views.getByRole("link", { name: "Occupation", exact: true });
  await expect(currentView).toHaveText("Checklist");
  await expect(checklist).toHaveAttribute("href", "/checklist");
  await expect(occupation).toHaveAttribute("href", "/occupation");
  await occupation.click();
  await expect(page).toHaveURL(/\/occupation$/);
  await expect(currentView).toHaveText("Occupation");
  await expect(rooms).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("button", { name: "Importer la fiche de séjours", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("occupation-menu-chambres.png"), animations: "disabled" });

  await page.goBack();
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(currentView).toHaveText("Checklist");
  await expect(page.getByRole("region", { name: "Couverture par étage", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/occupation$/);
  await expect(currentView).toHaveText("Occupation");
});

test("mobile opens the occupation bookmark directly and the drawer offers one Chambres entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/occupation");
  const views = roomViews(page);
  const currentView = views.locator('a[aria-current="page"]');
  await expect(currentView).toHaveText("Occupation");
  await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  const menu = mainMenu(page);
  const rooms = menu.getByRole("link", { name: "Chambres", exact: true });
  await expect(rooms).toHaveAttribute("aria-current", "location");
  await expect(menu.getByRole("link", { name: /checklist|occupation/i })).toHaveCount(0);
  await rooms.click();
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(menu).toBeHidden();
  await expect(currentView).toHaveText("Checklist");
  await views.getByRole("link", { name: "Occupation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Importer la fiche de séjours", exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
