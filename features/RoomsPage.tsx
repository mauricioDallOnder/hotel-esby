"use client";
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
import { issueRoom } from "@/lib/roomIssueMatching";
import { defaultIssueFilters, selectIssues } from "@/lib/issueView";
import { RoomAvailabilityCheckbox } from "@/components/RoomAvailabilityCheckbox";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { roomAvailabilityView } from "@/lib/roomAvailabilityView";
import { useDeviceDraft } from "@/lib/useDeviceDraft";

type Preferences = { dailyGoal: number; intervalDays: number; deferredDay: string; deferred: string[]; extendedDay?: string; extendedGoal?: number };
const filters = { all: "Toutes", occupied: "Occupées", unknown: "Non renseignées", uncovered: "Contrôle complet à prévoir", partial: "Visites partielles du jour", target: "Tournée du jour", due: "À contrôler", never: "Sans contrôle complet", problems: "Problèmes techniques" };
const occupancyFilters = ["all", "occupied", "unknown"] as const;
const workflowFilters = ["target", "due", "uncovered", "partial", "never", "problems"] as const;
const filterColors = { all: "primary", occupied: "info", unknown: "inherit" } as const;
const rotationReasons = { never: "À compléter", overdue: "En retard", followup: "Suivi · 4 j", scheduled: "Planifié", done: "Fait" } as const;
export default function RoomsPage() {
  const { roomInspections = [], issues, hotelName } = useAppContext();
  const { pending, reviewPending } = useEntries();
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
    const savedIds = new Set(roomInspections.map(record => record.id));
    return [...roomInspections, ...queued.filter(record => !savedIds.has(record.id))];
  }, [queued, roomInspections]);
  const confirmedToday = useMemo(() => new Set(roomInspections.filter(record => record.date === day && completeRoomInspection(record)).map(record => record.room)), [roomInspections, day]);
  const { latest, history: currentHistory, pendingIds } = useMemo(() => roomObservations(roomInspections, pending, day), [roomInspections, pending, day]);
  const blockedToday = new Map<string, string>();
  const pendingStatus = new Map<string, string>();
  for (const { entry, blocked } of pending) {
    if (entry.type !== "createRoomInspection") continue;
    if (blocked) {
      pendingStatus.set(entry.room, "Contrôle à vérifier dans les envois");
      if (entry.date === day && !blockedToday.has(entry.room)) blockedToday.set(entry.room, entry.id);
    } else if (pendingIds.has(entry.id) && !pendingStatus.has(entry.room)) {
      pendingStatus.set(entry.room, "Contrôle en attente d’envoi");
    }
  }
  const availabilityStates = useMemo(() => roomAvailabilityView(workEvents, latest), [workEvents, latest]);
  const availability = useMemo(() => new Map([...availabilityStates].map(([room, state]) => [room, state.free])), [availabilityStates]);
  const eligibleRooms = useMemo(() => rooms.filter(n => availability.get(n) !== true), [availability]);
  const eligible = new Set(eligibleRooms);
  const rotation = useMemo(() => roomRotation(currentHistory, day, dailyTarget, config?.intervalDays, deferred, eligibleRooms), [currentHistory, day, dailyTarget, config?.intervalDays, deferred, eligibleRooms]);
  const openByRoom = useMemo(() => {
    const counts = new Map(rooms.map(n => [n, { technical: 0, room_clutter: 0, cafards: 0 }]));
    for (const kind of ["technical", "room_clutter", "cafards"] as const) {
      for (const issue of selectIssues(issues, { ...defaultIssueFilters, kind })) {
        const roomCounts = counts.get(issueRoom(issue) || "");
        if (roomCounts) roomCounts[kind]++;
      }
    }
    return counts;
  }, [issues]);
  const visibleDeferred = deferred.filter(n => eligible.has(n) && !rotation.done.includes(n));
  const free = rooms.filter(n => availabilityStates.get(n)?.vacancyReason === "available");
  const hasWorks = rooms.some(n => availabilityStates.get(n)?.vacancyReason === "works");
  const emptyRotationMessage = hasWorks ? "Les chambres sont libres ou en travaux. Aucune tournée à prévoir." : "Toutes les chambres sont marquées libres. Aucune tournée à prévoir.";
  const hasPendingControls = currentHistory.some(record => record.date === day && eligible.has(record.room) && pendingIds.has(record.id) && completeRoomInspection(record));
  const nextRoom = room && eligible.has(room) ? rotation.plan.find(n => n !== room) : undefined;
  const uncovered = new Set([...rotation.neverRooms, ...rotation.overdueRooms]);
  const extraCount = Math.min(5, rotation.candidates.length);
  const cycleWorkDays = rotation.total ? Math.ceil(rotation.total / Math.min(rotation.total, usualGoal)) : 0;
  function openControl(n: string | null) {
    const blockedId = n && blockedToday.get(n);
    if (blockedId) {
      setRoom(null);
      reviewPending(blockedId);
    } else setRoom(n);
  }
  function changePreference(patch: Partial<Preferences>) { if (config) preferences.update({ ...config, ...patch }); }
  function extendTour() {
    if (!config || !extraCount) return;
    changePreference({ extendedDay: day, extendedGoal: Math.min(rotation.total, Math.max(rotation.goal, rotation.done.length) + extraCount) });
    setMessage(`${extraCount} chambre(s) ajoutée(s) à la tournée d’aujourd’hui. Votre objectif habituel reste ${usualGoal} par jour.`);
  }
  function showRooms(nextFilter: keyof typeof filters, floor = "all") {
    setSearch(""); setGroup(floor); setFilter(nextFilter);
    document.getElementById("room-checklist-filters")?.scrollIntoView({ block: "start" });
  }
  function deferRoom() {
    if (!room || !config) return;
    changePreference({ deferredDay: day, deferred: [...new Set([...deferred, room])] });
    setMessage(`Chambre ${room} reportée à demain. Son brouillon est conservé ; elle n’est pas comptée comme contrôlée.`);
    openControl(rotation.done.length < rotation.goal ? rotation.candidates.find(n => n !== room) || null : null);
  }
  async function exportFreeRooms() {
    setExporting(true); setExportError("");
    try { const { downloadFreeRoomsReport } = await import("@/lib/roomPdfExport"); await downloadFreeRoomsReport({ hotelName, history: currentHistory, workEvents }); }
    catch (error) { setExportError((error as Error).message); }
    finally { setExporting(false); }
  }
  const matchingGroups = roomGroups.filter(g => group === "all" || group === g.label)
    .map(g => ({ ...g, rooms: g.rooms.filter(n => n.includes(search.trim())) }));
  const scopedGroups = matchingGroups.map(g => ({ ...g, rooms: g.rooms.filter(n => eligible.has(n)) }));
  const outsideTour = filter === "all" ? matchingGroups.flatMap(g => g.rooms.filter(n => !eligible.has(n))) : [];
  const scopedRooms = scopedGroups.flatMap(g => g.rooms);
  const counts = {
    all: scopedRooms.length,
    occupied: scopedRooms.filter(n => availability.get(n) === false).length,
    unknown: scopedRooms.filter(n => availability.get(n) === undefined).length,
  };
  const visibleGroups = scopedGroups.map(g => ({ ...g, rooms: g.rooms.filter(n => {
    if (filter === "uncovered") return uncovered.has(n);
    if (filter === "partial") return rotation.partialToday.includes(n);
    if (filter === "target") return rotation.plan.includes(n);
    if (filter === "due") return rotation.due.includes(n);
    if (filter === "never") return rotation.neverRooms.includes(n);
    if (filter === "problems") return !!openByRoom.get(n)?.technical;
    if (filter === "occupied") return availability.get(n) === false;
    if (filter === "unknown") return availability.get(n) === undefined;
    return true;
  }) })).filter(g => g.rooms.length);
  const visibleCount = visibleGroups.reduce((count, g) => count + g.rooms.length, 0);
  const hasFilters = !!search || group !== "all" || filter !== "all";
  return <>
    <ConnectionBar />
    <PageTitle title="Contrôle des chambres" description="Repérez les chambres à visiter et poursuivez la tournée du jour." />
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
          <Typography variant="body2" color="text.secondary">La tournée présente d’abord les chambres sans contrôle complet, puis les échéances les plus anciennes. Une visite partielle du jour laisse la place aux chambres restant à visiter.</Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
            <Chip label={`${rotation.due.length} à contrôler`} onClick={() => showRooms("due")} color={rotation.due.length ? "primary" : "default"} variant="outlined" />
            <Chip label={`${rotation.neverRooms.length} sans contrôle complet`} onClick={() => showRooms("never")} variant="outlined" />
            {rotation.partialToday.length > 0 && <Chip label={`${rotation.partialToday.length} visite(s) partielle(s) aujourd’hui`} onClick={() => showRooms("partial")} variant="outlined" />}
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
            <Button variant="contained" size="large" onClick={() => openControl(rotation.plan[0])} disabled={!config}>Continuer la tournée · chambre {rotation.plan[0]}</Button>
            <Box role="group" aria-label="Chambres de la tournée" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(3, minmax(0, 1fr))", sm: "repeat(5, minmax(0, 1fr))" }, gridAutoRows: "1fr", gap: 1 }}>
              {rotation.plan.map((n, index) => {
                const priority = rotation.priorityRooms.includes(n);
                const detail = rotation.byRoom.get(n)!;
                return <Button key={n} variant="outlined" color={priority ? "warning" : "primary"} onClick={() => openControl(n)}
                  aria-label={`Ouvrir la chambre ${n} dans la tournée`} aria-describedby={`rotation-status-${n}`}
                  sx={{ minWidth: 0, minHeight: 96, height: "100%", width: "100%", px: 0.5, py: 1 }}>
                  <Stack spacing={0.25} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
                    <Typography component="strong" sx={{ fontWeight: 800, fontSize: 20, lineHeight: 1.3 }}>{n}</Typography>
                    <Typography variant="caption">{index === 0 ? "Suivante" : detail.lastComplete ? `${daysSince(detail.lastComplete, day)} j` : "Complet manquant"}</Typography>
                    <Typography id={`rotation-status-${n}`} variant="caption" sx={{ fontWeight: priority ? 700 : 400, lineHeight: 1.3 }}>{blockedToday.has(n) ? "Envoi à vérifier" : rotationReasons[detail.reason]}</Typography>
                  </Stack>
                </Button>;
              })}
            </Box>
          </> : <Alert severity={rotation.total && !hasPendingControls ? "success" : "info"}>{!rotation.total ? emptyRotationMessage : hasPendingControls ? "Des contrôles de la tournée attendent la confirmation du serveur." : rotation.candidates.length && rotation.done.length >= rotation.goal ? "Objectif du jour atteint. Vous pouvez poursuivre si vous avez encore du temps." : rotation.due.length ? "Les chambres restantes ont été reportées. Vous pouvez les reprendre ci-dessous." : "Tous les contrôles prévus sont à jour. Les prochains suivis restent programmés."}</Alert>}
          {rotation.done.length >= rotation.goal && extraCount > 0 && <Button variant="contained" disabled={!config} onClick={extendTour} sx={{ minHeight: 48 }}>Ajouter {extraCount} chambre{extraCount > 1 ? "s" : ""} à la tournée</Button>}
          {rotation.candidates.length > rotation.plan.length && <Typography variant="body2" color="text.secondary">{rotation.candidates.length - rotation.plan.length} chambre(s) à contrôler restent après cette tournée. Elles gardent leur place dans la file.</Typography>}
          {rotation.due.length > 0 && <Button variant="text" onClick={() => showRooms("due")} sx={{ alignSelf: "flex-start", minHeight: 44 }}>Voir toutes les chambres à contrôler ({rotation.due.length})</Button>}
          {visibleDeferred.length > 0 && <details><summary style={{ cursor: "pointer" }}>{visibleDeferred.length} chambre(s) reportée(s) aujourd’hui</summary><Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>{visibleDeferred.map(n => <Button key={n} onClick={() => { changePreference({ deferred: deferred.filter(item => item !== n) }); openControl(n); }}>Reprendre {n}</Button>)}</Stack></details>}
          {rotation.waitingPoorRooms.length > 0 && <details>
            <summary style={{ cursor: "pointer" }}>Suivis de mauvais état à venir ({rotation.waitingPoorRooms.length})</summary>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Le suivi attend 4 jours après la dernière visite. Un contrôle complet manquant ou en retard reste à faire.</Typography>
            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>{rotation.waitingPoorRooms.map(n => <Button key={n} variant="outlined" onClick={() => openControl(n)} sx={{ minHeight: 44 }}>Ch. {n} · {displayDate(rotation.byRoom.get(n)!.waitingUntil!)}</Button>)}</Stack>
          </details>}
        </Stack>
      </Paper>
      <Paper component="section" aria-label="Couverture par étage" variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Stack spacing={1.5}>
          <Typography variant="h6" component="h2">Couverture par étage</Typography>
          <Typography variant="body2"><strong>{rotation.covered} / {rotation.total}</strong> chambres de la tournée avec un contrôle complet dans les {rotation.interval} derniers jours.</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
            {roomGroups.map(floor => {
              const active = floor.rooms.filter(n => eligible.has(n));
              const remaining = active.filter(n => uncovered.has(n)).length;
              return <Box key={floor.label} sx={{ p: 1.5, border: 1, borderRadius: 1, borderColor: "divider" }}>
                <Typography variant="subtitle2">{floor.label}</Typography>
                <Typography variant="body2">{active.length - remaining} / {active.length} contrôlées</Typography>
                {remaining > 0 && <Button size="small" onClick={() => showRooms("uncovered", floor.label)}
                  aria-label={`Voir les ${remaining} chambres à couvrir · ${floor.label}`}>Voir les chambres à couvrir ({remaining})</Button>}
              </Box>;
            })}
          </Box>
        </Stack>
      </Paper>
      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button variant="outlined" onClick={() => setHistoryRoom("all")}>Historique de tous les contrôles</Button>
        <Button variant="outlined" onClick={() => setPrinting(true)}>Imprimer le checklist (PDF)</Button>
        <Button variant="outlined" disabled={exporting || !free.length} onClick={() => void exportFreeRooms()}>{exporting ? "Préparation du PDF…" : `Exporter en PDF · Chambres libres (${free.length})`}</Button>
      </Stack>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      <Stack spacing={1.5} id="room-checklist-filters" sx={{ scrollMarginTop: 88 }}>
        <Typography variant="body2" color="text.secondary">La tournée inclut les chambres occupées et celles dont l’occupation reste à renseigner.</Typography>
        <Typography variant="caption" color="text.secondary">Décochez « Occupée », choisissez « Libre » ou « En travaux », puis enregistrez. Une observation peut être ajoutée. Un trait indique une occupation inconnue.</Typography>
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
      {outsideTour.length > 0 && <details key={search.trim() ? "search" : "browse"} open={search.trim() ? true : undefined}>
        <summary style={{ cursor: "pointer" }}>Contrôle manuel · chambres libres ou en travaux ({outsideTour.length})</summary>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
          {outsideTour.map(n => <Button key={n} variant="outlined" onClick={() => openControl(n)} aria-label={`Contrôle manuel de la chambre ${n}`}>
            {n} · {availabilityStates.get(n)?.vacancyReason === "works" ? "En travaux" : "Libre"}</Button>)}
        </Stack>
      </details>}
      {rotation.total > 0 && !visibleGroups.length && !outsideTour.length && <Alert severity="info">Aucune chambre ne correspond à ces filtres.</Alert>}
      {visibleGroups.map(g => <Box component="section" key={g.label} aria-label={g.label}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{g.label} · {g.rooms.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 155px), 1fr))", gridAutoRows: "1fr", gap: 1.5 }}>
          {g.rooms.map(n => {
            const record = latest.get(n), open = openByRoom.get(n)!, done = rotation.done.includes(n), target = rotation.plan.includes(n), priority = rotation.priorityRooms.includes(n);
            const detail = rotation.byRoom.get(n)!;
            const borderColor = availability.get(n) === false ? "info.main" : "grey.400";
            return <Paper component="article" key={n} aria-label={`Chambre ${n}`} variant="outlined" sx={{ p: 1.5, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", borderColor: "divider", borderTop: "4px solid", borderTopColor: borderColor }}>
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Stack direction="row" useFlexGap sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}><Typography variant="h4" component="h3" sx={{ fontSize: 36, lineHeight: 1.2, fontWeight: 800 }}>{n}</Typography>{confirmedToday.has(n) && <Chip label="Fait" color="success" size="small" />}</Stack>
                <Typography variant="caption">{detail.lastComplete ? `Contrôle complet : ${displayDate(detail.lastComplete)}` : "Sans contrôle complet"}</Typography>
                {record && !completeRoomInspection(record) && <Typography variant="caption" color="text.secondary">Visite partielle : {displayDate(record.date)}</Typography>}
                {detail.reason === "overdue" && <Typography variant="caption" color="warning.main">Contrôle complet en retard</Typography>}
                {priority && <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>Mauvais état · suivi à faire</Typography>}
                {detail.waitingUntil && <Typography variant="caption" color="text.secondary">Mauvais état · suivi le {displayDate(detail.waitingUntil)}</Typography>}
                {detail.reason === "scheduled" && detail.dueOn && !detail.waitingUntil && <Typography variant="caption" color="text.secondary">Prochain contrôle : {displayDate(detail.dueOn)}</Typography>}
                <RoomAvailabilityCheckbox room={n} availability={availabilityStates.get(n)!} inspection={record} inspectionPending={!!record && pendingIds.has(record.id)} />
                {record?.occupied === false && <Typography variant="caption">Dernier contrôle · Ménage {cleaningText(record).toLowerCase()}</Typography>}
                {open.technical > 0 && <Chip label={`${open.technical} problème${open.technical > 1 ? "s" : ""} technique${open.technical > 1 ? "s" : ""}`} color="warning" size="small" variant="outlined" sx={{ maxWidth: "100%", height: "auto", minHeight: 24, "& .MuiChip-label": { whiteSpace: "normal", lineHeight: 1.4, py: 0.25 } }} />}
                {open.room_clutter > 0 && <Chip label="Chambre encombrée" color="warning" size="small" variant="outlined" />}
                {open.cafards > 0 && <Chip label="Suivi cafards" color="warning" size="small" variant="outlined" />}
                {pendingStatus.has(n) && <Typography variant="caption" color="warning.main">{pendingStatus.get(n)}</Typography>}
                {visibleDeferred.includes(n) && <Typography variant="caption">Reportée à demain</Typography>}
                <Box sx={{ flex: 1 }} />
                <Button variant={target ? "contained" : "outlined"} onClick={() => openControl(n)} aria-label={`${blockedToday.has(n) ? "Reprendre le contrôle de" : "Contrôler"} la chambre ${n}`} sx={{ minHeight: 48 }}>{blockedToday.has(n) ? "Reprendre le contrôle" : done ? "Recontrôler" : "Contrôler"}</Button>
                <Button aria-label={`Historique de la chambre ${n}`} onClick={() => setHistoryRoom(n)}>Historique</Button>
              </Stack>
            </Paper>;
          })}
        </Box>
      </Box>)}
    </Stack>
    {room && <RoomInspectionDialog key={room} room={room} nextRoom={nextRoom} onClose={() => setRoom(null)} onDefer={eligible.has(room) ? deferRoom : undefined} onSaved={(next, visitDate) => { setMessage(`Contrôle de la chambre ${room} du ${displayDate(visitDate)} conservé. Le statut d’envoi reste visible jusqu’à la confirmation du serveur.`); openControl(next ? nextRoom || null : null); }} />}
    {historyRoom && <RoomHistoryDialog key={historyRoom} room={historyRoom === "all" ? undefined : historyRoom} history={history} issues={issues} onClose={() => setHistoryRoom(null)} />}
    {printing && <RoomChecklistPrintDialog hotelName={hotelName} selectedRooms={visibleGroups.flatMap(g => g.rooms)} tour={rotation.plan.map(n => rotation.byRoom.get(n)!)} history={history} date={day} blockedIds={pending.filter(p => p.blocked).map(p => p.entry.id)} onClose={() => setPrinting(false)} />}
  </>;
}
