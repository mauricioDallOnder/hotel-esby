import { expect, test, type Page } from "./fixtures";
import { roomChecks, rooms, type RoomInspection } from "../../lib/rooms";
import { roomReceipt } from "./helpers/receipts";

const day = "2026-11-11";

function control(room: string, date: string, condition: RoomInspection["condition"] = "bon"): RoomInspection {
  return roomReceipt({
    type: "createRoomInspection", id: crypto.randomUUID(), schemaVersion: 6, room, date,
    inspectedAt: date + "T08:00:00.000Z", actor: "Test tournée", notes: "Contrôle fictif de rotation.",
    occupied: true, condition, cleaning: null, carpet: "ok", carpetNotes: "",
    microwave: "non", microwaveCleaning: null, fridgeCleaning: "propre", bugs: "non",
    checks: roomChecks.map(check => ({ key: check.key, result: "ok" })),
    photosData: [],
  }).record;
}

async function fixture(page: Page, goal: number) {
  await page.clock.setFixedTime(new Date(day + "T12:00:00.000Z"));
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  const data = {
    records: rooms.filter(room => room !== "101").map(room => control(room,
      room === "102" ? "2026-11-01" : room === "103" ? "2026-11-08" : room === "104" ? "2026-11-07" : "2026-11-10",
      ["103", "104"].includes(room) ? "mauvais" : "bon")),
    writes: 0,
  };
  await page.route("**/api/hotel*", route => route.fulfill({ json: {
    mode: "local", issues: [], inspections: [], familyEvents: [], workEvents: [], roomInspections: data.records,
  } }));
  await page.route("**/api/entries", route => {
    data.writes++;
    return route.fulfill({ status: 500, json: { error: "Ce scénario de rotation ne doit pas envoyer de contrôle." } });
  });
  await page.goto("/checklist");
  await expect(page.getByRole("heading", { name: "Contrôle des chambres", exact: true })).toBeVisible();
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hotel-work", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("records", "readwrite");
        transaction.objectStore("records").put(value, "room-rotation-preferences");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, { dailyGoal: goal, intervalDays: 7, deferredDay: day, deferred: [] });
  await page.reload();
  return data;
}

async function plannedRooms(page: Page) {
  return page.getByRole("group", { name: "Chambres de la tournée", exact: true }).getByRole("button")
    .evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")!.match(/\d+/)![0]));
}

test("mobile rotation exposes waiting dates and the full due queue, then allows extra rooms after the goal", async ({ page }) => {
  const data = await fixture(page, 2);
  await expect.poll(() => plannedRooms(page)).toEqual(["101", "102"]);
  const waiting = page.getByRole("article", { name: "Chambre 103", exact: true });
  await expect(waiting).toContainText("Mauvais état · suivi le 12/11/2026");
  await expect(page.getByRole("article", { name: "Chambre 101", exact: true })).toContainText("Sans contrôle complet");
  await page.getByLabel("Rechercher une chambre", { exact: true }).fill("999");
  await page.getByRole("group", { name: "Filtrer par étage", exact: true }).getByRole("button", { name: "3e étage", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "Voir toutes les chambres à contrôler (3)", exact: true }).click();
  await expect(page.getByLabel("Rechercher une chambre", { exact: true })).toHaveValue("");
  await expect(page.getByRole("group", { name: "Filtrer par étage", exact: true }).getByRole("button", { name: "Tous les étages", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: "Chambre 104", exact: true })).toBeVisible();
  await expect(waiting).toHaveCount(0);

  // Other operators' confirmed full controls update coverage without a local write.
  data.records.push(control("101", day), control("102", day));
  await page.getByRole("region", { name: "État des enregistrements", exact: true }).getByRole("button", { name: "Actualiser", exact: true }).click();
  const extend = page.getByRole("button", { name: "Ajouter 1 chambre à la tournée", exact: true });
  await expect(extend).toBeVisible();
  await extend.click();
  await expect.poll(() => plannedRooms(page)).toEqual(["104"]);
  await page.reload();
  await expect.poll(() => plannedRooms(page)).toEqual(["104"]);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  // The extra allowance belongs to one Paris calendar day, not every future tour.
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00.000Z"));
  await page.reload();
  await expect.poll(() => plannedRooms(page)).toEqual(["104", "103"]);
  await page.getByRole("button", { name: "Régler", exact: true }).click();
  await expect(page.getByLabel("Objectif quotidien", { exact: true })).toHaveValue("2");
  expect(data.writes).toBe(0);
});

test("postponing the only planned room selects the next due room and preserves the draft until tomorrow", async ({ page }) => {
  const data = await fixture(page, 1);
  await expect.poll(() => plannedRooms(page)).toEqual(["101"]);
  await page.getByRole("button", { name: "Continuer la tournée · chambre 101", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const taps = dialog.getByRole("radiogroup", { name: "Robinets fonctionnels", exact: true });
  await taps.getByRole("radio", { name: "Problème", exact: true }).click();
  await dialog.getByRole("button", { name: "Reporter à demain", exact: true }).click();
  await expect(dialog).toContainText("Chambre 102");
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect.poll(() => plannedRooms(page)).toEqual(["102"]);
  await page.reload();
  await expect.poll(() => plannedRooms(page)).toEqual(["102"]);
  await expect(page.getByRole("article", { name: "Chambre 101", exact: true })).toContainText("Reportée à demain");

  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00.000Z"));
  await page.reload();
  await expect.poll(() => plannedRooms(page)).toEqual(["101"]);
  await page.getByRole("button", { name: "Continuer la tournée · chambre 101", exact: true }).click();
  await expect(taps.getByRole("radio", { name: "Problème", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(data.writes).toBe(0);
});
