"use client";
import { useEffect, useState } from "react";
import { Alert, Button } from "@mui/material";
import { flushDeviceDrafts } from "@/lib/useDeviceDraft";

export function VersionNotice() {
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true, checking = false, lastCheck = 0;
    const check = async () => {
      if (!navigator.onLine || document.visibilityState === "hidden" || checking || Date.now() - lastCheck < 5000) return;
      checking = true; lastCheck = Date.now();
      try {
        const response = await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const result = response.ok ? await response.json() : null;
        if (active && typeof result?.version === "string" && result.version !== process.env.NEXT_PUBLIC_HOTEL_BUILD_VERSION) setAvailable(true);
      } catch { /* Offline work continues; the next foreground event retries. */ }
      finally { checking = false; }
    };
    void check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => { active = false; window.removeEventListener("focus", check); window.removeEventListener("pageshow", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, []);
  async function update() {
    try {
      if (document.querySelector('fieldset:disabled')) throw new Error("Attendez la fin de l’enregistrement ou de la compression des photos.");
      await flushDeviceDrafts();
      window.location.reload();
    } catch (e) { setError((e as Error).message); }
  }
  if (!available) return null;
  return <Alert severity={error ? "error" : "info"} action={<Button onClick={() => void update()}>Actualiser l’application</Button>}>
    {error || "Nouvelle version disponible. Vos brouillons enregistrés seront conservés."}
  </Alert>;
}
