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
const filterColors = { all: "primary", occupied: "info", free: "success", unknown: "inherit" } as const;

export default function RoomOccupancyPage() {
  const { latest, pendingIds } = useRoomObservations();
  const { events } = useWorkEvents();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState<keyof typeof filters>("all");
  const availability = new Map(rooms.map(room => [room, roomAvailability(room, events, latest.get(room)).free]));
  const scopedGroups = roomGroups.filter(g => group === "all" || group === g.label)
    .map(g => ({ ...g, rooms: g.rooms.filter(room => room.includes(search.trim())) }));
  const scopedRooms = scopedGroups.flatMap(g => g.rooms);
  const counts = {
    all: scopedRooms.length,
    occupied: scopedRooms.filter(room => availability.get(room) === false).length,
    free: scopedRooms.filter(room => availability.get(room) === true).length,
    unknown: scopedRooms.filter(room => availability.get(room) === undefined).length,
  };
  const visibleGroups = scopedGroups.map(g => ({ ...g, rooms: g.rooms.filter(room => {
    const value = availability.get(room);
    return filter === "all" || (filter === "occupied" && value === false) || (filter === "free" && value === true) || (filter === "unknown" && value === undefined);
  }) })).filter(g => g.rooms.length);
  const visibleCount = visibleGroups.reduce((count, g) => count + g.rooms.length, 0);
  const hasFilters = !!search || group !== "all" || filter !== "all";
  return <>
    <ConnectionBar />
    <PageTitle title="Occupation des chambres" description="Consultez et mettez à jour les chambres occupées ou libres." />
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">Cochez « Occupée » pour une chambre occupée ; décochez pour la marquer libre. Enregistrement automatique.</Typography>
        <Typography variant="caption" color="text.secondary">Un trait indique une occupation inconnue : cochez pour « Occupée » ou choisissez « Marquer libre ».</Typography>
        <TextField label="Rechercher une chambre" type="search" value={search} onChange={event => setSearch(event.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par étage">
          {["all", ...roomGroups.map(g => g.label)].map(value => <Chip key={value} label={value === "all" ? "Tous les étages" : value} onClick={() => setGroup(value)} aria-pressed={group === value} color={group === value ? "primary" : "default"} variant={group === value ? "filled" : "outlined"} />)}
        </Stack>
        <Box role="group" aria-label="Filtrer par occupation" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" }, gap: 1 }}>
          {(Object.keys(filters) as (keyof typeof filters)[]).map(key => <Button key={key} onClick={() => setFilter(key)}
            aria-label={`${filters[key]} : ${counts[key]}`} aria-pressed={filter === key} color={filterColors[key]} variant={filter === key ? "contained" : "outlined"}
            sx={{ minHeight: 48, px: 1.5, gap: 1, justifyContent: "space-between", textAlign: "left" }}>
            <span>{filters[key]}</span><Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>{counts[key]}</Typography>
          </Button>)}
        </Box>
        <Typography variant="caption" color="text.secondary">Les compteurs suivent la recherche et l’étage sélectionné.</Typography>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" color="text.secondary" role="status">{visibleCount} chambre(s) affichée(s) sur {rooms.length}</Typography>
          <Button size="small" disabled={!hasFilters} onClick={() => { setSearch(""); setGroup("all"); setFilter("all"); }}>Réinitialiser les filtres</Button>
        </Stack>
      </Stack>
      {!visibleGroups.length && <Alert severity="info">Aucune chambre ne correspond à ces filtres.</Alert>}
      {visibleGroups.map(g => <Box component="section" key={g.label} aria-label={g.label}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{g.label} · {g.rooms.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 1.5 }}>
          {g.rooms.map(room => {
            const inspection = latest.get(room);
            const borderColor = availability.get(room) === false ? "info.main" : availability.get(room) === true ? "success.main" : "grey.400";
            return <Paper component="article" key={room} aria-label={`Chambre ${room}`} variant="outlined" sx={{ p: 1.5, minWidth: 0, borderColor: "divider", borderTop: "4px solid", borderTopColor: borderColor }}>
              <Typography variant="h4" component="h3" sx={{ mb: 1, fontSize: 36, lineHeight: 1.2, fontWeight: 800 }}>{room}</Typography>
              <RoomAvailabilityCheckbox room={room} inspection={inspection} inspectionPending={!!inspection && pendingIds.has(inspection.id)} />
            </Paper>;
          })}
        </Box>
      </Box>)}
    </Stack>
  </>;
}
