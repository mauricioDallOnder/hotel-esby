"use client";

import { useMemo, useState } from "react";
import { Alert, AlertTitle, Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import { CafardFollowupDialog } from "@/components/CafardFollowupDialog";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { RoomSelect } from "@/components/RoomSelect";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { cafardCases, cafardStatusLabels, cafardTreatmentReminder, emptyCafardCase, type CafardCase, type CafardStatus } from "@/lib/cafards";
import { cafardSeedsFromIssues } from "@/lib/cafardsLegacy";
import { displayDate } from "@/lib/domain";
import { roomGroups } from "@/lib/rooms";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { useWorkEvents } from "@/lib/useWorkEvents";

const statusColors = { a_verifier: "warning", signale: "error", traite: "info", resolu: "success" } as const;
const filters = {
  pending: "Suivis en cours", all: "Tous les états",
  a_verifier: cafardStatusLabels.a_verifier, signale: cafardStatusLabels.signale,
  traite: cafardStatusLabels.traite, resolu: cafardStatusLabels.resolu,
  due: "À vérifier après traitement",
} as const;
type CafardFilter = keyof typeof filters;
const dateText = (date: string | null) => date ? displayDate(date) : "Non renseignée";

function matchesFilter(record: CafardCase, filter: CafardFilter, day: string): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return record.status !== "resolu";
  if (filter === "due") return cafardTreatmentReminder(record, day)?.due === true;
  return record.status === filter;
}

function CafardCard({ record, day, pending, onEdit }: { record: CafardCase; day: string; pending: boolean; onEdit: () => void }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const reminder = cafardTreatmentReminder(record, day);
  const newDetection = reminder && record.history.find(event => event.id === record.lastEventId && event.kind === "inspection");
  return <Paper component="article" aria-label={"Chambre " + record.room} variant="outlined"
    sx={{ p: 2, minWidth: 0, borderTop: "4px solid", borderTopColor: (reminder?.due ? "warning" : statusColors[record.status]) + ".main" }}>
    <Stack spacing={1.5}>
      <Stack direction="row" useFlexGap sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Typography component="h3" variant="h4" sx={{ fontWeight: 800 }}>{record.room}</Typography>
        <Chip label={cafardStatusLabels[record.status]} color={statusColors[record.status]} variant="outlined" size="small" />
      </Stack>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 1.5, rowGap: 0.75 }}>
        {([
          ["Détection", record.detectedOn],
          ["Dernière application", record.treatedOn],
          ...(reminder ? [["Vérification prévue", reminder.dueOn]] : []),
          ["Dernière mise à jour", record.updatedOn],
          ...(record.status === "resolu" ? [["Résolution", record.resolvedOn]] : []),
        ] as [string, string | null][]).map(([label, date]) => <Box key={label} sx={{ display: "contents" }}>
          <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, textAlign: "right", fontWeight: date ? 600 : 400 }}>{dateText(date)}</Typography>
        </Box>)}
      </Box>
      {reminder?.due && <Alert severity="warning" role="note">
        <AlertTitle>Vérification à faire</AlertTitle>
        Passez dans cette chambre pour vérifier la présence de cafards, puis mettez le suivi à jour.
      </Alert>}
      {newDetection && <Alert severity="warning" role="note">
        <AlertTitle>Cafards encore observés le {dateText(newDetection.date)}</AlertTitle>
        Cette observation a été ajoutée au suivi existant. La date d’application et le rappel de vérification sont conservés.
      </Alert>}
      {record.product && <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Produit : {record.product}</Typography>}
      {record.notes && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{record.notes}</Typography>}
      {pending && <Typography role="status" variant="caption" color="warning.main">En attente d’envoi</Typography>}
      <Button variant="contained" onClick={onEdit} sx={{ minHeight: 44 }}>Mettre à jour</Button>
      {!!record.history.length && <>
        <Button onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} sx={{ justifyContent: "flex-start" }}>
          Historique ({record.history.length})
        </Button>
        <Collapse in={historyOpen} unmountOnExit>
          <Stack component="ol" spacing={2} sx={{ m: 0, pl: 0, listStyle: "none" }}>
            {record.history.map(event => <Box component="li" key={event.id} sx={{ pl: 1.5, borderLeft: "3px solid", borderColor: statusColors[event.status] + ".main" }}>
              <Typography variant="subtitle2">{dateText(event.date)} · {cafardStatusLabels[event.status]}</Typography>
              <Typography variant="caption" color="text.secondary">
                {event.kind === "inspection" ? "Contrôle de chambre" : event.kind === "initial" ? "Historique initial" : "Suivi"}
                {event.actor ? " · " + event.actor : ""}
              </Typography>
              {event.notes && <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{event.notes}</Typography>}
              {event.treatedOn && <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
                Application : {dateText(event.treatedOn)}{event.product ? " · " + event.product : ""}
              </Typography>}
              {event.resolvedOn && <Typography variant="caption" component="p">Résolution : {dateText(event.resolvedOn)}</Typography>}
            </Box>)}
          </Stack>
        </Collapse>
      </>}
    </Stack>
  </Paper>;
}

export default function CafardsPage() {
  const { issues } = useAppContext();
  const { history, pendingIds, day } = useRoomObservations();
  const { events, isPending } = useWorkEvents();
  const { ready } = useEntries();
  const records = useMemo(() => cafardCases(history, events, cafardSeedsFromIssues(issues)), [history, events, issues]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CafardFilter>("pending");
  const [editing, setEditing] = useState<CafardCase | null>(null);
  const [adding, setAdding] = useState(false);
  const [room, setRoom] = useState("");
  const [saved, setSaved] = useState<{ room: string; status: CafardStatus } | null>(null);
  const scoped = records.filter(record => record.room.includes(search.trim()));
  const dueRooms = records.filter(record => cafardTreatmentReminder(record, day)?.due);
  const counts = Object.fromEntries((Object.keys(filters) as CafardFilter[]).map(key => [key, scoped.filter(record => matchesFilter(record, key, day)).length])) as Record<CafardFilter, number>;
  const visible = scoped.filter(record => matchesFilter(record, filter, day));
  const groups = roomGroups.map(group => ({ ...group, records: visible.filter(record => (group.rooms as readonly string[]).includes(record.room)) })).filter(group => group.records.length);
  const existing = records.find(record => record.room === room);
  function openRoom() {
    if (!room) return;
    setEditing(existing || emptyCafardCase(room));
    setAdding(false);
  }
  return <>
    <ConnectionBar />
    <PageTitle title="Suivi des cafards" description="Détections, applications de produit et vérifications par chambre."
      action={<Button variant="contained" startIcon={<Add />} disabled={!ready} onClick={() => { setRoom(""); setAdding(true); }} sx={{ minHeight: 48, flexShrink: 0 }}>Ajouter une chambre</Button>} />
    <Stack spacing={3}>
      {saved && <Alert severity="success" onClose={() => setSaved(null)} closeText="Masquer ce message">
        Suivi de la chambre {saved.room} conservé.{saved.status === "resolu" ? " Retrouvez-le en choisissant « Résolu » dans le filtre." : ""}
      </Alert>}
      <Typography variant="body2" color="text.secondary">Chaque chambre garde un seul suivi. Les nouvelles détections pendant un contrôle rejoignent son historique et conservent le traitement en cours. Un rappel s’affiche 7 jours après l’application du produit : vérifiez la chambre, puis mettez le suivi à jour.</Typography>
      {!!dueRooms.length && <Alert severity="warning" role="status" sx={{ "& .MuiAlert-message": { minWidth: 0, width: "100%" } }}>
        <AlertTitle>{dueRooms.length} {dueRooms.length === 1 ? "chambre à vérifier" : "chambres à vérifier"} après traitement</AlertTitle>
        <Typography variant="body2">Le produit a été appliqué il y a au moins 7 jours. Passez dans les chambres concernées pour vérifier la présence de cafards.</Typography>
        <Button variant="outlined" color="inherit" onClick={() => { setFilter("due"); setSearch(""); }} sx={{ mt: 1.5, minHeight: 44 }}>
          Voir les chambres à vérifier
        </Button>
      </Alert>}
      <Stack spacing={1.5}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField type="search" label="Rechercher une chambre" value={search} onChange={event => setSearch(event.target.value)} fullWidth slotProps={{ htmlInput: { inputMode: "numeric" } }} />
          <TextField select label="État du suivi" value={filter} onChange={event => setFilter(event.target.value as CafardFilter)} fullWidth slotProps={{ select: { native: true } }}>
            {(Object.keys(filters) as CafardFilter[]).map(key => <option key={key} value={key}>{filters[key]} · {counts[key]}</option>)}
          </TextField>
        </Stack>
        <Typography variant="caption" color="text.secondary" role="status">{visible.length} {visible.length === 1 ? "chambre affichée" : "chambres affichées"}. Les nombres du filtre suivent la recherche.</Typography>
      </Stack>
      {!groups.length && <Alert severity="info">Aucun suivi ne correspond à cette recherche.</Alert>}
      {groups.map(group => <Box component="section" key={group.label} aria-label={group.label}>
        <Typography component="h2" variant="h6" sx={{ mb: 1.5 }}>{group.label} · {group.records.length}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }, alignItems: "start", gap: 2 }}>
          {group.records.map(record => <CafardCard key={record.room} record={record} day={day}
            pending={isPending(record.lastEventId || undefined) || pendingIds.has(record.lastEventId || "")}
            onEdit={() => setEditing(record)} />)}
        </Box>
      </Box>)}
    </Stack>
    {adding && <Dialog open fullWidth maxWidth="xs" onClose={() => setAdding(false)} aria-labelledby="add-cafard-title">
      <DialogTitle id="add-cafard-title">Ajouter une chambre au suivi</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <RoomSelect value={room} onChange={setRoom} />
        {existing && <Alert severity="info">Un suivi existe déjà pour cette chambre. Vous pouvez le mettre à jour.</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setAdding(false)}>Annuler</Button><Button variant="contained" disabled={!room} onClick={openRoom}>{existing ? "Ouvrir le suivi" : "Continuer"}</Button></DialogActions>
    </Dialog>}
    {editing && <CafardFollowupDialog key={editing.room + ":" + editing.revision} record={editing} onClose={() => setEditing(null)}
      onSaved={status => { setSaved({ room: editing.room, status }); setEditing(null); }} />}
  </>;
}
