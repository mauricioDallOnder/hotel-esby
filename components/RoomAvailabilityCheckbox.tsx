"use client";
import { useId, useRef, useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";
import { createId, displayDate, today } from "@/lib/domain";
import type { RoomEntry, RoomInspection } from "@/lib/rooms";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailability } from "@/lib/work";

type Props = {
  room: string;
  inspection?: RoomEntry | RoomInspection;
  inspectionPending?: boolean;
  mode?: "free" | "occupied";
};

export function RoomAvailabilityCheckbox({ room, inspection, inspectionPending = false, mode = "free" }: Props) {
  const { events, enqueue, actor, isPending } = useWorkEvents();
  const availability = roomAvailability(room, events, inspection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const statusId = useId();
  const occupiedMode = mode === "occupied";
  const unknown = availability.free === undefined;
  const inspectionSource = !availability.source && !unknown ? inspection : undefined;
  const sourceDate = availability.source?.date || inspectionSource?.date;
  const sourcePending = availability.source ? isPending(availability.source.id) : !!inspectionSource && inspectionPending;
  const status = unknown ? (occupiedMode ? "Occupation non renseignée" : "Disponibilité non renseignée") : availability.free ? "Libre" : "Occupée";
  const details = occupiedMode
    ? `${sourceDate ? ` · ${inspectionSource ? "Contrôle du " : ""}${displayDate(sourceDate)}` : ""}${sourcePending ? " · En attente d’envoi" : ""}`
    : isPending(availability.source?.id) ? " · En attente d’envoi" : availability.source ? ` · ${displayDate(availability.source.date)}` : "";
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
    <FormControlLabel sx={{ m: 0, ml: -1 }} label={occupiedMode ? "Occupée" : "Chambre libre"} control={<Checkbox checked={occupiedMode ? availability.free === false : availability.free === true} indeterminate={unknown} disabled={busy} onChange={(_, checked) => void change(occupiedMode ? !checked : checked)} slotProps={{ input: { "aria-label": `Chambre ${room} ${occupiedMode ? "occupée" : "libre"}`, "aria-checked": unknown ? "mixed" : undefined, "aria-describedby": statusId } }} />} />
    <Typography id={statusId} variant="caption" color="text.secondary">{status}{details}</Typography>
    {occupiedMode && unknown && <Button size="small" variant="outlined" disabled={busy} sx={{ alignSelf: "flex-start", mt: 0.5 }} onClick={() => void change(true)}>Marquer libre</Button>}
    {error && <Alert severity="error">{error}</Alert>}
  </Stack>;
}
