import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyCommand, type Command, type Issue, type State } from "../../lib/domain";
import { commandOperation, isCommandReplay, stampCommandReceipt } from "../../lib/commandReceipt";
import { entrySchema, type Entry, type WorkEvent } from "../../lib/rooms";
import { validateWorkEntry, validateWorkPredecessor } from "../../lib/work";
import { roomReceipt, workReceipt } from "./helpers/receipts";

const day = "2026-11-11";
const instant = day + "T12:00:00.000Z";
const socketLabel = "Prise électrique cassée ou mal fixée";

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: crypto.randomUUID(), version: 1, room: "325", location: "Chambre 325",
    title: "Prise côté bureau cassée", description: "La prise électrique côté bureau est cassée.",
    category: "Électricité", priority: "normale", status: "ouvert", assignee: "Agent fictif", reportedBy: "Agent fictif",
    date: day, createdAt: instant, updatedAt: instant, photoId: null, photoIds: [], history: [], ...overrides,
  };
}

async function fixture(page: Page, initialIssues: Issue[] = [], initialWork: WorkEvent[] = [], role: "employe" | "direction" = "employe") {
  await page.clock.setFixedTime(new Date(instant));
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/session", { data: { role, password: role === "direction" ? "test-direction" : "test-employee" } })).ok()).toBeTruthy();
  const data: State & { mode: "local" } = {
    mode: "local", issues: [...initialIssues], inspections: [], roomInspections: [], familyEvents: [], workEvents: [...initialWork],
  };
  const commands: Command[] = [], entries: Entry[] = [];
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    const command = route.request().postDataJSON() as Command;
    commands.push(command);
    const operation = commandOperation(command);
    if (isCommandReplay(data, command, operation)) return route.fulfill({ json: data });
    const change = applyCommand(data, command, instant);
    stampCommandReceipt(change, operation);
    expect(change.collection).toBe("issues");
    if (change.collection === "issues") data.issues = [...data.issues.filter(record => record.id !== change.record.id), change.record];
    return route.fulfill({ json: data });
  });
  await page.route("**/api/entries", async route => {
    const entry = entrySchema.parse(route.request().postDataJSON());
    entries.push(entry);
    if (entry.type === "createRoomInspection") {
      const receipt = roomReceipt(entry, data.issues, instant);
      data.roomInspections!.push(receipt.record);
      if (receipt.issue) data.issues.push(receipt.issue);
      return route.fulfill({ json: receipt });
    }
    expect(entry.type).toBe("createWorkEvent");
    if (entry.type === "createWorkEvent") {
      const error = validateWorkPredecessor(entry, data.workEvents || [], true) ||
        validateWorkEntry(entry, data.workEvents || [], data.familyEvents || [], [], data.roomInspections || []);
      if (error) return route.fulfill({ status: 409, json: { error } });
      const record = workReceipt(entry);
      data.workEvents!.push(record);
      return route.fulfill({ json: { collection: "workEvents", record } });
    }
    return route.fulfill({ status: 400, json: { error: "Unexpected fixture entry." } });
  });
  return { data, commands, entries };
}

async function select(page: Page, scope: Locator, label: string, option: string | RegExp) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}

async function openRoom(page: Page) {
  await page.goto("/checklist");
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("325");
  await page.getByRole("button", { name: "Contrôler la chambre 325", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Chambre 325/ });
  await dialog.getByRole("radiogroup", { name: "Rien de cassé", exact: true }).getByRole("radio", { name: "Problème", exact: true }).click();
  return dialog;
}

async function finishRoomAnswers(dialog: Locator) {
  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  for (const [label, answer] of [
    ["Chambre occupée", "Occupée"], ["État général de la chambre", "Bon"], ["Présence de cafards ou nuisibles", "Aucun"],
    ["État de la moquette", "OK"], ["Micro-ondes présent ?", "Non"], ["Propreté du minibar", "Propre"],
  ]) await dialog.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: answer, exact: true }).click();
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await dialog.getByLabel("Inspecteur", { exact: true }).fill("Agent de test");
}

test("a frequent problem fills the report and Other keeps a required free description", async ({ page }) => {
  const api = await fixture(page);
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Signaler une anomalie", exact: true });
  await select(page, dialog, "Problème constaté", socketLabel);
  await expect(dialog.getByLabel("Titre", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Catégorie", exact: true })).toContainText("Électricité");
  await dialog.getByLabel("Lieu précis").fill("Chambre 304");
  await dialog.getByLabel("Signalé par").fill("Agent de test");
  // The selected problem is sufficient: an optional precision can stay empty.
  await dialog.getByLabel("Description du problème").fill("");
  await dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0]).toMatchObject({ type: "createIssue", fields: {
    problemType: "electrical_socket", title: socketLabel, category: "Électricité", description: socketLabel,
  } });

  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  await select(page, dialog, "Problème constaté", "Chauffage / radiateur en panne");
  await select(page, dialog, "Problème constaté", "Autre problème");
  await dialog.getByLabel("Titre", { exact: true }).fill("Étagère du placard fissurée");
  await dialog.getByLabel("Lieu précis").fill("Chambre 305");
  await dialog.getByLabel("Signalé par").fill("Agent de test");
  await dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Vérifiez les champs obligatoires" })).toBeVisible();
  expect(api.commands).toHaveLength(1);
  await dialog.getByLabel("Description du problème").fill("La tablette supérieure du placard est fissurée.");
  await dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.commands[1]).toMatchObject({ type: "createIssue", fields: {
    problemType: "other", title: "Étagère du placard fissurée", description: "La tablette supérieure du placard est fissurée.",
  } });
});

test("direction can reclassify a typed issue without retaining an unrelated preset", async ({ page }) => {
  const existing = issue({ problemType: "electrical_socket", title: socketLabel });
  const api = await fixture(page, [existing], [], "direction");
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Suivi de l’anomalie/ });
  await dialog.getByRole("button", { name: "Modifier la fiche / voir les photos", exact: true }).click();
  await dialog.getByLabel("Titre", { exact: true }).fill("Abattant WC cassé");
  await dialog.getByLabel("Description du problème").fill("L’abattant WC est cassé, correction du constat initial.");
  await select(page, dialog, "Catégorie", "Plomberie");
  await dialog.getByLabel("Intervention saisie par").fill("Direction de test");
  await dialog.getByLabel("Intervention ou modification effectuée").fill("Correction du type de problème après vérification.");
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0]).toMatchObject({ type: "updateIssue", id: existing.id, fields: {
    title: "Abattant WC cassé", category: "Plomberie", problemType: "other",
  } });
});

test("a checklist explicitly reuses any open issue of its room even when the wording differs", async ({ page }) => {
  const socket = issue();
  const closed = issue({ title: "Ancienne prise réparée", status: "resolu" });
  const elsewhere = issue({ room: "326", location: "Chambre 326", title: "Prise d’un autre étage" });
  const api = await fixture(page, [socket, closed, elsewhere]);
  const dialog = await openRoom(page);
  await select(page, dialog, "Problème constaté · Rien de cassé", "Autre problème");
  await dialog.getByLabel("Décrivez le problème · Rien de cassé").fill("Cache endommagé au même endroit.");
  await finishRoomAnswers(dialog);
  const association = dialog.getByRole("combobox", { name: "Associer au problème existant · Rien de cassé", exact: true });
  await association.click();
  await expect(page.getByRole("option", { name: /Ancienne prise réparée/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Prise d’un autre étage/ })).toHaveCount(0);
  await page.getByRole("option", { name: /^Prise côté bureau cassée ·/ }).click();
  await expect(dialog.getByText(/Déjà signalé : Prise côté bureau cassée · aucun doublon/)).toBeVisible();
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => api.entries.length).toBe(1);
  expect(api.entries[0]).toMatchObject({ type: "createRoomInspection", notes: "", issueLinks: [{ key: "damage", issueId: socket.id }],
    problemDetails: [{ key: "damage", problemType: "other", description: "Cache endommagé au même endroit." }] });
  expect(api.data.issues).toHaveLength(3);
  expect(api.data.roomInspections![0].relatedIssueIds).toEqual([socket.id]);
  expect(api.data.roomInspections![0].createdIssue).toBe(false);
});

test("a new broken-item finding asks for identification and accepts a preset without repeated notes", async ({ page }) => {
  const api = await fixture(page);
  const dialog = await openRoom(page);
  await finishRoomAnswers(dialog);
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Problème constaté · Rien de cassé", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("Choisissez ou décrivez ce qui est cassé, ou associez le problème déjà ouvert.", { exact: true })).toBeVisible();
  expect(api.entries).toHaveLength(0);
  await select(page, dialog, "Problème constaté · Rien de cassé", socketLabel);
  await dialog.getByRole("button", { name: "3. Résumé", exact: true }).click();
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => api.entries.length).toBe(1);
  expect(api.entries[0]).toMatchObject({ type: "createRoomInspection", notes: "", problemDetails: [{ key: "damage", problemType: "electrical_socket" }] });
  expect(api.data.issues).toHaveLength(1);
  expect(api.data.issues[0].roomFindings).toEqual([{ key: "damage", problemType: "electrical_socket", label: socketLabel }]);
});

test("a possible duplicate needs an explicit choice and an unspecified broken item gets a field error", async ({ page }) => {
  const socket = issue();
  const legacy = issue({ title: "Contrôle antérieur · élément cassé", description: "Rien de cassé : Problème",
    category: "Équipements", roomFindings: [{ key: "damage", label: "Rien de cassé : Problème" }] });
  const api = await fixture(page, [socket, legacy]);
  const dialog = await openRoom(page);
  await select(page, dialog, "Problème constaté · Rien de cassé", socketLabel);
  await finishRoomAnswers(dialog);
  await expect(dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("alert").filter({ hasText: "Choisissez le signalement à réutiliser" })).toBeVisible();
  expect(api.entries).toHaveLength(0);
  await select(page, dialog, "Associer au problème existant · Rien de cassé", /^Prise côté bureau cassée ·/);
  await expect(dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "1. Équipements", exact: true }).click();
  await select(page, dialog, "Problème constaté · Rien de cassé", "Préciser le problème");
  await dialog.getByRole("radiogroup", { name: "Rien de cassé", exact: true }).getByRole("radio", { name: "OK", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Problème constaté · Rien de cassé", exact: true })).toHaveCount(0);
  // This item is now a different observation; no stale association may survive.
  await dialog.getByRole("radiogroup", { name: "Rien de cassé", exact: true }).getByRole("radio", { name: "Problème", exact: true }).click();
  await select(page, dialog, "Problème constaté · Rien de cassé", "Autre problème");
  await dialog.getByRole("button", { name: "3. Résumé", exact: true }).click();
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog.getByLabel("Décrivez le problème · Rien de cassé")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("Décrivez cet autre problème.", { exact: true })).toBeVisible();
  expect(api.entries).toHaveLength(0);
  await dialog.getByLabel("Décrivez le problème · Rien de cassé").fill("Un autre élément à préciser pendant cette vérification.");
  await dialog.getByRole("button", { name: "3. Résumé", exact: true }).click();
  await select(page, dialog, "Associer au problème existant · Rien de cassé", /^Prise côté bureau cassée ·/);
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => api.entries.length).toBe(1);
  expect(api.data.issues).toHaveLength(2);
  expect(api.data.roomInspections![0].relatedIssueIds).toEqual([socket.id]);
});

test("cafards opens the existing follow-up and returns to the same technical text and photos", async ({ page }) => {
  const treatment = workReceipt({
    type: "createWorkEvent", id: crypto.randomUUID(), kind: "cafardFollowup", targetId: "114", room: "114", expectedRevision: 0,
    expectedPreviousEventId: null, date: day, occurredAt: instant, actor: "Agent fictif", notes: "Application de test.", cafardStatus: "traite",
    detectedOn: day, treatedOn: day, resolvedOn: null, product: "Gel fictif", cafardObservationId: null,
  });
  const api = await fixture(page, [], [treatment]);
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Signaler une anomalie", exact: true });
  await dialog.getByLabel("Titre", { exact: true }).fill("Observation à compléter");
  await dialog.getByLabel("Description du problème").fill("Mon texte reste disponible au retour.");
  await dialog.getByLabel("Lieu précis").fill("Chambre 999");
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await dialog.locator('input[type="file"][multiple]').setInputFiles({ name: "test.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg, "base64") });
  await expect(dialog.getByText("1 / 3 photos · facultatif", { exact: true })).toBeVisible();
  await select(page, dialog, "Problème constaté", "Cafards / nuisibles · suivi dédié");
  await expect(dialog.getByRole("button", { name: "Continuer dans le suivi des cafards", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Indiquez le numéro d’une chambre de l’hôtel.", { exact: true })).toBeVisible();
  await dialog.getByLabel("Lieu précis").fill("Chambre 114");
  await dialog.getByRole("button", { name: "Ouvrir le suivi des cafards existant", exact: true }).click();
  const followup = page.getByRole("dialog", { name: "Cafards · chambre 114", exact: true });
  await expect(followup.getByRole("radio", { name: "Produit appliqué", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(followup.getByLabel("Produit utilisé (facultatif)")).toHaveValue("Gel fictif");
  await followup.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dialog.getByLabel("Titre", { exact: true })).toHaveValue("Observation à compléter");
  await expect(dialog.getByLabel("Description du problème")).toHaveValue("Mon texte reste disponible au retour.");
  await expect(dialog.getByRole("img", { name: "Photo 1 du problème signalé", exact: true })).toBeVisible();
  await expect(dialog.getByText("1 / 3 photos · facultatif", { exact: true })).toBeVisible();

  // A free-text pest report follows the same route, even before a valid room is entered.
  await dialog.getByLabel("Titre", { exact: true }).fill("Cafards présents");
  await dialog.getByLabel("Description du problème").fill("Deux cafards observés derrière le meuble.");
  await dialog.getByLabel("Lieu précis").fill("Deuxième étage");
  await expect(dialog.getByRole("button", { name: "Continuer dans le suivi des cafards", exact: true })).toBeDisabled();
  await dialog.getByLabel("Lieu précis").fill("Chambre 114");
  await dialog.getByRole("button", { name: "Ouvrir le suivi des cafards existant", exact: true }).click();
  await followup.getByLabel("Observations", { exact: true }).fill("Nouvelle vérification fictive, même suivi.");
  await followup.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(followup).toHaveCount(0);
  await expect.poll(() => api.entries.length).toBe(1);
  expect(api.entries[0]).toMatchObject({ type: "createWorkEvent", kind: "cafardFollowup", targetId: "114", expectedRevision: 1,
    cafardStatus: "traite", product: "Gel fictif", treatedOn: day });
  expect(api.commands).toHaveLength(0);
  expect(api.data.issues).toHaveLength(0);
  await expect(dialog.getByRole("button", { name: "Enregistrer l’anomalie", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
