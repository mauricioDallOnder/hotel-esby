import { expect, test } from "@playwright/test";
import { today, type Issue } from "../../lib/domain";

const sample = (patch: Partial<Issue> = {}): Issue => ({ id: crypto.randomUUID(), version: 1, title: "Éclairage défectueux", description: "Ampoule de la salle de bain", location: "Chambre 204", category: "Électricité", status: "ouvert", priority: "haute", date: "2026-10-01", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", assignee: "", reportedBy: "Marie", photoId: null, photoIds: [], history: [{ at: "2026-10-01T10:00:00Z", actor: "Marie", note: "Anomalie signalée.", status: "ouvert", priority: "haute", assignee: "" }], ...patch });

test("mobile anomalies start newest first with visible inclusive date filters, search, status and priority", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  const issues = [
    sample({ date: "2026-10-10", createdAt: "2026-10-10T10:00:00Z" }),
    sample({ title: "Fuite urgente", location: "Chambre 205", priority: "critique", assignee: "Technicien", category: "Plomberie" }),
    sample({ title: "Fenêtre réparée", status: "resolu", location: "Chambre 206" }),
    sample({ title: "Store bloqué", location: "Chambre 207", priority: "normale", date: "2026-10-12", createdAt: "2026-10-12T10:00:00Z" }),
  ];
  await page.route("**/api/hotel*", route => route.fulfill({ json: { issues, inspections: [], mode: "local" } }));
  await page.goto("/anomalies");
  const from = page.getByLabel("Constat à partir du"), to = page.getByLabel("Constat jusqu’au");
  await expect(from).toBeVisible();
  await expect(to).toBeVisible();
  await expect(page.getByRole("button", { name: "Filtres avancés", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 207 · Store bloqué");
  await expect(page.getByRole("combobox", { name: "Trier par" })).toHaveText("Plus récentes d’abord");
  await page.getByLabel("Rechercher une anomalie").fill("204 eclairage");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 204 · Éclairage défectueux");
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Fenêtre réparée", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await page.getByRole("group", { name: "Filtrer par priorité" }).getByRole("button", { name: "Critique", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await from.fill("2026-10-02");
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText("Aucune anomalie dans cette sélection", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await from.fill("2026-10-01");
  await to.fill("2026-10-10");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 204 · Éclairage défectueux");
  await expect(page.getByRole("article").last()).toHaveAccessibleName("Chambre 205 · Fuite urgente");
  await from.fill("2026-10-10");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 204 · Éclairage défectueux");
  await page.getByRole("combobox", { name: "Trier par" }).click();
  await page.getByRole("option", { name: "Plus anciennes d’abord", exact: true }).click();
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(from).toHaveValue("");
  await expect(to).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Trier par" })).toHaveText("Plus récentes d’abord");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 207 · Store bloqué");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("direction can record an intervention with one-tap status and inspect its dated history", async ({ page }) => {
  await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } });
  const id = crypto.randomUUID(), title = "Suivi rapide test";
  expect((await page.request.post("/api/hotel", { data: { type: "createIssue", id, date: today(), actor: "Marie", fields: { title, location: "Chambre 230", category: "Équipements", priority: "normale", description: "Store bloqué", assignee: "" } } })).ok()).toBeTruthy();
  await page.goto("/anomalies");
  await page.getByLabel("Rechercher une anomalie").fill(title);
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Suivi de l’anomalie/ });
  await expect(dialog.getByLabel("Titre", { exact: true })).toHaveCount(0);
  await dialog.getByRole("radiogroup", { name: "État de résolution" }).getByRole("radio", { name: "Résolu", exact: true }).click();
  await expect(dialog.getByLabel("Votre nom")).toHaveCount(0);
  await expect(dialog.getByLabel("Responsable de l’intervention")).toHaveCount(1);
  await dialog.getByLabel("Responsable de l’intervention").fill("Salima");
  await dialog.getByLabel("Travaux effectués / résolution").fill("Store réparé et testé");
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("dialog", { name: "Fermer sans enregistrer ?", exact: true }).getByRole("button", { name: "Continuer la saisie" }).click();
  await expect(dialog.getByLabel("Travaux effectués / résolution")).toHaveValue("Store réparé et testé");
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const state = await (await page.request.get("/api/hotel")).json();
  const saved = state.issues.find((item: Issue) => item.id === id);
  expect(saved.assignee).toBe("Salima");
  expect(saved.history.at(-1).actor).toBe("Salima");
  expect(saved.history[0].actor).toBe("Marie");
  await expect(page.getByText(/Retrouvez-la avec le filtre Résolu/)).toBeVisible();
  await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(page.getByRole("article").getByText("Store réparé et testé", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  await dialog.getByRole("button", { name: "Historique (2)", exact: true }).click();
  await expect(dialog.getByText("Store réparé et testé", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Salima · Résolu", { exact: true })).toBeVisible();
});
