"use client";

import { useState } from "react";
import { Alert, Box, Button, Chip, Collapse, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import Search from "@mui/icons-material/Search";
import { CollectedItemDialog, type CollectedItemAction } from "@/components/CollectedItemDialog";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { useEntries } from "@/context/EntriesContext";
import { collectedItems, collectedItemRoomLabel, filterCollectedItems, type CollectedItemHistoryEvent, type CollectedItemRecord } from "@/lib/collectedItems";
import { displayDate } from "@/lib/domain";
import { useWorkEvents } from "@/lib/useWorkEvents";

const filters = { stored: "En armoire", returned: "Restitués", all: "Tous" } as const;
type Filter = keyof typeof filters;

function historyTitle(event: CollectedItemHistoryEvent, previous?: CollectedItemHistoryEvent) {
  if (!previous) return "Récupération enregistrée";
  if (!previous.returnedOn && event.returnedOn) return "Restitution enregistrée";
  if (previous.returnedOn && !event.returnedOn) return "Restitution annulée";
  return "Fiche corrigée";
}

function ItemCard({ record, pending, ready, onAction }: {
  record: CollectedItemRecord;
  pending: boolean;
  ready: boolean;
  onAction: (action: CollectedItemAction) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const returned = !!record.returnedOn;
  const color = returned ? "success" : "warning";
  return <Paper component="article" aria-label={`${collectedItemRoomLabel(record.room)} · ${record.itemName}`} variant="outlined"
    sx={{ p: 2.5, minWidth: 0, borderTop: "4px solid", borderTopColor: color + ".main" }}>
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Chambre</Typography>
          <Typography component="h2" variant={record.room ? "h4" : "h6"} sx={{ fontWeight: 800, lineHeight: 1.2 }}>{record.room || "Non identifiée"}</Typography>
        </Box>
        <Chip size="small" variant="outlined" color={color} label={returned ? "Restitué" : "En armoire"} />
      </Stack>
      <Typography component="h3" variant="h6" sx={{ overflowWrap: "anywhere", lineHeight: 1.35 }}>{record.itemName}</Typography>
      <Box>
        <Typography variant="body2">Récupéré le <Box component="span" sx={{ fontWeight: 700 }}>{displayDate(record.collectedOn)}</Box></Typography>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Par <Box component="span" sx={{ fontWeight: 700 }}>{record.collectedBy}</Box></Typography>
      </Box>
      {record.reason && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><Box component="span" sx={{ fontWeight: 600 }}>Motif : </Box>{record.reason}</Typography>}
      {record.returnedOn && <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>Restitué le {displayDate(record.returnedOn)}</Typography>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Par {record.returnedBy}</Typography>
      </Box>}
      {pending && <Typography role="status" variant="caption" color="warning.main">En attente d’envoi</Typography>}
      {!returned && <Button variant="contained" disabled={!ready} onClick={() => onAction("return")} sx={{ minHeight: 48 }}>Restituer</Button>}
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", justifyContent: "space-between" }}>
        <Button disabled={!ready} onClick={() => onAction("edit")} sx={{ minHeight: 44, px: 1 }}>Corriger la fiche</Button>
        <Button onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} sx={{ minHeight: 44, px: 1 }}>Historique ({record.history.length})</Button>
      </Stack>
      {returned && <Button color="inherit" disabled={!ready} onClick={() => onAction("restore")} sx={{ minHeight: 44, justifyContent: "flex-start", px: 1 }}>Annuler la restitution</Button>}
      <Collapse in={historyOpen} unmountOnExit>
        <Stack component="ol" spacing={2.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
          {record.history.map((event, index) => {
            const title = historyTitle(event, record.history[index + 1]);
            const actor = title === "Fiche corrigée" && ["Employé", "Direction"].includes(event.actor) ? "Profil " + event.actor : event.actor;
            return <Box component="li" key={event.id} sx={{ pl: 1.5, borderLeft: "3px solid", borderColor: "divider" }}>
              <Typography variant="subtitle2">{title} · {displayDate(event.date)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                {new Date(event.occurredAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · {actor}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75, overflowWrap: "anywhere" }}>{collectedItemRoomLabel(event.room)} · {event.itemName}</Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Récupéré le {displayDate(event.collectedOn)} par {event.collectedBy}.</Typography>
              {event.returnedOn ? <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>Restitué le {displayDate(event.returnedOn)} par {event.returnedBy}.</Typography> : <Typography variant="body2">En armoire</Typography>}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{event.reason ? "Motif : " + event.reason : "Motif non renseigné."}</Typography>
            </Box>;
          })}
        </Stack>
      </Collapse>
    </Stack>
  </Paper>;
}

export default function CollectedItemsPage() {
  const { events, isPending } = useWorkEvents();
  const { ready } = useEntries();
  const records = collectedItems(events);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("stored");
  const [dialog, setDialog] = useState<{ action: CollectedItemAction; record?: CollectedItemRecord } | null>(null);
  const [saved, setSaved] = useState<{ message: string; returned: boolean } | null>(null);
  const scoped = filterCollectedItems(records, search);
  const counts = { all: scoped.length, stored: scoped.filter(record => !record.returnedOn).length, returned: scoped.filter(record => !!record.returnedOn).length };
  const visible = scoped.filter(record => filter === "all" || (filter === "returned" ? !!record.returnedOn : !record.returnedOn));
  const emptyTitle = search.trim() ? "Aucun objet trouvé" : !records.length ? "Aucun objet enregistré" : filter === "stored" ? "Aucun objet en armoire" : "Aucun objet restitué";
  const emptyDetail = search.trim() ? "Essayez un numéro de chambre, un nom ou un autre mot." : !records.length ?
    "Ajoutez un objet dès qu’il est rangé dans l’armoire." : filter === "stored" ?
      "Les objets déjà rendus restent consultables dans « Restitués »." : "Les objets rendus apparaîtront ici avec leur date de restitution.";
  return <>
    <ConnectionBar />
    <PageTitle title="Objets récupérés" description="Retrouvez les objets gardés dans l’armoire et les restitutions par chambre."
      action={<Button variant="contained" startIcon={<Add />} disabled={!ready} onClick={() => setDialog({ action: "create" })} sx={{ minHeight: 48, flexShrink: 0 }}>Ajouter un objet</Button>} />
    <Stack spacing={3}>
      {saved && <Alert severity="success" onClose={() => setSaved(null)} closeText="Masquer ce message">
        {saved.message}
        {saved.returned && filter !== "returned" && <Button size="small" onClick={() => { setFilter("returned"); setSearch(""); }} sx={{ display: "block", mt: 0.5, minHeight: 44 }}>Voir les objets restitués</Button>}
      </Alert>}
      <Stack spacing={1.5}>
        <TextField type="search" label="Rechercher un objet" placeholder="Chambre, objet, nom ou motif…" value={search} onChange={event => setSearch(event.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search /></InputAdornment> } }} />
        <Box role="group" aria-label="Filtrer les objets récupérés" sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
          {(Object.keys(filters) as Filter[]).map(key => <Button key={key} variant={filter === key ? "contained" : "outlined"} onClick={() => setFilter(key)}
            aria-label={filters[key] + " : " + counts[key]} aria-pressed={filter === key} sx={{ minHeight: 48, px: 1, gap: 0.75, flexWrap: "wrap", lineHeight: 1.35 }}>
            {filters[key]} <Box component="span" sx={{ fontWeight: 800 }}>{counts[key]}</Box>
          </Button>)}
        </Box>
        <Typography variant="caption" color="text.secondary" role="status">{visible.length} objet{visible.length > 1 ? "s" : ""} affiché{visible.length > 1 ? "s" : ""} · Récupérations les plus récentes en premier.</Typography>
      </Stack>
      {!ready ? <Typography role="status">Chargement des objets enregistrés sur cet appareil…</Typography> : !visible.length ?
        <Paper variant="outlined" sx={{ py: 5, px: 3, textAlign: "center", borderStyle: "dashed" }}>
          <Inventory2Outlined color="action" sx={{ fontSize: 40, mb: 1.5 }} />
          <Typography component="h2" variant="h6">{emptyTitle}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>{emptyDetail}</Typography>
          {search.trim() && <Button onClick={() => setSearch("")} sx={{ mt: 1, minHeight: 44 }}>Effacer la recherche</Button>}
        </Paper> :
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }, alignItems: "start", gap: 2 }}>
          {visible.map(record => <ItemCard key={record.id} record={record} pending={isPending(record.lastEventId)} ready={ready} onAction={action => setDialog({ action, record })} />)}
        </Box>}
    </Stack>
    {dialog && <CollectedItemDialog key={dialog.action + ":" + (dialog.record?.id || "new") + ":" + (dialog.record?.revision || 0)} action={dialog.action} record={dialog.record}
      onClose={() => setDialog(null)} onSaved={result => {
        const roomLabel = collectedItemRoomLabel(result.room);
        const message = dialog.action === "return" ? `Restitution conservée · ${roomLabel}. Retrouvez l’objet dans « Restitués ».` :
          dialog.action === "restore" ? `Restitution annulée · ${roomLabel}. L’objet est de nouveau « En armoire ».` :
            dialog.action === "edit" ? `Fiche corrigée · ${roomLabel}. Les anciennes informations restent dans l’historique.` :
              `Objet conservé · ${roomLabel}. ${result.room ? "Pensez à mettre l’étiquette et à le ranger dans l’armoire." : "Vous pourrez renseigner le numéro plus tard avec « Corriger la fiche »."}`;
        setSaved({ message, returned: result.returned });
        if (dialog.action === "create" || dialog.action === "restore") { setFilter("stored"); setSearch(""); }
        setDialog(null);
      }} />}
  </>;
}
