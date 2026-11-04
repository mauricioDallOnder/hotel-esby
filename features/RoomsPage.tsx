"use client";
import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { RoomHistoryDialog } from "@/components/RoomHistoryDialog";
import { RoomInspectionDialog } from "@/components/RoomInspectionDialog";
import { RoomChecklistPrintDialog } from "@/components/RoomChecklistPrintDialog";
import { displayDate, today } from "@/lib/domain";
import { cleaningText, roomGroups, rooms, type RoomEntry } from "@/lib/rooms";
import { roomObservations } from "@/lib/roomObservations";
import { daysSince, roomRotation } from "@/lib/roomRotation";
import { openRoomIssues } from "@/lib/roomIssueMatching";
import { RoomAvailabilityCheckbox } from "@/components/RoomAvailabilityCheckbox";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailability } from "@/lib/work";
import { useDeviceDraft } from "@/lib/useDeviceDraft";

type Preferences = { dailyGoal: number; intervalDays: number; deferredDay: string; deferred: string[] };
const filters = { all: "Toutes", occupied: "Occupées", free: "Libres", unknown: "Non renseignées", target: "Tournée du jour", due: "À contrôler", problems: "Anomalies ouvertes", cleaning: "Ménage à faire" };
const occupancyFilters = ["all", "occupied", "free", "unknown"] as const;
const workflowFilters = ["target", "due", "problems", "cleaning"] as const;
const filterColors = { all: "primary", occupied: "info", free: "success", unknown: "inherit" } as const;
export default function RoomsPage() {
  const { roomInspections = [], issues, hotelName } = useAppContext();
  const { pending } = useEntries();
  const { events: workEvents } = useWorkEvents();
  const [room, setRoom] = useState<string | null>(null);
  const [historyRoom, setHistoryRoom] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [day, setDay] = useState(today);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState<keyof typeof filters>("all");
  const [settings, setSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const preferences = useDeviceDraft<Preferences>("room-rotation-preferences", () => ({ dailyGoal: 15, intervalDays: 7, deferredDay: day, deferred: [] }));
  const config = preferences.value;
  const deferred = config?.deferredDay === day ? config.deferred : [];
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const queued = pending.filter(p => p.entry.type === "createRoomInspection").map(p => p.entry as RoomEntry);
  const history = [...queued, ...roomInspections.filter(i => !queued.some(q => q.id === i.id))];
  const { latest, history: currentHistory, pendingIds } = roomObservations(roomInspections, pending, day);
  const rotation = roomRotation(history.filter(r => !pending.some(p => p.entry.id === r.id && p.blocked)), day, config?.dailyGoal, config?.intervalDays, deferred);
  const availability = new Map(rooms.map(n => [n, roomAvailability(n, workEvents, latest.get(n)).free]));
  const free = rooms.filter(n => availability.get(n) === true);
  const nextRoom = rotation.plan.find(n => n !== room);
  function changePreference(patch: Partial<Preferences>) { if (config) preferences.update({ ...config, ...patch }); }
  function deferRoom() {
    if (!room || !config) return;
    changePreference({ deferredDay: day, deferred: [...new Set([...deferred, room])] });
    setMessage(`Chambre ${room} reportée à demain. Son brouillon est conservé ; elle n’est pas comptée comme contrôlée.`);
    setRoom(nextRoom || null);
  }
  async function exportFreeRooms() {
    setExporting(true); setExportError("");
    try { const { downloadFreeRoomsReport } = await import("@/lib/roomPdfExport"); await downloadFreeRoomsReport({ hotelName, history: currentHistory, workEvents }); }
    catch (error) { setExportError((error as Error).message); }
    finally { setExporting(false); }
  }
  const scopedGroups = roomGroups.filter(g => group === "all" || group === g.label)
    .map(g => ({ ...g, rooms: g.rooms.filter(n => n.includes(search.trim())) }));
  const scopedRooms = scopedGroups.flatMap(g => g.rooms);
  const counts = {
    all: scopedRooms.length,
    occupied: scopedRooms.filter(n => availability.get(n) === false).length,
    free: scopedRooms.filter(n => availability.get(n) === true).length,
    unknown: scopedRooms.filter(n => availability.get(n) === undefined).length,
  };
  const visibleGroups = scopedGroups.map(g => ({ ...g, rooms: g.rooms.filter(n => {
    const record = latest.get(n);
    if (filter === "target") return rotation.plan.includes(n) || rotation.done.includes(n);
    if (filter === "due") return rotation.due.includes(n);
    if (filter === "problems") return openRoomIssues(issues, n).length > 0;
    if (filter === "occupied") return availability.get(n) === false;
    if (filter === "free") return availability.get(n) === true;
    if (filter === "unknown") return availability.get(n) === undefined;
    if (filter === "cleaning") return availability.get(n) === true && record?.cleaning === "non_faite";
    return true;
  }) })).filter(g => g.rooms.length);
  const visibleCount = visibleGroups.reduce((count, g) => count + g.rooms.length, 0);
  const hasFilters = !!search || group !== "all" || filter !== "all";
  return <>
    <ConnectionBar />
    <PageTitle title="Contrôle des chambres" description="Votre tournée, un contrôle rapide, un historique clair." />
    <Stack spacing={3}>
      {message && <Alert severity="info" onClose={() => setMessage("")}>{message}</Alert>}
      {preferences.error && <Alert severity="error">{preferences.error}</Alert>}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderColor: "primary.main", bgcolor: "#f4f8f7" }}>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Box><Typography variant="overline" color="primary">{displayDate(day)} · Rotation</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>Votre tournée du jour</Typography></Box>
            <Button onClick={() => setSettings(!settings)} aria-expanded={settings}>Régler</Button>
          </Stack>
          <Typography><strong>{rotation.done.length} / {rotation.goal}</strong> chambres contrôlées aujourd’hui{queued.some(r => r.date === day) ? " · dont des envois en attente" : ""}</Typography>
          <LinearProgress aria-label="Objectif du jour" variant="determinate" value={Math.min(100, rotation.done.length / rotation.goal * 100)} sx={{ height: 8, borderRadius: 4 }} />
          <Typography variant="body2" color="text.secondary">{rotation.covered}/{rooms.length} chambres contrôlées dans les {rotation.interval} derniers jours · {rotation.due.length} à contrôler. Les chambres en mauvais état sont prioritaires, même récemment visitées. Dans chaque groupe, les chambres jamais contrôlées passent d’abord, puis les plus anciennes. Les contrôles complets d’aujourd’hui et les reports sont respectés.</Typography>
          {settings && <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Objectif quotidien" type="number" value={config?.dailyGoal || 15} onChange={e => changePreference({ dailyGoal: Math.max(1, Math.min(85, Number(e.target.value) || 1)) })} slotProps={{ htmlInput: { min: 1, max: 85 } }} />
              <TextField label="Intervalle cible (jours)" type="number" value={config?.intervalDays || 7} onChange={e => changePreference({ intervalDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} slotProps={{ htmlInput: { min: 1, max: 60 } }} />
            </Stack>
            <Typography variant="caption">À ce rythme, un tour complet demande environ {rotation.cycleWorkDays} jours de travail. L’intervalle compte les jours calendaires. Réglages et reports mémorisés sur cet appareil.</Typography>
            {rotation.cycleWorkDays > rotation.interval && <Alert severity="warning">L’objectif quotidien est trop bas pour couvrir les 85 chambres dans cet intervalle, même en travaillant chaque jour.</Alert>}
          </Stack>}
          {rotation.plan.length ? <>
            <Button variant="contained" size="large" onClick={() => setRoom(rotation.plan[0])} disabled={!config}>Continuer la tournée · chambre {rotation.plan[0]}</Button>
            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
              {rotation.plan.map((n, index) => <Button key={n} variant="outlined" color={rotation.priorityRooms.includes(n) ? "warning" : "primary"} onClick={() => setRoom(n)} aria-label={`Ouvrir la chambre ${n} dans la tournée`} sx={{ minWidth: 60, minHeight: 48, maxWidth: "100%" }}><Stack><strong>{n}</strong><Typography variant="caption">{index === 0 ? "Suivante" : latest.has(n) ? `${daysSince(latest.get(n)!.date, day)} j` : "Jamais"}</Typography>{rotation.priorityRooms.includes(n) && <Typography variant="caption">Mauvais état · prioritaire</Typography>}</Stack></Button>)}
            </Stack>
          </> : <Alert severity="success">{rotation.done.length >= rotation.goal ? "Objectif du jour atteint. Les chambres restantes vous attendront dans les prochaines tournées." : rotation.due.length ? "Les chambres restantes ont été reportées. Vous pouvez les reprendre ci-dessous." : "Toutes les chambres sont dans l’intervalle cible."}</Alert>}
          {deferred.length > 0 && <details><summary style={{ cursor: "pointer" }}>{deferred.length} chambre(s) reportée(s) aujourd’hui</summary><Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>{deferred.map(n => <Button key={n} onClick={() => { changePreference({ deferred: deferred.filter(item => item !== n) }); setRoom(n); }}>Reprendre {n}</Button>)}</Stack></details>}
        </Stack>
      </Paper>
      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button variant="outlined" onClick={() => setHistoryRoom("all")}>Historique de tous les contrôles</Button>
        <Button variant="outlined" onClick={() => setPrinting(true)}>Imprimer le checklist (PDF)</Button>
        <Button variant="outlined" disabled={exporting || !free.length} onClick={() => void exportFreeRooms()}>{exporting ? "Préparation du PDF…" : `Exporter en PDF · Chambres libres (${free.length})`}</Button>
      </Stack>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">Cochez « Occupée » pour une chambre occupée ; décochez pour la marquer libre. Aucun contrôle à remplir. Un trait indique une occupation inconnue : cochez pour « Occupée » ou choisissez « Marquer libre ».</Typography>
        <TextField label="Rechercher une chambre" value={search} onChange={e => setSearch(e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par étage">{["all", ...roomGroups.map(g => g.label)].map(g => <Chip key={g} label={g === "all" ? "Tous les étages" : g} onClick={() => setGroup(g)} aria-pressed={group === g} color={group === g ? "primary" : "default"} variant={group === g ? "filled" : "outlined"} />)}</Stack>
        <Box role="group" aria-label="Filtrer par occupation" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" }, gap: 1 }}>
          {occupancyFilters.map(key => <Button key={key} onClick={() => setFilter(key)} aria-label={`${filters[key]} : ${counts[key]}`}
            aria-pressed={filter === key} color={filterColors[key]} variant={filter === key ? "contained" : "outlined"}
            sx={{ minHeight: 48, px: 1.5, gap: 1, justifyContent: "space-between", textAlign: "left" }}>
            <span>{filters[key]}</span><Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>{counts[key]}</Typography>
          </Button>)}
        </Box>
        <Typography variant="caption" color="text.secondary">Les compteurs suivent la recherche et l’étage sélectionné.</Typography>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer les contrôles">
          {workflowFilters.map(key => <Chip key={key} label={filters[key]} onClick={() => setFilter(key)} aria-pressed={filter === key} color={filter === key ? "primary" : "default"} variant={filter === key ? "filled" : "outlined"} />)}
        </Stack>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" color="text.secondary" role="status">{visibleCount} chambre(s) affichée(s) sur {rooms.length}</Typography>
          <Button size="small" disabled={!hasFilters} onClick={() => { setSearch(""); setGroup("all"); setFilter("all"); }}>Réinitialiser les filtres</Button>
        </Stack>
      </Stack>
      {!visibleGroups.length && <Alert severity="info">Aucune chambre ne correspond à ces filtres.</Alert>}
      {visibleGroups.map(g => <Box component="section" key={g.label} aria-label={g.label}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{g.label} · {g.rooms.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 1.5 }}>
          {g.rooms.map(n => {
            const record = latest.get(n), open = openRoomIssues(issues, n), done = rotation.done.includes(n), target = rotation.plan.includes(n), priority = rotation.priorityRooms.includes(n);
            const borderColor = availability.get(n) === false ? "info.main" : availability.get(n) === true ? "success.main" : "grey.400";
            return <Paper component="article" key={n} aria-label={`Chambre ${n}`} variant="outlined" sx={{ p: 1.5, minWidth: 0, borderColor: "divider", borderTop: "4px solid", borderTopColor: borderColor }}>
              <Stack spacing={1}>
                <Stack direction="row" useFlexGap sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}><Typography variant="h4" component="h3" sx={{ fontSize: 36, lineHeight: 1.2, fontWeight: 800 }}>{n}</Typography>{done && <Chip label="Fait" color="success" size="small" />}</Stack>
                <Typography variant="caption">{record ? `Dernier : ${displayDate(record.date)}` : "Jamais contrôlée"}</Typography>
                {priority && <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>Mauvais état · prioritaire</Typography>}
                <RoomAvailabilityCheckbox room={n} inspection={record} inspectionPending={!!record && pendingIds.has(record.id)} />
                {record?.occupied === false && <Typography variant="caption">Dernier contrôle · Ménage {cleaningText(record).toLowerCase()}</Typography>}
                {open.length > 0 && <Chip label={`${open.length} anomalie(s)`} color="warning" size="small" variant="outlined" />}
                {queued.some(q => q.room === n) && <Typography variant="caption" color="warning.main">Contrôle en attente d’envoi</Typography>}
                {deferred.includes(n) && <Typography variant="caption">Reportée à demain</Typography>}
                <Button variant={target ? "contained" : "outlined"} onClick={() => setRoom(n)} aria-label={`Contrôler la chambre ${n}`} sx={{ minHeight: 48 }}>{done ? "Recontrôler" : "Contrôler"}</Button>
                <Button aria-label={`Historique de la chambre ${n}`} onClick={() => setHistoryRoom(n)}>Historique</Button>
              </Stack>
            </Paper>;
          })}
        </Box>
      </Box>)}
    </Stack>
    {room && <RoomInspectionDialog key={room} room={room} nextRoom={nextRoom} onClose={() => setRoom(null)} onDefer={deferRoom} onSaved={next => { setMessage(`Contrôle de la chambre ${room} conservé. Le statut d’envoi reste visible jusqu’à la confirmation du serveur.`); setRoom(next ? nextRoom || null : null); }} />}
    {historyRoom && <RoomHistoryDialog key={historyRoom} room={historyRoom === "all" ? undefined : historyRoom} history={history} issues={issues} onClose={() => setHistoryRoom(null)} />}
    {printing && <RoomChecklistPrintDialog hotelName={hotelName} selectedRooms={visibleGroups.flatMap(g => g.rooms)} history={history} date={day} blockedIds={pending.filter(p => p.blocked).map(p => p.entry.id)} onClose={() => setPrinting(false)} />}
  </>;
}
