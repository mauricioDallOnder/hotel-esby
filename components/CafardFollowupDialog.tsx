"use client";

import { useRef, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { cafardCases, cafardStatusLabels, cafardTreatmentReminder, type CafardCase, type CafardStatus } from "@/lib/cafards";
import { cafardSeedsFromIssues } from "@/lib/cafardsLegacy";
import { useAppContext } from "@/context/AppContext";
import { deviceStore } from "@/lib/deviceStore";
import { createId, displayDate, today } from "@/lib/domain";
import type { PendingEntry } from "@/lib/entryQueue";
import { workEntrySchema, type WorkEntry } from "@/lib/rooms";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { validateWorkEntry } from "@/lib/work";

type Draft = WorkEntry & { kind: "cafardFollowup"; cafardStatus: CafardStatus; detectedOn: string | null; treatedOn: string | null; resolvedOn: string | null; product: string };
const statusColors = { a_verifier: "warning", signale: "error", traite: "primary", resolu: "success" } as const;

export function CafardFollowupDialog({ record, onClose, onSaved }: { record: CafardCase; onClose: () => void; onSaved: (status: CafardStatus) => void }) {
  const { actor, enqueue, events } = useWorkEvents();
  const { history } = useRoomObservations();
  const { issues } = useAppContext();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const freshDraft = (): Draft => ({
    type: "createWorkEvent", id: createId(), kind: "cafardFollowup", targetId: record.room, room: record.room,
    expectedRevision: record.revision, expectedPreviousEventId: record.revision ? record.lastEventId : null,
    date: today(), occurredAt: new Date().toISOString(), actor,
    cafardStatus: record.status, detectedOn: record.detectedOn, treatedOn: record.treatedOn,
    resolvedOn: record.resolvedOn, product: record.product, notes: "",
    cafardObservationId: record.observationId ?? null,
  });
  const draft = useDeviceDraft<Draft>("draft:cafard-room:" + record.room, freshDraft,
    value => events.some(event => event.id === value.id) ? freshDraft() : value,
    ["draft:cafard:" + record.room + ":" + record.revision]);
  const value = draft.value;
  const stale = !!value && !events.some(event => event.id === value.id) &&
    (value.cafardObservationId === undefined || value.expectedPreviousEventId === undefined || !!validateWorkEntry(value, events, [], [], history));
  const reminder = value ? cafardTreatmentReminder({ status: value.cafardStatus, treatedOn: value.treatedOn }) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [validationAttempted, setValidationAttempted] = useState(false);
  const saving = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const validation = validationAttempted && value ? workEntrySchema.safeParse(value) : undefined;
  const problems = validation && !validation.success ? validation.error.issues : [];
  const fieldError = (field: string) => problems.find(problem => problem.path[0] === field)?.message;
  function update(patch: Partial<Draft>) { if (value) draft.update({ ...value, ...patch }); }
  function useCurrentFollowup() {
    if (!value || busy) return;
    const current = cafardCases(history, events, cafardSeedsFromIssues(issues)).find(item => item.room === record.room) || record;
    draft.update({ ...value, id: createId(), expectedRevision: current.revision, expectedPreviousEventId: current.revision ? current.lastEventId : null,
      cafardObservationId: current.observationId ?? null,
      date: today(), occurredAt: new Date().toISOString(), cafardStatus: current.status,
      detectedOn: current.detectedOn, treatedOn: current.treatedOn, resolvedOn: current.resolvedOn, product: current.product });
    setError("");
    setValidationAttempted(false);
  }
  function changeStatus(status: CafardStatus) {
    if (!value || value.cafardStatus === status) return;
    const patch: Partial<Draft> = { cafardStatus: status, resolvedOn: status === "resolu" ? value.date : null };
    if (status === "traite") patch.treatedOn = value.date;
    update(patch);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || saving.current) return;
    setError("");
    saving.current = true;
    setBusy(true);
    try {
      // A failed local refresh may leave an accepted entry in the queue. Reuse
      // its original envelope so retrying never changes the submission hash.
      const queued = await deviceStore<PendingEntry | undefined>("get", "queue:" + value.id);
      const previous = queued?.entry.type === "createWorkEvent" ? queued.entry : events.find(event => event.id === value.id);
      if (!previous && stale) throw new Error("Ce suivi a changé depuis l’ouverture. Fermez cette fiche puis rouvrez le suivi existant pour utiliser les dernières informations.");
      const parsed = workEntrySchema.safeParse({ ...value,
        ...(previous ? { cafardObservationId: previous.cafardObservationId } : {}),
        actor: previous?.actor || actor, occurredAt: previous?.occurredAt || new Date().toISOString() });
      if (!parsed.success) {
        setValidationAttempted(true);
        content.current?.scrollTo({ top: 0 });
        return;
      }
      draft.update({ ...value, actor: parsed.data.actor, occurredAt: parsed.data.occurredAt });
      await enqueue(parsed.data);
      // The entry is durable now. An accepted ID in a leftover draft is replaced
      // by a fresh draft on reopening, even if local cleanup failed.
      try { await draft.clear(); } catch { /* The queued entry remains available. */ }
      onSaved(value.cafardStatus);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Enregistrement impossible. Votre saisie est conservée.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="cafard-followup-title">
    <Box component="form" onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: mobile ? "100%" : undefined }}>
      <DialogTitle id="cafard-followup-title">Cafards · chambre {record.room}</DialogTitle>
      <DialogContent ref={content} dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          {draft.error && <Alert severity="error">{draft.error}</Alert>}
          {stale && <Alert severity="warning">
            Ce brouillon utilise une ancienne version du suivi. Rechargez l’état et les dates actuels avant de continuer. Vos observations seront conservées.
            <Button color="inherit" disabled={busy} onClick={useCurrentFollowup} sx={{ display: "flex", mt: 1 }}>Recharger le suivi en conservant mes observations</Button>
          </Alert>}
          {!!problems.length && <Alert severity="error">Vérifiez les champs indiqués avant d’enregistrer.</Alert>}
          {!value ? <Typography>Chargement du brouillon…</Typography> : <Box component="fieldset" disabled={busy} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Stack spacing={2.5}>
              <Box role="radiogroup" aria-label="État du suivi" aria-invalid={!!fieldError("cafardStatus") || undefined}>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>État du suivi</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
                  {(Object.keys(cafardStatusLabels) as CafardStatus[]).map(status => <Button key={status} role="radio" aria-checked={value.cafardStatus === status}
                    color={statusColors[status]} variant={value.cafardStatus === status ? "contained" : "outlined"} onClick={() => changeStatus(status)}
                    sx={{ minHeight: 48, px: 1, lineHeight: 1.3 }}>
                    {cafardStatusLabels[status]}
                  </Button>)}
                </Box>
                {value.cafardStatus === "traite" && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Un rappel apparaîtra dans l’application 7 jours après l’application du produit.</Typography>}
              </Box>
              <TextField required type="date" label="Date de la mise à jour" value={value.date} onChange={event => update({ date: event.target.value })}
                error={!!fieldError("date")} helperText={fieldError("date") || "Jour de la vérification ou de l’intervention."}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />
              <TextField type="date" label="Date de détection" value={value.detectedOn || ""} onChange={event => update({ detectedOn: event.target.value || null })}
                error={!!fieldError("detectedOn")} helperText={fieldError("detectedOn") || "Laissez vide si la date n’est pas connue."}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: value.date || today() } }} />
              <TextField type="date" label="Date d’application du produit" required={value.cafardStatus === "traite"} value={value.treatedOn || ""} onChange={event => update({ treatedOn: event.target.value || null })}
                error={!!fieldError("treatedOn")} helperText={fieldError("treatedOn") || (reminder
                  ? `Vérification prévue le ${displayDate(reminder.dueOn)}. Pour une nouvelle application, modifiez la date.`
                  : "Pour une nouvelle application, indiquez sa date.")}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: value.detectedOn || undefined, max: value.date || today() } }} />
              <TextField label="Produit utilisé (facultatif)" value={value.product} onChange={event => update({ product: event.target.value })}
                error={!!fieldError("product")} helperText={fieldError("product")} slotProps={{ htmlInput: { maxLength: 200 } }} />
              {value.cafardStatus === "resolu" && <TextField required type="date" label="Date de résolution" value={value.resolvedOn || ""} onChange={event => update({ resolvedOn: event.target.value || null })}
                error={!!fieldError("resolvedOn")} helperText={fieldError("resolvedOn") || "Date de la vérification confirmant l’absence de cafards."}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: value.treatedOn || value.detectedOn || undefined, max: value.date || today() } }} />}
              <TextField label="Observations" multiline minRows={3} value={value.notes} onChange={event => update({ notes: event.target.value })}
                error={!!fieldError("notes")} helperText={fieldError("notes") || "Facultatif : endroit vérifié, résultat, détails de l’application…"}
                slotProps={{ htmlInput: { maxLength: 4000 } }} />
              <Typography variant="caption" color="text.secondary">
                {draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil."} Enregistré avec le profil {actor}. Les mises à jour restent dans l’historique.
              </Typography>
            </Stack>
          </Box>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button disabled={busy} onClick={onClose}>Fermer</Button>
        <Button variant="contained" type="submit" disabled={busy || !value || stale} sx={{ minHeight: 48 }}>{busy ? "Enregistrement…" : "Enregistrer le suivi"}</Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
