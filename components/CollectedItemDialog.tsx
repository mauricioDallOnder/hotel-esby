"use client";

import { useRef, useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { RoomSelect } from "@/components/RoomSelect";
import type { CollectedItemRecord } from "@/lib/collectedItems";
import { deviceStore } from "@/lib/deviceStore";
import { createId, displayDate, today } from "@/lib/domain";
import type { PendingEntry } from "@/lib/entryQueue";
import { workEntrySchema, type WorkEntry } from "@/lib/rooms";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useWorkEvents } from "@/lib/useWorkEvents";

export type CollectedItemAction = "create" | "edit" | "return" | "restore";
type Draft = WorkEntry & {
  kind: "collectedItem";
  itemName: string;
  collectedOn: string;
  collectedBy: string;
  returnedOn: string | null;
  returnedBy: string;
};
type Saved = { room: string; itemName: string; returned: boolean };
const titles = { create: "Ajouter un objet", edit: "Corriger la fiche", return: "Restituer l’objet", restore: "Annuler la restitution" };
const submitLabels = { create: "Enregistrer l’objet", edit: "Enregistrer la correction", return: "Confirmer la restitution", restore: "Confirmer l’annulation" };
const suggestions = ["Plaque de cuisson", "Multiprise", "Appareil > 100 W"];

// Compare the editable content, ignoring the submission envelope. A retry must
// never report that changed input was saved when this UUID is already durable.
function sameDetails(draft: Draft, previous: WorkEntry) {
  return draft.targetId === previous.targetId && draft.expectedRevision === previous.expectedRevision &&
    draft.room === previous.room && draft.itemName.trim() === previous.itemName &&
    draft.collectedOn === previous.collectedOn && draft.collectedBy.trim() === previous.collectedBy &&
    draft.notes.trim() === previous.notes && draft.returnedOn === previous.returnedOn &&
    draft.returnedBy.trim() === previous.returnedBy;
}

export function CollectedItemDialog({ action, record, onClose, onSaved }: {
  action: CollectedItemAction;
  record?: CollectedItemRecord;
  onClose: () => void;
  onSaved: (saved: Saved) => void;
}) {
  const { actor: profile, enqueue, events } = useWorkEvents();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  function initial(): Draft {
    return {
      type: "createWorkEvent", kind: "collectedItem", id: createId(), targetId: record?.id || createId(),
      expectedRevision: record?.revision || 0, room: record?.room || "", date: today(), occurredAt: new Date().toISOString(),
      actor: action === "edit" ? profile : "", itemName: record?.itemName || "",
      collectedOn: record?.collectedOn || today(), collectedBy: record?.collectedBy || "", notes: record?.reason || "",
      returnedOn: action === "return" ? today() : action === "restore" ? null : record?.returnedOn || null,
      returnedBy: action === "return" || action === "restore" ? "" : record?.returnedBy || "",
    };
  }
  const draft = useDeviceDraft<Draft>("draft:collected-item:" + (record ? record.id + ":" + record.revision : "new") + ":" + action,
    initial,
    // Cleanup may fail after an accepted save. Opening “Ajouter” still starts a
    // new physical object instead of recycling the previous object's identity.
    value => {
      const previous = events.find(event => event.id === value.id);
      return action === "create" && previous && sameDetails(value, previous) ? initial() : value;
    });
  const value = draft.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alreadySaved, setAlreadySaved] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const saving = useRef(false);
  const attemptedHere = useRef(new Set<string>());
  const content = useRef<HTMLDivElement>(null);
  const collectionFields = action === "create" || action === "edit";
  const returnFields = action === "return" || (action === "edit" && !!record?.returnedOn);
  function candidate(current: Draft): Draft {
    return { ...current, date: today(), occurredAt: new Date().toISOString(),
      actor: action === "create" ? current.collectedBy : action === "return" ? current.returnedBy : action === "edit" ? profile : current.actor };
  }
  const validation = validationAttempted && value ? workEntrySchema.safeParse(candidate(value)) : undefined;
  const problems = [
    ...(validation && !validation.success ? validation.error.issues.filter(problem =>
      !(returnFields && !value?.returnedOn && value?.returnedBy.trim() && problem.path[0] === "returnedBy")) : []),
    ...(validationAttempted && returnFields && !value?.returnedOn ? [{ path: ["returnedOn"], message: "Renseignez la date de restitution." }] : []),
    ...(validationAttempted && returnFields && !value?.returnedBy.trim() ? [{ path: ["returnedBy"], message: "Indiquez qui a restitué l’objet." }] : []),
  ];
  const fieldError = (field: string) => problems.find(problem => problem.path[0] === field)?.message;
  const unchanged = action === "edit" && value && record && value.room === record.room && value.itemName.trim() === record.itemName &&
    value.collectedOn === record.collectedOn && value.collectedBy.trim() === record.collectedBy && value.notes.trim() === record.reason &&
    value.returnedOn === record.returnedOn && value.returnedBy.trim() === record.returnedBy;
  function update(patch: Partial<Draft>) { if (value) draft.update({ ...value, ...patch }); }
  function startAnother() {
    const next = initial();
    // The user explicitly chose another physical object. Keep their entered
    // details while allocating both a new object ID and a new event ID.
    if (value) Object.assign(next, { room: value.room, itemName: value.itemName, collectedOn: value.collectedOn, collectedBy: value.collectedBy, notes: value.notes });
    draft.update(next);
    setAlreadySaved(false);
    setError("");
    setValidationAttempted(false);
    content.current?.scrollTo({ top: 0 });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || saving.current) return;
    setError("");
    saving.current = true;
    setBusy(true);
    try {
      const queued = await deviceStore<PendingEntry | undefined>("get", "queue:" + value.id);
      const previous = queued?.entry.type === "createWorkEvent" ? queued.entry : events.find(event => event.id === value.id);
      if (queued?.blocked) {
        setError("Cet envoi n’a pas été accepté. Fermez cette fenêtre et consultez le message d’envoi en haut de la page avant de reprendre la fiche.");
        content.current?.scrollTo({ top: 0 });
        return;
      }
      if (previous && ((action === "create" && !attemptedHere.current.has(value.id)) || !sameDetails(value, previous) || (action === "restore" && value.actor.trim() !== previous.actor))) {
        setAlreadySaved(true);
        setError("Cette fiche a déjà été enregistrée. Fermez-la et retrouvez l’objet dans la liste pour le corriger. Votre nouvelle saisie n’a pas été envoyée." +
          (action === "create" ? " Pour un autre objet, choisissez « Ajouter un autre objet » : les champs saisis seront conservés." : ""));
        content.current?.scrollTo({ top: 0 });
        return;
      }
      // Keep the FULL accepted payload on retries: changing a date, timestamp or
      // normalized field would change its hash after a durable offline save.
      const parsed = workEntrySchema.safeParse(previous || candidate(value));
      if (!parsed.success || (returnFields && (!parsed.data.returnedOn || !parsed.data.returnedBy))) {
        setValidationAttempted(true);
        content.current?.scrollTo({ top: 0 });
        return;
      }
      draft.update(parsed.data as Draft);
      attemptedHere.current.add(parsed.data.id);
      await enqueue(parsed.data);
      try { await draft.clear(); } catch { /* The complete event is already durable. */ }
      onSaved({ room: parsed.data.room, itemName: parsed.data.itemName!, returned: !!parsed.data.returnedOn });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enregistrement impossible. Votre saisie est conservée.");
      content.current?.scrollTo({ top: 0 });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="collected-item-title">
    <Box component="form" noValidate onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: mobile ? "100%" : undefined }}>
      <DialogTitle id="collected-item-title">{titles[action]}</DialogTitle>
      <DialogContent ref={content} dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}
            {alreadySaved && action === "create" && <Button onClick={startAnother} disabled={busy} sx={{ display: "block", mt: 1 }}>Ajouter un autre objet</Button>}
          </Alert>}
          {draft.error && <Alert severity="error">{draft.error}</Alert>}
          {!!problems.length && <Alert severity="error">Vérifiez les champs indiqués avant d’enregistrer.</Alert>}
          {!value ? <Typography role="status">Chargement du brouillon…</Typography> : <Box component="fieldset" disabled={busy} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Stack spacing={2.5}>
              {!collectionFields && <Paper variant="outlined" sx={{ p: 2 }}>
                <Chip size="small" label={"Chambre " + value.room} sx={{ mb: 1 }} />
                <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>{value.itemName}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>Récupéré le {displayDate(value.collectedOn)} par {value.collectedBy}.</Typography>
              </Paper>}
              {action === "return" && <Typography variant="body2">Confirmez seulement après avoir remis cet objet au résident.</Typography>}
              {action === "restore" && <Alert severity="info">
                À utiliser si la restitution a été saisie par erreur et que l’objet est toujours dans l’armoire.
                {record?.returnedOn && <> La restitution du {displayDate(record.returnedOn)} par {record.returnedBy} restera dans l’historique.</>}
              </Alert>}
              {collectionFields && <>
                <Box>
                  <RoomSelect value={value.room} onChange={room => update({ room })} />
                  {fieldError("room") && <Typography role="alert" variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>{fieldError("room")}</Typography>}
                </Box>
                <Stack spacing={1}>
                  <TextField required label="Objet" name="itemName" value={value.itemName} onChange={event => update({ itemName: event.target.value })}
                    placeholder="Multiprise blanche, 3 prises" error={!!fieldError("itemName")}
                    helperText={fieldError("itemName") || "Un objet par fiche. Ajoutez une précision pour le reconnaître."} slotProps={{ htmlInput: { maxLength: 200 } }} />
                  {action === "create" && <Box role="group" aria-label="Objets fréquents" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {suggestions.map(name => <Button key={name} size="small" variant="outlined" onClick={() => update({ itemName: name })} sx={{ minHeight: 44 }}>{name}</Button>)}
                  </Box>}
                </Stack>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) minmax(0, 1.2fr)" }, gap: 2.5 }}>
                  <TextField required type="date" label="Date de récupération" value={value.collectedOn} onChange={event => update({ collectedOn: event.target.value })}
                    error={!!fieldError("collectedOn")} helperText={fieldError("collectedOn")}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: value.returnedOn || today() } }} />
                  <TextField required label="Récupéré par" value={value.collectedBy} onChange={event => update({ collectedBy: event.target.value })}
                    placeholder="Prénom et nom" error={!!fieldError("collectedBy")} helperText={fieldError("collectedBy")}
                    slotProps={{ htmlInput: { maxLength: 200, autoComplete: "off" } }} />
                </Box>
                <TextField label="Motif (facultatif)" value={value.notes} multiline minRows={2} onChange={event => update({ notes: event.target.value })}
                  error={!!fieldError("notes")} helperText={fieldError("notes") || "Raison du retrait ou détail utile."} slotProps={{ htmlInput: { maxLength: 4000 } }} />
              </>}
              {returnFields && <>
                {action === "edit" && <Typography variant="subtitle2">Restitution enregistrée</Typography>}
                <TextField required type="date" label="Date de restitution" value={value.returnedOn || ""} onChange={event => update({ returnedOn: event.target.value || null })}
                  error={!!fieldError("returnedOn")} helperText={fieldError("returnedOn")}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: value.collectedOn, max: today() } }} />
                <TextField required label="Restitué par" value={value.returnedBy} onChange={event => update({ returnedBy: event.target.value })}
                  placeholder="Prénom et nom" error={!!fieldError("returnedBy")} helperText={fieldError("returnedBy")}
                  slotProps={{ htmlInput: { maxLength: 200, autoComplete: "off" } }} />
              </>}
              {action === "restore" && <TextField required label="Annulation enregistrée par" value={value.actor} onChange={event => update({ actor: event.target.value })}
                placeholder="Prénom et nom" error={!!fieldError("actor")} helperText={fieldError("actor")}
                slotProps={{ htmlInput: { maxLength: 200, autoComplete: "off" } }} />}
              <Typography variant="caption" color="text.secondary">
                {draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil."}
                {action === "edit" ? ` Correction enregistrée avec le profil ${profile}. Les anciennes informations restent dans l’historique.` :
                  action === "create" ? " Pensez à étiqueter l’objet avec le numéro de chambre avant de le ranger." : " Le nom de la personne qui a récupéré l’objet reste conservé."}
              </Typography>
            </Stack>
          </Box>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexWrap: "wrap" }}>
        <Button disabled={busy} onClick={onClose} sx={{ minHeight: 48 }}>Fermer</Button>
        <Button variant="contained" type="submit" disabled={busy || !value || !!unchanged || alreadySaved} sx={{ minHeight: 48, flex: { xs: 1, sm: "none" } }}>
          {busy ? "Enregistrement…" : submitLabels[action]}
        </Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
