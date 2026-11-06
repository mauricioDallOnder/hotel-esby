import { expect, test, type Page } from "@playwright/test";
import { roomChecks } from "../../lib/rooms";
async function login(page: Page) { await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } }); }
async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: ?\\*)?$") }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("mobile room checklist opens cleaning for free rooms, exports PDF and shares problems and photos with anomalies", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  await page.goto("/checklist");
  await expect(page.getByRole("button", { name: "Contrôler la chambre", exact: false })).toHaveCount(85);
  await page.getByRole("button", { name: "Contrôler la chambre 114", exact: true }).click();
  const choose = async (label: string, answer: string) => { await page.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: answer, exact: true }).click(); };
  for (const check of roomChecks) await choose(check.label, check.key === "taps" ? "Problème" : check.key === "door_closer" ? "Absent" : check.key === "radiator_clear" ? "Libre" : "OK");
  await page.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await choose("État général de la chambre", "À revoir");
  await choose("Chambre occupée", "Occupée");
  await expect(page.getByRole("radiogroup", { name: /Nettoyage/ })).toHaveCount(0);
  await choose("Chambre occupée", "Libre");
  await choose("Nettoyage / ménage", "Non fait");
  await choose("Présence de cafards ou nuisibles", "Aucun");
  await choose("Propreté du minibar", "Propre");
  await choose("Micro-ondes présent ?", "Oui");
  await choose("Propreté du micro-ondes", "Sale");
  await choose("État de la moquette", "Sale");
  await page.getByLabel("Précisez les taches ou salissures").fill("Boue près de la fenêtre");
  await page.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await page.getByLabel("Inspecteur").fill("Test mobile");
  await page.getByLabel("Observations et problèmes constatés").fill("Robinet bloqué");
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") });
  await expect(page.getByAltText("Photo du contrôle 1")).toBeVisible();
  const send = page.waitForResponse(r => r.url().endsWith("/api/entries") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  expect((await send).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Historique de la chambre 114", exact: true }).click();
  await page.getByRole("button", { name: /Test mobile/ }).click();
  await expect(page.getByText(/Moquette sale : Boue près de la fenêtre/)).toBeVisible();
  await page.getByRole("button", { name: "Afficher les photos", exact: true }).click();
  await expect(page.getByRole("img", { name: "Chambre 114 · photo 1" })).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exporter en PDF · Chambres libres/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^chambres-libres-.*\.pdf$/);
  const state = await (await page.request.get("/api/hotel")).json();
  const issue = state.issues.find((i: { reportedBy: string }) => i.reportedBy === "Test mobile");
  expect(issue.description).toContain("Robinet bloqué");
  expect(issue.description).not.toContain("Micro-ondes sale");
  expect(issue.roomFindings.map((finding: { key: string }) => finding.key)).toEqual(["taps"]);
  expect(issue.photoIds).toHaveLength(1);
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Consulter", exact: true }).last().click();
  await expect(page.getByRole("dialog").getByLabel("Description du problème")).toHaveValue(/Robinet bloqué/);
  await expect(page.getByRole("dialog").locator("img").first()).toHaveJSProperty("naturalWidth", 1);
});

test("radiator Libre stays in the checklist while Caché creates one technical problem and repeat visits reuse it", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/checklist");
  const choose = async (label: string, answer: string) => page.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: answer, exact: true }).click();
  const inspect = async (room: string, answer: "Libre" | "Caché", actor: string, repeated = false) => {
    await page.getByRole("button", { name: `Contrôler la chambre ${room}`, exact: true }).click();
    const radiator = page.getByRole("radiogroup", { name: "Chauffage / radiateur", exact: true });
    await expect(radiator.getByRole("radio")).toHaveCount(2);
    await expect(radiator.getByRole("radio", { checked: true })).toHaveCount(0);
    await choose("Chauffage / radiateur", answer);
    await page.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
    await expect(radiator.getByRole("radio", { name: answer, exact: true })).toHaveAttribute("aria-checked", "true");
    await choose("Détecteur de fumée fonctionnel", "OK");
    if (answer === "Caché" && !repeated) {
      await radiator.scrollIntoViewIfNeeded();
      await expect(radiator.getByText(/Problèmes techniques/)).toBeVisible();
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
      await page.screenshot({ path: testInfo.outputPath("radiator-choice-mobile.png") });
    }
    await page.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
    await choose("Chambre occupée", "Occupée");
    await choose("État général de la chambre", "Bon");
    await choose("Présence de cafards ou nuisibles", "Aucun");
    await choose("État de la moquette", "OK");
    await choose("Micro-ondes présent ?", "Non");
    await choose("Propreté du minibar", "Propre");
    await page.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
    await page.getByLabel(/^Inspecteur/).fill(actor);
    if (answer === "Caché") {
      await expect(page.getByText("Chauffage / radiateur : Caché", { exact: true })).toBeVisible();
      if (repeated) await expect(page.getByText(/aucun doublon/)).toBeVisible();
    } else {
      await expect(page.getByText(/Aucune anomalie automatique à signaler/)).toBeVisible();
    }
    const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
    expect((await sent).status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };

  await inspect("123", "Libre", "Test radiateur libre");
  let state = await (await page.request.get("/api/hotel")).json();
  expect(state.issues.filter((issue: { room: string }) => issue.room === "123")).toHaveLength(0);
  expect(state.roomInspections.find((record: { room: string }) => record.room === "123").checks.find((check: { key: string }) => check.key === "radiator_clear").result).toBe("ok");

  await inspect("124", "Caché", "Test radiateur caché");
  state = await (await page.request.get("/api/hotel")).json();
  const issues = state.issues.filter((issue: { room: string }) => issue.room === "124");
  expect(issues).toHaveLength(1);
  expect(issues[0].description).toBe("Chauffage / radiateur : Caché");
  expect(issues[0].roomFindings).toEqual([{ key: "radiator_clear", label: "Chauffage / radiateur : Caché" }]);
  await page.goto("/anomalies");
  await expect(page.getByRole("heading", { name: "Problèmes techniques", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Consulter", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Description du problème")).toHaveValue("Chauffage / radiateur : Caché");

  await page.goto("/checklist");
  await inspect("124", "Caché", "Test radiateur toujours caché", true);
  state = await (await page.request.get("/api/hotel")).json();
  expect(state.issues.filter((issue: { room: string }) => issue.room === "124")).toHaveLength(1);
  const repeated = state.roomInspections.find((record: { actor: string }) => record.actor === "Test radiateur toujours caché");
  expect(repeated.schemaVersion).toBe(5);
  expect(repeated.relatedIssueIds).toEqual([issues[0].id]);
  await page.getByRole("button", { name: "Historique de la chambre 124", exact: true }).click();
  await page.getByRole("button", { name: /Test radiateur toujours caché/ }).click();
  await expect(page.getByText(/déjà signalée, non dupliquée/)).toBeVisible();
  await page.getByRole("button", { name: "Afficher tous les points de contrôle", exact: true }).click();
  await expect(page.locator('[data-result="bad"]').filter({ hasText: "Chauffage / radiateur : Caché" })).toBeVisible();
});

test("family drafts survive reload and offline entries synchronize without losing data", async ({ page, context }) => {
  await login(page); await page.goto("/familles");
  await page.getByLabel(/^Chambre/).selectOption("332");
  await page.getByLabel(/^Famille/).fill("Famille hors réseau");
  await page.getByLabel("Signalé par").fill("Marie");
  await page.getByLabel("Observations", { exact: true }).fill("Retour lundi");
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("hotel-work", 1); r.onsuccess = () => resolve(r.result); });
    return new Promise<string>(resolve => { const r = db.transaction("records").objectStore("records").get("draft:family"); r.onsuccess = () => { resolve(r.result?.notes); db.close(); }; });
  })).toBe("Retour lundi");
  await page.reload(); await expect(page.getByLabel(/^Famille/)).toHaveValue("Famille hors réseau");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Enregistrer l’événement" }).click();
  await expect(page.getByText("En attente d’envoi", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("Enregistré sur le serveur", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ch. 332 · Famille hors réseau", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel(/^Famille/)).toHaveValue("");
});
test("a lost save receipt can be retried without duplicating a family departure", async ({ page }) => {
  await login(page); await page.goto("/familles");
  await page.route("**/api/entries", async route => { await route.fetch(); await route.abort("failed"); }, { times: 1 });
  await page.getByLabel(/^Chambre/).selectOption("201");
  await page.getByLabel(/^Famille/).fill("Famille reçu perdu");
  await page.getByLabel("Signalé par").fill("Marie");
  await select(page, "Événement", "Départ définitif");
  await expect(page.getByLabel("Retour prévu (facultatif)")).toHaveCount(0);
  await page.getByRole("button", { name: "Enregistrer l’événement" }).click();
  await expect(page.getByText(/Connexion interrompue ou lente/)).toBeVisible();
  await page.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  await expect(page.getByText("En attente d’envoi", { exact: true })).toHaveCount(0);
  const state = await (await page.request.get("/api/hotel")).json();
  expect(state.familyEvents.filter((r: { family: string }) => r.family === "Famille reçu perdu")).toHaveLength(1);
});

test("quick controls protect known faults and safety checks, then reuse an existing anomaly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const id = crypto.randomUUID();
  expect((await page.request.post("/api/hotel", { data: { type: "createIssue", id, date: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()), actor: "Test dédoublonnage",
    fields: { title: "Robinet chambre 120", description: "Le robinet est bloqué", location: "Chambre 120", category: "Plomberie", priority: "normale", assignee: "" } } })).ok()).toBeTruthy();
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Contrôler la chambre 120", exact: true }).click();
  await page.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK" }).click();
  const choose = async (label: string, answer: string) => page.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: answer, exact: true }).click();
  for (const key of ["smoke", "taps"]) {
    await expect(page.getByRole("radiogroup", { name: roomChecks.find(c => c.key === key)!.label }).getByRole("radio", { checked: true })).toHaveCount(0);
  }
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
  await choose(roomChecks.find(c => c.key === "smoke")!.label, "OK");
  await expect(page.getByRole("radiogroup", { name: "Ferme-porte (fermeture automatique)", exact: true }).getByRole("radio", { name: "OK", exact: true })).toHaveAttribute("aria-checked", "true");
  await choose(roomChecks.find(c => c.key === "taps")!.label, "Problème");
  await page.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await choose("Chambre occupée", "Occupée"); await choose("État général de la chambre", "À revoir");
  await choose("Présence de cafards ou nuisibles", "Aucun"); await choose("État de la moquette", "OK");
  await choose("Micro-ondes présent ?", "Non"); await choose("Propreté du minibar", "Propre");
  await page.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await page.getByLabel("Inspecteur").fill("Test doublon");
  await expect(page.getByText(/aucun doublon/)).toBeVisible();
  const sent = page.waitForResponse(r => r.url().endsWith("/api/entries") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  expect((await sent).ok()).toBeTruthy();
  const state = await (await page.request.get("/api/hotel")).json();
  expect(state.issues.filter((i: { location: string }) => i.location === "Chambre 120")).toHaveLength(1);
  expect(state.roomInspections.find((r: { actor: string }) => r.actor === "Test doublon").relatedIssueIds).toEqual([id]);
  await page.getByRole("button", { name: "Historique de la chambre 120", exact: true }).click();
  await expect(page.getByText("1 anomalie(s) ouverte(s)")).toBeVisible();
  await page.getByRole("button", { name: /Test doublon/ }).click();
  await expect(page.getByText(/déjà signalée, non dupliquée/)).toBeVisible();
});

test("room draft and daily deferral survive reload without counting an inspection", async ({ page }) => {
  await login(page); await page.goto("/checklist");
  await page.getByRole("button", { name: "Contrôler la chambre 121", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Ferme-porte (fermeture automatique)", exact: true }).getByRole("radio", { name: "Absent", exact: true }).click();
  await page.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK" }).click();
  await expect(page.getByRole("radiogroup", { name: "Ferme-porte (fermeture automatique)", exact: true }).getByRole("radio", { name: "Absent", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Reporter à demain", exact: true }).click();
  await expect(page.getByText(/Chambre 121 reportée à demain/)).toBeVisible();
  await page.reload();
  await page.getByText(/chambre\(s\) reportée\(s\) aujourd’hui/).click();
  await page.getByRole("button", { name: "Reprendre 121", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Ferme-porte (fermeture automatique)", exact: true }).getByRole("radio", { name: "Absent", exact: true })).toHaveAttribute("aria-checked", "true");
  const state = await (await page.request.get("/api/hotel")).json();
  expect(state.roomInspections.some((r: { room: string }) => r.room === "121")).toBe(false);
});


test("room validation follows corrections and conditional fields without another save or focus change", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  await page.goto("/checklist");
  await page.getByRole("button", { name: "Contrôler la chambre 325", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const group = (label: string) => dialog.getByRole("radiogroup", { name: label, exact: true });
  const choose = async (label: string, answer: string) => group(label).getByRole("radio", { name: answer, exact: true }).click();
  const validation = dialog.getByRole("alert").filter({ hasText: "Il reste des points à vérifier." });
  let submissions = 0;
  page.on("request", request => { if (request.url().endsWith("/api/entries") && request.method() === "POST") submissions++; });

  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await choose("Chambre occupée", "Libre");
  await choose("État général de la chambre", "Bon");
  await choose("Présence de cafards ou nuisibles", "Aucun");
  await choose("État de la moquette", "OK");
  await choose("Micro-ondes présent ?", "Oui");
  await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await dialog.getByLabel(/^Inspecteur/).fill("Validation immédiate");
  await expect(validation).toHaveCount(0);
  await dialog.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();

  const smoke = group("Détecteur de fumée fonctionnel");
  await expect(smoke).toHaveAttribute("aria-invalid", "true");
  await expect(smoke).toBeFocused();
  await choose("Détecteur de fumée fonctionnel", "OK");
  await expect(smoke).not.toHaveAttribute("aria-invalid", "true");
  await expect(smoke.getByText("Ce point reste à renseigner.", { exact: true })).toHaveCount(0);
  await expect(smoke.getByRole("radio", { name: "OK", exact: true })).toBeFocused();
  await expect(validation).toBeVisible(); // Other required fields still need answers.

  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await expect(group("Nettoyage / ménage")).toHaveAttribute("aria-invalid", "true");
  await expect(group("Propreté du micro-ondes")).toHaveAttribute("aria-invalid", "true");
  await expect(group("Propreté du minibar")).toHaveAttribute("aria-invalid", "true");
  await choose("Chambre occupée", "Occupée");
  await expect(group("Nettoyage / ménage")).toHaveCount(0);
  await choose("Micro-ondes présent ?", "Non");
  await expect(group("Propreté du micro-ondes")).toHaveCount(0);
  await expect(group("Propreté du minibar")).toHaveAttribute("aria-invalid", "true");
  await choose("Propreté du minibar", "Propre");
  await expect(group("Propreté du minibar")).not.toHaveAttribute("aria-invalid", "true");
  await expect(validation).toHaveCount(0);

  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  const inspector = dialog.getByLabel(/^Inspecteur/);
  await inspector.fill("   ");
  await expect(inspector).toHaveAttribute("aria-invalid", "true");
  await expect(validation).toBeVisible();
  await inspector.fill("Validation corrigée");
  await expect(inspector).toHaveAttribute("aria-invalid", "false");
  await expect(inspector).toBeFocused();
  await expect(validation).toHaveCount(0);
  await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
  expect(submissions).toBe(0);
});
