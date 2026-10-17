"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Collapse, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import { useAppContext } from "@/context/AppContext";
import { categories, displayDate, issuePhotoIds, priorities, statuses, today, type Issue } from "@/lib/domain";
import { defaultIssueFilters, issueAge, lastIntervention, selectIssues, type IssueFilters } from "@/lib/issueView";
import { ConnectionBar, EmptyState, IssueBadges, PageTitle } from "@/components/HotelUI";
import { IssueDialog } from "@/components/IssueDialog";
import { IssuePhoto } from "@/components/IssuePhoto";

function IssueCard({ issue, onOpen, direction }: { issue: Issue; onOpen: () => void; direction: boolean }) {
  const [photosOpen, setPhotosOpen] = useState(false);
  const photos = issuePhotoIds(issue), last = lastIntervention(issue), age = issueAge(issue, today());
  return <Paper component="article" aria-label={`${issue.location} · ${issue.title}`} variant="outlined" sx={{ p: 2, minWidth: 0, borderLeft: "4px solid", borderLeftColor: issue.status === "resolu" ? "success.main" : issue.priority === "critique" ? "error.main" : issue.priority === "haute" ? "warning.main" : "divider" }}>
    <Stack spacing={1.5}>
      <Stack direction="row" useFlexGap sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <IssueBadges issue={issue} />
        {issue.status !== "resolu" && <Chip size="small" variant="outlined" color={age >= 7 ? "warning" : "default"} label={age === 0 ? "Signalée aujourd’hui" : `Signalée il y a ${age} j`} />}
      </Stack>
      <Box>
        <Typography color="primary" variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>{issue.location}</Typography>
        <Typography variant="h6" sx={{ lineHeight: 1.3, overflowWrap: "anywhere" }}>{issue.title}</Typography>
        <Typography variant="caption" color="text.secondary">{issue.category} · Signalée le {displayDate(issue.date)}</Typography>
      </Box>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{issue.description}</Typography>
      <Box sx={{ bgcolor: "action.hover", borderRadius: 1.5, p: 1.25 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{issue.assignee ? `Responsable : ${issue.assignee}` : "Responsable à désigner"}</Typography>
        <Typography variant="caption" color="text.secondary">{last ? `Dernier suivi · ${new Date(last.at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} · ${last.actor}` : "Aucune intervention enregistrée"}</Typography>
        {last && <Typography variant="body2" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{last.note}</Typography>}
      </Box>
      <Stack direction="row" useFlexGap sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        {photos.length > 0 && <Button size="small" onClick={() => setPhotosOpen(!photosOpen)} aria-expanded={photosOpen}>{photosOpen ? "Masquer les photos" : `Voir les photos (${photos.length})`}</Button>}
        <Button variant="outlined" onClick={onOpen} sx={{ ml: "auto", minHeight: 44 }}>{direction ? "Ouvrir le suivi" : "Consulter"}</Button>
      </Stack>
      <Collapse in={photosOpen} unmountOnExit><Stack spacing={1}>{photos.map((photoId, index) => <IssuePhoto key={photoId} issueId={issue.id} index={index} alt={`${issue.title} · photo ${index + 1}`} />)}</Stack></Collapse>
    </Stack>
  </Paper>;
}

export default function IssuesPage() {
  const { issues, role } = useAppContext();
  const [filters, setFilters] = useState<IssueFilters>(defaultIssueFilters);
  const [advanced, setAdvanced] = useState(false);
  const [limit, setLimit] = useState(24);
  const [dialog, setDialog] = useState<Issue | "new" | null>(null);
  const [message, setMessage] = useState("");
  function change(patch: Partial<IssueFilters>) { setFilters(current => ({ ...current, ...patch })); setLimit(24); }
  function reset() { setFilters(defaultIssueFilters); setLimit(24); }
  const filtered = selectIssues(issues, filters);
  const pending = issues.filter(i => i.status !== "resolu");
  const shortcuts = [
    { label: "Non résolues", count: pending.length, patch: {} },
    { label: "Critiques ouvertes", count: pending.filter(i => i.priority === "critique").length, patch: { priority: "critique" as const } },
    { label: "Sans responsable", count: pending.filter(i => !i.assignee.trim()).length, patch: { unassigned: true } },
  ];
  const statusChoices = { pending: "Non résolues", ouvert: statuses.ouvert, en_cours: statuses.en_cours, resolu: statuses.resolu, all: "Toutes" };
  const extraCount = Number(filters.category !== "all") + Number(filters.unassigned) + Number(!!filters.from) + Number(!!filters.to);
  const changed = JSON.stringify(filters) !== JSON.stringify(defaultIssueFilters);
  return <>
    <ConnectionBar />
    <PageTitle eyebrow="Maintenance" title="Anomalies & suivi" description="Les priorités, les responsables et les dernières interventions en un coup d’œil." action={<Button variant="contained" startIcon={<Add />} onClick={() => setDialog("new")}>Signaler une anomalie</Button>} />
    <Stack spacing={2.5}>
      {message && <Alert severity="success" onClose={() => setMessage("")}>{message}</Alert>}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
        {shortcuts.map(shortcut => <Button key={shortcut.label} variant="outlined" onClick={() => { setFilters({ ...defaultIssueFilters, ...shortcut.patch }); setLimit(24); }} sx={{ flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", p: { xs: 1.25, sm: 2 }, textTransform: "none", textAlign: "left", minWidth: 0, gap: 1 }}>
          <Typography component="span" variant="body2" sx={{ fontSize: { xs: 12, sm: 14 } }}>{shortcut.label}</Typography><Typography component="span" variant="h5" sx={{ fontWeight: 800 }}>{shortcut.count}</Typography>
        </Button>)}
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
        <TextField fullWidth label="Rechercher une anomalie" placeholder="Chambre, problème, responsable ou intervention…" value={filters.query} onChange={e => change({ query: e.target.value })} />
        <Stack direction="row" useFlexGap role="group" aria-label="Filtrer par état" sx={{ flexWrap: "wrap", gap: 1 }}>{Object.entries(statusChoices).map(([value, label]) => <Chip key={value} label={label} onClick={() => change({ status: value as IssueFilters["status"] })} color={filters.status === value ? "primary" : "default"} variant={filters.status === value ? "filled" : "outlined"} aria-pressed={filters.status === value} />)}</Stack>
        <Stack direction="row" useFlexGap role="group" aria-label="Filtrer par priorité" sx={{ flexWrap: "wrap", gap: 1 }}>{Object.entries({ all: "Toutes priorités", ...priorities }).map(([value, label]) => <Chip key={value} label={label} onClick={() => change({ priority: value as IssueFilters["priority"] })} color={filters.priority === value ? "primary" : "default"} variant={filters.priority === value ? "filled" : "outlined"} aria-pressed={filters.priority === value} />)}</Stack>
        <Stack direction="row" useFlexGap sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>Filtres avancés{extraCount ? ` (${extraCount})` : ""}</Button>
          {changed && <Button onClick={reset}>Réinitialiser les filtres</Button>}
        </Stack>
        <Collapse in={advanced}><Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField fullWidth select label="Catégorie" value={filters.category} onChange={e => change({ category: e.target.value })}><MenuItem value="all">Toutes les catégories</MenuItem>{categories.map(category => <MenuItem key={category} value={category}>{category}</MenuItem>)}</TextField>
            <TextField fullWidth select label="Attribution" value={filters.unassigned ? "missing" : "all"} onChange={e => change({ unassigned: e.target.value === "missing" })}><MenuItem value="all">Tous les responsables</MenuItem><MenuItem value="missing">Sans responsable</MenuItem></TextField>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField fullWidth type="date" label="Constat à partir du" value={filters.from} onChange={e => change({ from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="date" label="Constat jusqu’au" value={filters.to} onChange={e => change({ to: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: filters.from || undefined } }} />
          </Stack>
        </Stack></Collapse>
        {filters.from && filters.to && filters.from > filters.to && <Alert severity="warning">La date de fin doit être postérieure ou égale à la date de début.</Alert>}
      </Stack></Paper>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
        <Typography variant="body2" role="status">{filtered.length} anomalie(s) trouvée(s){filters.unassigned ? " · Sans responsable" : ""}</Typography>
        <TextField select size="small" label="Trier par" value={filters.sort} onChange={e => change({ sort: e.target.value as IssueFilters["sort"] })} sx={{ minWidth: 230 }}>
          <MenuItem value="priority">Priorité, puis ancienneté</MenuItem><MenuItem value="oldest">Plus anciennes d’abord</MenuItem><MenuItem value="recent">Plus récentes d’abord</MenuItem><MenuItem value="updated">Dernières interventions</MenuItem>
        </TextField>
      </Stack>
      {!filtered.length ? <EmptyState title="Aucune anomalie dans cette sélection" detail="Modifiez les filtres pour retrouver un signalement, ou signalez un nouveau problème." /> : <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2, alignItems: "start" }}>
        {filtered.slice(0, limit).map(issue => <IssueCard key={issue.id} issue={issue} direction={role === "direction"} onOpen={() => setDialog(issue)} />)}
      </Box>}
      {filtered.length > limit && <Button variant="outlined" onClick={() => setLimit(n => n + 24)}>Afficher plus · {filtered.length - limit} restante(s)</Button>}
    </Stack>
    {dialog && <IssueDialog key={dialog === "new" ? "new" : dialog.id} issue={dialog === "new" ? undefined : dialog} onClose={() => setDialog(null)} onSaved={saved => setMessage(dialog === "new" ? "Anomalie enregistrée." : `Suivi enregistré · ${statuses[saved.status]}.${saved.status === "resolu" && filters.status === "pending" ? " Retrouvez-la avec le filtre Résolu." : ""}`)} />}
  </>;
}
