"use client";

import { useId, useRef, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { createId, today } from "@/lib/domain";
import { deviceStore } from "@/lib/deviceStore";
import type { PendingEntry } from "@/lib/entryQueue";
import { roomObservations } from "@/lib/roomObservations";
import { sameRoomVacancyDraftAnswers } from "@/lib/roomVacancyDraft";
import { workEntrySchema, type WorkEntry } from "@/lib/rooms";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailability } from "@/lib/work";

type Draft = WorkEntry & { kind: "roomAvailability"; free: true; vacancyReason: "available" | "works"; expectedPreviousEventId: string | null };

export function RoomVacancyDialog({ room, onClose }: { room: string; onClose: () => void }) {
  const { readRecoveryState } = useAppContext();
  const { pending, ready, reviewPending } = useEntries();
  const { actor, events, enqueue } = useWorkEvents();
  const { latest } = useRoomObservations();
  const current = roomAvailability(room, events, latest.get(room));
  const blocked = pending.find(item => item.blocked && item.entry.type === "createWorkEvent" && item.entry.kind === "roomAvailability" && item.entry.targetId === room);
  const freshDraft = (): Draft => ({
    type: "createWorkEvent", kind: "roomAvailability", id: createId(), targetId: room, room,
    expectedRevision: current.revision, expectedPreviousEventId: current.source?.id || null,
    date: today(), occurredAt: new Date().toISOString(), actor, free: true,
    vacancyReason: current.vacancyReason || "available", notes: current.free ? current.source?.notes || "" : "",
  });
  // A local draft survives a list filter removing the card after a colleague's
  // update. Cancel explicitly discards it; a saved queue entry remains immutable.
  const draft = useDeviceDraft<Draft>("draft:room-availability:" + room, freshDraft,
    value => {
      const previous = events.find(event => event.id === value.id);
      return previous && sameRoomVacancyDraftAnswers(value, previous) ? freshDraft() : value;
    });
  const value = draft.value;
  const previousSubmission = value ? events.find(event => event.id === value.id) : undefined;
  const stale = !!value && !events.some(event => event.id === value.id) &&
    (value.expectedRevision !== current.revision || value.expectedPreviousEventId !== (current.source?.id || null));
  const currentLabel = current.free === undefined ? "Occupation non renseignée" : current.free ? current.vacancyReason === "works" ? "En travaux" : "Libre" : "Occupée";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submissionConflict, setSubmissionConflict] = useState(false);
  const needsReview = submissionConflict || !!(value && previousSubmission && !sameRoomVacancyDraftAnswers(value, previousSubmission));
  const saving = useRef(false);
  const titleId = useId();

  function update(patch: Partial<Draft>) {
    if (value) draft.update({ ...value, ...patch });
  }

  async function reloadCurrent() {
    if (!value || saving.current || blocked) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (await deviceStore<PendingEntry | undefined>("get", "queue:" + value.id))
        throw new Error("La demande précédente est encore dans les envois en attente. Attendez sa confirmation ou vérifiez cet envoi, puis rechargez la situation actuelle. Votre saisie est conservée.");
      const state = await readRecoveryState();
      const queued = await deviceStore<PendingEntry[]>("all");
      if (queued.some(item => item.entry.id === value.id))
        throw new Error("La demande précédente attend encore sa confirmation. Vérifiez les envois en attente, puis rechargez la situation actuelle. Votre saisie est conservée.");
      if (queued.some(item => item.blocked && item.entry.type === "createWorkEvent" && item.entry.kind === "roomAvailability" && item.entry.targetId === room))
        throw new Error("Une modification de cette chambre doit être vérifiée dans les envois en attente.");
      const currentEvents = [...(state.workEvents || []), ...queued.filter(item => !item.blocked && item.entry.type === "createWorkEvent").map(item => item.entry as WorkEntry)];
      const observations = roomObservations(state.roomInspections || [], queued, today());
      const latestState = roomAvailability(room, currentEvents, observations.latest.get(room));
      draft.update({ ...value, id: createId(), expectedRevision: latestState.revision,
        expectedPreviousEventId: latestState.source?.id || null, date: today(), occurredAt: new Date().toISOString() });
      setSubmissionConflict(false);
      setNotice("Situation actuelle rechargée. Votre choix et votre observation sont conservés. Vérifiez-les avant d’enregistrer.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de recharger la situation. Votre saisie est conservée.");
    } finally { saving.current = false; setBusy(false); }
  }

  async function cancel() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { await draft.clear(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de fermer le brouillon."); }
    finally { saving.current = false; setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || saving.current || !ready || blocked) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const queued = await deviceStore<PendingEntry | undefined>("get", "queue:" + value.id);
      const previous = queued?.entry.type === "createWorkEvent" ? queued.entry : events.find(item => item.id === value.id);
      if (previous && !sameRoomVacancyDraftAnswers(value, previous)) {
        setSubmissionConflict(true);
        throw new Error("La demande précédente contient un autre choix ou une autre observation. Votre nouvelle saisie est conservée. Vérifiez sa confirmation, puis rechargez la situation actuelle avant de préparer une nouvelle modification.");
      }
      if (!previous && stale) throw new Error("La situation de cette chambre a changé. Rechargez la situation actuelle avant d’enregistrer.");
      const parsed = workEntrySchema.safeParse(previous || { ...value, actor, occurredAt: new Date().toISOString() });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Vérifiez la situation de la chambre.");
      draft.update({ ...value, actor: parsed.data.actor, occurredAt: parsed.data.occurredAt });
      await enqueue(parsed.data);
      try { await draft.clear(); } catch { /* The exact saved operation remains in the queue. */ }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible. Votre saisie est conservée.");
    } finally { saving.current = false; setBusy(false); }
  }

  return <Dialog open fullWidth maxWidth="xs" onClose={busy ? undefined : needsReview ? onClose : () => void cancel()} aria-labelledby={titleId}
    slotProps={{ paper: { sx: { m: 2, width: "calc(100% - 32px)", maxHeight: "calc(100% - 32px)" } } }}>
    <Box component="form" onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DialogTitle id={titleId}>Disponibilité · chambre {room}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {draft.error && <Alert severity="error">{draft.error}</Alert>}
          {blocked && <Alert severity="warning">Une modification de cette chambre attend votre vérification.
            <Button color="inherit" onClick={() => { onClose(); reviewPending(blocked.entry.id); }}>Vérifier la modification</Button>
          </Alert>}
          {(stale || needsReview) && !blocked && <Alert severity="warning">{needsReview
            ? "Cette demande a déjà été envoyée avec des informations différentes. Votre nouvelle saisie est conservée. Rechargez la situation actuelle pour préparer une nouvelle modification après confirmation de l’envoi précédent."
            : "La situation de cette chambre a changé. Votre saisie est conservée."}
            <Button color="inherit" disabled={busy} onClick={() => void reloadCurrent()} sx={{ display: "flex", mt: 1 }}>Recharger la situation actuelle</Button>
          </Alert>}
          {!stale && !needsReview && notice && <Alert severity="info">{notice}</Alert>}
          {(stale || needsReview || !!notice) && <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>Situation actuelle : {currentLabel}</Typography>
            {current.source?.notes && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{current.source.notes}</Typography>}
          </Box>}
          {!value ? <Typography>Chargement…</Typography> : <Box component="fieldset" disabled={busy || !!blocked} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">La chambre n’est pas occupée. Choisissez sa situation :</Typography>
              <RadioGroup row aria-label="Situation de la chambre" value={value.vacancyReason} onChange={event => update({ vacancyReason: event.target.value as Draft["vacancyReason"] })} sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
                {(["available", "works"] as const).map(reason => <FormControlLabel key={reason} value={reason}
                  control={<Radio color={reason === "works" ? "warning" : "success"} />} label={reason === "works" ? "En travaux" : "Libre"}
                  sx={{ m: 0, minHeight: 52, border: "1px solid", borderColor: value.vacancyReason === reason ? reason === "works" ? "warning.main" : "success.main" : "divider", borderRadius: 1, pr: 1, "& .MuiFormControlLabel-label": { fontWeight: 700, fontSize: 14 } }} />)}
              </RadioGroup>
              <Typography variant="body2" color="text.secondary">{value.vacancyReason === "works" ? "Indisponible pour une nouvelle occupation tant que les travaux ne sont pas terminés." : "Disponible pour une nouvelle occupation."}</Typography>
              <TextField label="Observation (facultative)" multiline minRows={3} maxRows={6} value={value.notes}
                onChange={event => update({ notes: event.target.value })} placeholder="Ex. : peinture en cours, attente d’un équipement…"
                slotProps={{ htmlInput: { maxLength: 4000 } }} />
              <Typography variant="caption" color="text.secondary">Ces deux situations retirent la chambre de la tournée des chambres occupées.</Typography>
            </Stack>
          </Box>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button disabled={busy} onClick={needsReview ? onClose : () => void cancel()}>{needsReview ? "Fermer sans effacer" : "Annuler"}</Button>
        <Button variant="contained" type="submit" disabled={busy || !value || !ready || stale || needsReview || !!blocked} sx={{ minHeight: 48 }}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
