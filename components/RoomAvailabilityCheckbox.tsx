"use client";
import { useId, useRef, useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";
import { createId, displayDate, today } from "@/lib/domain";
import type { RoomEntry, RoomInspection } from "@/lib/rooms";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import type { RoomAvailabilityState } from "@/lib/roomAvailabilityView";

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
  const [error, setError] = useState("");
  const saving = useRef(false);
  const statusId = useId();
  const unknown = availability.free === undefined;
  const inspectionSource = !availability.source && !unknown ? inspection : undefined;
  const sourceDate = availability.source?.date || inspectionSource?.date;
  const sourcePending = availability.source ? pending.some(item => item.entry.id === availability.source!.id) : !!inspectionSource && inspectionPending;
  const status = unknown ? "Occupation non renseignée" : availability.free ? "Libre" : "Occupée";
  const statusColor = unknown ? "text.secondary" : availability.free ? "success.main" : "info.main";
  const details = busy ? "Enregistrement…" : [
    sourcePending ? "En attente d’envoi" : sourceDate ? "Enregistré" : "",
    sourceDate ? `${inspectionSource ? "Contrôle du " : ""}${displayDate(sourceDate)}` : "",
  ].filter(Boolean).join(" · ");
  async function change(free: boolean) {
    if (saving.current || !ready || blocked) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await enqueue({ type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: room,
        expectedRevision: availability.revision, expectedPreviousEventId: availability.source?.id || null, room, date: today(), actor, notes: "", occurredAt: new Date().toISOString(), free });
    } catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Stack spacing={0.75}>
    <FormControlLabel sx={{ m: 0, minHeight: 48, width: "100%" }} label={<Typography variant="body2" sx={{ fontWeight: 700 }}>Occupée</Typography>}
      control={<Checkbox color="info" checked={availability.free === false} indeterminate={unknown} disabled={busy || !ready || !!blocked}
        sx={{ minWidth: 48, minHeight: 48, color: unknown ? "text.disabled" : statusColor }}
        onChange={(_, checked) => void change(!checked)} slotProps={{ input: { "aria-label": `Chambre ${room} occupée`, "aria-checked": unknown ? "mixed" : undefined, "aria-describedby": statusId } }} />} />
    <Stack id={statusId} spacing={0.25} role="status" aria-live="polite">
      <Typography variant="body2" color={statusColor} sx={{ fontWeight: 700 }}>{status}</Typography>
      {details && <Typography variant="caption" color={sourcePending && !busy ? "warning.main" : "text.secondary"}>{details}</Typography>}
    </Stack>
    {unknown && <Button size="small" variant="outlined" color="success" disabled={busy || !ready || !!blocked} sx={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => void change(true)}>Marquer libre</Button>}
    {blocked && <Button color="warning" onClick={() => reviewPending(blocked.entry.id)}>Vérifier la modification</Button>}
    {error && <Alert severity="error">{error}</Alert>}
  </Stack>;
}
