"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Snackbar } from "@mui/material";
import { laundryForegroundReady, laundryNotices, type LaundryNotice } from "@/lib/laundryNotifications";
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

export function useLaundryNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error("LaundryNotificationsProvider manquant");
  return context;
}

export function LaundryNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { events, queued } = useWorkEvents();
  const { refresh } = useAppContext();
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

  const registration = useCallback(async () => {
    if (!registrationPromise.current) {
      registrationPromise.current = (async () => {
        const result = await navigator.serviceWorker.register("/laundry-sw.js", { scope: "/", updateViaCache: "none" });
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
    try {
      const response = await fetch("/api/laundry/notifications/status", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setStatus(await response.json());
    } catch { setStatus(null); }
    finally { setStatusLoaded(true); }
  }, []);

  useEffect(() => {
    let cancelled = false;
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
    const focus = () => { inspect(); void checkStatus(); if (navigator.onLine) void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") focus(); };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    document.addEventListener("visibilitychange", visible);
    // Other employees can start/collect a machine from another device.
    const refreshTimer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); }, 30_000);
    const statusTimer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void checkStatus(); }, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", focus); window.removeEventListener("online", focus);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(refreshTimer); clearInterval(statusTimer);
    };
  }, [checkStatus, refresh]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (!enabled || permission !== "granted" || !status?.publicKey) {
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
  }, [enabled, permission, registration, status]);

  useEffect(() => {
    const showToast = (notice: LaundryNotice) => {
      if (rememberNotice(notice, "toast")) setAlerts(current => [...current.filter(item => Date.parse(item.expiresAt) > Date.now()), notice].slice(-6));
    };
    const tick = () => {
      const pendingCycles = new Set(queued.filter(item => !item.blocked && item.entry.type === "createWorkEvent")
        .map(item => item.entry.type === "createWorkEvent" ? item.entry.laundryCycleId : undefined));
      for (const notice of laundryNotices(events)) {
        showToast(notice);
        const backgroundActive = navigator.onLine && subscribed && status?.backgroundConfigured && status.schedulerRecent && !pendingCycles.has(notice.cycleId);
        if (enabled && permission === "granted" && laundryForegroundReady(notice, !!backgroundActive) && !alreadySeen(notice, "system")
          && !noticesInFlight.current.has(notice.id) && (nextNoticeAttempt.current.get(notice.id) || 0) <= Date.now()) {
          noticesInFlight.current.add(notice.id);
          void registration().then(worker => showSystemNotice(worker, notice)).then(() => {
            rememberNotice(notice, "system");
            nextNoticeAttempt.current.delete(notice.id);
            setError(current => current === foregroundError ? "" : current);
          }).catch(() => {
            nextNoticeAttempt.current.set(notice.id, Date.now() + 30_000);
            setError(foregroundError);
          }).finally(() => noticesInFlight.current.delete(notice.id));
        }
      }
    };
    const received = (event: MessageEvent) => {
      if (event.data?.type === "LAUNDRY_NOTICE_SHOWN") {
        const current = laundryNotices(events).find(notice => notice.id === event.data.notice?.id);
        if (current) { rememberNotice(current, "system"); showToast(current); }
      }
    };
    tick();
    const timer = setInterval(tick, 1_000);
    navigator.serviceWorker?.addEventListener("message", received);
    return () => { clearInterval(timer); navigator.serviceWorker?.removeEventListener("message", received); };
  }, [events, queued, enabled, permission, registration, status, subscribed]);

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
