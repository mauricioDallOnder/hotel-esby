"use client";
import { useRef, useState } from "react";
import { Alert, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";
import { createId, displayDate, today } from "@/lib/domain";
import type { RoomEntry, RoomInspection } from "@/lib/rooms";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailability } from "@/lib/work";

export function RoomAvailabilityCheckbox({ room, inspection }: { room: string; inspection?: RoomEntry | RoomInspection }) {
  const { events, enqueue, actor, isPending } = useWorkEvents();
  const availability = roomAvailability(room, events, inspection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function change(free: boolean) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await enqueue({ type: "createWorkEvent", id: createId(), kind: "roomAvailability", targetId: room,
        expectedRevision: availability.revision, room, date: today(), actor, notes: "", occurredAt: new Date().toISOString(), free });
    } catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Stack spacing={0.5}>
    <FormControlLabel sx={{ m: 0, ml: -1 }} label="Chambre libre" control={<Checkbox checked={availability.free === true} indeterminate={availability.free === undefined} disabled={busy} onChange={(_, checked) => void change(checked)} slotProps={{ input: { "aria-label": `Chambre ${room} libre` } }} />} />
    <Typography variant="caption" color="text.secondary">{availability.free === undefined ? "Disponibilité non renseignée" : availability.free ? "Libre" : "Occupée"}{isPending(availability.source?.id) ? " · En attente d’envoi" : availability.source ? ` · ${displayDate(availability.source.date)}` : ""}</Typography>
    {error && <Alert severity="error">{error}</Alert>}
  </Stack>;
}
