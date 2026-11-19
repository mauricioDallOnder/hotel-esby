import { readFile } from "node:fs/promises";
import type { Issue } from "../../lib/domain";
import type { WorkEvent } from "../../lib/rooms";
import { expect, test, type Page } from "./fixtures";

const reportDay = "2025-10-20";
const openedAt = "2025-10-18T09:00:00.000Z";
const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAAMIM/4EAAB/uBfsL2WiLAAAAAElFTkSuQmCC", "base64");

function issue(room: string, title: string, fields: Partial<Issue> = {}): Issue {
  const id = crypto.randomUUID();
  return {
    id, room, location: `Chambre ${room}`, title, description: title, category: "Autre",
    date: openedAt.slice(0, 10), createdAt: openedAt, updatedAt: openedAt, version: 1,
    reportedBy: "Camille", assignee: "Camille", priority: "normale", status: "ouvert",
    history: [{ at: openedAt, actor: "Camille", assignee: "Camille", priority: "normale", status: "ouvert", note: "Signalement" }],
    photoIds: [`photo-${id}`], photoId: null, ...fields,
  };
}

async function loadExamples(page: Page, path: string, additionalIssues: Issue[] = []) {
  const technical = issue("201", "Lampe en panne", { category: "Électricité" });
  const clutter = issue("202", "Chambre encombrée de valises", { problemType: "room_cluttered" });
  const pests = issue("203", "Présence de cafards");
  const repaired = issue("204", "Prise descellée");
  repaired.date = "2025-09-30";
  repaired.createdAt = repaired.date + "T14:10:00.000Z";
  repaired.history[0].at = repaired.createdAt;
  repaired.status = "resolu";
  repaired.updatedAt = reportDay + "T14:10:00.000Z";
  repaired.history.push({ ...repaired.history[0], actor: "Alex", at: repaired.updatedAt, status: "resolu", note: "Prise fixée et testée." });

  const followup: WorkEvent = {
    id: crypto.randomUUID(), type: "createWorkEvent", kind: "cafardFollowup", targetId: "203", room: "203",
    cafardStatus: "traite", date: reportDay, occurredAt: repaired.updatedAt, expectedRevision: 0,
    detectedOn: openedAt.slice(0, 10), treatedOn: reportDay, resolvedOn: null, product: "Gel", notes: "Gel appliqué.",
    actor: "Alex", version: 1, updatedAt: repaired.updatedAt, submissionHash: "test",
  };
  const resolvedCase: WorkEvent = {
    ...followup, id: crypto.randomUUID(), room: "205", targetId: "205", cafardStatus: "resolu",
    resolvedOn: reportDay, notes: "Aucun cafard observé.",
  };

  const session = await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  expect(session.ok()).toBeTruthy();
  await page.route("**/api/hotel*", route => route.fulfill({
    json: { issues: [technical, clutter, pests, repaired, ...additionalIssues], inspections: [], workEvents: [followup, resolvedCase], roomInspections: [], mode: "local" },
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  return { technical, clutter, pests, repaired };
}

test("daily report downloads include the photos of exactly the requested issues", async ({ page }) => {
  const { technical, clutter, pests, repaired } = await loadExamples(page, "/relatorios");
  const photoRequests: string[] = [];
  await page.route("**/api/photos/**", route => {
    photoRequests.push(new URL(route.request().url()).pathname.split("/").pop()!);
    return route.fulfill({ contentType: "image/png", body: photo });
  });
  await page.getByLabel("Date", { exact: true }).fill(reportDay);
  await expect(page.getByText(technical.title, { exact: true })).toBeVisible();

  const scopes = [
    { label: "Tous les problèmes à traiter", prefix: "rapport-quotidien", issues: [technical, clutter, pests] },
    { label: "Problèmes techniques", prefix: "problemes-techniques", issues: [technical] },
    { label: "Chambres encombrées", prefix: "chambres-encombrees", issues: [clutter] },
    { label: "Problèmes résolus", prefix: "problemes-resolus", issues: [repaired] },
    { label: "Rapport complet", prefix: "rapport-complet", issues: [technical, clutter, pests, repaired] },
  ];
  for (const scope of scopes) {
    await test.step(scope.label, async () => {
      await page.getByRole("combobox", { name: "Contenu", exact: true }).click();
      await page.getByRole("option", { name: scope.label, exact: true }).click();
      const includesResolvedCase = scope.prefix === "rapport-complet" || scope.prefix === "problemes-resolus";
      await expect(page.getByText("Cafards · Chambre 205", { exact: true })).toHaveCount(includesResolvedCase ? 1 : 0);
      photoRequests.length = 0;
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "Télécharger le PDF", exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(`${scope.prefix}-${reportDay}.pdf`);
      const document = await readFile((await download.path())!);
      expect(document.subarray(0, 5).toString()).toBe("%PDF-");
      expect([...photoRequests].sort()).toEqual(scope.issues.map(item => item.id).sort());
    });
  }
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("mobile navigation separates technical problems and clutter, including after resetting filters", async ({ page }) => {
  const { technical, clutter, repaired } = await loadExamples(page, "/anomalies");
  const types = page.getByRole("group", { name: "Filtrer par type de problème", exact: true });
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleName(`${technical.location} · ${technical.title}`);
  await types.getByRole("button", { name: "Cafards", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleName("Chambre 203");
  await expect(cards.getByText("Produit appliqué", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "État du suivi", exact: true }).selectOption("resolu");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleName("Chambre 205");

  await types.getByRole("button", { name: "Problèmes techniques", exact: true }).click();
  await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleName(`${repaired.location} · ${repaired.title}`);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("link", { name: "État général de chambre", exact: true }).click();
  await expect(page.getByRole("heading", { name: "État général de chambre", exact: true })).toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleName(`${clutter.location} · ${clutter.title}`);
  await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(cards).toHaveAccessibleName(`${clutter.location} · ${clutter.title}`);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("legacy remarks and mixed inspections appear under the relevant room condition and status", async ({ page }) => {
  const legacy = issue("207", "Chambre encombrée de bagages");
  const mixed = issue("208", "Contrôle de la chambre 208", { status: "en_cours", roomFindings: [
    { key: "room_clutter", label: "Chambre encombrée d’affaires", status: "resolu" },
    { key: "radiator_clear", label: "Radiateur encombré", status: "ouvert" },
  ] });
  await loadExamples(page, "/etat-general-de-chambre", [legacy, mixed]);
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: legacy.title })).toBeVisible();
  await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(cards).toHaveAccessibleName("Chambre 208 · Chambre encombrée d’affaires");
  await page.goto("/anomalies");
  const radiator = page.getByRole("article", { name: "Chambre 208 · Radiateur encombré", exact: true });
  await expect(radiator).toBeVisible();
  await expect(radiator).not.toContainText("Chambre encombrée d’affaires");
  await expect(cards.filter({ hasText: legacy.title })).toHaveCount(0);
});

test("the monthly resolved report follows the resolution month and requires a valid period", async ({ page }) => {
  const { repaired, technical } = await loadExamples(page, "/relatorios");
  await page.getByRole("combobox", { name: "Type de rapport", exact: true }).click();
  await page.getByRole("option", { name: "Bilan mensuel", exact: true }).click();
  await page.getByRole("combobox", { name: "Contenu", exact: true }).click();
  await page.getByRole("option", { name: "Problèmes résolus", exact: true }).click();
  const month = page.getByLabel("Mois", { exact: true });
  const downloadButton = page.getByRole("button", { name: "Télécharger le PDF", exact: true });
  await month.fill("");
  await expect(downloadButton).toBeDisabled();
  await month.fill("2025-10");
  await expect(page.getByText(repaired.title, { exact: true })).toBeVisible();
  await expect(page.getByText(technical.title, { exact: true })).toHaveCount(0);
  await page.route("**/api/photos/**", route => route.fulfill({ contentType: "image/png", body: photo }));
  const downloading = page.waitForEvent("download");
  await downloadButton.click();
  expect((await downloading).suggestedFilename()).toBe("problemes-resolus-2025-10.pdf");
  await month.fill("2025-11");
  await expect(page.getByText(repaired.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Aucun problème résolu sur la période.", { exact: true })).toBeVisible();
});
