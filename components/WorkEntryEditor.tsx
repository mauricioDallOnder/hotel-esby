"use client";
import { useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useEntries } from "@/context/EntriesContext";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import type { WorkEntry } from "@/lib/rooms";

export function WorkEntryEditor({ initial, draftKey, title, onClose }: { initial: WorkEntry; draftKey: string; title: string; onClose: () => void }) {
  const { enqueue } = useEntries();
  const draft = useDeviceDraft<WorkEntry>(draftKey, () => initial);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const value = draft.value;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { await enqueue(value); await draft.clear(); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <form onSubmit={submit}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {draft.error && <Alert severity="error">{draft.error}</Alert>}
        {value && <>
          <TextField autoFocus label={value.kind === "dailyTask" ? "À faire" : "Commentaire"} required multiline minRows={3} disabled={busy} value={value.notes} onChange={e => draft.update({ ...value, notes: e.target.value })} slotProps={{ htmlInput: { maxLength: value.kind === "dailyTask" ? 500 : 4000 } }} />
          <TextField label={value.kind === "dailyTask" ? "Jour prévu" : "Date du commentaire"} type="date" required disabled={busy} value={value.date} onChange={e => draft.update({ ...value, date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
          {value.kind === "familyComment" && <TextField label="Votre nom" required disabled={busy} value={value.actor} onChange={e => draft.update({ ...value, actor: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />}
          <Typography variant="caption" color="text.secondary">{draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil."}{value.kind === "familyComment" && " Les versions précédentes restent dans l’historique."}</Typography>
        </>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={onClose}>Fermer</Button><Button variant="contained" type="submit" disabled={busy || !value}>Enregistrer</Button></DialogActions>
    </form>
  </Dialog>;
}
