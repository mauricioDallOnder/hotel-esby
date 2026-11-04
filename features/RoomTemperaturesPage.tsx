"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Paper, Stack, TextField, Typography } from "@mui/material";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { RoomInspectionDialog } from "@/components/RoomInspectionDialog";
import { displayDate } from "@/lib/domain";
import { roomGroups, rooms } from "@/lib/rooms";
import { formatRoomTemperature, latestRoomTemperatures } from "@/lib/roomTemperature";
import { useRoomObservations } from "@/lib/useRoomObservations";

const filters = { all: "Toutes", measured: "Avec une mesure", missing: "Sans mesure" };

export default function RoomTemperaturesPage() {
  const { history, day, pendingIds } = useRoomObservations();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState<keyof typeof filters>("all");
  const [room, setRoom] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const measurements = latestRoomTemperatures(history, day);
  const visibleGroups = roomGroups.filter(item => group === "all" || item.label === group).map(item => ({
    ...item, rooms: item.rooms.filter(number => number.includes(search.trim()) &&
      (filter === "all" || (filter === "measured" ? measurements.has(number) : !measurements.has(number)))),
  })).filter(item => item.rooms.length);

  return <>
    <ConnectionBar />
    <PageTitle title="Températures des chambres" description="La dernière température renseignée pour chaque chambre, avec la date de la mesure." />
    <Stack spacing={3}>
      {message && <Alert severity="info" onClose={() => setMessage("")}>{message}</Alert>}
      <Stack spacing={1.5}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
          <Chip label={`${measurements.size} avec une mesure`} color="primary" variant="outlined" />
          <Chip label={`${rooms.length - measurements.size} sans mesure`} variant="outlined" />
          <Chip label={`${rooms.length} chambres`} variant="outlined" />
        </Stack>
        <Typography variant="body2" color="text.secondary">La température se saisit dans le contrôle de la chambre. Elle reste dans l’historique et ne crée pas d’anomalie.</Typography>
        <TextField label="Rechercher une chambre" value={search} onChange={event => setSearch(event.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par étage">
          {["all", ...roomGroups.map(item => item.label)].map(item => <Chip key={item} label={item === "all" ? "Tous les étages" : item} onClick={() => setGroup(item)} aria-pressed={group === item} color={group === item ? "primary" : "default"} variant={group === item ? "filled" : "outlined"} />)}
        </Stack>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par mesure">
          {Object.entries(filters).map(([key, label]) => <Chip key={key} label={label} onClick={() => setFilter(key as keyof typeof filters)} aria-pressed={filter === key} color={filter === key ? "primary" : "default"} variant={filter === key ? "filled" : "outlined"} />)}
        </Stack>
      </Stack>
      {!visibleGroups.length && <Alert severity="info">Aucune chambre ne correspond à ces filtres.</Alert>}
      {visibleGroups.map(item => <Box key={item.label}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{item.label} · {item.rooms.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 1.5 }}>
          {item.rooms.map(number => {
            const measurement = measurements.get(number);
            return <Paper key={number} component="article" aria-label={`Chambre ${number}`} variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
              <Stack spacing={1}>
                <Typography variant="h4" component="h3" sx={{ fontWeight: 800 }}>{number}</Typography>
                <Typography variant={measurement ? "h5" : "body2"} color={measurement ? "primary.main" : "text.secondary"} sx={{ fontWeight: measurement ? 700 : 400, overflowWrap: "anywhere" }}>{formatRoomTemperature(measurement?.temperatureC)}</Typography>
                {measurement && <Typography variant="caption" color="text.secondary">Mesure du {displayDate(measurement.date)}</Typography>}
                {measurement && pendingIds.has(measurement.id) && <Typography variant="caption" color="warning.main">En attente d’envoi</Typography>}
                <Button variant="outlined" onClick={() => setRoom(number)} aria-label={`Saisir la température de la chambre ${number}`} sx={{ minHeight: 44 }}>Saisir dans le contrôle</Button>
              </Stack>
            </Paper>;
          })}
        </Box>
      </Box>)}
    </Stack>
    {room && <RoomInspectionDialog key={room} room={room} initialStep={1} onClose={() => setRoom(null)} onSaved={() => {
      setMessage(`Contrôle de la chambre ${room} conservé. Le statut d’envoi reste visible jusqu’à la confirmation du serveur.`);
      setRoom(null);
    }} />}
  </>;
}
