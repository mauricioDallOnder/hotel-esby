"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, Stack, Typography } from "@mui/material";
import { withEntryLock, withEntryWriteLock } from "@/lib/entryLock";
import { deviceStore, deviceStoreBatch } from "@/lib/deviceStore";
import { entrySchema, roomIssue, type Entry, type EntryChange, type RoomEntry, type WorkEntry } from "@/lib/rooms";
import { blockPendingBranch, comparePendingEntries, isPermanentEntryFailure, pendingBlocker, pendingRequiresLegacyReview, type PendingEntry as Pending } from "@/lib/entryQueue";
import { createId, today, type State } from "@/lib/domain";
import { getLaundryMachine } from "@/lib/laundry";
import { buildRecoveredLaundryEntry, inspectLaundryRecovery, sameLaundryRecoveryReview, type LaundryRecoveryReview } from "@/lib/laundryRecovery";
import { LaundryRecoveryDialog } from "@/components/LaundryRecoveryDialog";
import { EntryRecoveryDialog, type EntryRecoveryAction } from "@/components/EntryRecoveryDialog";
import { RoomInspectionDialog } from "@/components/RoomInspectionDialog";
import { buildRecoveredWorkEntry, inspectEntryRecovery, isCompleteEntryReceipt, pendingEntryLabel, recoveryStateIdentity, type EntryRecoveryReview } from "@/lib/entryRecovery";
import { validateRoomIssuePlan } from "@/lib/roomIssueMatching";

type Context = { pending: Pending[]; ready: boolean; online: boolean; working: boolean; storageError: string; enqueue: (entry: Entry) => Promise<void>; retry: () => void; reviewLaundry: (id: string) => void; reviewPending: (id: string) => void; removeAbsence: (id: string) => Promise<void>; status: React.ReactNode };
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
export function EntriesProvider({ children, onSaved, onDelete, readRecoveryState, authenticated = true }: { children: React.ReactNode; onSaved: (change: EntryChange) => void; onDelete: (id: string) => Promise<void>; readRecoveryState: () => Promise<State>; authenticated?: boolean }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [working, setWorking] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [roomRecovery, setRoomRecovery] = useState<{ originalId: string; entry: RoomEntry } | null>(null);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  const authenticatedRef = useRef(authenticated);
  useEffect(() => { authenticatedRef.current = authenticated; }, [authenticated]);
  const holdBranch = useCallback(async (refused: Pending, reason: Pending["blockedReason"] = "conflict") => {
    await withEntryWriteLock(async () => {
      const items = await deviceStore<Pending[]>("all");
      await deviceStoreBatch(blockPendingBranch(items, refused, reason).map(value => ({ action: "put" as const, key: "queue:" + value.entry.id, value })));
    });
  }, []);
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
    if (running.current || !navigator.onLine || !authenticatedRef.current) return;
    running.current = true;
    try {
      await withEntryLock(async () => {
        const attempted = new Set<string>();
        send: while (mounted.current && navigator.onLine && authenticatedRef.current) {
          const items = (await reload()).filter(item => !attempted.has(item.entry.id) && !item.blocked);
          if (!items.length) break;
          setWorking(true);
          for (const snapshot of items) {
            if (!mounted.current || !navigator.onLine || !authenticatedRef.current) break send;
            // A previous request in this same batch may have held this one.
            const item = await deviceStore<Pending | undefined>("get", "queue:" + snapshot.entry.id);
            if (!item || item.blocked) continue;
            attempted.add(item.entry.id);
            if (pendingRequiresLegacyReview(item)) {
              item.error = "Cette ancienne demande doit être vérifiée avant son envoi. Ses informations restent conservées.";
              await holdBranch(item, "legacy");
              continue;
            }
            const blocker = pendingBlocker(item.entry, await deviceStore<Pending[]>("all"));
            if (blocker) {
              await holdBranch({ ...item, blockedBy: blocker.entry.id, error: "Une demande précédente doit être vérifiée avant cet envoi." }, "dependency");
              continue;
            }
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
                item.blocked = isPermanentEntryFailure(response.status);
                if (item.blocked) await holdBranch(item, response.status === 409 ? "conflict" : "validation");
                else await deviceStore("put", "queue:" + item.entry.id, item);
                if (response.status === 401) break send;
                if (!item.blocked) break send;
                continue;
              }
              if (!await isCompleteEntryReceipt(item, result)) throw new Error("Confirmation d’enregistrement incomplète.");
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
  }, [reload, onSaved, holdBranch]);
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
  useEffect(() => { if (authenticated) void sync(); }, [authenticated, sync]);
  async function enqueue(input: Entry) {
    const entry = entrySchema.parse(input);
    await withEntryWriteLock(async () => {
      const existing = await deviceStore<Pending | undefined>("get", "queue:" + entry.id);
      if (existing) {
        if (JSON.stringify(existing.entry) !== JSON.stringify(entry)) throw new Error("Cet envoi est déjà conservé. Attendez sa confirmation avant de le modifier.");
        return;
      }
      if (pendingBlocker(entry, await deviceStore<Pending[]>("all")))
        throw new Error("Ce suivi a une demande à vérifier. Ouvrez les envois à vérifier avant de continuer. Votre saisie reste dans ce formulaire.");
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
        if (!laundry && items.some(item => item.blocked)) setPendingOpen(true);
        // Only transport failures can be retried without a fresh comparison.
        for (const item of items.filter(value => !value.blocked))
          await deviceStore("put", "queue:" + item.entry.id, { ...item, error: undefined });
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
      await withEntryWriteLock(async () => {
        const items = await deviceStore<Pending[]>("all");
        const children = items.filter(value => value.entry.type === "createWorkEvent" && value.entry.kind === "familyComment" && value.entry.familyEventId === id);
        await deviceStoreBatch([
          ...children.map(value => ({ action: "put" as const, key: "queue:" + value.entry.id, value: { ...value, blocked: true, blockedReason: "dependency" as const, blockedBy: id,
            error: "L’événement familial a été supprimé. Vérifiez ce commentaire avant de retirer sa copie en attente." } })),
          ...(item ? [{ action: "delete" as const, key: "queue:" + id }] : []),
        ]);
      });
      await reload();
    });
  }
  async function inspectPendingLaundry(id: string) {
    if (!navigator.onLine) throw new Error("Connectez cet appareil pour vérifier le cycle. La demande reste conservée.");
    const events = (await readRecoveryState()).workEvents || [];
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
          await deviceStore("put", "queue:" + id, { ...stored, blocked: false, blockedReason: undefined, blockedBy: undefined, error: undefined });
          setNotice(`${laundryRequestLabel(item.entry)} : nouvelle tentative d’envoi.`);
        } else {
          // Explicitly closing a refused request only removes the local intent;
          // the confirmed server history and the current machine are untouched.
          await deviceStoreBatch([
            ...blockPendingBranch(items, stored).filter(value => value.entry.id !== id).map(value => ({ action: "put" as const, key: "queue:" + value.entry.id, value })),
            { action: "delete", key: "queue:" + id },
          ]);
          setNotice(`${laundryRequestLabel(item.entry)} : ${review.kind === "completed" ? "demande déjà traitée, message retiré." : "demande en attente annulée."}`);
        }
      });
      await reload();
      setRecoveryId(null);
    });
    void sync();
  }
  async function inspectPendingEntry(id: string) {
    if (!navigator.onLine || !authenticatedRef.current)
      throw new Error("Connectez cet appareil pour vérifier l’enregistrement. La demande reste conservée.");
    const state = await readRecoveryState();
    const items = await reload();
    const item = items.find(value => value.entry.id === id);
    if (!item?.blocked) throw new Error("Cet envoi a changé sur cet appareil. Fermez cette fenêtre et vérifiez la liste.");
    return { item, items, review: await inspectEntryRecovery(item, state, items) };
  }
  function checkEntry(id: string) {
    return withEntryLock(async () => (await inspectPendingEntry(id)).review);
  }
  async function resolveEntry(id: string, shown: EntryRecoveryReview, action: EntryRecoveryAction) {
    await withEntryLock(async () => {
      const { item, review } = await inspectPendingEntry(id);
      if (recoveryStateIdentity(review) !== recoveryStateIdentity(shown))
        throw new Error("Le suivi a encore changé. Vérifiez à nouveau les informations avant de confirmer.");
      if (review.kind === "saved") {
        if (!review.receipt) throw new Error("Confirmation d’enregistrement incomplète.");
        await deviceStore("delete", "queue:" + id);
        onSaved(review.receipt);
        await reload(); setRecoveryId(null); setNotice("Enregistrement confirmé. La copie en attente a été retirée.");
        return;
      }
      if (action === "edit") {
        if (review.kind !== "missing" || item.entry.type !== "createRoomInspection") throw new Error("Ce contrôle ne peut pas être remplacé sans vérifier son enregistrement.");
        setRoomRecovery({ originalId: id, entry: { ...item.entry, id: createId() } });
        setRecoveryId(null); setPendingOpen(false);
        return;
      }
      await withEntryWriteLock(async () => {
        const items = await deviceStore<Pending[]>("all");
        const stored = items.find(value => value.entry.id === id);
        if (!stored?.blocked || JSON.stringify(stored.entry) !== JSON.stringify(item.entry))
          throw new Error("Cette demande a changé sur cet appareil. Vérifiez à nouveau la liste.");
        const lockedReview = await inspectEntryRecovery(stored, review.state, items);
        if (recoveryStateIdentity(lockedReview) !== recoveryStateIdentity(review))
          throw new Error("Une autre demande de ce suivi a changé. Vérifiez à nouveau la liste.");
        if (action === "replace") {
          const entry = buildRecoveredWorkEntry(review, items, { id: createId(), at: new Date().toISOString(), date: today() });
          await deviceStoreBatch([
            { action: "put", key: "queue:" + entry.id, value: { entry, protocol: 2, attempted: false, queuedAt: Date.now() } satisfies Pending },
            { action: "delete", key: "queue:" + id },
          ]);
          setNotice("Nouvelle modification conservée, en attente d’envoi.");
        } else if (action === "retry" && (review.kind === "partial" || review.kind === "missing" && stored.entry.type === "createFamilyEvent")) {
          await deviceStore("put", "queue:" + id, { ...stored, blocked: false, blockedReason: undefined, blockedBy: undefined, error: undefined });
        } else if (action === "dismiss" && review.kind !== "partial") {
          await deviceStoreBatch([
            ...blockPendingBranch(items, stored).filter(value => value.entry.id !== id).map(value => ({ action: "put" as const, key: "queue:" + value.entry.id, value })),
            { action: "delete", key: "queue:" + id },
            { action: "delete", key: "draft:room-recovery:" + id },
          ]);
          setNotice("Demande annulée sur cet appareil. Les enregistrements confirmés sont conservés.");
        } else throw new Error("Choisissez une action après avoir vérifié l’envoi.");
      });
      await reload(); setRecoveryId(null);
    });
    void sync();
  }
  async function replaceRoomRequest(id: string, input: RoomEntry) {
    const entry = entrySchema.parse(input);
    if (entry.type !== "createRoomInspection") throw new Error("Contrôle invalide.");
    await withEntryLock(async () => {
      const { item, review } = await inspectPendingEntry(id);
      if (review.kind !== "missing" || item.entry.type !== "createRoomInspection")
        throw new Error("L’enregistrement initial existe ou a changé. Fermez la correction et vérifiez son reçu avant de poursuivre.");
      if (entry.id === id || entry.room !== item.entry.room || (review.state.roomInspections || []).some(record => record.id === entry.id))
        throw new Error("Cette correction doit conserver la chambre et utiliser un nouvel identifiant.");
      const record = { ...entry, version: 1, updatedAt: new Date().toISOString(), submissionHash: "", photoId: null, photoIds: [] };
      const conflict = validateRoomIssuePlan(roomIssue(record), record, review.state.issues);
      if (conflict) throw new Error(conflict);
      await withEntryWriteLock(async () => {
        const items = await deviceStore<Pending[]>("all");
        const stored = items.find(value => value.entry.id === id);
        if (!stored?.blocked || JSON.stringify(stored.entry) !== JSON.stringify(item.entry))
          throw new Error("Cette demande a changé sur cet appareil. Vérifiez à nouveau son état.");
        await deviceStoreBatch([
          ...blockPendingBranch(items, stored).filter(value => value.entry.id !== id).map(value => ({ action: "put" as const, key: "queue:" + value.entry.id, value })),
          { action: "put", key: "queue:" + entry.id, value: { entry, protocol: 2, attempted: false, queuedAt: Date.now() } satisfies Pending },
          { action: "delete", key: "queue:" + id },
        ]);
      });
      await reload();
    });
    void sync();
  }
  const blocked = pending.filter(item => item.blocked);
  const laundryErrors = blocked.filter(isLaundryRequest);
  const selected = pending.find(item => item.entry.id === recoveryId && item.blocked);
  function reviewPending(id: string) { setRecoveryId(id); setPendingOpen(false); }
  const status = (pending.length || storageError) ? <Stack spacing={1} sx={{ mt: 1.5 }}>
    {pending.length > 0 && <Alert severity={blocked.length ? "warning" : "info"} sx={{ "& .MuiAlert-message": { width: "100%", minWidth: 0 } }}>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>{blocked.length ? `${blocked.length} envoi(s) à vérifier` : `${pending.length} envoi(s) en attente`}</Typography>
      <Typography variant="body2">{blocked.length ? "Vos demandes sont conservées. Vérifiez les informations pour les reprendre." : "L’envoi reprendra lorsque la connexion le permettra."}</Typography>
      <Button onClick={() => setPendingOpen(true)} sx={{ minHeight: 44 }}>Voir tous les envois ({pending.length})</Button>
      {laundryErrors.length > 0 && laundryErrors.length <= 2 && <Stack spacing={0.5}>{laundryErrors.map(item => <Stack key={item.entry.id} direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
        <Typography variant="caption">{laundryRequestLabel(item.entry)} · {laundryActionLabel(item.entry)}</Typography>
        <Button size="small" onClick={() => reviewPending(item.entry.id)} sx={{ minHeight: 44 }}>Vérifier et résoudre</Button>
      </Stack>)}</Stack>}
    </Alert>}
    {storageError && <Alert severity="error">{storageError}</Alert>}
  </Stack> : null;
  return <EntriesContext.Provider value={{ pending, ready, online, working, storageError, enqueue, retry, reviewLaundry: reviewPending, reviewPending, removeAbsence, status }}>
    {children}
    {selected && isLaundryRequest(selected) && <LaundryRecoveryDialog key={selected.entry.id} entry={selected.entry}
      onCheck={() => checkLaundry(selected.entry.id)} onResolve={(review, action) => resolveLaundry(selected.entry.id, review, action)} onClose={() => setRecoveryId(null)} />}
    {selected && !isLaundryRequest(selected) && <EntryRecoveryDialog key={selected.entry.id} item={selected} pending={pending}
      onCheck={() => checkEntry(selected.entry.id)} onResolve={(review, action) => resolveEntry(selected.entry.id, review, action)} onClose={() => setRecoveryId(null)} />}
    {roomRecovery && <RoomInspectionDialog key={roomRecovery.originalId} room={roomRecovery.entry.room} onClose={() => setRoomRecovery(null)} onDefer={() => setRoomRecovery(null)}
      recovery={{ ...roomRecovery, onSubmit: entry => replaceRoomRequest(roomRecovery.originalId, entry) }}
      onSaved={() => { setRoomRecovery(null); setNotice("Correction du contrôle conservée, en attente d’envoi."); }} />}
    <Dialog open={pendingOpen} onClose={() => setPendingOpen(false)} fullWidth maxWidth="sm" aria-labelledby="pending-entries-title">
      <DialogTitle id="pending-entries-title">Envois de cet appareil · {pending.length}</DialogTitle>
      <DialogContent dividers><Stack spacing={2}>
        {!pending.length && <Typography>Tous les envois ont été confirmés.</Typography>}
        {pending.map(item => <Stack key={item.entry.id} spacing={0.75} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2, overflowWrap: "anywhere" }}>
          <Typography variant="subtitle2">{pendingEntryLabel(item.entry)}</Typography>
          <Typography variant="body2" color={item.blocked ? "warning.main" : "text.secondary"}>{item.blocked ? "Envoi à vérifier" : "En attente de confirmation"}</Typography>
          {item.error && <Typography variant="body2">{item.error}</Typography>}
          {item.blocked && <Button variant="outlined" onClick={() => reviewPending(item.entry.id)} sx={{ minHeight: 44, alignSelf: "flex-start" }}>Vérifier et résoudre</Button>}
        </Stack>)}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setPendingOpen(false)} sx={{ minHeight: 48 }}>Fermer</Button></DialogActions>
    </Dialog>
    <Snackbar open={!!notice} autoHideDuration={6500} onClose={() => setNotice("")}>
      <Alert severity="info" onClose={() => setNotice("")} sx={{ width: "100%" }}>{notice}</Alert>
    </Snackbar>
  </EntriesContext.Provider>;
}

export function SyncStatus() { return useEntries().status; }
