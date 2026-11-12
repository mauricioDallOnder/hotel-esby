import { expect, test } from "./fixtures";
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

test("anomaly shortcuts keep the search scope, show matching counts and replace the previous view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  const issues = [
    sample({ title: "Éclairage plafond", date: "2026-10-10", priority: "critique", assignee: "Technicien" }),
    sample({ title: "Éclairage couloir", date: "2026-10-11", priority: "critique", reportedBy: "" }),
    sample({ title: "Éclairage salle de bain", date: "2026-10-12", priority: "normale", reportedBy: "" }),
    sample({ priority: "critique", date: "2026-10-09" }),
    sample({ priority: "critique", date: "2026-10-13" }),
    sample({ priority: "critique", date: "2026-10-10", location: "Chambre 1204" }),
    sample({ priority: "critique", date: "2026-10-10", category: "Plomberie" }),
    sample({ priority: "critique", date: "2026-10-10", status: "resolu" }),
  ];
  await page.route("**/api/hotel*", route => route.fulfill({ json: { issues, inspections: [], mode: "local" } }));
  await page.goto("/anomalies");
  const search = page.getByLabel("Rechercher une anomalie"), from = page.getByLabel("Constat à partir du"), to = page.getByLabel("Constat jusqu’au");
  await search.fill("204 eclairage");
  await from.fill("2026-10-10");
  await to.fill("2026-10-12");
  await page.getByRole("button", { name: "Filtres avancés", exact: true }).click();
  await page.getByRole("combobox", { name: "Catégorie", exact: true }).click();
  await page.getByRole("option", { name: "Électricité", exact: true }).click();
  await page.getByRole("combobox", { name: "Trier par" }).click();
  await page.getByRole("option", { name: "Plus anciennes d’abord", exact: true }).click();
  await page.getByRole("group", { name: "Filtrer par priorité" }).getByRole("button", { name: "Haute", exact: true }).click();

  const shortcuts = page.getByRole("group", { name: "Vues rapides des anomalies" });
  const pending = shortcuts.getByRole("button", { name: /Non résolues/ });
  const critical = shortcuts.getByRole("button", { name: /Critiques ouvertes/ });
  const unassigned = shortcuts.getByRole("button", { name: /Sans responsable/ });
  await expect(pending).toHaveText(/Non résolues\s*3$/);
  await expect(critical).toHaveText(/Critiques ouvertes\s*2$/);
  await expect(unassigned).toHaveText(/Sans responsable\s*2$/);
  await expect(shortcuts.getByRole("button", { pressed: true })).toHaveCount(0);
  await critical.click();
  await expect(critical).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 204 · Éclairage plafond");
  await unassigned.click();
  await expect(critical).toHaveAttribute("aria-pressed", "false");
  await expect(unassigned).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Chambre 204 · Éclairage couloir");
  await expect(page.getByRole("article").last()).toHaveAccessibleName("Chambre 204 · Éclairage salle de bain");
  await pending.click();
  await expect(pending).toHaveAttribute("aria-pressed", "true");
  await expect(shortcuts.getByRole("button", { pressed: true })).toHaveCount(1);
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(search).toHaveValue("204 eclairage");
  await expect(from).toHaveValue("2026-10-10");
  await expect(to).toHaveValue("2026-10-12");
  await expect(page.getByRole("combobox", { name: "Catégorie", exact: true })).toHaveText("Électricité");
  await expect(page.getByRole("combobox", { name: "Trier par" })).toHaveText("Plus anciennes d’abord");
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(from).toHaveValue("");
  await expect(to).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Catégorie", exact: true })).toHaveText("Toutes les catégories");
  await expect(page.getByRole("combobox", { name: "Trier par" })).toHaveText("Plus récentes d’abord");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("employee creates an anomaly with only the reporter name and keeps the consultation read-only", async ({ page }) => {
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  const title = `Responsable automatique ${crypto.randomUUID().slice(0, 8)}`;
  const location = "Chambre 231", reporter = "Élodie test";
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "Signaler une anomalie", exact: true });
  await expect(creation.getByLabel("Responsable de l’intervention")).toHaveCount(0);
  await expect(creation.getByLabel(/^Signalé par\s*\*?$/)).toHaveCount(1);
  await creation.getByLabel(/^Titre\s*\*?$/).fill(title);
  await creation.getByLabel(/^Lieu précis\s*\*?$/).fill(location);
  await creation.getByLabel(/^Description du problème\s*\*?$/).fill("Le robinet de la salle de bain fuit.");
  await creation.getByLabel(/^Signalé par\s*\*?$/).fill(`  ${reporter}  `);
  await creation.getByRole("button", { name: "Enregistrer l’anomalie", exact: true }).click();
  await expect(creation).toHaveCount(0);

  const response = await page.request.get("/api/hotel");
  expect(response.ok()).toBeTruthy();
  const state = await response.json();
  const saved = state.issues.find((item: Issue) => item.title === title);
  expect(saved).toBeDefined();
  expect(saved.reportedBy).toBe(reporter);
  expect(saved.assignee).toBe(reporter);
  expect(saved.history).toHaveLength(1);
  expect(saved.history[0].actor).toBe(reporter);
  expect(saved.history[0].assignee).toBe(reporter);

  const card = page.getByRole("article", { name: `${location} · ${title}`, exact: true });
  await expect(card.getByText(`Responsable : ${reporter}`, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Consulter", exact: true }).click();
  const consultation = page.getByRole("dialog", { name: /Consulter l’anomalie/ });
  await expect(consultation.getByText(`Responsable : ${reporter}`, { exact: true })).toBeVisible();
  await expect(consultation.getByLabel(/^Titre\s*\*?$/)).toBeDisabled();
  await expect(consultation.getByLabel(/^Description du problème\s*\*?$/)).toBeDisabled();
  await expect(consultation.getByLabel("Responsable de l’intervention")).toHaveCount(0);
  await expect(consultation.getByLabel(/^Intervention saisie par\s*\*?$/)).toHaveCount(0);
  await expect(consultation.getByRole("radiogroup", { name: "État de résolution" })).toHaveCount(0);
  await expect(consultation.getByRole("button", { name: "Enregistrer le suivi", exact: true })).toHaveCount(0);
  await expect(consultation.getByText("La direction gère les interventions et les changements d’état.", { exact: true })).toBeVisible();
});

test("direction records an intervention under its author while the original reporter remains responsible", async ({ page }) => {
  await page.request.post("/api/session", { data: { role: "direction", password: "test-direction" } });
  const id = crypto.randomUUID(), title = "Suivi rapide test";
  expect((await page.request.post("/api/hotel", { data: { type: "createIssue", id, date: today(), actor: "Marie", fields: { title, location: "Chambre 230", category: "Équipements", priority: "normale", description: "Store bloqué", assignee: "" } } })).ok()).toBeTruthy();
  await page.goto("/anomalies");
  await page.getByLabel("Rechercher une anomalie").fill(title);
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Suivi de l’anomalie/ });
  await expect(dialog.getByLabel(/^Titre\s*\*?$/)).toHaveCount(0);
  await expect(dialog.getByText("Responsable : Marie", { exact: true })).toBeVisible();
  await dialog.getByRole("radiogroup", { name: "État de résolution" }).getByRole("radio", { name: "Résolu", exact: true }).click();
  await expect(dialog.getByLabel("Votre nom")).toHaveCount(0);
  await expect(dialog.getByLabel("Responsable de l’intervention")).toHaveCount(0);
  await expect(dialog.getByLabel(/^Intervention saisie par\s*\*?$/)).toHaveValue("");
  await dialog.getByLabel(/^Intervention saisie par\s*\*?$/).fill("Salima");
  await dialog.getByLabel(/^Travaux effectués \/ résolution\s*\*?$/).fill("Store réparé et testé");
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("dialog", { name: "Fermer sans enregistrer ?", exact: true }).getByRole("button", { name: "Continuer la saisie" }).click();
  await expect(dialog.getByLabel(/^Travaux effectués \/ résolution\s*\*?$/)).toHaveValue("Store réparé et testé");
  await dialog.getByRole("button", { name: "Enregistrer le suivi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const state = await (await page.request.get("/api/hotel")).json();
  const saved = state.issues.find((item: Issue) => item.id === id);
  expect(saved.reportedBy).toBe("Marie");
  expect(saved.assignee).toBe("Marie");
  expect(saved.history.at(-1).actor).toBe("Salima");
  expect(saved.history.at(-1).assignee).toBe("Marie");
  expect(saved.history[0].actor).toBe("Marie");
  await expect(page.getByText(/Retrouvez-la avec le filtre Résolu/)).toBeVisible();
  await page.getByRole("group", { name: "Filtrer par état" }).getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(page.getByRole("article").getByText("Store réparé et testé", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").getByText("Responsable : Marie", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le suivi", exact: true }).click();
  await expect(dialog.getByLabel(/^Intervention saisie par\s*\*?$/)).toHaveValue("");
  await dialog.getByRole("button", { name: "Historique (2)", exact: true }).click();
  await expect(dialog.getByText("Store réparé et testé", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Salima · Résolu", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Marie · À traiter", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Responsable indiqué à cette date : Marie/)).toHaveCount(1);
});
