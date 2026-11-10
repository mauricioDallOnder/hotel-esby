import { expect, test, type Page, type Worker } from "@playwright/test";
import { createHash } from "node:crypto";
import { laundryNotices } from "../../lib/laundryNotifications";
import { workEntrySchema } from "../../lib/rooms";

async function prepare(page: Page, now: number) {
  await page.clock.setFixedTime(new Date(now));
  const startedAt = new Date(now - 20 * 60_000 + 1_000).toISOString();
  const start = workEntrySchema.parse({
    type: "createWorkEvent", kind: "laundryCycle", id: crypto.randomUUID(), targetId: "washer-2", expectedRevision: 0,
    room: "201", date: startedAt.slice(0, 10), occurredAt: startedAt, actor: "Agent fictif", notes: "",
    laundryCycleId: crypto.randomUUID(), laundryOwner: "Repère privé", laundryStartedAt: startedAt, laundryStatus: "en_cours", laundryCollectedAt: null, laundryCollectedBy: "",
  });
  const workEvents = [{ ...start, version: 1, updatedAt: start.occurredAt, submissionHash: createHash("sha256").update(JSON.stringify(start)).digest("hex") }];
  await page.route("**/api/hotel*", route => route.fulfill({ json: { mode: "local", issues: [], inspections: [], roomInspections: [], familyEvents: [], workEvents } }));
  await page.route("**/api/laundry/notifications/status", route => route.fulfill({ json: { publicKey: null, backgroundConfigured: false, schedulerRecent: false } }));
  expect((await page.request.post("/api/session", { data: { role: "employe", password: "test-employee" } })).ok()).toBeTruthy();
  return { start, workEvents };
}

test("native browser notification test when the browser supports permission overrides", async ({ page, context }) => {
  await context.grantPermissions(["notifications"], { origin: "http://127.0.0.1:3127" });
  await prepare(page, Date.now());
  await page.goto("/lingerie");
  // Some chrome-headless-shell builds expose granted in the Permissions API
  // while denying the native Notification API, independently of this app.
  test.skip(await page.evaluate(() => Notification.permission) !== "granted", "This headless browser denies native notifications despite the permission override.");
  await page.getByRole("button", { name: "Activer sur cet appareil", exact: true }).click();
  await page.getByRole("button", { name: "Envoyer un test", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(notice => notice.tag))).toContain("laundry:test");
});

type NotificationCapture = { tag: string; body: string; silent?: boolean };
type WorkerTestState = { laundryTestNotifications: NotificationCapture[]; laundryTestFailures: number };

async function captureNativeDisplay(worker: Worker) {
  // Mock only the OS boundary; all worker validation, IndexedDB transactions,
  // acknowledgements and deduplication run from the deployed service worker.
  await worker.evaluate(() => {
    const scope = self as unknown as WorkerTestState & { registration: ServiceWorkerRegistration };
    scope.laundryTestNotifications = [];
    scope.laundryTestFailures = 0;
    scope.registration.showNotification = async (_title, options) => {
      if (scope.laundryTestFailures) { scope.laundryTestFailures--; throw new Error("Simulated native display failure"); }
      scope.laundryTestNotifications.push({ tag: options?.tag || "", body: options?.body || "", ...(typeof options?.silent === "boolean" ? { silent: options.silent } : {}) });
    };
  });
}

test("real worker and IndexedDB deduplicate reminders across navigation and reload, with native display mocked", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    Notification.requestPermission = async () => "granted";
  });
  const now = Date.now(), { start, workEvents } = await prepare(page, now);
  await page.goto("/lingerie");
  await expect(page.getByText("Les rappels lorsque l’application est fermée doivent encore être activés par la direction.", { exact: false })).toBeVisible();
  const createdWorker = context.waitForEvent("serviceworker");
  await page.getByRole("button", { name: "Activer sur cet appareil", exact: true }).click();
  const worker = await createdWorker;
  await captureNativeDisplay(worker);
  await expect(page.getByText("Avec l’application ouverte", { exact: true })).toBeVisible();

  await page.goto("/occupation");
  await page.clock.setFixedTime(new Date(now + 1_000));
  const shown = () => worker.evaluate(() => (self as unknown as WorkerTestState).laundryTestNotifications);
  await expect.poll(shown).toEqual([{ tag: `laundry:${start.laundryCycleId}:soon`, body: "Machine à laver 2 · chambre 201 : il reste moins de 10 minutes." }]);
  await page.reload();
  const soon = laundryNotices(workEvents, now + 1_000)[0];
  const repeated = await page.evaluate(async notice => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); };
      registration.active!.postMessage({ type: "LAUNDRY_SHOW", notice }, [channel.port2]);
    });
  }, soon);
  expect(repeated).toEqual({ shown: false });
  expect(await shown()).toHaveLength(1);

  // A rejected native display must not poison the dedup record. The provider
  // retries after 30 seconds, then acknowledges exactly one finished notice.
  await worker.evaluate(() => { (self as unknown as WorkerTestState).laundryTestFailures = 1; });
  await page.clock.setFixedTime(new Date(now + 10 * 60_000 + 1_000));
  await expect.poll(() => worker.evaluate(() => (self as unknown as WorkerTestState).laundryTestFailures)).toBe(0);
  expect(await shown()).toHaveLength(1);
  await page.clock.setFixedTime(new Date(now + 11 * 60_000));
  await expect.poll(shown).toHaveLength(2);
  expect((await shown())[1]).toEqual({ tag: `laundry:${start.laundryCycleId}:finished`, body: "Machine à laver 2 · chambre 201 : le linge est prêt à récupérer." });
  expect(JSON.stringify(await shown())).not.toContain("Repère privé");
  const finished = laundryNotices(workEvents, now + 11 * 60_000)[0];
  await worker.evaluate(async notice => {
    let pending: Promise<unknown> = Promise.resolve();
    const event = new Event("push");
    Object.defineProperties(event, { data: { value: { json: () => notice } }, waitUntil: { value: (promise: Promise<unknown>) => { pending = promise; } } });
    self.dispatchEvent(event); await pending;
  }, finished);
  expect((await shown())[2]).toEqual({ tag: `laundry:${start.laundryCycleId}:finished`, body: "Machine à laver 2 · chambre 201 : le linge est prêt à récupérer.", silent: true });
  await worker.evaluate(async notice => {
    let pending: Promise<unknown> = Promise.resolve();
    const event = new Event("push");
    Object.defineProperties(event, { data: { value: { json: () => ({ ...notice, expiresAt: new Date(Date.now() - 1).toISOString() }) } }, waitUntil: { value: (promise: Promise<unknown>) => { pending = promise; } } });
    self.dispatchEvent(event); await pending;
  }, soon);
  expect((await shown())[3]).toEqual({ tag: "laundry:check", body: "Ouvrez la lingerie pour vérifier les cycles et la récupération du linge.", silent: true });
  await page.goto("/lingerie");
  await page.getByRole("button", { name: "Désactiver sur cet appareil", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activer sur cet appareil", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("hotel-laundry-notifications-enabled"))).toBeNull();
});

test("denied notifications keep visible in-app reminders and explain the fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" });
    Notification.requestPermission = async () => "denied";
  });
  const now = Date.now();
  await prepare(page, now);
  await page.goto("/lingerie");
  await expect(page.getByText(/Notifications bloquées :/)).toBeVisible();
  await page.getByRole("button", { name: "Activer sur cet appareil", exact: true }).click();
  await expect(page.getByText("Les notifications sont bloquées. Autorisez-les dans les réglages de ce site, puis réessayez.", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(now + 1_000));
  await expect(page.getByRole("alert").filter({ hasText: "Machine à laver 2 · chambre 201 : il reste moins de 10 minutes." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer un test", exact: true })).toHaveCount(0);
});
