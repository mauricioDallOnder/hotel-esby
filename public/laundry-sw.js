/* Laundry notifications only: this worker does not cache hotel pages or records. */
const noticeDatabase = "hotel-laundry-alerts";
const machineIds = new Set(["washer-1", "washer-2", "washer-3", "dryer-1", "dryer-2", "dryer-3"]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function validNotice(value) {
  if (!value || typeof value !== "object" || typeof value.cycleId !== "string" || value.cycleId.length > 80
    || !["soon", "finished"].includes(value.stage) || value.id !== value.cycleId + ":" + value.stage
    || !machineIds.has(value.machineId) || typeof value.body !== "string" || value.body.length > 240
    || typeof value.expiresAt !== "string" || !(Date.parse(value.expiresAt) > Date.now())) return null;
  return {
    ...value, tag: "laundry:" + value.id, url: "/lingerie",
    title: value.stage === "soon" ? "Lingerie · bientôt terminé" : "Lingerie · cycle terminé",
  };
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(noticeDatabase, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("shown", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function claimNotice(notice) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("shown", "readwrite"), store = transaction.objectStore("shown");
      const request = store.get(notice.id);
      let claimed = false;
      request.onsuccess = () => {
        if (!request.result || request.result.expiresAt <= Date.now()) {
          store.put({ id: notice.id, expiresAt: Date.parse(notice.expiresAt) });
          claimed = true;
        }
      };
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        if (cursor.result.value.expiresAt <= Date.now()) cursor.result.delete();
        cursor.result.continue();
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function releaseNotice(id) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("shown", "readwrite");
      transaction.objectStore("shown").delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function showNotice(input, fromPush = false) {
  const notice = validNotice(input);
  if (!notice) {
    // userVisibleOnly requires a visible result for every incoming push. An
    // expired message must never claim there are still ten minutes remaining.
    if (fromPush) await self.registration.showNotification("Lingerie · suivi des machines", {
      body: "Ouvrez la lingerie pour vérifier les cycles et la récupération du linge.",
      tag: "laundry:check", renotify: false, silent: true,
      icon: "/laundry-icon.svg", data: { url: "/lingerie" },
    });
    return false;
  }
  let claimed;
  try { claimed = await claimNotice(notice); }
  catch { claimed = !(await self.registration.getNotifications({ tag: notice.tag })).length; }
  if (!claimed && !fromPush) return false;
  try {
    await self.registration.showNotification(notice.title, {
      body: notice.body, tag: notice.tag, renotify: false,
      ...(!claimed ? { silent: true } : {}),
      icon: "/laundry-icon.svg", data: { url: "/lingerie", id: notice.id },
    });
  } catch (error) {
    if (claimed) await releaseNotice(notice.id).catch(() => {});
    throw error;
  }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: "LAUNDRY_NOTICE_SHOWN", notice });
  return true;
}

self.addEventListener("push", event => {
  let notice;
  try { notice = event.data?.json(); } catch { /* Display a safe, quiet prompt. */ }
  event.waitUntil(showNotice(notice, true));
});

self.addEventListener("message", event => {
  if (event.data?.type === "LAUNDRY_SHOW") event.waitUntil(showNotice(event.data.notice)
    .then(shown => event.ports[0]?.postMessage({ shown }))
    .catch(() => event.ports[0]?.postMessage({ shown: false, error: "notification_unavailable" })));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("/lingerie", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.navigate(target);
        await client.focus();
        return;
      } catch { /* A tab may have closed while the notification was opened. */ }
    }
    await self.clients.openWindow(target);
  })());
});
