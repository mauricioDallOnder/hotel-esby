import { expect, test, type Page } from "./fixtures";
import { today, type Issue, type State } from "../../lib/domain";
import { cafardCases } from "../../lib/cafards";
import { roomChecks, rooms, type RoomInspection, type WorkEntry } from "../../lib/rooms";
import { roomReceipt, workReceipt } from "./helpers/receipts";

async function login(page: Page) {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
}

async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}

test("chambre 323 · a repaired toilet and an obstructed radiator are confirmed in one mobile inspection", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } })).ok()).toBeTruthy();
  const toilet = crypto.randomUUID(), heater = crypto.randomUUID();
  for (const [id, title] of [[toilet, "Chasse d’eau cassée"], [heater, "Chauffage encombré"]]) {
    const response = await page.request.post("/api/hotel", { data: { type: "createIssue", id, date: today(), actor: "Réception",
      fields: { title, location: "Chambre 323", category: "Équipements", priority: "haute", description: title, assignee: "" } } });
    expect(response.status(), await response.text()).toBe(200);
  }
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Contrôler la chambre 323", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const answer = (label: string, name: string) => dialog.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name, exact: true }).click();
  await dialog.getByRole("button", { name: /les équipements restants sont OK/ }).click();
  await answer("État du mobilier et des équipements", "OK");
  await answer("Chauffage / radiateur", "Caché");
  await dialog.getByRole("button", { name: "Continuer · État et ménage" }).click();
  await answer("Chambre occupée", "Occupée");
  await answer("État général de la chambre", "Bon");
  await answer("Chambre encombrée d’affaires", "Non");
  await answer("Présence de cafards ou nuisibles", "Aucun");
  await answer("État de la moquette", "OK");
  await answer("Micro-ondes présent ?", "Non");
  await answer("Propreté du minibar", "Propre");
  await dialog.getByRole("button", { name: "Continuer · Résumé" }).click();
  await dialog.getByLabel(/^Inspecteur\s*\*?$/).fill("Mauricio test");
  await dialog.getByRole("combobox", { name: "Associer une réparation effectuée" }).click();
  await page.getByRole("option", { name: "État du mobilier et des équipements", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Associer au problème existant · État du mobilier et des équipements" }).click();
  await page.getByRole("option", { name: /^Chasse d’eau cassée/ }).click();
  await dialog.getByLabel("Observation sur la fiche · État du mobilier et des équipements").fill("Mécanisme remis en place et testé.");
  await dialog.locator('input[type="file"][multiple]').setInputFiles({ name: "visite.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") });
  await expect(dialog.getByAltText("Photo du contrôle 1")).toBeVisible();
  await expect(dialog.getByText("1 constat(s) lié(s) encore présent(s) · 1 résolu(s)")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  const sent = page.waitForResponse(r => r.url().endsWith("/api/entries") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Chambre 323", exact: true })).toContainText("1 problème technique");
  await expect(page.getByRole("alert", { name: "Priorités incendie" })).toHaveCount(0);
  const after = await state(page);
  expect(after.issues).toHaveLength(2);
  expect(after.roomInspections).toHaveLength(1);
  expect(after.issues.find(issue => issue.id === toilet)?.status).toBe("resolu");
  expect(after.issues.find(issue => issue.id === heater)?.status).toBe("ouvert");
  expect(after.roomInspections![0].issueAssociations).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "damage", issueId: toilet, outcome: "resolved" }),
    expect.objectContaining({ key: "radiator_clear", issueId: heater, outcome: "present" }),
  ]));
  await page.goto("/anomalies");
  const pending = page.getByRole("article").filter({ hasText: "Chauffage encombré" });
  await pending.getByRole("button", { name: "Ouvrir le suivi" }).click();
  await dialog.getByRole("button", { name: "Historique (2)" }).click();
  await dialog.getByText(/Photos du contrôle du/).click();
  await expect(dialog.getByRole("img", { name: "Chambre 323 · photo 1 du contrôle" })).toBeVisible();
});

test("bulk OK includes smoke, minibar presence stays consistent and a new detection reuses the existing cafard follow-up", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const treatment: WorkEntry = {
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "cafardFollowup", targetId: "125", room: "125",
    expectedRevision: 0, expectedPreviousEventId: null, date: today(), occurredAt: new Date().toISOString(), actor: "Test suivi existant",
    cafardStatus: "traite", detectedOn: today(), treatedOn: today(), resolvedOn: null,
    product: "Gel fictif", notes: "Traitement de test à conserver.", cafardObservationId: null,
  };
  expect((await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: treatment })).ok()).toBeTruthy();
  const before = await state(page);
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Contrôler la chambre 125", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const group = (label: string) => dialog.getByRole("radiogroup", { name: label, exact: true });
  const choose = async (label: string, answer: string) => group(label).getByRole("radio", { name: answer, exact: true }).click();
  const bulk = dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true });
  await expect(dialog.getByText("Suivi des cafards déjà existant · Produit appliqué", { exact: true })).toBeVisible();
  await bulk.click();
  await expect(group("Détecteur de fumée fonctionnel").getByRole("radio", { name: "OK", exact: true })).toHaveAttribute("aria-checked", "true");
  await choose("Minibar fonctionnel", "Absent");
  await bulk.click();
  await expect(group("Minibar fonctionnel").getByRole("radio", { name: "Absent", exact: true })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await expect(group("Minibar / réfrigérateur présent ?").getByRole("radio", { name: "Non", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(group("Propreté du minibar")).toHaveCount(0);
  await choose("Minibar / réfrigérateur présent ?", "Oui");
  // Presence alone must not assert that the appliance works.
  await expect(group("Minibar fonctionnel").getByRole("radio", { checked: true })).toHaveCount(0);
  await choose("Minibar fonctionnel", "Problème");
  await choose("Minibar / réfrigérateur présent ?", "Oui");
  await dialog.getByRole("button", { name: "1. Équipements", exact: true }).click();
  await expect(group("Minibar fonctionnel").getByRole("radio", { name: "Problème", exact: true })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await choose("Minibar / réfrigérateur présent ?", "Non");
  await expect(group("Propreté du minibar")).toHaveCount(0);
  await choose("Chambre occupée", "Occupée");
  await choose("État général de la chambre", "Bon");
  await choose("Chambre encombrée d’affaires", "Non");
  await choose("Présence de cafards ou nuisibles", "Détectés");
  await expect(dialog.getByText("Cette détection sera ajoutée au suivi existant de cette chambre, sans créer de doublon.", { exact: true })).toBeVisible();
  await choose("État de la moquette", "OK");
  await choose("Micro-ondes présent ?", "Non");
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await dialog.getByLabel(/^Inspecteur\s*\*?$/).fill("Test minibar absent");
  await dialog.getByLabel("Observations et problèmes constatés", { exact: true }).fill("Nouvelle observation fictive dans la même chambre.");
  await expect(dialog.getByText("Cafards détectés : constat ajouté au suivi existant de cette chambre. Aucun doublon.", { exact: true })).toBeVisible();
  const saved = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  const after = await state(page);
  const inspection = after.roomInspections!.find(record => record.actor === "Test minibar absent")!;
  expect(inspection.checks.find(check => check.key === "smoke")?.result).toBe("ok");
  expect(inspection.checks.find(check => check.key === "fridge")?.result).toBe("absent");
  expect(inspection.fridgeCleaning).toBeNull();
  expect(inspection).not.toHaveProperty("fridgePresent");
  expect(after.issues.length).toBe(before.issues.length);
  expect(after.workEvents!.filter(event => event.kind === "cafardFollowup" && event.room === "125")).toHaveLength(1);
  const cases = cafardCases(after.roomInspections || [], after.workEvents || []).filter(record => record.room === "125");
  expect(cases).toHaveLength(1);
  expect(cases[0].status).toBe("traite");
  expect(cases[0].treatedOn).toBe(treatment.treatedOn);
  expect(cases[0].history.map(event => event.id)).toEqual(expect.arrayContaining([treatment.id, inspection.id]));
  await page.goto("/cafards");
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("125");
  await expect(page.getByRole("article", { name: "Chambre 125", exact: true })).toHaveCount(1);
  await expect(page.getByRole("article").getByText("Produit appliqué", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").getByText(/Cafards encore observés le/)).toBeVisible();
  await expect(page.getByRole("article").getByText("Produit : Gel fictif", { exact: true })).toBeVisible();
});

test("room rotation cards keep equal dimensions on mobile and desktop and known smoke faults remain individual checks", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await login(page);
  const date = today(new Date(Date.now() - 8 * 86_400_000));
  const prior = (room: string, recordDate = date, condition: RoomInspection["condition"] = "mauvais"): RoomInspection => roomReceipt({
    type: "createRoomInspection", schemaVersion: 6, id: crypto.randomUUID(), room, date: recordDate,
    inspectedAt: `${recordDate}T08:00:00.000Z`, actor: "Test présentation", notes: "État fictif pour vérifier les cartes.",
    condition, occupied: true, cleaning: null, carpet: "ok", carpetNotes: "",
    microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non",
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
    photosData: [],
  }).record;
  const known: Issue = {
    id: crypto.randomUUID(), room: "107", title: "Détecteur de fumée en panne", description: "Détecteur déjà signalé.",
    location: "Chambre 107", category: "Équipements", status: "ouvert", priority: "normale", assignee: "Test",
    date, createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`, version: 1,
    photoId: null, photoIds: [], reportedBy: "Test", history: [], roomFindings: [{ key: "smoke", label: "Détecteur de fumée fonctionnel : Problème" }],
  };
  const treatment = workReceipt({
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "cafardFollowup", targetId: "107", room: "107",
    expectedRevision: 0, expectedPreviousEventId: null, date, occurredAt: `${date}T08:00:00.000Z`, actor: "Test suivi existant", notes: "Traitement fictif.",
    cafardStatus: "traite", detectedOn: date, treatedOn: date, resolvedOn: null, product: "Gel test",
  });
  const recent = today(new Date(Date.now() - 86_400_000));
  // Twelve incomplete rooms and three mature poor-condition follow-ups produce
  // mixed card labels under the new fair ordering, instead of fifteen identical
  // never-completed cards masking a layout regression.
  const records = [prior("101"), prior("102"), prior("103"), ...rooms.slice(15).map(room => prior(room, recent, "bon"))];
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { mode: "local", issues: [known], inspections: [], roomInspections: records, workEvents: [treatment] } });
  });
  await page.goto("/checklist");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByRole("button", { name: "Activer le mode sombre", exact: true }).click();
    const cards = page.getByRole("group", { name: "Chambres de la tournée", exact: true }).getByRole("button");
    await expect(cards).toHaveCount(15);
    const dimensions = await cards.evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
    expect(Math.max(...dimensions.map(size => size.width)) - Math.min(...dimensions.map(size => size.width))).toBeLessThan(1);
    expect(Math.max(...dimensions.map(size => size.height)) - Math.min(...dimensions.map(size => size.height))).toBeLessThan(1);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await page.getByRole("group", { name: "Chambres de la tournée", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`checklist-uniform-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Contrôler la chambre 107", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Suivi des cafards déjà existant · Produit appliqué", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Vérification après traitement à faire depuis le/)).toBeVisible();
  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  await expect(dialog.getByRole("radiogroup", { name: "Détecteur de fumée fonctionnel", exact: true }).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(dialog.getByRole("radiogroup", { name: "Robinets fonctionnels", exact: true }).getByRole("radio", { name: "OK", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await dialog.locator(".MuiDialogContent-root").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("checklist-existing-followup-dark-mobile.png"), animations: "disabled" });
});
