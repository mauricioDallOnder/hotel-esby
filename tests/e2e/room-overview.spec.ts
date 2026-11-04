import { expect, test, type Page } from "@playwright/test";
import { displayDate, today, type State } from "../../lib/domain";
import { roomChecks, type RoomEntry } from "../../lib/rooms";

async function login(page: Page) {
  const response = await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } });
  expect(response.ok()).toBeTruthy();
}

async function state(page: Page): Promise<State> {
  return (await page.request.get("/api/hotel?fresh=1")).json();
}

function yesterday() {
  const date = new Date(`${today()}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function inspection(room: string, patch: Partial<RoomEntry> = {}): RoomEntry {
  return {
    type: "createRoomInspection", schemaVersion: 4, id: crypto.randomUUID(), room, date: today(),
    actor: "Température API", notes: "", occupied: true, condition: "bon", cleaning: null,
    carpet: "ok", carpetNotes: "", microwave: "non", microwaveCleaning: null,
    fridgeCleaning: "propre", bugs: "non", photosData: [],
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
    ...patch,
  };
}

async function saveInspection(page: Page, entry: RoomEntry) {
  const response = await page.request.post("/api/entries", { headers: { "X-Entry-Schema": "2" }, data: entry });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function completeControl(page: Page, actor: string) {
  const dialog = page.getByRole("dialog");
  const choose = async (label: string, answer: string) => {
    await dialog.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: answer, exact: true }).click();
  };
  await dialog.getByRole("button", { name: "1. Équipements", exact: true }).click();
  await dialog.getByRole("button", { name: "J’ai vérifié : les équipements restants sont OK", exact: true }).click();
  await choose("Détecteur de fumée fonctionnel", "OK");
  await dialog.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
  await choose("Chambre occupée", "Occupée");
  await choose("État général de la chambre", "Bon");
  await choose("Présence de cafards ou nuisibles", "Aucun");
  await choose("État de la moquette", "OK");
  await choose("Micro-ondes présent ?", "Non");
  await choose("Propreté du minibar", "Propre");
  await dialog.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  await dialog.getByLabel("Inspecteur", { exact: true }).fill(actor);
}

test("the mobile occupancy menu keeps unknown rooms separate and synchronizes the occupied checkbox with the checklist", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const before = await state(page);
  await page.goto("/occupation");
  await expect(page.getByRole("checkbox", { name: /^Chambre \d+ occupée$/ })).toHaveCount(85);
  const card = page.getByRole("article", { name: "Chambre 101", exact: true });
  const checkbox = card.getByRole("checkbox", { name: "Chambre 101 occupée", exact: true });
  await expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  await expect(card.getByText("Occupation non renseignée", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Libres", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Toutes", exact: true }).click();

  await context.setOffline(true);
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(card.getByText(/Occupée.*En attente d’envoi/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await context.setOffline(false);
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "101").map(event => event.free)).toEqual([false]);
  await page.reload();
  await expect(checkbox).toBeChecked();

  await page.goto("/checklist");
  await expect(page.getByRole("checkbox", { name: "Chambre 101 libre", exact: true })).not.toBeChecked();
  await page.goto("/occupation");
  await checkbox.uncheck();
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "101").map(event => event.free)).toEqual([false, true]);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect(card.getByText(/^Libre ·/)).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.goto("/checklist");
  await expect(page.getByRole("checkbox", { name: "Chambre 101 libre", exact: true })).toBeChecked();

  const after = await state(page);
  expect(after.roomInspections?.length || 0).toBe(before.roomInspections?.length || 0);
  expect(after.issues.length).toBe(before.issues.length);
});

test("an unknown room can be marked free directly without recording a temporary occupied state", async ({ page }) => {
  await login(page);
  await page.goto("/occupation");
  const card = page.getByRole("article", { name: "Chambre 110", exact: true });
  await expect(card.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  await card.getByRole("button", { name: "Marquer libre", exact: true }).click();
  await expect.poll(async () => (await state(page)).workEvents?.filter(event => event.kind === "roomAvailability" && event.room === "110").map(event => event.free)).toEqual([true]);
  await expect(card.getByRole("checkbox")).not.toBeChecked();
  await expect(card.getByRole("button", { name: "Marquer libre", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Libres", exact: true }).click();
  await expect(card).toBeVisible();
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("110");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("a comma temperature survives the draft reload, saves without an anomaly and appears in the menu and control history", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const before = await state(page);
  await page.goto("/temperatures");
  await expect(page.getByRole("article")).toHaveCount(85);
  const card = page.getByRole("article", { name: "Chambre 105", exact: true });
  await expect(card.getByText("Non renseignée", { exact: true })).toBeVisible();
  const openControl = () => page.getByRole("button", { name: "Saisir la température de la chambre 105", exact: true }).click();
  await openControl();
  const temperature = page.getByLabel("Température de la chambre (°C)", { exact: true });
  await expect(temperature).toHaveValue("");
  await temperature.fill("21,5");
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hotel-work", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<string | undefined>((resolve, reject) => {
      const request = db.transaction("records").objectStore("records").get("draft:room:105");
      request.onsuccess = () => { resolve(request.result?.temperatureInput); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    });
  })).toBe("21,5");
  await page.reload();
  await openControl();
  await expect(temperature).toHaveValue("21,5");
  await completeControl(page, "Température E2E 105");
  await expect(page.getByRole("dialog").getByText(/Aucune anomalie automatique à signaler/)).toBeVisible();
  const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBeTruthy();
  const receipt = await response.json();
  expect(receipt.record.temperatureC).toBe(21.5);
  expect(receipt.issue).toBeUndefined();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByText(/21,5\s*°C/)).toBeVisible();
  await expect(card.getByText(`Mesure du ${displayDate(today())}`, { exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.reload();
  await expect(card.getByText(/21,5\s*°C/)).toBeVisible();
  expect((await state(page)).issues.length).toBe(before.issues.length);

  await page.goto("/checklist");
  await page.getByRole("button", { name: "Historique de la chambre 105", exact: true }).click();
  await page.getByRole("button", { name: /Température E2E 105/ }).click();
  await expect(page.getByRole("dialog").getByText(/21,5\s*°C/)).toBeVisible();
});

test("the temperature overview retains the dated last measurement, distinguishes zero from missing and filters the full hotel", async ({ page }) => {
  await login(page);
  await saveInspection(page, inspection("106", { date: yesterday(), inspectedAt: `${yesterday()}T08:00:00.000Z`, temperatureC: 18.4 }));
  await saveInspection(page, inspection("106", { inspectedAt: `${today()}T08:00:00.000Z` }));
  await saveInspection(page, inspection("107", { temperatureC: 0 }));
  await page.goto("/temperatures");
  await expect(page.getByRole("link", { name: "Températures des chambres", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Occupation des chambres", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(85);
  const last = page.getByRole("article", { name: "Chambre 106", exact: true });
  await expect(last.getByText(/18,4\s*°C/)).toBeVisible();
  await expect(last.getByText(`Mesure du ${displayDate(yesterday())}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Chambre 107", exact: true }).getByText(/^0\s*°C$/)).toBeVisible();
  await expect(page.getByRole("article", { name: "Chambre 108", exact: true }).getByText("Non renseignée", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sans mesure", exact: true }).click();
  await expect(last).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Chambre 108", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Avec une mesure", exact: true }).click();
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("106");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(last).toBeVisible();
});

test("an invalid temperature blocks saving, while clearing the optional field preserves the previous dated measurement", async ({ page }) => {
  test.setTimeout(90000);
  await login(page);
  await saveInspection(page, inspection("109", { date: yesterday(), temperatureC: 19.5 }));
  const before = await state(page);
  await page.goto("/temperatures");
  await page.getByRole("button", { name: "Saisir la température de la chambre 109", exact: true }).click();
  const temperature = page.getByLabel("Température de la chambre (°C)", { exact: true });
  await temperature.fill("100");
  await completeControl(page, "Température facultative E2E 109");
  await page.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  await expect(temperature).toHaveAttribute("aria-invalid", "true");
  expect((await state(page)).roomInspections?.length).toBe(before.roomInspections?.length);
  await temperature.fill("20.5");
  await expect(temperature).toHaveAttribute("aria-invalid", "false");
  await temperature.fill("");
  await page.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
  const sent = page.waitForResponse(response => response.url().endsWith("/api/entries") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer le contrôle", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBeTruthy();
  const receipt = await response.json();
  expect(receipt.record).not.toHaveProperty("temperatureC");
  expect(receipt.issue).toBeUndefined();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.getByRole("article", { name: "Chambre 109", exact: true });
  await expect(card.getByText(/19,5\s*°C/)).toBeVisible();
  await expect(card.getByText(`Mesure du ${displayDate(yesterday())}`, { exact: true })).toBeVisible();
  expect((await state(page)).issues.length).toBe(before.issues.length);
});
