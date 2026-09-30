"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { RoomSelect } from "@/components/RoomSelect";
import { createId, displayDate, today } from "@/lib/domain";
import { familyEntrySchema, type FamilyEntry } from "@/lib/rooms";
import { useDeviceDraft } from "@/lib/useDeviceDraft";

export default function FamiliesPage() {
  const { familyEvents = [] } = useAppContext();
  const { pending, enqueue, removeAbsence } = useEntries();
  const draft = useDeviceDraft<FamilyEntry>("draft:family", () => ({ type: "createFamilyEvent", id: createId(), date: today(), room: "", family: "", actor: "", notes: "", kind: "absence", returnDate: "" }));
  const [deleting, setDeleting] = useState<FamilyEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(30);
  const [filter, setFilter] = useState("");
  const value = draft.value;
  const queued = pending.filter(p => p.entry.type === "createFamilyEvent").map(p => p.entry as FamilyEntry);
  const records = [...queued, ...familyEvents.filter(e => !queued.some(q => q.id === e.id))].sort((a, b) => b.date.localeCompare(a.date));
  const visibleRecords = records.filter(e => `${e.room} ${e.family}`.toLowerCase().includes(filter.toLowerCase()));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setError(""); setMessage(""); setBusy(true);
    const parsed = familyEntrySchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(" ")); setBusy(false); return; }
    try {
      await enqueue(parsed.data);
      await draft.clear();
      setMessage("Événement sauvegardé sur cet appareil. L’état d’envoi apparaît dans l’historique.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true); setDeleteError("");
    try { await removeAbsence(deleting.id); setDeleting(null); }
    catch (e) { setDeleteError((e as Error).message); }
    finally { setDeleteBusy(false); }
  }
  return <>
    <ConnectionBar />
    <PageTitle title="Absences et départs" description="Signalez les absences temporaires et les départs définitifs des familles." />
    <Stack spacing={3}>
      <Paper component="form" onSubmit={submit} variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h6">Nouvel événement</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {draft.error && <Alert severity="error">{draft.error}</Alert>}
          {message && <Alert severity="success">{message}</Alert>}
          {value && <Box component="fieldset" disabled={busy} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}><Stack spacing={2}>
            <RoomSelect value={value.room} onChange={room => draft.update({ ...value, room })} />
            <TextField label="Famille" required value={value.family} onChange={e => draft.update({ ...value, family: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField select label="Événement" value={value.kind} onChange={e => draft.update({ ...value, kind: e.target.value as FamilyEntry["kind"], returnDate: "" })}>
              <MenuItem value="absence">Absence temporaire</MenuItem><MenuItem value="depart">Départ définitif</MenuItem>
            </TextField>
            <TextField label={value.kind === "absence" ? "Date de début d’absence" : "Date du départ"} type="date" required value={value.date} onChange={e => draft.update({ ...value, date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            {value.kind === "absence" && <TextField label="Retour prévu (facultatif)" type="date" value={value.returnDate} onChange={e => draft.update({ ...value, returnDate: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: value.date } }} />}
            <TextField label="Signalé par" required value={value.actor} onChange={e => draft.update({ ...value, actor: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField label="Observations" multiline minRows={3} value={value.notes} onChange={e => draft.update({ ...value, notes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />
            <Typography variant="caption" color="text.secondary">{draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil pendant la saisie."}</Typography>
            <Button type="submit" variant="contained" disabled={busy}>Enregistrer l’événement</Button>
          </Stack></Box>}
        </Stack>
      </Paper>
      <Typography variant="h6">Historique · {records.length} événement(s)</Typography>
      <TextField label="Rechercher une chambre ou une famille" value={filter} onChange={e => { setFilter(e.target.value); setLimit(30); }} />
      {visibleRecords.slice(0, limit).map(record => <Paper key={record.id} variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}><Chip label={record.kind === "absence" ? "Absence" : "Départ"} color={record.kind === "absence" ? "warning" : "default"} /><Chip variant="outlined" label={queued.some(e => e.id === record.id) ? "En attente d’envoi" : "Enregistré sur le serveur"} /></Stack>
          <Typography variant="h6">Ch. {record.room} · {record.family}</Typography>
          <Typography>{displayDate(record.date)}{record.returnDate ? ` · Retour prévu : ${displayDate(record.returnDate)}` : ""}</Typography>
          <Typography variant="body2" color="text.secondary">Signalé par {record.actor}</Typography>
          {record.kind === "absence" && <Button color="error" onClick={() => { setDeleteError(""); setDeleting(record); }}>Supprimer</Button>}
          {record.notes && <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{record.notes}</Typography>}
        </Stack>
      </Paper>)}
      {visibleRecords.length > limit && <Button onClick={() => setLimit(n => n + 30)}>Afficher plus</Button>}
      {!records.length && <Typography color="text.secondary">Aucun événement enregistré.</Typography>}
    </Stack>
    <Dialog open={!!deleting} onClose={deleteBusy ? undefined : () => setDeleting(null)} fullWidth maxWidth="xs">
      <DialogTitle>Supprimer cette absence ?</DialogTitle>
      <DialogContent>
        <Typography>Voulez-vous vraiment supprimer cette absence ?</Typography>
        <Typography>Chambre {deleting?.room} · {deleting?.family} · {displayDate(deleting?.date || "")}</Typography>
        {deleteError && <Alert severity="error">{deleteError}</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={deleteBusy} onClick={() => setDeleting(null)}>Annuler</Button><Button color="error" disabled={deleteBusy} onClick={() => void confirmDelete()}>Supprimer</Button></DialogActions>
    </Dialog>
  </>;
}
