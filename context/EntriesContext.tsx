"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Button, Snackbar, Stack, Typography } from "@mui/material";
import { withEntryLock, withEntryWriteLock } from "@/lib/entryLock";
import { deviceStore, deviceStoreBatch } from "@/lib/deviceStore";
import { entrySchema, type Entry, type EntryChange, type WorkEntry, type WorkEvent } from "@/lib/rooms";
import { comparePendingEntries, type PendingEntry as Pending } from "@/lib/entryQueue";
import { createId, displayDate, today } from "@/lib/domain";
import { collectedItemRoomLabel } from "@/lib/collectedItems";
import { getLaundryMachine } from "@/lib/laundry";
import { buildRecoveredLaundryEntry, inspectLaundryRecovery, sameLaundryRecoveryReview, type LaundryRecoveryReview } from "@/lib/laundryRecovery";
import { LaundryRecoveryDialog } from "@/components/LaundryRecoveryDialog";

type Context = { pending: Pending[]; ready: boolean; online: boolean; working: boolean; storageError: string; enqueue: (entry: Entry) => Promise<void>; retry: () => void; reviewLaundry: (id: string) => void; removeAbsence: (id: string) => Promise<void>; status: React.ReactNode };
const EntriesContext = createContext<Context | null>(null);
export function useEntries() { return useContext(EntriesContext)!; }
function isLaundryRequest(item: Pending): item is Pending & { entry: WorkEntry } {
  return item.entry.type === "createWorkEvent" && item.entry.kind === "laundryCycle";
}
function laundryRequestLabel(entry: WorkEntry) {
  return `${getLaundryMachine(entry.targetId)?.label || entry.targetId} · Ch. ${entry.room}`;
}
function laundryActionLabel(entry: WorkEntry) {
  return entry.laundryAddedMinutes ? `Ajout de ${entry.laundryAddedMinutes} min` : entry.laundryStatus === "en_cours"
    ? "Démarrage" : entry.laundryStatus === "recupere" ? "Retrait" : "Annulation";
}
export function EntriesProvider({ children, onSaved, onDelete, readLaundryRecoveryState }: { children: React.ReactNode; onSaved: (change: EntryChange) => void; onDelete: (id: string) => Promise<void>; readLaundryRecoveryState: () => Promise<WorkEvent[]> }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [working, setWorking] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    const values = (await deviceStore<Pending[]>("all")).sort(comparePendingEntries);
    if (mounted.current) {
      setPending(current => !current.length && !values.length ? current : values);
      setReady(true);
      setStorageError("");
    }
    return values;
  }, []);
  const sync = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    try {
      await withEntryLock(async () => {
        const attempted = new Set<string>();
        send: while (mounted.current && navigator.onLine) {
          const items = (await reload()).filter(item => !attempted.has(item.entry.id) && !item.blocked);
          if (!items.length) break;
          setWorking(true);
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
      if (entry.type === "createWorkEvent" && entry.kind === "laundryCycle" &&
        (await deviceStore<Pending[]>("all")).some(item => item.blocked && isLaundryRequest(item) && item.entry.targetId === entry.targetId))
        throw new Error("Cette machine a une demande à vérifier. Ouvrez « Vérifier la demande » avant de continuer.");
      await deviceStore("put", "queue:" + entry.id, { entry, protocol: 2, attempted: false, queuedAt: Date.now() });
    });
    await reload();
    void sync();
  }
  function retry() {
    if (running.current) return;
    void (async () => {
      await withEntryLock(async () => {
        const items = await reload();
        const laundry = items.find(item => item.blocked && isLaundryRequest(item));
        if (laundry) setRecoveryId(laundry.entry.id);
        // A revision conflict cannot be fixed by resending its stale payload.
        // Keep refused laundry actions out of optimistic state until reviewed.
        for (const item of items) {
          if (item.blocked && isLaundryRequest(item)) continue;
          await deviceStore("put", "queue:" + item.entry.id, { ...item, error: undefined, blocked: false });
        }
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
        if (item?.blocked && item.entry.type === "createWorkEvent" && !isLaundryRequest(item)) await deviceStore("delete", "queue:" + id);
        await reload();
      });
    } catch (e) { setStorageError((e as Error).message); }
  }
  async function inspectPendingLaundry(id: string) {
    if (!navigator.onLine) throw new Error("Connectez cet appareil pour vérifier le cycle. La demande reste conservée.");
    const events = await readLaundryRecoveryState();
    const items = await reload();
    const item = items.find(value => value.entry.id === id);
    if (!item || !item.blocked || !isLaundryRequest(item))
      throw new Error("Cette demande a changé sur cet appareil. Fermez cette fenêtre et vérifiez la lingerie.");
    return { item, events, review: inspectLaundryRecovery(item.entry, events, items) };
  }
  async function settleSavedLaundry(item: Pending, review: LaundryRecoveryReview) {
    if (review.kind !== "saved" || !review.confirmed) return false;
    await deviceStore("delete", "queue:" + item.entry.id);
    onSaved({ collection: "workEvents", record: review.confirmed });
    await reload();
    setRecoveryId(current => current === item.entry.id ? null : current);
    setNotice(`${laundryRequestLabel(review.original)} : enregistrement confirmé.`);
    return true;
  }
  async function checkLaundry(id: string): Promise<LaundryRecoveryReview> {
    return withEntryLock(async () => {
      const { item, review } = await inspectPendingLaundry(id);
      await settleSavedLaundry(item, review);
      return review;
    });
  }
  async function resolveLaundry(id: string, shown: LaundryRecoveryReview, action: "retry" | "replace" | "dismiss") {
    await withEntryLock(async () => {
      const { item, events, review } = await inspectPendingLaundry(id);
      if (await settleSavedLaundry(item, review)) return;
      // The operator approves the cycle they have just seen. A new remote event
      // requires another review; the final server revision check still applies.
      if (!sameLaundryRecoveryReview(review, shown))
        throw new Error("Le cycle a encore changé. Vérifiez à nouveau son état avant de confirmer.");
      await withEntryWriteLock(async () => {
        const items = await deviceStore<Pending[]>("all");
        const stored = items.find(value => value.entry.id === id);
        if (!stored?.blocked || !isLaundryRequest(stored) || JSON.stringify(stored.entry) !== JSON.stringify(item.entry))
          throw new Error("Cette demande a changé sur cet appareil. Vérifiez à nouveau son état.");
        // Enqueue uses this same write lock: check any new dependent requests
        // before retrying or atomically replacing this request.
        const lockedReview = inspectLaundryRecovery(stored.entry, events, items);
        if (!sameLaundryRecoveryReview(lockedReview, review))
          throw new Error("Une autre demande de cette machine a changé. Vérifiez à nouveau son état.");
        if (action === "replace") {
          if (review.kind !== "reconfirm") throw new Error("Cette demande ne peut pas être reconfirmée. Vérifiez son état.");
          const entry = buildRecoveredLaundryEntry(review, { id: createId(), at: new Date().toISOString(), date: today() });
          await deviceStoreBatch([
            { action: "put", key: "queue:" + entry.id, value: { entry, protocol: 2, attempted: false, queuedAt: Date.now() } satisfies Pending },
            { action: "delete", key: "queue:" + id },
          ]);
          setNotice(`${laundryRequestLabel(entry)} : nouvelle demande conservée, en attente d’envoi.`);
        } else if (action === "retry") {
          if (review.kind !== "retry") throw new Error("Vérifiez le cycle avant de réessayer cette demande.");
          await deviceStore("put", "queue:" + id, { ...stored, blocked: false, error: undefined });
          setNotice(`${laundryRequestLabel(item.entry)} : nouvelle tentative d’envoi.`);
        } else {
          // Explicitly closing a refused request only removes the local intent;
          // the confirmed server history and the current machine are untouched.
          await deviceStore("delete", "queue:" + id);
          setNotice(`${laundryRequestLabel(item.entry)} : ${review.kind === "completed" ? "demande déjà traitée, message retiré." : "demande en attente annulée."}`);
        }
      });
      await reload();
      setRecoveryId(null);
    });
    void sync();
  }
  const laundryErrors = pending.filter(item => item.blocked && isLaundryRequest(item));
  const otherErrors = pending.filter(item => (item.error || item.blocked) && !(item.blocked && isLaundryRequest(item)));
  const selected = pending.find(item => item.entry.id === recoveryId && item.blocked && isLaundryRequest(item));
  const status = (laundryErrors.length || otherErrors.length || storageError) ? <Stack spacing={1} sx={{ mt: 1.5 }}>
      {laundryErrors.length > 0 && <Alert severity="warning" sx={{ "& .MuiAlert-message": { width: "100%", minWidth: 0 } }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>Lingerie · {laundryErrors.length} demande{laundryErrors.length > 1 ? "s" : ""} à vérifier</Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>Vérifiez le cycle actuel pour résoudre chaque demande.</Typography>
        {laundryErrors.map(item => isLaundryRequest(item) && <Stack key={item.entry.id} component="section" aria-label={laundryRequestLabel(item.entry)} spacing={0.5}
          sx={{ pt: 1, mt: 1, borderTop: "1px solid", borderColor: "divider", overflowWrap: "anywhere" }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{laundryRequestLabel(item.entry)}</Typography>
          <Typography variant="caption">{laundryActionLabel(item.entry)} · {item.entry.actor}</Typography>
          <Button variant="outlined" onClick={() => setRecoveryId(item.entry.id)} sx={{ minHeight: 44, alignSelf: { xs: "stretch", sm: "flex-start" } }}>Vérifier et résoudre</Button>
        </Stack>)}
      </Alert>}
      {otherErrors.length > 0 && <Alert severity={otherErrors.some(p => p.blocked) ? "error" : "warning"}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{otherErrors.some(p => p.blocked) ? "Ces modifications nécessitent votre attention." : "L’envoi reprendra dès que la connexion le permettra."}</Typography>
        {otherErrors.map(p => <Stack key={p.entry.id}>
          <Typography variant="body2">{p.entry.room ? `Ch. ${p.entry.room}` : p.entry.type === "createWorkEvent" && p.entry.kind === "collectedItem" ? collectedItemRoomLabel("") : "Tâche"} : {p.error || "Envoi refusé. Actualisez les données puis réessayez."}</Typography>
          {p.blocked && p.entry.type === "createWorkEvent" && <><Typography variant="caption" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.entry.kind === "roomAvailability" ? `Disponibilité demandée : ${p.entry.free ? "libre" : "occupée"}` : p.entry.kind === "collectedItem"
            ? `${p.entry.itemName} · Récupéré le ${displayDate(p.entry.collectedOn!)} par ${p.entry.collectedBy}\n${p.entry.returnedOn ? `Restitution demandée : ${displayDate(p.entry.returnedOn)} · ${p.entry.returnedBy}` : "État demandé : en armoire"}${p.entry.notes ? `\nMotif : ${p.entry.notes}` : ""}`
            : p.entry.notes}</Typography><Button onClick={() => void discardBlocked(p.entry.id)}>Annuler cette modification en attente</Button></>}
        </Stack>)}
      </Alert>}
      {storageError && <Alert severity="error">{storageError}</Alert>}
    </Stack> : null;
  return <EntriesContext.Provider value={{ pending, ready, online, working, storageError, enqueue, retry, reviewLaundry: setRecoveryId, removeAbsence, status }}>
    {children}
    {selected && isLaundryRequest(selected) && <LaundryRecoveryDialog key={selected.entry.id} entry={selected.entry}
      onCheck={() => checkLaundry(selected.entry.id)} onResolve={(review, action) => resolveLaundry(selected.entry.id, review, action)} onClose={() => setRecoveryId(null)} />}
    <Snackbar open={!!notice} autoHideDuration={6500} onClose={() => setNotice("")}>
      <Alert severity="info" onClose={() => setNotice("")} sx={{ width: "100%" }}>{notice}</Alert>
    </Snackbar>
  </EntriesContext.Provider>;
}

export function SyncStatus() { return useEntries().status; }
