import { expect, test, type Page } from "@playwright/test";
import { applyCommand, commandSchema, today, type Command, type Issue, type State } from "../../lib/domain";
import { commandOperation, isCommandReplay, stampCommandReceipt } from "../../lib/commandReceipt";

function issue(): Issue {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), version: 1, title: "Robinet et éclairage", location: "Chambre 101", room: "101",
    description: "Robinet du lavabo bloqué. Éclairage du chevet en panne.", category: "Équipements", priority: "normale", status: "ouvert",
    assignee: "Agent test", reportedBy: "Agent test", date: today(), createdAt: now, updatedAt: now, photoId: null, photoIds: [], history: [],
    roomFindings: [{ key: "taps", label: "Robinet du lavabo", problemType: "tap_fault", description: "Robinet du lavabo bloqué." },
      { key: "lights", label: "Éclairage du chevet", problemType: "lighting_fault", description: "Éclairage du chevet en panne." }] };
}

async function fixture(page: Page, original: Issue, loseFirst = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } })).ok()).toBeTruthy();
  const data: State & { mode: "local" } = { mode: "local", issues: [original], inspections: [], roomInspections: [], workEvents: [], familyEvents: [] };
  const commands: Command[] = [];
  let writes = 0, loseResponse = loseFirst;
  await page.route("**/api/hotel*", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    const command = commandSchema.parse(route.request().postDataJSON());
    commands.push(command);
    const operation = commandOperation(command);
    if (!isCommandReplay(data, command, operation)) {
      const change = applyCommand(data, command);
      stampCommandReceipt(change, operation);
      if (change.collection === "issues") data.issues = [change.record];
      writes++;
    }
    if (loseResponse) { loseResponse = false; return route.abort("failed"); }
    return route.fulfill({ json: data });
  });
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  return { data, commands, writes: () => writes, dialog: page.getByRole("dialog", { name: /^Suivi de l’anomalie/ }) };
}

test("a partial repair keeps its resolved item and completing all findings is an explicit action", async ({ page }) => {
  const api = await fixture(page, issue());
  await api.dialog.getByRole("radiogroup", { name: "État · Robinet du lavabo", exact: true }).getByRole("radio", { name: "Résolu", exact: true }).click();
  await expect(api.dialog.getByText("1 / 2 problème(s) restant(s)", { exact: true })).toBeVisible();
  await expect(api.dialog.getByRole("radiogroup", { name: /^État ·/ })).toHaveCount(2);
  await expect(api.dialog.getByRole("radiogroup", { name: "État de tous les problèmes", exact: true })).toHaveCount(0);
  await api.dialog.getByText("État global : En cours", { exact: true }).click();
  await expect(api.dialog.getByRole("radiogroup", { name: "État · Robinet du lavabo", exact: true }).getByRole("radio", { name: "Résolu", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(api.dialog.getByRole("radiogroup", { name: "État · Éclairage du chevet", exact: true }).getByRole("radio", { name: "À traiter", exact: true })).toHaveAttribute("aria-checked", "true");
  await api.dialog.getByLabel(/^Intervention saisie par\s*\*?$/).fill("Direction test");
  await api.dialog.getByLabel(/^Intervention ou modification effectuée\s*\*?$/).fill("Robinet réparé ; la lampe reste à remplacer.");
  await api.dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(api.dialog).toHaveCount(0);
  expect(api.data.issues[0].status).toBe("en_cours");
  expect(api.data.issues[0].roomFindings?.map(item => item.status)).toEqual(["resolu", "ouvert"]);
  await expect(page.getByText("1 / 2 problème(s) restant(s) · 1 résolu(s)", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  await api.dialog.getByRole("button", { name: "Marquer tous les problèmes résolus", exact: true }).click();
  await expect(api.dialog.getByText("État global : Résolu", { exact: true })).toBeVisible();
  await expect(api.dialog.getByRole("button", { name: "Marquer tous les problèmes résolus", exact: true })).toBeDisabled();
  await api.dialog.getByLabel(/^Intervention saisie par\s*\*?$/).fill("Direction test");
  await api.dialog.getByLabel(/^Travaux effectués \/ résolution\s*\*?$/).fill("Ampoule remplacée et fonctionnement vérifié.");
  await api.dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(api.dialog).toHaveCount(0);
  expect(api.data.issues[0].status).toBe("resolu");
  expect(api.data.issues[0].roomFindings?.every(item => item.status === "resolu")).toBe(true);
  expect(api.data.issues[0].history).toHaveLength(2);
});

test("one finding has one resolution control and saves the same state on the item", async ({ page }) => {
  const original = issue();
  original.roomFindings = original.roomFindings!.slice(0, 1);
  const api = await fixture(page, original);
  await expect(api.dialog.getByRole("radiogroup", { name: /^État/ })).toHaveCount(1);
  const resolution = api.dialog.getByRole("radiogroup", { name: "État de résolution", exact: true });
  await expect(resolution).toBeVisible();
  await expect(api.dialog.getByRole("button", { name: "Marquer tous les problèmes résolus", exact: true })).toHaveCount(0);
  await resolution.getByRole("radio", { name: "Résolu", exact: true }).click();
  await api.dialog.getByLabel(/^Intervention saisie par\s*\*?$/).fill("Direction test");
  await api.dialog.getByLabel(/^Travaux effectués \/ résolution\s*\*?$/).fill("Robinet réparé et vérifié.");
  await api.dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(api.dialog).toHaveCount(0);
  expect(api.data.issues[0].status).toBe("resolu");
  expect(api.data.issues[0].roomFindings?.map(item => item.status)).toEqual(["resolu"]);
});

test("an accepted intervention with a lost response retries the frozen request after reload exactly once", async ({ page }) => {
  const original = { ...issue(), roomFindings: undefined };
  const api = await fixture(page, original, true);
  await api.dialog.getByLabel(/^Intervention saisie par\s*\*?$/).fill("Direction test");
  await api.dialog.getByLabel(/^Intervention ou modification effectuée\s*\*?$/).fill("Vérification effectuée ; pièce commandée.");
  await api.dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(api.dialog.getByRole("button", { name: "Réessayer le même envoi", exact: true })).toBeEnabled();
  await expect(api.dialog.getByLabel(/^Intervention ou modification effectuée\s*\*?$/)).toBeDisabled();
  expect(api.writes()).toBe(1);
  expect(api.commands[0].type).toBe("updateIssue");
  await page.reload();
  await page.getByRole("button", { name: "Reprendre le brouillon", exact: true }).click();
  await expect(api.dialog.getByLabel(/^Intervention ou modification effectuée\s*\*?$/)).toHaveValue("Vérification effectuée ; pièce commandée.");
  await api.dialog.getByRole("button", { name: "Réessayer le même envoi", exact: true }).click();
  await expect(api.dialog).toHaveCount(0);
  expect(api.commands).toHaveLength(2);
  expect(api.commands[1]).toEqual(api.commands[0]);
  expect(api.writes()).toBe(1);
  expect(api.data.issues[0].version).toBe(2);
  expect(api.data.issues[0].history).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Reprendre le brouillon", exact: true })).toHaveCount(0);
});
