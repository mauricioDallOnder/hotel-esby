"use client";
import { TextField } from "@mui/material";
import { roomGroups } from "@/lib/rooms";
export function RoomSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <TextField select label="Chambre" value={value} onChange={e => onChange(e.target.value)} required fullWidth slotProps={{ select: { native: true } }}>
    <option value="">Choisir une chambre</option>
    {roomGroups.map(group => <optgroup key={group.start} label={group.label}>
      {Array.from({ length: group.end - group.start + 1 }, (_, i) => String(group.start + i)).map(room => <option key={room} value={room}>{room}</option>)}
    </optgroup>)}
  </TextField>;
}
