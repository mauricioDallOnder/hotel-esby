"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Snackbar } from "@mui/material";
import { laundryForegroundReady, laundryNoticeIsObsolete, laundryNoticesForCycles, nextLaundryNoticeAt, type LaundryNotice } from "@/lib/laundryNotifications";
import { projectLaundry } from "@/lib/laundry";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { useAppContext } from "./AppContext";

type ServerStatus = { publicKey: string | null; backgroundConfigured: boolean; schedulerRecent: boolean };
type Context = {
  ready: boolean; supported: boolean; homeScreenRequired: boolean;
  permission: NotificationPermission; enabled: boolean; subscribed: boolean;
  status: ServerStatus | null; statusLoaded: boolean; busy: boolean; error: string; feedback: string;
  enable: () => Promise<void>; disable: () => Promise<void>; test: () => Promise<void>;
};
const Context = createContext<Context | null>(null);
const preferenceKey = "hotel-laundry-notifications-enabled";
const seenKey = "hotel-laundry-notices-v1";
const memorySeen = new Map<string, number>();
const foregroundError = "Les notifications de cet appareil sont indisponibles. Gardez la page Lingerie ouverte et vérifiez les réglages du navigateur.";

function alreadySeen(notice: LaundryNotice, channel: "toast" | "system") {
  const key = channel + ":" + notice.id, now = Date.now();
  if ((memorySeen.get(key) || 0) > now) return true;
  try { return JSON.parse(localStorage.getItem(seenKey) || "{}")[key] > now; }
  catch { return false; }
}

function rememberNotice(notice: LaundryNotice, channel: "toast" | "system") {
  const key = channel + ":" + notice.id, now = Date.now();
  if ((memorySeen.get(key) || 0) > now) return false;
  try {
    const stored: Record<string, number> = JSON.parse(localStorage.getItem(seenKey) || "{}");
    for (const [id, expiry] of Object.entries(stored)) if (typeof expiry !== "number" || expiry <= now) delete stored[id];
    if (stored[key] > now) { memorySeen.set(key, stored[key]); return false; }
    stored[key] = Date.parse(notice.expiresAt);
    localStorage.setItem(seenKey, JSON.stringify(stored));
  } catch { /* In private browsing, deduplication still works within this tab. */ }
  for (const [id, expiry] of memorySeen) if (expiry <= now) memorySeen.delete(id);
  memorySeen.set(key, Date.parse(notice.expiresAt));
  return true;
}

function savePreference(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(preferenceKey, "true");
    else localStorage.removeItem(preferenceKey);
  }
  catch { /* A restricted device store must not block the current session. */ }
}

function applicationKey(value: string): ArrayBuffer {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function matchesKey(subscription: PushSubscription, publicKey: string) {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = new Uint8Array(applicationKey(publicKey)), actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

async function subscriptionRequest(method: "POST" | "DELETE", subscription: PushSubscription) {
  const response = await fetch("/api/laundry/notifications/subscription", {
    method, headers: { "Content-Type": "application/json" },
    body: JSON.stringify(method === "POST" ? subscription.toJSON() : { endpoint: subscription.endpoint }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "La connexion aux notifications a échoué. Réessayez.");
  }
}

function showSystemNotice(worker: ServiceWorkerRegistration, notice: LaundryNotice): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!worker.active) { reject(new Error(foregroundError)); return; }
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error(foregroundError)); }, 8_000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout); channel.port1.close();
      // shown:false without an error means the worker already delivered this ID.
      if (event.data?.error) reject(new Error(foregroundError));
      else resolve();
    };
    worker.active.postMessage({ type: "LAUNDRY_SHOW", notice }, [channel.port2]);
  });
}

function waitForActivation(worker: ServiceWorker) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); worker.removeEventListener("statechange", inspect); };
    const inspect = () => {
      if (worker.state === "activated") { cleanup(); resolve(); }
      else if (worker.state === "redundant") { cleanup(); reject(new Error("La mise à jour des notifications a échoué. Réessayez.")); }
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Les notifications sont en cours de mise à jour. Réessayez.")); }, 12_000);
    worker.addEventListener("statechange", inspect);
    inspect();
  });
}

export function useLaundryNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error("LaundryNotificationsProvider manquant");
  return context;
}

export function LaundryNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { events, queued } = useWorkEvents();
  const { refresh, authenticated } = useAppContext();
  const projection = useMemo(() => projectLaundry(events), [events]);
  const activeCycles = useMemo(() => projection.machines.flatMap(({ cycle }) => cycle ? [cycle] : []), [projection]);
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(false);
  const [homeScreenRequired, setHomeScreenRequired] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [alerts, setAlerts] = useState<LaundryNotice[]>([]);
  const registrationPromise = useRef<Promise<ServiceWorkerRegistration> | null>(null);
  const registeredSubscription = useRef("");
  const noticesInFlight = useRef(new Set<string>());
  const nextNoticeAttempt = useRef(new Map<string, number>());
  const latestProjection = useRef(projection);
  const latestCycles = useRef(activeCycles);
  const statusChecking = useRef(false);
  const notificationTick = useRef<() => void>(() => {});

  const closeObsoleteNotifications = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    try {
      const worker = await navigator.serviceWorker.getRegistration("/");
      if (!worker) return;
      const displayed = await worker.getNotifications();
      const cycles = new Map(latestProjection.current.cycles.map(cycle => [cycle.cycleId, cycle]));
      for (const notification of displayed) {
        const id = notification.data?.id;
        if (typeof id !== "string") continue;
        const cycle = cycles.get(id.split(":")[0]);
        if (cycle && laundryNoticeIsObsolete(cycle, id)) notification.close();
      }
    } catch { /* Cleanup failure must not block a new reminder. */ }
  }, []);

  const registration = useCallback(async () => {
    if (!registrationPromise.current) {
      registrationPromise.current = (async () => {
        const result = await navigator.serviceWorker.register("/laundry-sw.js", { scope: "/", updateViaCache: "none" });
        // The previous worker does not understand extension IDs. Wait for a
        // freshly installed script before sending it a new-format reminder.
        const updating = result.installing || result.waiting;
        if (updating) await waitForActivation(updating);
        if (result.active) return result;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Les notifications ne sont pas encore prêtes. Réessayez.")), 12_000); }),
          ]);
        } finally { clearTimeout(timeout); }
      })().catch(error => { registrationPromise.current = null; throw error; });
    }
    return registrationPromise.current;
  }, []);

  const checkStatus = useCallback(async () => {
    if (!authenticated || statusChecking.current || !navigator.onLine) return;
    statusChecking.current = true;
    try {
      const response = await fetch("/api/laundry/notifications/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error();
      setStatus(await response.json());
    } catch { setStatus(null); }
    finally { statusChecking.current = false; setStatusLoaded(true); }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    let lastForeground = 0;
    const inspect = () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
      const available = window.isSecureContext && "Notification" in window && "serviceWorker" in navigator;
      setHomeScreenRequired(ios && !standalone);
      setSupported(available);
      setPermission(available ? Notification.permission : "default");
      try { setEnabled(localStorage.getItem(preferenceKey) === "true" && available && Notification.permission === "granted"); } catch { /* Keep the current session preference. */ }
      setReady(true);
    };
    queueMicrotask(() => { if (!cancelled) { inspect(); void checkStatus(); } });
    const focus = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastForeground < 5000) return;
      lastForeground = Date.now();
      inspect(); void checkStatus();
      if (navigator.onLine) void refresh(false);
    };
    const visible = () => { if (document.visibilityState === "visible") focus(); };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    document.addEventListener("visibilitychange", visible);
    // Other employees can start/collect a machine from another device.
    const refreshTimer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(false); }, 30_000);
    const statusTimer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void checkStatus(); }, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", focus); window.removeEventListener("online", focus);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(refreshTimer); clearInterval(statusTimer);
    };
  }, [authenticated, checkStatus, refresh]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (!authenticated || !enabled || permission !== "granted" || !status?.publicKey) {
        registeredSubscription.current = "";
        if (!cancelled) setSubscribed(false);
        return;
      }
      try {
        const worker = await registration(), existing = await worker.pushManager.getSubscription();
        if (!existing || !matchesKey(existing, status.publicKey)) {
          registeredSubscription.current = "";
          if (!cancelled) setSubscribed(false);
          return;
        }
        const key = existing.endpoint + ":" + status.publicKey;
        // Recheck the browser on every status/focus refresh, without rewriting
        // an unchanged subscription in Sheets every minute.
        if (registeredSubscription.current !== key) {
          await subscriptionRequest("POST", existing);
          registeredSubscription.current = key;
        }
        if (!cancelled) setSubscribed(true);
      } catch { if (!cancelled) setSubscribed(false); }
    });
    return () => { cancelled = true; };
  }, [authenticated, enabled, permission, registration, status]);

  useEffect(() => {
    latestProjection.current = projection;
    latestCycles.current = activeCycles;
    if (!authenticated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void closeObsoleteNotifications();
    const isCurrent = (notice: LaundryNotice) => laundryNoticesForCycles(latestCycles.current).some(current => current.id === notice.id && current.expiresAt === notice.expiresAt);
    const showToast = (notice: LaundryNotice) => {
      if (rememberNotice(notice, "toast")) setAlerts(current => [...current.filter(item => Date.parse(item.expiresAt) > Date.now()), notice].slice(-6));
    };
    const schedule = () => {
      clearTimeout(timer);
      if (cancelled) return;
      const now = Date.now(), nextStage = nextLaundryNoticeAt(latestCycles.current, now);
      const next = [nextStage, ...nextNoticeAttempt.current.values()].filter((at): at is number => at !== null && at > now);
      if (next.length) timer = setTimeout(tick, Math.min(2_147_483_647, Math.max(1, Math.min(...next) - now)));
    };
    const tick = () => {
      if (cancelled) return;
      const notices = laundryNoticesForCycles(latestCycles.current), currentIds = new Set(notices.map(notice => notice.id));
      setAlerts(current => {
        const remaining = current.filter(notice => currentIds.has(notice.id));
        return remaining.length === current.length ? current : remaining;
      });
      for (const id of nextNoticeAttempt.current.keys()) if (!currentIds.has(id)) nextNoticeAttempt.current.delete(id);
      const pendingCycles = new Set(queued.filter(item => !item.blocked && item.entry.type === "createWorkEvent")
        .map(item => item.entry.type === "createWorkEvent" ? item.entry.laundryCycleId : undefined));
      for (const notice of notices) {
        showToast(notice);
        const backgroundActive = navigator.onLine && subscribed && status?.backgroundConfigured && status.schedulerRecent && !pendingCycles.has(notice.cycleId);
        if (enabled && permission === "granted" && laundryForegroundReady(notice, !!backgroundActive) && !alreadySeen(notice, "system")
          && !noticesInFlight.current.has(notice.id) && (nextNoticeAttempt.current.get(notice.id) || 0) <= Date.now()) {
          noticesInFlight.current.add(notice.id);
          void registration().then(async worker => {
            if (!isCurrent(notice)) return false;
            await showSystemNotice(worker, notice);
            return true;
          }).then(shown => {
            if (!shown) return;
            if (!isCurrent(notice)) { void closeObsoleteNotifications(); return; }
            rememberNotice(notice, "system");
            nextNoticeAttempt.current.delete(notice.id);
            setError(current => current === foregroundError ? "" : current);
          }).catch(() => {
            if (!isCurrent(notice)) return;
            nextNoticeAttempt.current.set(notice.id, Date.now() + 30_000);
            setError(foregroundError);
          }).finally(() => { noticesInFlight.current.delete(notice.id); notificationTick.current(); });
        }
      }
      schedule();
    };
    const received = (event: MessageEvent) => {
      if (event.data?.type === "LAUNDRY_NOTICE_SHOWN") {
        const current = laundryNoticesForCycles(latestCycles.current).find(notice => notice.id === event.data.notice?.id);
        if (current) { rememberNotice(current, "system"); showToast(current); }
        else {
          const cycle = latestProjection.current.cycles.find(item => item.cycleId === event.data.notice?.cycleId);
          if (typeof event.data.notice?.id === "string" && (!cycle || !laundryNoticeIsObsolete(cycle, event.data.notice.id))) void refresh(false);
          void closeObsoleteNotifications();
        }
      }
    };
    notificationTick.current = tick;
    tick();
    const visible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", visible);
    navigator.serviceWorker?.addEventListener("message", received);
    return () => { cancelled = true; if (notificationTick.current === tick) notificationTick.current = () => {}; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); navigator.serviceWorker?.removeEventListener("message", received); };
  }, [authenticated, projection, activeCycles, queued, enabled, permission, registration, status, subscribed, closeObsoleteNotifications, refresh]);

  async function enable() {
    if (!supported || busy) return;
    setBusy(true); setError(""); setFeedback("");
    try {
      // Keep the browser prompt directly attached to the user's click (iOS).
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") throw new Error(granted === "denied"
        ? "Les notifications sont bloquées. Autorisez-les dans les réglages de ce site, puis réessayez."
        : "Autorisez les notifications pour recevoir les rappels sur cet appareil.");
      const worker = await registration();
      savePreference(true); setEnabled(true);
      if (status?.publicKey && "PushManager" in window) {
        let subscription = await worker.pushManager.getSubscription();
        if (subscription && !matchesKey(subscription, status.publicKey)) {
          await subscriptionRequest("DELETE", subscription);
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(status.publicKey) });
        await subscriptionRequest("POST", subscription);
        registeredSubscription.current = subscription.endpoint + ":" + status.publicKey;
        setSubscribed(true);
      }
      setFeedback("Notifications autorisées sur cet appareil. Vous pouvez envoyer un test.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Impossible d’activer les notifications. Réessayez."); }
    finally { setBusy(false); }
  }

  async function disable() {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try {
      const worker = await navigator.serviceWorker.getRegistration("/");
      const subscription = await worker?.pushManager.getSubscription();
      if (subscription) {
        // Browser revocation stops delivery even while the hotel server is offline.
        const removed = await subscription.unsubscribe();
        if (!removed) throw new Error("Impossible de désactiver les notifications. Réessayez dans les réglages du navigateur.");
        await subscriptionRequest("DELETE", subscription).catch(() => {});
      }
      savePreference(false); setEnabled(false); setSubscribed(false);
      registeredSubscription.current = "";
      setFeedback("Notifications désactivées sur cet appareil.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Impossible de désactiver les notifications."); }
    finally { setBusy(false); }
  }

  async function test() {
    if (busy || !enabled || Notification.permission !== "granted") return;
    setBusy(true); setError(""); setFeedback("");
    try {
      const worker = await registration();
      await worker.showNotification("Lingerie · notification de test", {
        body: "Les rappels apparaîtront ici 10 minutes avant la fin, puis lorsque le linge est prêt.",
        icon: "/laundry-icon.svg", tag: "laundry:test", data: { url: "/lingerie" },
      });
      setFeedback("Test envoyé. Si rien n’apparaît, vérifiez les notifications et le mode silencieux de votre appareil.");
    } catch { setError("Le test n’a pas pu être affiché. Vérifiez les réglages de notification de votre appareil."); }
    finally { setBusy(false); }
  }

  const firstAlert = alerts[0];
  return <Context.Provider value={{ ready, supported, homeScreenRequired, permission, enabled, subscribed, status, statusLoaded, busy, error, feedback, enable, disable, test }}>
    {children}
    <Snackbar open={!!firstAlert} key={firstAlert?.id} autoHideDuration={12_000} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      onClose={(_, reason) => { if (reason !== "clickaway") setAlerts(current => current.slice(1)); }}>
      <Alert severity={firstAlert?.stage === "finished" ? "success" : "info"} variant="filled"
        onClose={() => setAlerts(current => current.slice(1))}
        action={<Button component={Link} href="/lingerie" color="inherit" onClick={() => setAlerts([])}>Voir</Button>}
        sx={{ maxWidth: 460, alignItems: "center" }}>
        {firstAlert?.body}{alerts.length > 1 ? ` (+${alerts.length - 1} rappel${alerts.length > 2 ? "s" : ""})` : ""}
      </Alert>
    </Snackbar>
  </Context.Provider>;
}
