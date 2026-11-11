"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, InputAdornment, LinearProgress, Paper, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import LocalLaundryServiceOutlined from "@mui/icons-material/LocalLaundryServiceOutlined";
import DryCleaningOutlined from "@mui/icons-material/DryCleaningOutlined";
import Search from "@mui/icons-material/Search";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { LaundryCycleDialog, type LaundryAction } from "@/components/LaundryCycleDialog";
import { LaundryNotificationSettings } from "@/components/LaundryNotificationSettings";
import { useEntries } from "@/context/EntriesContext";
import { laundryCycles, laundryMachineStates, laundryPhase } from "@/lib/laundry";
import { useWorkEvents } from "@/lib/useWorkEvents";

type MachineState = ReturnType<typeof laundryMachineStates>[number];
const phaseLabels = { available: "Libre", running: "En cours", soon: "Bientôt terminé", ready: "À récupérer", collected: "Récupéré", cancelled: "Annulé" } as const;
const statusFilters = { all: "Tous les cycles", active: "En cours / à retirer", collected: "Linge retiré", cancelled: "Annulés" } as const;
const colors = { available: "success", running: "info", soon: "warning", ready: "warning", collected: "success", cancelled: "default" } as const;

function phaseLabel(phase: keyof typeof phaseLabels, kind?: "washer" | "dryer") {
  if (kind === "washer" && phase === "ready") return "Prêt à sécher";
  if (kind === "washer" && phase === "collected") return "Lavage terminé";
  return phaseLabels[phase];
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
}
function clockTime(value: string) {
  return new Date(value).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
}
function dateOnly(value: string) {
  return new Date(value).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}
function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return now;
}

function MachineCard({ state, pending, ready, blocked, onReview, onAction }: {
  state: MachineState; pending: boolean; ready: boolean; blocked: boolean; onReview: () => void; onAction: (action: LaundryAction) => void;
}) {
  const { machine, cycle, phase } = state;
  const active = !!cycle && cycle.status === "en_cours";
  const color = colors[phase];
  return <Paper component="article" aria-label={machine.label} variant="outlined" sx={{ p: 2.5, minWidth: 0, borderTop: "4px solid", borderTopColor: color === "default" ? "divider" : color + ".main", height: "100%" }}>
    <Stack spacing={2} sx={{ height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">{machine.kind === "washer" ? `Lavage · ${machine.capacityKg} kg` : "Séchage"}</Typography>
          <Typography component="h3" variant="h6" sx={{ fontWeight: 800 }}>{machine.label}</Typography>
        </Box>
        <Chip label={phaseLabel(phase, machine.kind)} color={color} size="small" variant="outlined" sx={{ mt: 0.5 }} />
      </Stack>
      <Typography variant="body2" color="text.secondary">{machine.program}{machine.kind === "washer" ? ` · ${cycle?.initialDurationMinutes ?? machine.durationMinutes} min` : ""}</Typography>
      {blocked && <Alert severity="warning" sx={{ "& .MuiAlert-message": { minWidth: 0 } }}>
        <Typography variant="body2">Une demande en attente doit être vérifiée avant de modifier cette machine.</Typography>
        <Button color="inherit" onClick={onReview} sx={{ mt: 0.5, px: 0, minHeight: 44 }}>Vérifier la demande</Button>
      </Alert>}
      {active ? <>
        <Box sx={{ p: 1.75, bgcolor: "action.hover", borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary">Linge de la chambre</Typography>
          <Typography variant="h3" component="p" sx={{ fontWeight: 800, letterSpacing: -1, lineHeight: 1.15 }}>{cycle.room}</Typography>
          {cycle.owner && <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 600, overflowWrap: "anywhere" }}>{cycle.owner}</Typography>}
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">{phase === "ready" ? "Temps prévu écoulé" : "Temps restant · min : s"}</Typography>
          <Typography variant="h4" component="p" aria-label={phase === "ready" ? "Temps écoulé" : "Temps restant"} sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, color: phase === "ready" || phase === "soon" ? "warning.dark" : "text.primary" }}>
            {phase === "ready" ? "Terminé" : countdown(state.remainingMs)}
          </Typography>
          <LinearProgress variant="determinate" value={state.progress} color={phase === "ready" || phase === "soon" ? "warning" : "primary"} aria-label={`Avancement · ${machine.label}`} sx={{ mt: 1, height: 6, borderRadius: 4 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Fin prévue à {clockTime(cycle.endsAt)}</Typography>
          {cycle.addedMinutes > 0 && <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>+{cycle.addedMinutes} min ajoutées</Typography>}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>Démarré le {dateTime(cycle.startedAt)} · {cycle.actor}</Typography>
        </Box>
        {cycle.notes && <Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{cycle.notes}</Typography>}
        {pending && <Typography role="status" variant="caption" color="warning.main">En attente d’envoi · suivi conservé sur cet appareil</Typography>}
        <Box sx={{ flexGrow: 1 }} />
        {phase === "ready" && <Typography variant="body2" sx={{ fontWeight: 700 }}>{machine.kind === "washer"
          ? "Le linge est prêt à passer au séchage. Retirez-le avant de libérer la machine à laver."
          : "Le linge attend dans la machine. Retirez-le avant de libérer la place."}</Typography>}
        <Button variant="outlined" disabled={!ready || blocked} onClick={() => onAction("extend")} sx={{ minHeight: 48 }}>Ajouter du temps</Button>
        <Button variant={phase === "ready" ? "contained" : "outlined"} disabled={!ready || blocked} onClick={() => onAction("collect")} sx={{ minHeight: 48 }}>{machine.kind === "washer" ? "Terminé · prêt à sécher" : "Linge récupéré"}</Button>
        <Button color="inherit" disabled={!ready || blocked} onClick={() => onAction("cancel")} sx={{ minHeight: 44 }}>Annuler le cycle</Button>
      </> : <>
        <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: "center", flexGrow: 1 }}>
          {machine.kind === "washer" ? <LocalLaundryServiceOutlined color="action" /> : <DryCleaningOutlined color="action" />}
          <Typography variant="body2" color="text.secondary">Prête pour un nouveau linge</Typography>
        </Stack>
        <Button variant="contained" disabled={!ready || blocked} onClick={() => onAction("start")} sx={{ minHeight: 48 }}>Démarrer</Button>
      </>}
    </Stack>
  </Paper>;
}

export default function LaundryPage() {
  const { events, isPending, queued } = useWorkEvents();
  const { ready, reviewLaundry } = useEntries();
  const blockedMachines = new Map(queued.filter(item => item.blocked && item.entry.type === "createWorkEvent" && item.entry.kind === "laundryCycle")
    .map(item => [item.entry.type === "createWorkEvent" ? item.entry.targetId : "", item.entry.id]));
  const now = useClock();
  const states = laundryMachineStates(events, now);
  const cycles = laundryCycles(events);
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<keyof typeof statusFilters>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saved, setSaved] = useState("");
  const [dialog, setDialog] = useState<{ action: LaundryAction; state: MachineState } | null>(null);
  const activeCount = states.filter(state => ["running", "soon"].includes(state.phase)).length;
  const awaitingCount = states.filter(state => state.phase === "ready").length;
  const availableCount = states.filter(state => state.phase === "available").length;
  const text = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  const visibleHistory = cycles.filter(cycle => {
    const machine = states.find(state => state.machine.id === cycle.machineId)?.machine;
    const haystack = `${cycle.room} ${cycle.owner} ${cycle.actor} ${cycle.collectedBy} ${machine?.label} ${cycle.notes}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
    return (!text || haystack.includes(text)) && (!from || dateOnly(cycle.startedAt) >= from) && (!to || dateOnly(cycle.startedAt) <= to) &&
      (filter === "all" || filter === "active" && cycle.status === "en_cours" || filter === "collected" && cycle.status === "recupere" || filter === "cancelled" && cycle.status === "annule");
  });
  const currentDialog = dialog && states.find(state => state.machine.id === dialog.state.machine.id);
  const unchanged = !!currentDialog && !!dialog && currentDialog.revision === dialog.state.revision &&
    !blockedMachines.has(dialog.state.machine.id) &&
    (dialog.action === "start" ? currentDialog.phase === "available" : currentDialog.cycle?.cycleId === dialog.state.cycle?.cycleId);
  return <>
    <ConnectionBar />
    <PageTitle title="Lingerie" description="Une machine, une chambre : suivez les cycles et la récupération du linge." />
    <Stack spacing={3}>
      {saved && <Alert severity="success" onClose={() => setSaved("")}>{saved} Le statut d’envoi reste indiqué jusqu’à la confirmation du serveur.</Alert>}
      <LaundryNotificationSettings />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }} aria-label="État des machines">
        {[{ label: "Libres", count: availableCount, color: "success.main" }, { label: "En cours", count: activeCount, color: "info.main" }, { label: "À retirer", count: awaitingCount, color: "warning.main" }].map(item => <Paper key={item.label} variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
          <Typography variant="h4" component="p" sx={{ color: item.color, fontWeight: 800 }}>{ready ? item.count : "—"}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.label}</Typography>
        </Paper>)}
      </Box>
      <Tabs value={tab} onChange={(_, value: number) => setTab(value)} aria-label="Consulter la lingerie" variant="fullWidth">
        <Tab label="Machines" id="laundry-machines-tab" aria-controls="laundry-machines-panel" />
        <Tab label={`Historique (${cycles.length})`} id="laundry-history-tab" aria-controls="laundry-history-panel" />
      </Tabs>
      {!ready ? <Typography role="status">Chargement des cycles conservés sur cet appareil…</Typography> : tab === 0 ? <Box role="tabpanel" id="laundry-machines-panel" aria-labelledby="laundry-machines-tab">
        <Stack spacing={4}>
          <Typography variant="body2" color="text.secondary">La fin du minuteur indique que le programme devrait être terminé. La machine reste occupée jusqu’à la confirmation du retrait du linge.</Typography>
          {(["washer", "dryer"] as const).map(kind => <Box component="section" key={kind} aria-label={kind === "washer" ? "Machines à laver" : "Machines à sécher"}>
            <Typography component="h2" variant="h6" sx={{ mb: 1.5, fontWeight: 800 }}>{kind === "washer" ? "Machines à laver" : "Machines à sécher"}</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 2, alignItems: "stretch" }}>
              {states.filter(state => state.machine.kind === kind).map(state => <MachineCard key={state.machine.id} state={state} ready={ready} pending={!!state.cycle && isPending(state.cycle.lastEventId)}
                blocked={blockedMachines.has(state.machine.id)} onReview={() => { const id = blockedMachines.get(state.machine.id); if (id) reviewLaundry(id); }}
                onAction={action => setDialog({ action, state })} />)}
            </Box>
          </Box>)}
        </Stack>
      </Box> : <Box role="tabpanel" id="laundry-history-panel" aria-labelledby="laundry-history-tab">
        <Stack spacing={2}>
          <TextField type="search" label="Rechercher du linge" placeholder="Chambre, nom, machine…" value={search} onChange={event => setSearch(event.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search /></InputAdornment> } }} />
          <TextField select label="État du cycle" value={filter} onChange={event => setFilter(event.target.value as keyof typeof statusFilters)} slotProps={{ select: { native: true } }}>
            {Object.entries(statusFilters).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField type="date" label="Démarré à partir du" value={from} onChange={event => setFrom(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField type="date" label="Démarré jusqu’au" value={to} onChange={event => setTo(event.target.value)} fullWidth error={!!from && !!to && to < from} helperText={from && to && to < from ? "La date de fin doit suivre la date de début." : undefined} slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="caption" color="text.secondary" role="status">{visibleHistory.length} cycle(s) · Les plus récents en premier</Typography>
            <Button disabled={!search && filter === "all" && !from && !to} onClick={() => { setSearch(""); setFilter("all"); setFrom(""); setTo(""); }}>Réinitialiser les filtres</Button>
          </Stack>
          {!visibleHistory.length ? <Alert severity="info">{cycles.length ? "Aucun cycle ne correspond à ces filtres." : "Les cycles et les récupérations du linge apparaîtront ici."}</Alert> : visibleHistory.map(cycle => {
            const machine = states.find(state => state.machine.id === cycle.machineId)?.machine;
            const phase = laundryPhase(cycle, now);
            return <Paper component="article" aria-label={`${machine?.label} · chambre ${cycle.room} · ${dateTime(cycle.startedAt)}`} key={cycle.cycleId} variant="outlined" sx={{ p: 2.5, minWidth: 0 }}>
              <Stack spacing={1.25}>
                <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                  <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>Chambre {cycle.room} · {machine?.label}</Typography>
                  <Chip label={phaseLabel(phase, machine?.kind)} color={colors[phase]} size="small" variant="outlined" />
                </Stack>
                {cycle.owner && <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{cycle.owner}</Typography>}
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Début : {dateTime(cycle.startedAt)} · {cycle.actor}</Typography>
                <Typography variant="body2" color="text.secondary">Durée initiale : {cycle.initialDurationMinutes} min{cycle.addedMinutes > 0 ? ` · +${cycle.addedMinutes} min ajoutées` : ""}</Typography>
                <Typography variant="body2" color="text.secondary">Fin prévue : {dateTime(cycle.endsAt)}</Typography>
                {cycle.addedMinutes > 0 && <Box component="ul" aria-label="Ajouts de temps" sx={{ m: 0, pl: 2.5 }}>
                  {cycle.history.filter(event => event.laundryAddedMinutes !== undefined).map(event => <Box component="li" key={event.id} sx={{ mb: 0.5 }}>
                    <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>+{event.laundryAddedMinutes} min le {dateTime(event.occurredAt)} · {event.actor}</Typography>
                  </Box>)}
                </Box>}
                {cycle.collectedAt && <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{machine?.kind === "washer" ? "Lavage terminé le" : "Linge récupéré le"} {dateTime(cycle.collectedAt)} · {cycle.collectedBy}</Typography>}
                {cycle.cancelledAt && <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Annulé le {dateTime(cycle.cancelledAt)} · {cycle.history[0]?.actor}</Typography>}
                {cycle.notes && <Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{cycle.notes}</Typography>}
                {isPending(cycle.lastEventId) && <Typography variant="caption" color="warning.main" role="status">En attente d’envoi</Typography>}
              </Stack>
            </Paper>;
          })}
        </Stack>
      </Box>}
    </Stack>
    {dialog && <LaundryCycleDialog key={`${dialog.state.machine.id}:${dialog.action}:${dialog.state.revision}`} action={dialog.action} machine={dialog.state.machine} cycle={dialog.state.cycle}
      revision={dialog.state.revision} unchanged={unchanged} onClose={() => setDialog(null)} onSaved={room => {
        const result = dialog.action === "start" ? "Suivi démarré" : dialog.action === "extend" ? "Temps ajouté" : dialog.action === "collect"
          ? dialog.state.machine.kind === "washer" ? "Lavage terminé · prêt à sécher" : "Récupération conservée" : "Annulation conservée";
        setSaved(`${result} · chambre ${room} · ${dialog.state.machine.label}.`);
        setDialog(null);
      }} />}
  </>;
}
