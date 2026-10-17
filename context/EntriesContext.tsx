"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { withEntryLock, withEntryWriteLock } from "@/lib/entryLock";
import { deviceStore } from "@/lib/deviceStore";
import { entrySchema, type Entry, type EntryChange } from "@/lib/rooms";
import { comparePendingEntries, type PendingEntry as Pending } from "@/lib/entryQueue";

type Context = { pending: Pending[]; enqueue: (entry: Entry) => Promise<void>; retry: () => void; removeAbsence: (id: string) => Promise<void>; status: React.ReactNode };
const EntriesContext = createContext<Context | null>(null);
export function useEntries() { return useContext(EntriesContext)!; }
export function EntriesProvider({ children, onSaved, onDelete }: { children: React.ReactNode; onSaved: (change: EntryChange) => void; onDelete: (id: string) => Promise<void> }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const [working, setWorking] = useState(false);
  const [storageError, setStorageError] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    const values = (await deviceStore<Pending[]>("all")).sort(comparePendingEntries);
    if (mounted.current) setPending(values);
    return values;
  }, []);
  const sync = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    setWorking(true);
    try {
      await withEntryLock(async () => {
        const attempted = new Set<string>();
        send: while (mounted.current && navigator.onLine) {
          const items = (await reload()).filter(item => !attempted.has(item.entry.id) && !item.blocked);
          if (!items.length) break;
          for (const item of items) {
            if (!mounted.current) break send;
            attempted.add(item.entry.id);
            try {
              item.attempted = true;
              await deviceStore("put", "queue:" + item.entry.id, item);
              const response = await fetch("/api/entries", {
                method: "POST", headers: { "Content-Type": "application/json", "X-Entry-Schema": item.protocol === 2 ? "2" : "1" },
                body: JSON.stringify(item.entry), signal: AbortSignal.timeout(65_000),
              });
              const result = await response.json();
              if (!response.ok) {
                item.error = result.error || "Envoi impossible.";
                item.blocked = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
                await deviceStore("put", "queue:" + item.entry.id, item);
                if (response.status === 401) break send;
                if (!item.blocked) break send;
                continue;
              }
              if (result.record?.id !== item.entry.id || !["familyEvents", "roomInspections", "workEvents"].includes(result.collection)) throw new Error("Réponse invalide.");
              // Remove only after an explicit server receipt. A lost receipt is safe to retry.
              await deviceStore("delete", "queue:" + item.entry.id);
              if (mounted.current) onSaved(result);
            } catch {
              item.error = "Connexion interrompue ou lente. Enregistrement conservé sur cet appareil.";
              await deviceStore("put", "queue:" + item.entry.id, item);
              break send;
            }
          }
        }
        await reload();
      });
    } catch (error) { if (mounted.current) setStorageError((error as Error).message); }
    finally { running.current = false; if (mounted.current) setWorking(false); }
  }, [reload, onSaved]);
  useEffect(() => {
    mounted.current = true;
    void reload().then(() => { setOnline(navigator.onLine); return sync(); }).catch(error => setStorageError(error.message));
    const connect = () => { setOnline(true); void sync(); };
    const disconnect = () => setOnline(false);
    window.addEventListener("online", connect);
    window.addEventListener("offline", disconnect);
    const timer = window.setInterval(() => void sync(), 60_000);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener("online", connect); window.removeEventListener("offline", disconnect); };
  }, [reload, sync]);
  async function enqueue(input: Entry) {
    const entry = entrySchema.parse(input);
    await withEntryWriteLock(async () => {
      const existing = await deviceStore<Pending | undefined>("get", "queue:" + entry.id);
      if (existing) {
        if (JSON.stringify(existing.entry) !== JSON.stringify(entry)) throw new Error("Cet envoi est déjà conservé. Attendez sa confirmation avant de le modifier.");
        return;
      }
      await deviceStore("put", "queue:" + entry.id, { entry, protocol: 2, attempted: false, queuedAt: Date.now() });
    });
    await reload();
    void sync();
  }
  function retry() {
    if (running.current) return;
    void (async () => {
      await withEntryLock(async () => {
        for (const item of await reload()) await deviceStore("put", "queue:" + item.entry.id, { ...item, error: undefined, blocked: false });
      });
      await sync();
    })().catch(error => setStorageError(error.message));
  }
  async function removeAbsence(id: string) {
    await withEntryLock(async () => {
      const item = await deviceStore<Pending | undefined>("get", "queue:" + id);
      if (item && (item.entry.type !== "createFamilyEvent" || item.entry.kind !== "absence")) throw new Error("Seules les absences peuvent être supprimées.");
      // Undefined means an old queue item: it may have a lost server receipt.
      if (!item || item.attempted !== false) await onDelete(id);
      if (item) await deviceStore("delete", "queue:" + id);
      await reload();
    });
  }
  async function discardBlocked(id: string) {
    try {
      await withEntryLock(async () => {
        const item = await deviceStore<Pending | undefined>("get", "queue:" + id);
        if (item?.blocked && item.entry.type === "createWorkEvent") await deviceStore("delete", "queue:" + id);
        await reload();
      });
    } catch (e) { setStorageError((e as Error).message); }
  }
  const status = <>
    <Stack spacing={1} sx={{ mb: 2 }}>
      {!online && <Alert severity="warning">Hors connexion. Les nouveaux contrôles et événements seront conservés sur cet appareil jusqu’au retour du réseau.</Alert>}
      {pending.length > 0 && <Alert severity={pending.some(p => p.blocked) ? "error" : "info"} action={<Button disabled={working || !online} onClick={retry}>Réessayer</Button>}>
        <Typography variant="body2">{pending.length} enregistrement(s) en attente d’envoi{working ? " · Synchronisation…" : ""}. Ne supprimez pas les données du navigateur.</Typography>
        {pending.filter(p => p.error).map(p => <Stack key={p.entry.id}>
          <Typography variant="caption">{p.entry.room ? `Ch. ${p.entry.room}` : "Tâche"} : {p.error}</Typography>
          {p.blocked && p.entry.type === "createWorkEvent" && <><Typography variant="caption" sx={{ whiteSpace: "pre-wrap" }}>{p.entry.kind === "roomAvailability" ? `Disponibilité demandée : ${p.entry.free ? "libre" : "occupée"}` : p.entry.notes}</Typography><Button onClick={() => void discardBlocked(p.entry.id)}>Annuler cette modification en attente</Button></>}
        </Stack>)}
      </Alert>}
      {storageError && <Alert severity="error">{storageError}</Alert>}
    </Stack>
  </>;
  return <EntriesContext.Provider value={{ pending, enqueue, retry, removeAbsence, status }}>{children}</EntriesContext.Provider>;
}

export function SyncStatus() { return useEntries().status; }
