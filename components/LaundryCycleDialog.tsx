"use client";

import { useRef, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { RoomSelect } from "@/components/RoomSelect";
import { deviceStore } from "@/lib/deviceStore";
import { createId, today } from "@/lib/domain";
import type { PendingEntry } from "@/lib/entryQueue";
import { laundryMachines, type LaundryCycle } from "@/lib/laundry";
import { workEntrySchema, type WorkEntry } from "@/lib/rooms";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useWorkEvents } from "@/lib/useWorkEvents";

export type LaundryAction = "start" | "collect" | "cancel";
type Machine = typeof laundryMachines[number];
type Draft = { eventId: string; cycleId: string; room: string; owner: string; actor: string; notes: string };
const titles = { start: "Démarrer", collect: "Récupérer le linge", cancel: "Annuler le cycle" };
const labels = { start: "Démarrer", collect: "Confirmer la récupération", cancel: "Confirmer l’annulation" };

function rememberedActor() {
  try { return localStorage.getItem("laundry-actor") || localStorage.getItem("room-inspector") || ""; }
  catch { return ""; }
}

export function LaundryCycleDialog({ action, machine, cycle, revision, unchanged, onClose, onSaved }: {
  action: LaundryAction;
  machine: Machine;
  cycle?: LaundryCycle;
  revision: number;
  unchanged: boolean;
  onClose: () => void;
  onSaved: (room: string) => void;
}) {
  const { enqueue, events } = useWorkEvents();
  const mobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  const saving = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  function initial(previous?: Draft): Draft {
    return { eventId: createId(), cycleId: cycle?.cycleId || createId(), room: cycle?.room || previous?.room || "",
      owner: cycle?.owner || previous?.owner || "", actor: previous?.actor || rememberedActor(), notes: cycle?.notes || previous?.notes || "" };
  }
  const draft = useDeviceDraft<Draft>(`draft:laundry:${machine.id}:${action}:${cycle?.cycleId || "new"}`, initial,
    value => events.some(event => event.id === value.eventId) ? initial(value) : value);
  const value = draft.value;
  function update(patch: Partial<Draft>) {
    if (value) draft.update({ ...value, ...patch });
    setInvalid([]);
  }
  function candidate(current: Draft): WorkEntry {
    const at = new Date().toISOString();
    return {
      type: "createWorkEvent", kind: "laundryCycle", id: current.eventId, targetId: machine.id,
      expectedRevision: revision, room: current.room, date: today(), actor: current.actor, notes: current.notes,
      occurredAt: at, laundryCycleId: current.cycleId, laundryOwner: current.owner,
      laundryStartedAt: cycle?.startedAt || at,
      laundryStatus: action === "start" ? "en_cours" : action === "collect" ? "recupere" : "annule",
      laundryCollectedAt: action === "collect" ? at : null,
      laundryCollectedBy: action === "collect" ? current.actor : "",
    };
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || saving.current || !unchanged) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const queued = await deviceStore<PendingEntry | undefined>("get", "queue:" + value.eventId);
      const previous = queued?.entry.type === "createWorkEvent" ? queued.entry : events.find(item => item.id === value.eventId);
      if (queued?.blocked) {
        setError("Cet envoi nécessite votre attention. Fermez cette fenêtre et consultez le message de synchronisation avant de recommencer.");
        return;
      }
      if (previous && (previous.room !== value.room || previous.laundryOwner !== value.owner.trim() || previous.actor !== value.actor.trim() || previous.notes !== value.notes.trim())) {
        setError("Cette action a déjà été conservée. Fermez cette fenêtre pour retrouver son résultat ; les nouvelles informations n’ont pas été envoyées.");
        return;
      }
      // A retry reuses the exact durable payload, including the original clock.
      const parsed = workEntrySchema.safeParse(previous || candidate(value));
      if (!parsed.success) {
        setInvalid(parsed.error.issues.map(problem => String(problem.path[0])));
        setError([...new Set(parsed.error.issues.map(problem => problem.message))].join(" "));
        content.current?.scrollTo({ top: 0 });
        return;
      }
      await enqueue(parsed.data);
      try { localStorage.setItem("laundry-actor", parsed.data.actor); } catch { /* Optional convenience. */ }
      try { await draft.clear(); } catch { /* The complete event is already durable. */ }
      onSaved(parsed.data.room);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enregistrement impossible. Votre saisie est conservée.");
      content.current?.scrollTo({ top: 0 });
    } finally { saving.current = false; setBusy(false); }
  }
  return <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="laundry-action-title">
    <Box component="form" noValidate onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: mobile ? "100%" : undefined }}>
      <DialogTitle id="laundry-action-title">{titles[action]} · {machine.label}</DialogTitle>
      <DialogContent ref={content} dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          {draft.error && <Alert severity="error">{draft.error}</Alert>}
          {!unchanged && <Alert severity="warning">Cette machine a été mise à jour. Fermez cette fenêtre puis consultez son état avant de continuer. Votre saisie reste conservée.</Alert>}
          {!value ? <Typography role="status">Chargement du brouillon…</Typography> : <Box component="fieldset" disabled={busy || !unchanged} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Stack spacing={2.5}>
              {action === "start" ? <>
                <Box sx={{ bgcolor: "action.hover", borderRadius: 2, p: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>{machine.program}{machine.kind === "washer" ? ` · ${machine.durationMinutes} min` : ""}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Lancez ce programme sur la machine, puis appuyez sur « Démarrer » ici pour suivre le temps.</Typography>
                </Box>
                <Box>
                  <RoomSelect value={value.room} onChange={room => update({ room })} />
                  {invalid.includes("room") && <Typography role="alert" variant="caption" color="error">Choisissez la chambre du linge.</Typography>}
                </Box>
                <TextField label="Nom ou repère du linge (facultatif)" value={value.owner} onChange={event => update({ owner: event.target.value })}
                  helperText="Un prénom ou un repère pour distinguer plusieurs personnes de la même chambre." slotProps={{ htmlInput: { maxLength: 200 } }} />
              </> : <>
                <Box sx={{ bgcolor: "action.hover", borderRadius: 2, p: 2 }}>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>Chambre {value.room}</Typography>
                  {value.owner && <Typography sx={{ mt: 0.5, overflowWrap: "anywhere" }}>{value.owner}</Typography>}
                </Box>
                {action === "collect" ? <Typography>Confirmez après avoir retiré tout le linge de la machine. La date et l’heure de récupération seront enregistrées et la machine sera libérée.</Typography> :
                  <Alert severity="warning">Cette annulation libère la machine dans l’application. Vérifiez qu’elle est arrêtée et vide avant de confirmer. Le cycle restera dans l’historique.</Alert>}
              </>}
              <TextField required label="Votre nom" value={value.actor} onChange={event => update({ actor: event.target.value })} error={invalid.includes("actor") || invalid.includes("laundryCollectedBy")}
                helperText="Mémorisé sur cet appareil. Vérifiez le nom avant d’enregistrer." slotProps={{ htmlInput: { maxLength: 200, autoComplete: "name" } }} />
              <Button onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes} sx={{ alignSelf: "flex-start", px: 0, minHeight: 44 }}>{showNotes ? "Masquer la note" : value.notes ? "Voir la note" : "Ajouter une note (facultatif)"}</Button>
              {showNotes && <TextField label="Note" multiline minRows={2} value={value.notes} onChange={event => update({ notes: event.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />}
            </Stack>
          </Box>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 48 }}>Fermer</Button>
        <Button type="submit" variant="contained" color={action === "cancel" ? "error" : "primary"} disabled={busy || !value || !unchanged} sx={{ minHeight: 48 }}>
          {busy ? "Enregistrement…" : labels[action]}
        </Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
