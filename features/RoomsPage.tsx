"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { completeRoomInspection, daysSince, roomRotation } from "@/lib/roomRotation";
import { openRoomIssues } from "@/lib/roomIssueMatching";
import { RoomAvailabilityCheckbox } from "@/components/RoomAvailabilityCheckbox";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailabilityView } from "@/lib/roomAvailabilityView";
import { useDeviceDraft } from "@/lib/useDeviceDraft";

type Preferences = { dailyGoal: number; intervalDays: number; deferredDay: string; deferred: string[]; extendedDay?: string; extendedGoal?: number };
const filters = { all: "Toutes", occupied: "Occupées", unknown: "Non renseignées", target: "Tournée du jour", due: "À contrôler", never: "Sans contrôle complet", problems: "Problèmes techniques" };
const occupancyFilters = ["all", "occupied", "unknown"] as const;
const workflowFilters = ["target", "due", "never", "problems"] as const;
const filterColors = { all: "primary", occupied: "info", unknown: "inherit" } as const;
const rotationReasons = { never: "À compléter", overdue: "En retard", followup: "Suivi · 4 j", scheduled: "Planifié", done: "Fait" } as const;
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
  const usualGoal = Math.max(1, Math.floor(config?.dailyGoal || 15));
  const dailyTarget = config?.extendedDay === day ? Math.max(usualGoal, config.extendedGoal || usualGoal) : usualGoal;
  const deferred = useMemo(() => config?.deferredDay === day ? config.deferred : [], [config, day]);
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const queued = useMemo(() => pending.filter(p => p.entry.type === "createRoomInspection").map(p => p.entry as RoomEntry), [pending]);
  const history = useMemo(() => {
    const queuedIds = new Set(queued.map(record => record.id));
    return [...queued, ...roomInspections.filter(record => !queuedIds.has(record.id))];
  }, [queued, roomInspections]);
  const { latest, history: currentHistory, pendingIds } = useMemo(() => roomObservations(roomInspections, pending, day), [roomInspections, pending, day]);
  const availabilityStates = useMemo(() => roomAvailabilityView(workEvents, latest), [workEvents, latest]);
  const availability = useMemo(() => new Map([...availabilityStates].map(([room, state]) => [room, state.free])), [availabilityStates]);
  const eligibleRooms = useMemo(() => rooms.filter(n => availability.get(n) !== true), [availability]);
  const eligible = new Set(eligibleRooms);
  const rotation = useMemo(() => roomRotation(currentHistory, day, dailyTarget, config?.intervalDays, deferred, eligibleRooms), [currentHistory, day, dailyTarget, config?.intervalDays, deferred, eligibleRooms]);
  const openByRoom = useMemo(() => new Map(rooms.map(n => [n, openRoomIssues(issues, n)])), [issues]);
  const visibleDeferred = deferred.filter(n => eligible.has(n) && !rotation.done.includes(n));
  const free = rooms.filter(n => availability.get(n) === true);
  const hasPendingControls = currentHistory.some(record => record.date === day && eligible.has(record.room) && pendingIds.has(record.id) && completeRoomInspection(record));
  const nextRoom = rotation.plan.find(n => n !== room);
  const extraCount = Math.min(5, rotation.candidates.length);
  const cycleWorkDays = rotation.total ? Math.ceil(rotation.total / Math.min(rotation.total, usualGoal)) : 0;
  function changePreference(patch: Partial<Preferences>) { if (config) preferences.update({ ...config, ...patch }); }
  function extendTour() {
    if (!config || !extraCount) return;
    changePreference({ extendedDay: day, extendedGoal: Math.min(rotation.total, Math.max(rotation.goal, rotation.done.length) + extraCount) });
    setMessage(`${extraCount} chambre(s) ajoutée(s) à la tournée d’aujourd’hui. Votre objectif habituel reste ${usualGoal} par jour.`);
  }
  function showRooms(nextFilter: keyof typeof filters) {
    setSearch(""); setGroup("all"); setFilter(nextFilter);
    document.getElementById("room-checklist-filters")?.scrollIntoView({ block: "start" });
  }
  function deferRoom() {
    if (!room || !config) return;
    changePreference({ deferredDay: day, deferred: [...new Set([...deferred, room])] });
    setMessage(`Chambre ${room} reportée à demain. Son brouillon est conservé ; elle n’est pas comptée comme contrôlée.`);
    setRoom(rotation.done.length < rotation.goal ? rotation.candidates.find(n => n !== room) || null : null);
  }
  async function exportFreeRooms() {
    setExporting(true); setExportError("");
    try { const { downloadFreeRoomsReport } = await import("@/lib/roomPdfExport"); await downloadFreeRoomsReport({ hotelName, history: currentHistory, workEvents }); }
    catch (error) { setExportError((error as Error).message); }
    finally { setExporting(false); }
  }
  const scopedGroups = roomGroups.filter(g => group === "all" || group === g.label)
    .map(g => ({ ...g, rooms: g.rooms.filter(n => eligible.has(n) && n.includes(search.trim())) }));
  const scopedRooms = scopedGroups.flatMap(g => g.rooms);
  const counts = {
    all: scopedRooms.length,
    occupied: scopedRooms.filter(n => availability.get(n) === false).length,
    unknown: scopedRooms.filter(n => availability.get(n) === undefined).length,
  };
  const visibleGroups = scopedGroups.map(g => ({ ...g, rooms: g.rooms.filter(n => {
    if (filter === "target") return rotation.plan.includes(n) || rotation.done.includes(n);
    if (filter === "due") return rotation.due.includes(n);
    if (filter === "never") return rotation.neverRooms.includes(n);
    if (filter === "problems") return (openByRoom.get(n)?.length || 0) > 0;
    if (filter === "occupied") return availability.get(n) === false;
    if (filter === "unknown") return availability.get(n) === undefined;
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
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderColor: "primary.main", bgcolor: "action.hover" }}>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
            <Box><Typography variant="overline" color="primary">{displayDate(day)} · Rotation</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>Votre tournée du jour</Typography></Box>
            <Button onClick={() => setSettings(!settings)} aria-expanded={settings}>Régler</Button>
          </Stack>
          <Typography><strong>{rotation.done.length} / {rotation.goal}</strong> contrôles complets aujourd’hui{hasPendingControls ? " · dont des envois en attente" : ""}</Typography>
          {dailyTarget > usualGoal && <Typography variant="caption" color="text.secondary">Tournée prolongée pour aujourd’hui · objectif habituel : {Math.min(rotation.total, usualGoal)} chambres.</Typography>}
          <LinearProgress aria-label="Objectif du jour" variant="determinate" value={rotation.goal ? Math.min(100, rotation.done.length / rotation.goal * 100) : 0} sx={{ height: 8, borderRadius: 4 }} />
          <Box>
            <Typography variant="body2"><strong>{rotation.covered} / {rotation.total}</strong> chambres avec un contrôle complet dans les {rotation.interval} derniers jours.</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>D’abord les chambres sans contrôle complet, puis les contrôles dont l’échéance est la plus ancienne. Le mauvais état déclenche un suivi après 4 jours.</Typography>
          </Box>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
            <Chip label={`${rotation.due.length} à contrôler`} onClick={() => showRooms("due")} color={rotation.due.length ? "primary" : "default"} variant="outlined" />
            <Chip label={`${rotation.neverRooms.length} sans contrôle complet`} onClick={() => showRooms("never")} variant="outlined" />
            <Chip label={`${rotation.overdueRooms.length} en retard`} color={rotation.overdueRooms.length ? "warning" : "default"} variant="outlined" />
          </Stack>
          {settings && <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Objectif quotidien" type="number" value={config?.dailyGoal || 15} onChange={e => changePreference({ dailyGoal: Math.max(1, Math.min(rooms.length, Math.floor(Number(e.target.value)) || 1)), extendedDay: undefined, extendedGoal: undefined })} slotProps={{ htmlInput: { min: 1, max: rooms.length, step: 1 } }} helperText="Votre objectif habituel, limité au nombre de chambres à suivre." />
              <TextField label="Intervalle cible (jours)" type="number" value={config?.intervalDays || 7} onChange={e => changePreference({ intervalDays: Math.max(1, Math.min(60, Math.floor(Number(e.target.value)) || 1)) })} slotProps={{ htmlInput: { min: 1, max: 60, step: 1 } }} />
            </Stack>
            <Typography variant="caption">Un tour sans visites supplémentaires demande environ {cycleWorkDays} jours de travail à votre rythme habituel. Les délais comptent les jours calendaires, y compris les week-ends. Réglages et reports sont mémorisés sur cet appareil.</Typography>
            {rotation.suggestedGoal > Math.min(rotation.total, usualGoal) && <Alert severity="warning" sx={{ "& .MuiAlert-message": { minWidth: 0 } }}>
              <Typography variant="body2">Rythme conseillé : {rotation.suggestedGoal} contrôles par jour calendaire en moyenne, pour la couverture régulière et les suivis à 4 jours. Prévoyez davantage les jours travaillés si vous ne passez pas chaque jour.</Typography>
              <Button disabled={!config} onClick={() => changePreference({ dailyGoal: rotation.suggestedGoal, extendedDay: undefined, extendedGoal: undefined })} sx={{ mt: 1, minHeight: 44 }}>Adopter {rotation.suggestedGoal} par jour</Button>
            </Alert>}
          </Stack>}
          {rotation.plan.length ? <>
            <Button variant="contained" size="large" onClick={() => setRoom(rotation.plan[0])} disabled={!config}>Continuer la tournée · chambre {rotation.plan[0]}</Button>
            <Box role="group" aria-label="Chambres de la tournée" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(3, minmax(0, 1fr))", sm: "repeat(5, minmax(0, 1fr))" }, gridAutoRows: "1fr", gap: 1 }}>
              {rotation.plan.map((n, index) => {
                const priority = rotation.priorityRooms.includes(n);
                const detail = rotation.byRoom.get(n)!;
                return <Button key={n} variant="outlined" color={priority ? "warning" : "primary"} onClick={() => setRoom(n)}
                  aria-label={`Ouvrir la chambre ${n} dans la tournée`} aria-describedby={`rotation-status-${n}`}
                  sx={{ minWidth: 0, minHeight: 96, height: "100%", width: "100%", px: 0.5, py: 1 }}>
                  <Stack spacing={0.25} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
                    <Typography component="strong" sx={{ fontWeight: 800, fontSize: 20, lineHeight: 1.3 }}>{n}</Typography>
                    <Typography variant="caption">{index === 0 ? "Suivante" : detail.lastComplete ? `${daysSince(detail.lastComplete, day)} j` : "Complet manquant"}</Typography>
                    <Typography id={`rotation-status-${n}`} variant="caption" sx={{ fontWeight: priority ? 700 : 400, lineHeight: 1.3 }}>{rotationReasons[detail.reason]}</Typography>
                  </Stack>
                </Button>;
              })}
            </Box>
          </> : <Alert severity={rotation.total ? "success" : "info"}>{!rotation.total ? "Toutes les chambres sont marquées libres. Aucune tournée à prévoir." : rotation.candidates.length && rotation.done.length >= rotation.goal ? "Objectif du jour atteint. Vous pouvez poursuivre si vous avez encore du temps." : rotation.due.length ? "Les chambres restantes ont été reportées. Vous pouvez les reprendre ci-dessous." : "Tous les contrôles prévus sont à jour. Les prochains suivis restent programmés."}</Alert>}
          {rotation.done.length >= rotation.goal && extraCount > 0 && <Button variant="contained" disabled={!config} onClick={extendTour} sx={{ minHeight: 48 }}>Ajouter {extraCount} chambre{extraCount > 1 ? "s" : ""} à la tournée</Button>}
          {rotation.candidates.length > rotation.plan.length && <Typography variant="body2" color="text.secondary">{rotation.candidates.length - rotation.plan.length} chambre(s) à contrôler restent après cette tournée. Elles gardent leur place dans la file.</Typography>}
          {rotation.due.length > 0 && <Button variant="text" onClick={() => showRooms("due")} sx={{ alignSelf: "flex-start", minHeight: 44 }}>Voir toutes les chambres à contrôler ({rotation.due.length})</Button>}
          {visibleDeferred.length > 0 && <details><summary style={{ cursor: "pointer" }}>{visibleDeferred.length} chambre(s) reportée(s) aujourd’hui</summary><Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>{visibleDeferred.map(n => <Button key={n} onClick={() => { changePreference({ deferred: deferred.filter(item => item !== n) }); setRoom(n); }}>Reprendre {n}</Button>)}</Stack></details>}
          {rotation.waitingPoorRooms.length > 0 && <details>
            <summary style={{ cursor: "pointer" }}>Suivis de mauvais état à venir ({rotation.waitingPoorRooms.length})</summary>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Le suivi attend 4 jours après la dernière visite. Un contrôle complet manquant ou en retard reste à faire.</Typography>
            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>{rotation.waitingPoorRooms.map(n => <Button key={n} variant="outlined" onClick={() => setRoom(n)} sx={{ minHeight: 44 }}>Ch. {n} · {displayDate(rotation.byRoom.get(n)!.waitingUntil!)}</Button>)}</Stack>
          </details>}
        </Stack>
      </Paper>
      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button variant="outlined" onClick={() => setHistoryRoom("all")}>Historique de tous les contrôles</Button>
        <Button variant="outlined" onClick={() => setPrinting(true)}>Imprimer le checklist (PDF)</Button>
        <Button variant="outlined" disabled={exporting || !free.length} onClick={() => void exportFreeRooms()}>{exporting ? "Préparation du PDF…" : `Exporter en PDF · Chambres libres (${free.length})`}</Button>
      </Stack>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      <Stack spacing={1.5} id="room-checklist-filters" sx={{ scrollMarginTop: 88 }}>
        <Typography variant="body2" color="text.secondary">Les chambres marquées libres sont exclues du checklist et de la tournée. Les chambres dont l’occupation n’est pas renseignée restent affichées. Une chambre réapparaît dès qu’elle est marquée occupée.</Typography>
        <Button component={Link} href="/occupation" variant="text" sx={{ alignSelf: "flex-start", minHeight: 44 }}>Occupation des chambres</Button>
        <Typography variant="caption" color="text.secondary">Décochez « Occupée » pour marquer une chambre libre et la retirer de cette liste. Un trait indique une occupation inconnue.</Typography>
        <TextField label="Rechercher une chambre" value={search} onChange={e => setSearch(e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }} role="group" aria-label="Filtrer par étage">{["all", ...roomGroups.map(g => g.label)].map(g => <Chip key={g} label={g === "all" ? "Tous les étages" : g} onClick={() => setGroup(g)} aria-pressed={group === g} color={group === g ? "primary" : "default"} variant={group === g ? "filled" : "outlined"} />)}</Stack>
        <Box role="group" aria-label="Filtrer par occupation" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
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
          <Typography variant="body2" color="text.secondary" role="status">{visibleCount} chambre(s) affichée(s) sur {rotation.total}</Typography>
          <Button size="small" disabled={!hasFilters} onClick={() => { setSearch(""); setGroup("all"); setFilter("all"); }}>Réinitialiser les filtres</Button>
        </Stack>
      </Stack>
      {rotation.total > 0 && !visibleGroups.length && <Alert severity="info">Aucune chambre ne correspond à ces filtres.</Alert>}
      {visibleGroups.map(g => <Box component="section" key={g.label} aria-label={g.label}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{g.label} · {g.rooms.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 155px), 1fr))", gridAutoRows: "1fr", gap: 1.5 }}>
          {g.rooms.map(n => {
            const record = latest.get(n), open = openByRoom.get(n) || [], done = rotation.done.includes(n), target = rotation.plan.includes(n), priority = rotation.priorityRooms.includes(n);
            const detail = rotation.byRoom.get(n)!;
            const borderColor = availability.get(n) === false ? "info.main" : "grey.400";
            return <Paper component="article" key={n} aria-label={`Chambre ${n}`} variant="outlined" sx={{ p: 1.5, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", borderColor: "divider", borderTop: "4px solid", borderTopColor: borderColor }}>
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Stack direction="row" useFlexGap sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}><Typography variant="h4" component="h3" sx={{ fontSize: 36, lineHeight: 1.2, fontWeight: 800 }}>{n}</Typography>{done && <Chip label="Fait" color="success" size="small" />}</Stack>
                <Typography variant="caption">{detail.lastComplete ? `Contrôle complet : ${displayDate(detail.lastComplete)}` : "Sans contrôle complet"}</Typography>
                {record && !completeRoomInspection(record) && <Typography variant="caption" color="text.secondary">Visite partielle : {displayDate(record.date)}</Typography>}
                {detail.reason === "overdue" && <Typography variant="caption" color="warning.main">Contrôle complet en retard</Typography>}
                {priority && <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>Mauvais état · suivi à faire</Typography>}
                {detail.waitingUntil && <Typography variant="caption" color="text.secondary">Mauvais état · suivi le {displayDate(detail.waitingUntil)}</Typography>}
                {detail.reason === "scheduled" && detail.dueOn && !detail.waitingUntil && <Typography variant="caption" color="text.secondary">Prochain contrôle : {displayDate(detail.dueOn)}</Typography>}
                <RoomAvailabilityCheckbox room={n} availability={availabilityStates.get(n)!} inspection={record} inspectionPending={!!record && pendingIds.has(record.id)} />
                {record?.occupied === false && <Typography variant="caption">Dernier contrôle · Ménage {cleaningText(record).toLowerCase()}</Typography>}
                {open.length > 0 && <Chip label={`${open.length} problème${open.length > 1 ? "s" : ""} technique${open.length > 1 ? "s" : ""}`} color="warning" size="small" variant="outlined" sx={{ maxWidth: "100%", height: "auto", minHeight: 24, "& .MuiChip-label": { whiteSpace: "normal", lineHeight: 1.4, py: 0.25 } }} />}
                {queued.some(q => q.room === n) && <Typography variant="caption" color="warning.main">Contrôle en attente d’envoi</Typography>}
                {visibleDeferred.includes(n) && <Typography variant="caption">Reportée à demain</Typography>}
                <Box sx={{ flex: 1 }} />
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
