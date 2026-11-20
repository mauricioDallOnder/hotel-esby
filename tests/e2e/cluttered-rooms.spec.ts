import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "./fixtures";
import { today, type Issue, type State } from "../../lib/domain";
import { prepareE2ELocalData, resetE2ELocalData } from "./helpers/local-data";

const clutterLabel = "Chambre encombrée d’affaires";
const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");

async function login(page: Page) {
  const response = await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  expect(response.ok()).toBeTruthy();
}

async function state(page: Page): Promise<State> {
  const response = await page.request.get("/api/hotel");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function choose(dialog: Locator, label: string, answer: string) {
  await dialog.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: answer, exact: true }).click();
}

async function prepareRoom(page: Page, room: string, actor: string, clutter?: "Oui" | "Non", checkEquipment?: (dialog: Locator) => Promise<void>) {
  await page.getByRole("button", { name: `Contrôler la chambre ${room}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  // A known technical problem leaves this broad question for an individual check.
  await choose(dialog, "État du mobilier et des équipements", "OK");
  if (checkEquipment) await checkEquipment(dialog);
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  const question = dialog.getByRole("radiogroup", { name: clutterLabel, exact: true });
  await expect(question.getByRole("radio")).toHaveCount(2);
  await expect(question.getByRole("radio", { checked: true })).toHaveCount(0);
  await choose(dialog, "Chambre occupée", "Occupée");
  await choose(dialog, "État général de la chambre", "Bon");
  if (clutter) await choose(dialog, clutterLabel, clutter);
  await choose(dialog, "Présence de cafards ou nuisibles", "Aucun");
  await choose(dialog, "État de la moquette", "OK");
  await choose(dialog, "Micro-ondes présent ?", "Non");
  await choose(dialog, "Propreté du minibar", "Propre");
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await dialog.getByLabel(/^Inspecteur\s*\*?$/).fill(actor);
  return dialog;
}

async function saveRoom(page: Page, dialog: Locator) {
  const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Enregistrements à jour", { exact: true })).toBeVisible();
}

test("clutter needs an explicit answer after bulk equipment OK and Non creates no technical problem", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/checklist");
  const dialog = await prepareRoom(page, "118", "Contrôle sans encombrement");
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  const question = dialog.getByRole("radiogroup", { name: clutterLabel, exact: true });
  await expect(question).toBeVisible();
  await expect(question.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(dialog.getByText("Il reste des points à vérifier. Aucun contrôle n’a été enregistré.", { exact: true })).toBeVisible();
  expect((await state(page)).roomInspections).toHaveLength(0);
  await choose(dialog, clutterLabel, "Non");
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await saveRoom(page, dialog);
  const saved = await state(page);
  expect(saved.issues).toHaveLength(0);
  expect(saved.roomInspections).toHaveLength(1);
  expect(saved.roomInspections![0].checks.find(check => check.key === "room_clutter")?.result).toBe("ok");
  expect(saved.roomInspections![0].schemaVersion).toBe(7);
});

test("mobile clutter controls reuse the open problem and Rapports exports all original and follow-up photos", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/checklist");
  let dialog = await prepareRoom(page, "117", "Premier constat encombrement", "Oui");
  await expect(dialog.getByText(clutterLabel, { exact: true })).toBeVisible();
  await dialog.getByLabel("Observations et problèmes constatés", { exact: true }).fill("Valises et sacs qui encombrent la chambre.");
  await dialog.locator('input[type="file"][multiple]').setInputFiles([1, 2, 3].map(index => ({ name: `constat-${index}.png`, mimeType: "image/png", buffer: photo })));
  await expect(dialog.getByAltText("Photo du contrôle 3", { exact: true })).toBeVisible();
  await saveRoom(page, dialog);

  const firstState = await state(page);
  const issue = firstState.issues.find(record => record.room === "117");
  expect(issue).toBeTruthy();
  expect(issue!.roomFindings).toEqual([expect.objectContaining({ key: "room_clutter", problemType: "room_cluttered" })]);
  expect(issue!.photoIds).toHaveLength(3);

  dialog = await prepareRoom(page, "117", "Nouvelle visite encombrement", "Oui");
  await expect(dialog.getByText(/Déjà signalé : .*aucun doublon/)).toBeVisible();
  await dialog.getByLabel("Observations et problèmes constatés", { exact: true }).fill("Encombrement toujours présent à la nouvelle visite.");
  await dialog.locator('input[type="file"][multiple]').setInputFiles([1, 2].map(index => ({ name: `suivi-${index}.png`, mimeType: "image/png", buffer: photo })));
  await expect(dialog.getByAltText("Photo du contrôle 2", { exact: true })).toBeVisible();
  await saveRoom(page, dialog);

  const saved = await state(page);
  expect(saved.issues.filter(record => record.room === "117")).toHaveLength(1);
  const repeated = saved.roomInspections!.find(record => record.actor === "Nouvelle visite encombrement")!;
  expect(repeated.relatedIssueIds).toEqual([issue!.id]);
  expect(repeated.photoIds).toHaveLength(2);

  await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  await expect(page.getByRole("link", { name: "Rapports", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tâches du jour", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Rapports", exact: true }).click();
  await expect(page).toHaveURL(/\/relatorios$/);
  await page.getByRole("combobox", { name: "Contenu", exact: true }).click();
  await page.getByRole("option", { name: "Chambres encombrées", exact: true }).click();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("clutter-reports-mobile.png"), fullPage: true });

  const photoRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/photos/")) photoRequests.push(request.url()); });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const pdf = await readFile(downloadedPath!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(1000);
  const expectedRequests = [
    ...[0, 1, 2].map(index => `/api/photos/${issue!.id}?index=${index}&collection=issues&v=2`),
    ...[0, 1].map(index => `/api/photos/${repeated.id}?index=${index}&collection=roomInspections&v=2`),
  ];
  expect(photoRequests.map(url => new URL(url).pathname + new URL(url).search).sort()).toEqual(expectedRequests.sort());
});

test("room 117 saves the obstructed radiator and clutter with their own issues and leaves the old tap report untouched", async ({ page }) => {
  const date = today();
  function existingIssue(title: string, roomFindings: NonNullable<Issue["roomFindings"]>): Issue {
    return {
      id: crypto.randomUUID(), room: "117", location: "Chambre 117", title, description: title, roomFindings,
      category: "Équipements", status: "ouvert", priority: "normale", version: 1, history: [],
      date, createdAt: date + "T08:00:00.000Z", updatedAt: date + "T08:00:00.000Z", assignee: "Équipe de test",
      reportedBy: "Équipe de test", photoId: null, photoIds: [],
    };
  }
  const tap = existingIssue("Robinet de la salle de bains", [
    { key: "taps", label: "Robinets fonctionnels : Problème", status: "ouvert" },
    { key: "damage", label: "Rien de cassé : Problème", status: "ouvert" },
  ]);
  const heater = existingIssue("Radiateur caché ou encombré", [
    { key: "radiator_clear", label: "Radiateur caché ou encombré", problemType: "radiator_obstructed" },
  ]);
  const clutter = existingIssue(clutterLabel, [
    { key: "room_clutter", label: clutterLabel, problemType: "room_cluttered" },
  ]);
  resetE2ELocalData(prepareE2ELocalData(), [tap, heater, clutter]);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/checklist");
  const actor = "Visite de vérification 117";
  const dialog = await prepareRoom(page, "117", actor, "Oui", async equipment => {
    await choose(equipment, "Robinets fonctionnels", "OK");
    await choose(equipment, "Chauffage / radiateur", "Caché");
  });
  for (const [label, issue] of [["Chauffage / radiateur", heater], [clutterLabel, clutter]] as const) {
    const association = dialog.getByRole("combobox", { name: `Associer au problème existant · ${label}`, exact: true });
    await expect(association).toContainText(issue.title);
    await association.click();
    await expect(page.getByRole("option", { name: new RegExp(tap.title) })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await saveRoom(page, dialog);
  await page.reload();
  const saved = await state(page);
  expect(saved.issues).toHaveLength(3);
  expect(saved.issues.find(issue => issue.id === tap.id)).toEqual(tap);
  expect(saved.roomInspections).toHaveLength(1);
  const inspection = saved.roomInspections![0];
  expect(inspection.issueAssociations).toHaveLength(2);
  for (const [key, issue] of [["radiator_clear", heater], ["room_clutter", clutter]] as const) {
    expect(inspection.issueAssociations).toContainEqual(expect.objectContaining({ key, issueId: issue.id, findingKey: key, outcome: "present" }));
    expect(saved.issues.find(record => record.id === issue.id)?.history.filter(event => event.inspectionId === inspection.id)).toHaveLength(1);
  }
  await page.getByRole("button", { name: "Historique de la chambre 117", exact: true }).click();
  const history = page.getByRole("dialog");
  await history.getByRole("button", { name: new RegExp(actor) }).click();
  await history.getByRole("button", { name: "Afficher tous les points de contrôle", exact: true }).click();
  await expect(history.locator('[data-result="bad"]').filter({ hasText: "Chauffage / radiateur : Caché" })).toBeVisible();
  await expect(history.locator('[data-result="bad"]').filter({ hasText: clutterLabel + " : Oui" })).toBeVisible();
  await expect(history.locator('[data-result="ok"]').filter({ hasText: "Robinets fonctionnels" })).toBeVisible();
});
