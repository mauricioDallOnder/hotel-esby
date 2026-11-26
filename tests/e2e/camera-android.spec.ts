import { devices } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

async function login(page: Page) {
  const session = await page.request.post("/api/session", {
    data: { role: "employe", password: "test-employee" },
  });
  expect(session.ok()).toBeTruthy();
}

async function openReport(page: Page) {
  await login(page);
  await page.goto("/anomalies");
  await page.getByRole("button", { name: "Signaler une anomalie", exact: true }).click();
}

async function openCamera(page: Page) {
  await page.getByText("Prendre une photo", { exact: true }).click();
  const camera = page.getByRole("dialog", { name: "Appareil photo", exact: true });
  await expect(camera.getByRole("button", { name: "Photographier" })).toBeEnabled();
  const track = await camera.locator("video").evaluateHandle(video =>
    ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]);
  expect(await track.evaluate(track => track.readyState)).toBe("live");
  return { camera, track };
}

test.describe("Android", () => {
  test.use({ userAgent: devices["Pixel 5"].userAgent });

  test("takes two JPEG photos inside the report and releases the camera after each", async ({ page, context }) => {
    await context.grantPermissions(["camera"]);
    await openReport(page);
    for (const index of [1, 2]) {
      const { camera, track } = await openCamera(page);
      await camera.getByRole("button", { name: "Photographier" }).click();
      await expect(camera).toBeHidden();
      await expect.poll(() => track.evaluate(track => track.readyState)).toBe("ended");
      const photo = page.getByRole("img", { name: `Photo ${index} du problème signalé` });
      await expect(photo).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
      await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await track.dispose();
    }
    await expect(page.getByText("2 / 3 photos · facultatif")).toBeVisible();
  });

  test("cancelling stops the preview and keeps the report without an attachment", async ({ page, context }) => {
    await context.grantPermissions(["camera"]);
    await openReport(page);
    const { camera, track } = await openCamera(page);
    await camera.getByRole("button", { name: "Annuler" }).click();
    await expect(camera).toBeHidden();
    await expect.poll(() => track.evaluate(track => track.readyState)).toBe("ended");
    await expect(page.getByText("0 / 3 photos · facultatif")).toBeVisible();
    await track.dispose();
  });

  test("attaches a camera photo to a room inspection", async ({ page, context }) => {
    await context.grantPermissions(["camera"]);
    await login(page);
    await page.goto("/checklist");
    await page.getByRole("button", { name: "Contrôler la chambre 114", exact: true }).click();
    await page.getByRole("button", { name: "Continuer · État et ménage", exact: true }).click();
    await page.getByRole("button", { name: "Continuer · Résumé", exact: true }).click();
    const { camera, track } = await openCamera(page);
    await camera.getByRole("button", { name: "Photographier" }).click();
    const photo = page.getByAltText("Photo du contrôle 1", { exact: true });
    await expect(photo).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
    await expect(photo).toBeVisible();
    await expect.poll(() => track.evaluate(track => track.readyState)).toBe("ended");
    await track.dispose();
  });

  test("a denied camera permission offers the gallery", async ({ page }) => {
    // Block camera access in the document even when Chromium's fake camera is enabled.
    await page.route("**/anomalies", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "permissions-policy": "camera=()" } });
    });
    await openReport(page);
    await page.getByText("Prendre une photo", { exact: true }).click();
    await expect(page.getByText(/Accès à la caméra refusé/)).toBeVisible();
    const pending = page.waitForEvent("filechooser");
    await page.getByText("Choisir dans la galerie", { exact: true }).click();
    const chooser = await pending;
    expect(await chooser.element().getAttribute("capture")).toBeNull();
    await chooser.setFiles({
      name: "galerie.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAAMIM/4EAAB/uBfsL2WiLAAAAAElFTkSuQmCC", "base64"),
    });
    await expect(page.getByText("1 / 3 photos · facultatif")).toBeVisible();
  });
});

test.describe("iPhone user agent", () => {
  test.use({ userAgent: devices["iPhone 13"].userAgent });

  test("requests the native rear-camera file chooser", async ({ page }) => {
    await openReport(page);
    const pending = page.waitForEvent("filechooser");
    await page.getByText("Prendre une photo", { exact: true }).click();
    const chooser = await pending;
    expect(await chooser.element().getAttribute("capture")).toBe("environment");
    await expect(page.getByRole("dialog", { name: "Appareil photo" })).toHaveCount(0);
  });
});
