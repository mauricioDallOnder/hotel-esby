"use client";
import { useId, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import { createId, displayDate, today } from "@/lib/domain";
import type { RoomEntry, RoomInspection } from "@/lib/rooms";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import type { RoomAvailabilityState } from "@/lib/roomAvailabilityView";
import { RoomVacancyDialog } from "./RoomVacancyDialog";

type Props = {
  room: string;
  availability: RoomAvailabilityState;
  inspection?: RoomEntry | RoomInspection;
  inspectionPending?: boolean;
};

export function RoomAvailabilityCheckbox({ room, availability, inspection, inspectionPending = false }: Props) {
  const { role } = useAppContext();
  const { pending, enqueue, ready, reviewPending } = useEntries();
  const actor = role === "direction" ? "Direction" : "Employé";
  const blocked = pending.find(item => item.blocked && item.entry.type === "createWorkEvent" && item.entry.kind === "roomAvailability" && item.entry.targetId === room);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stay, setStay] = useState<{ guestName: string; stayUntil: string; previous: string | null; revision: number } | null>(null);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const statusId = useId();
  const unknown = availability.free === undefined;
  const inspectionSource = !availability.source && !unknown ? inspection : undefined;
  const sourceDate = availability.source?.date || inspectionSource?.date;
  const sourcePending = availability.source ? pending.some(item => item.entry.id === availability.source!.id) : !!inspectionSource && inspectionPending;
  const works = availability.free === true && availability.vacancyReason === "works";
  const status = unknown ? "Occupation non renseignée" : availability.free ? works ? "En travaux" : "Libre" : "Occupée";
  const statusColor = unknown ? "text.secondary" : availability.free ? works ? "warning.main" : "success.main" : "info.main";
  const notes = availability.free ? availability.source?.notes : undefined;
  const stayChanged = !!stay && (stay.previous !== (availability.source?.id || null) || stay.revision !== availability.revision || availability.free !== false);
  const details = busy ? "Enregistrement…" : [
    sourcePending ? "En attente d’envoi" : sourceDate ? "Enregistré" : "",
    sourceDate ? `${inspectionSource ? "Contrôle du " : ""}${displayDate(sourceDate)}` : "",
  ].filter(Boolean).join(" · ");
  async function markOccupied(details?: {guestName: string; stayUntil: string}) {
    if (saving.current || !ready || blocked) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await enqueue({ type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: room,
        expectedRevision: availability.revision, expectedPreviousEventId: availability.source?.id || null, room, date: today(), actor, notes: "", occurredAt: new Date().toISOString(), free: false,
        ...(details?.guestName.trim() ? { guestName: details.guestName.trim() } : {}), ...(details?.stayUntil ? { stayUntil: details.stayUntil } : {}) });
      setStay(null);
    } catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Stack spacing={0.75}>
    <Stack id={statusId} spacing={0.25} role="status" aria-live="polite">
      <FormControlLabel sx={{ m: 0, minHeight: 48, width: "100%", alignItems: "center" }} label={<Typography variant="body2" color={statusColor} sx={{ fontWeight: 700 }}>{status}</Typography>}
        control={<Checkbox color="info" checked={availability.free === false} indeterminate={unknown} disabled={busy || editing || !ready || !!blocked}
          sx={{ minWidth: 48, minHeight: 48, color: unknown ? "text.disabled" : statusColor }}
          onChange={(_, checked) => { if (checked) void markOccupied(); else { setError(""); setEditing(true); } }} slotProps={{ input: { "aria-label": `Chambre ${room} occupée`, "aria-checked": unknown ? "mixed" : undefined, "aria-describedby": statusId } }} />} />
      {details && <Typography variant="caption" color={sourcePending && !busy ? "warning.main" : "text.secondary"}>{details}</Typography>}
    </Stack>
    {availability.free === false && <>
      {availability.source?.guestName && <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{availability.source.guestName}</Typography>}
      {availability.source?.stayUntil && <Typography variant="body2">Séjour jusqu’au {displayDate(availability.source.stayUntil)}</Typography>}
      <Button size="small" variant="outlined" disabled={busy || !ready || !!blocked} sx={{ alignSelf: "flex-start" }} onClick={() => {
        setError(""); setStay({guestName: availability.source?.guestName || "", stayUntil: availability.source?.stayUntil || "",
          previous: availability.source?.id || null, revision: availability.revision});
      }}>Modifier le séjour</Button>
    </>}
    {notes && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{notes}</Typography>}
    {(unknown || availability.free) && <Button size="small" variant="outlined" color={works ? "warning" : "success"} disabled={busy || !ready || !!blocked} sx={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => { setError(""); setEditing(true); }}>{unknown ? "Marquer libre" : "Modifier"}</Button>}
    {blocked && <Button color="warning" onClick={() => reviewPending(blocked.entry.id)}>Vérifier la modification</Button>}
    {error && !stay && <Alert severity="error">{error}</Alert>}
    {stay && <Dialog open fullWidth maxWidth="xs" onClose={busy ? undefined : () => setStay(null)} aria-labelledby={statusId + "-stay"}>
      <Box component="form" onSubmit={e => { e.preventDefault(); if (!stayChanged) void markOccupied(stay); }}>
        <DialogTitle id={statusId + "-stay"}>Séjour · chambre {room}</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {stayChanged && <Alert severity="warning">La situation a changé. Rouvrez le séjour pour modifier les données actuelles.</Alert>}
          <TextField label="Nom de l’occupant" value={stay.guestName} disabled={busy} onChange={e => setStay({...stay, guestName:e.target.value})} slotProps={{htmlInput:{maxLength:200}}} />
          <TextField label="Séjour jusqu’au" type="date" value={stay.stayUntil} disabled={busy} onChange={e => setStay({...stay, stayUntil:e.target.value})} slotProps={{inputLabel:{shrink:true}}} />
        </Stack></DialogContent>
        <DialogActions><Button disabled={busy} onClick={() => setStay(null)}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={busy || !ready || !!blocked || stayChanged}>Enregistrer</Button>
        </DialogActions>
      </Box>
    </Dialog>}
    {editing && <RoomVacancyDialog room={room} onClose={() => setEditing(false)} />}
  </Stack>;
}
