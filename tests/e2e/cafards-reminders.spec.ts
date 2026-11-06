import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { workEntrySchema, type WorkEntry, type WorkEvent } from "../../lib/rooms";

// Deliberately use another device timezone: follow-ups belong to the hotel's
// calendar day in Paris, including while a page remains open over midnight.
test.use({ timezoneId: "America/Los_Angeles" });

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

function followup(room: string, status: WorkEntry["cafardStatus"], treatedOn: string | null): WorkEvent {
  const entry = workEntrySchema.parse({
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "cafardFollowup", targetId: room, room,
    expectedRevision: 0, date: "2025-06-04", actor: "Agent fictif", notes: "Suivi de démonstration.",
    occurredAt: "2025-06-04T09:00:00.000Z", cafardStatus: status, detectedOn: "2025-05-15",
    treatedOn, resolvedOn: status === "resolu" ? "2025-06-04" : null, product: treatedOn ? "Produit fictif" : "",
  });
  return receipt(entry);
}

function receipt(entry: WorkEntry): WorkEvent {
  return { ...entry, version: 1, updatedAt: entry.occurredAt,
    submissionHash: createHash("sha256").update(JSON.stringify(entry)).digest("hex") };
}

async function mockFollowups(page: Page, initial: WorkEvent[]) {
  const workEvents = [...initial];
  const submitted: WorkEntry[] = [];
  let reads = 0;
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() !== "GET") return route.continue();
    reads++;
    await route.fulfill({ json: { mode: "local", issues: [], inspections: [], roomInspections: [], familyEvents: [], workEvents } });
  });
  await page.route("**/api/entries", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const entry = workEntrySchema.parse(route.request().postDataJSON());
    expect(entry.kind).toBe("cafardFollowup");
    const record = receipt(entry);
    submitted.push(entry);
    workEvents.push(record);
    await route.fulfill({ json: { collection: "workEvents", record } });
  });
  return { submitted, reads: () => reads };
}

test("staff can filter every cafards state and act on seven-day treatment reminders", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2025-06-08T10:00:00.000Z"));
  await login(page);
  const api = await mockFollowups(page, [
    followup("101", "traite", "2025-06-01"), // Due exactly today.
    followup("102", "traite", "2025-06-03"), // Not due until 10 June.
    followup("103", "resolu", "2025-05-25"),
    followup("104", "signale", "2025-05-20"), // Old treatment is historical.
    followup("105", "a_verifier", null),
    followup("106", "traite", "2025-05-30"), // Overdue.
  ]);
  await page.goto("/");
  await expect(page.getByText("Cafards : 2 chambres à vérifier après traitement", { exact: true })).toBeVisible();
  const dashboardLink = page.getByRole("link", { name: "Ouvrir le suivi des cafards", exact: true });
  await expect(dashboardLink).toHaveAttribute("href", "/cafards");
  await dashboardLink.click();
  await expect(page).toHaveURL(/\/cafards$/);
  const filter = page.getByRole("combobox", { name: "État du suivi", exact: true });
  const search = page.getByLabel("Rechercher une chambre", { exact: true });
  const card = (room: string) => page.getByRole("article", { name: "Chambre " + room, exact: true });
  await expect(filter).toHaveValue("pending");
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByText("2 chambres à vérifier après traitement", { exact: true })).toBeVisible();
  await expect(card("101").getByText("Vérification à faire", { exact: true })).toBeVisible();
  await expect(card("101").getByText("Vérification prévue", { exact: true })).toBeVisible();
  await expect(card("101").locator("dd").filter({ hasText: "08/06/2025" })).toHaveCount(1);
  await expect(card("102").getByText("Vérification à faire", { exact: true })).toHaveCount(0);
  await expect(card("102").locator("dd").filter({ hasText: "10/06/2025" })).toHaveCount(1);
  await expect(card("104").getByText("Vérification prévue", { exact: true })).toHaveCount(0);
  await expect(card("106").getByText("Vérification à faire", { exact: true })).toBeVisible();

  for (const [value, room] of [["a_verifier", "105"], ["signale", "104"], ["resolu", "103"]]) {
    await filter.selectOption(value);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(room)).toBeVisible();
  }
  await expect(card("103").getByText("Vérification prévue", { exact: true })).toHaveCount(0);
  await filter.selectOption("all");
  await expect(page.getByRole("article")).toHaveCount(6);
  await filter.selectOption("traite");
  await expect(page.getByRole("article")).toHaveCount(3);
  await search.fill("102");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card("102")).toBeVisible();

  await page.getByRole("button", { name: "Voir les chambres à vérifier", exact: true }).click();
  await expect(filter).toHaveValue("due");
  await expect(search).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(card("101")).toBeVisible();
  await expect(card("106")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: test.info().outputPath("cafards-reminders-mobile.png"), fullPage: true, animations: "disabled" });

  await card("101").getByRole("button", { name: "Mettre à jour", exact: true }).click();
  const update = page.getByRole("dialog", { name: "Cafards · chambre 101", exact: true });
  await update.getByLabel(/^Date d’application du produit/).fill("2025-06-08");
  await update.getByLabel("Observations", { exact: true }).fill("Nouvelle application fictive.");
  await update.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(update).toHaveCount(0);
  await expect.poll(() => api.submitted.length).toBe(1);
  expect(api.submitted[0].treatedOn).toBe("2025-06-08");
  expect(api.submitted[0].expectedRevision).toBe(1);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card("101")).toHaveCount(0);
  await expect(page.getByText("1 chambre à vérifier après traitement", { exact: true })).toBeVisible();
  await filter.selectOption("traite");
  await expect(card("101").locator("dd").filter({ hasText: "15/06/2025" })).toHaveCount(1);
  await expect(card("101").getByText("Vérification à faire", { exact: true })).toHaveCount(0);

  await card("106").getByRole("button", { name: "Mettre à jour", exact: true }).click();
  const resolution = page.getByRole("dialog", { name: "Cafards · chambre 106", exact: true });
  await resolution.getByRole("radiogroup", { name: "État du suivi", exact: true }).getByRole("radio", { name: "Résolu", exact: true }).click();
  await resolution.getByLabel("Observations", { exact: true }).fill("Vérification fictive terminée : aucun cafard.");
  await resolution.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(resolution).toHaveCount(0);
  await expect.poll(() => api.submitted.length).toBe(2);
  expect(api.submitted[1].cafardStatus).toBe("resolu");
  await expect(page.getByRole("button", { name: "Voir les chambres à vérifier", exact: true })).toHaveCount(0);
  await filter.selectOption("resolu");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(card("106").getByText("Résolu", { exact: true })).toBeVisible();
  await expect(card("106").getByText("Vérification prévue", { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(filter).toHaveValue("pending");
  await expect(page.getByRole("article")).toHaveCount(4);
  await expect(card("101").locator("dd").filter({ hasText: "15/06/2025" })).toHaveCount(1);
  await expect(page.getByText("Vérification à faire", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1280);
  await page.screenshot({ path: test.info().outputPath("cafards-reminders-desktop.png"), fullPage: true, animations: "disabled" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Ouvrir le suivi des cafards", exact: true })).toHaveCount(0);
});

test("a treatment reminder becomes due at Paris midnight without reloading the page", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date("2025-06-07T21:00:00.000Z") });
  await login(page);
  const api = await mockFollowups(page, [followup("101", "traite", "2025-06-01")]);
  await page.goto("/cafards");
  const card = page.getByRole("article", { name: "Chambre 101", exact: true });
  await expect(card.getByText("Produit appliqué", { exact: true })).toBeVisible();
  await expect(card.locator("dd").filter({ hasText: "08/06/2025" })).toHaveCount(1);
  await page.clock.pauseAt(new Date("2025-06-07T21:59:30.000Z")); // 23:59 in Paris.
  await expect(card.getByText("Vérification à faire", { exact: true })).toHaveCount(0);
  const readsBeforeMidnight = api.reads();
  await page.clock.runFor(60_000); // 00:00:30 on 8 June in Paris; still 7 June on this device.
  await expect(card.getByText("Vérification à faire", { exact: true })).toBeVisible();
  await expect(page.getByText("1 chambre à vérifier après traitement", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => new Date().getDate())).toBe(7);
  expect(api.reads()).toBe(readsBeforeMidnight);
  expect(api.submitted).toHaveLength(0);
  await page.clock.resume();
});
