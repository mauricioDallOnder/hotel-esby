"use client";
import { TextField } from "@mui/material";
import { roomGroups } from "@/lib/rooms";
export function RoomSelect({ value, onChange, extraOption }: {
  value: string;
  onChange: (value: string) => void;
  extraOption?: { value: string; label: string };
}) {
  return <TextField select label="Chambre" value={value} onChange={e => onChange(e.target.value)} required fullWidth slotProps={{ select: { native: true } }}>
    <option value="">Choisir une chambre</option>
    {extraOption && <option value={extraOption.value}>{extraOption.label}</option>}
    {roomGroups.map(group => <optgroup key={group.label} label={group.label}>
      {group.rooms.map(room => <option key={room} value={room}>{room}</option>)}
    </optgroup>)}
  </TextField>;
}
