"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Paper, Stack, TextField, Typography } from "@mui/material";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { RoomAvailabilityCheckbox } from "@/components/RoomAvailabilityCheckbox";
import { roomGroups, rooms } from "@/lib/rooms";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailability } from "@/lib/work";

const filters = { all: "Toutes", occupied: "Occupées", free: "Libres", unknown: "Non renseignées" };

export default function RoomOccupancyPage() {
  const { latest, pendingIds } = useRoomObservations();
  const { events } = useWorkEvents();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState<keyof typeof filters>("all");
  const availability = new Map(rooms.map(room => [room, roomAvailability(room, events, latest.get(room)).free]));
  const occupied = rooms.filter(room => availability.get(room) === false).length;
  const free = rooms.filter(room => availability.get(room) === true).length;
  const unknown = rooms.length - occupied - free;
  const visibleGroups = roomGroups.filter(g => group === "all" || group === g.label).map(g => ({ ...g, rooms: g.rooms.filter(room => {
    if (!room.includes(search.trim())) return false;
    const value = availability.get(room);
    return filter === "all" || (filter === "occupied" && value === false) || (filter === "free" && value === true) || (filter === "unknown" && value === undefined);
  }) })).filter(g => g.rooms.length);
  const visibleCount = visibleGroups.reduce((count, g) => count + g.rooms.length, 0);
  return <>
    <ConnectionBar />
    <PageTitle title="Occupation des chambres" description="Consultez et mettez à jour les chambres occupées ou libres." />
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
          <Chip label={`${occupied} occupées`} color="primary" variant="outlined" />
          <Chip label={`${free} libres`} color="success" variant="outlined" />
          <Chip label={`${unknown} non renseignées`} variant="outlined" />
        </Stack>
        <Typography variant="body2" color="text.secondary">Cochez « Occupée » pour une chambre occupée ; décochez pour la marquer libre. Enregistrement automatique.</Typography>
        <Typography variant="caption" color="text.secondary">Un trait indique une occupation inconnue : cochez pour « Occupée » ou choisissez « Marquer libre ».</Typography>
        <TextField label="Rechercher une chambre" type="search" value={search} onChange={event => setSearch(event.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par étage">
          {["all", ...roomGroups.map(g => g.label)].map(value => <Chip key={value} label={value === "all" ? "Tous les étages" : value} onClick={() => setGroup(value)} aria-pressed={group === value} color={group === value ? "primary" : "default"} variant={group === value ? "filled" : "outlined"} />)}
        </Stack>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par occupation">
          {Object.entries(filters).map(([key, label]) => <Chip key={key} label={label} onClick={() => setFilter(key as keyof typeof filters)} aria-pressed={filter === key} color={filter === key ? "primary" : "default"} variant={filter === key ? "filled" : "outlined"} />)}
        </Stack>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" color="text.secondary" role="status">{visibleCount} chambre(s) affichée(s) sur {rooms.length}</Typography>
          {(search || group !== "all" || filter !== "all") && <Button size="small" onClick={() => { setSearch(""); setGroup("all"); setFilter("all"); }}>Réinitialiser les filtres</Button>}
        </Stack>
      </Stack>
      {!visibleGroups.length && <Alert severity="info">Aucune chambre ne correspond à ces filtres.</Alert>}
      {visibleGroups.map(g => <Box component="section" key={g.label} aria-label={g.label}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{g.label} · {g.rooms.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 1.5 }}>
          {g.rooms.map(room => {
            const inspection = latest.get(room);
            return <Paper component="article" key={room} aria-label={`Chambre ${room}`} variant="outlined" sx={{ p: 1.5, minWidth: 0, borderColor: availability.get(room) === false ? "primary.main" : availability.get(room) === true ? "success.main" : "divider" }}>
              <Typography variant="h4" component="h3" sx={{ mb: 1, fontWeight: 800 }}>{room}</Typography>
              <RoomAvailabilityCheckbox room={room} mode="occupied" inspection={inspection} inspectionPending={!!inspection && pendingIds.has(inspection.id)} />
            </Paper>;
          })}
        </Box>
      </Box>)}
    </Stack>
  </>;
}
