"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import CancelRounded from "@mui/icons-material/CancelRounded";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import { IssuePhoto } from "./IssuePhoto";
import { displayDate, issuePhotoIds, statuses, type Issue } from "@/lib/domain";
import { applianceCleaningLabels, carpetLabels, cleaningText, conditionLabels, resultLabels, roomChecks, roomProblems, roomRecordTime, type RoomEntry, type RoomInspection } from "@/lib/rooms";
import { openRoomIssues } from "@/lib/roomIssueMatching";
import { completeRoomInspection } from "@/lib/roomRotation";

type Record = RoomEntry | RoomInspection;
function Result({ label, text, status }: { label: string; text: string; status: "ok" | "bad" | "neutral" }) {
  const Icon = status === "ok" ? CheckCircleRounded : status === "bad" ? CancelRounded : HelpOutlineRounded;
  return <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }} data-result={status}>
    <Icon aria-hidden color={status === "ok" ? "success" : status === "bad" ? "error" : "disabled"} />
    <Typography sx={{ minWidth: 0 }}>{label} : <strong>{text}</strong></Typography>
  </Stack>;
}
function dateLabel(record: Record) {
  const time = roomRecordTime(record);
  return `${displayDate(record.date)}${Number.isFinite(Date.parse(time)) ? ` · ${new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(time))}` : ""}`;
}
export function RoomHistoryDialog({ room, history, issues = [], onClose }: { room?: string; history: Record[]; issues?: Issue[]; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [photos, setPhotos] = useState(false);
  const mobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  const records = [...new Map(history.filter(r => !room || r.room === room).map(r => [r.id, r])).values()]
    .sort((a, b) => b.date.localeCompare(a.date) || roomRecordTime(b).localeCompare(roomRecordTime(a)) || a.id.localeCompare(b.id));
  const record = records.find(r => r.id === selectedId);
  const previous = record ? records.slice(records.indexOf(record) + 1).find(r => r.room === record.room) : undefined;
  const visible = records.filter(r => (!start || r.date >= start) && (!end || r.date <= end) &&
    `${r.room} ${r.actor} ${r.notes} ${roomProblems(r).join(" ")}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")) &&
    (filter === "all" || (filter === "problems" ? roomProblems(r).length > 0 : !("updatedAt" in r))));
  const open = room ? openRoomIssues(issues, room) : [];
  const linked = record && "relatedIssueIds" in record ? issues.filter(i => record.relatedIssueIds?.includes(i.id) || (record.createdIssue && i.id === record.id)) : [];
  const changes = record && previous ? roomChecks.flatMap(check => {
    const before = previous.checks.find(c => c.key === check.key)?.result, after = record.checks.find(c => c.key === check.key)?.result;
    return before !== after ? [`${check.label} : ${before ? resultLabels[before] : "Non renseigné"} → ${after ? resultLabels[after] : "Non renseigné"}`] : [];
  }) : [];
  return <Dialog open fullWidth fullScreen={mobile} maxWidth="md" onClose={onClose} aria-labelledby="room-history-title" slotProps={{ paper: { sx: { overflowWrap: "anywhere" } } }}>
    <DialogTitle id="room-history-title">{room ? `Historique · chambre ${room}` : "Historique des contrôles"}</DialogTitle>
    <DialogContent dividers>
      {!record ? <Stack spacing={2}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}><Chip label={`${records.length} contrôle(s)`} />{room && <Chip label={`${open.length} anomalie(s) ouverte(s)`} color={open.length ? "warning" : "default"} />}</Stack>
        {open.length > 0 && <details><summary style={{ cursor: "pointer" }}>Anomalies à suivre actuellement</summary><Stack spacing={1} sx={{ mt: 1 }}>{open.map(i => <Alert severity="warning" key={i.id}><strong>{i.title}</strong> · {statuses[i.status]}<Typography variant="body2">{i.description}</Typography></Alert>)}</Stack></details>}
        <TextField label="Rechercher dans l’historique" placeholder="Chambre, inspecteur, observation…" value={query} onChange={e => setQuery(e.target.value)} />
        <Stack direction="row" spacing={1}><TextField fullWidth label="Du" type="date" value={start} onChange={e => setStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><TextField fullWidth label="Au" type="date" value={end} onChange={e => setEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Stack>
        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>{[["all", "Tous"], ["problems", "Avec constats"], ["pending", "En attente d’envoi"]].map(([key, label]) => <Chip key={key} label={label} onClick={() => setFilter(key)} color={filter === key ? "primary" : "default"} />)}</Stack>
        {!visible.length && <Typography>Aucun contrôle ne correspond à cette recherche.</Typography>}
        {visible.map(r => {
          const problems = roomProblems(r), partial = !completeRoomInspection(r);
          return <Paper key={r.id} variant="outlined" sx={{ borderLeft: "4px solid", borderLeftColor: problems.length ? "warning.main" : partial ? "grey.400" : "success.main" }}>
            <Button onClick={() => { setSelectedId(r.id); setShowAll(false); setPhotos(false); }} sx={{ display: "block", width: "100%", textAlign: "left", p: 2, color: "text.primary" }}>
              <Typography component="span" sx={{ fontWeight: 800, display: "block" }}>{!room ? `Ch. ${r.room} · ` : ""}{dateLabel(r)}</Typography>
              <Typography component="span" variant="body2" sx={{ display: "block" }}>{r.actor} · {conditionLabels[r.condition]} · {r.occupied === false ? "Libre" : r.occupied === true ? "Occupée" : "Occupation inconnue"}</Typography>
              <Typography component="span" variant="body2" sx={{ display: "block", mt: 1 }}>{problems.length ? `${problems.length} constat(s) · ${problems.slice(0, 2).join(" · ")}` : partial ? "Contrôle partiel" : "Aucun problème signalé"}</Typography>
              {r.notes && <Typography component="span" variant="body2" color="text.secondary" sx={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", mt: 0.5 }}>{r.notes}</Typography>}
              <Typography component="span" variant="caption" color={"updatedAt" in r ? "text.secondary" : "warning.main"} sx={{ display: "block", mt: 1 }}>{"updatedAt" in r ? "Enregistré sur le serveur" : "En attente d’envoi"} · {"photoIds" in r ? issuePhotoIds(r).length : r.photosData.length} photo(s)</Typography>
            </Button>
          </Paper>;
        })}
      </Stack> : <Stack key={record.id} spacing={2}>
        <Typography variant="h6">Chambre {record.room} · {dateLabel(record)}</Typography>
        <Typography>Inspecteur : {record.actor}</Typography>
        <Chip sx={{ alignSelf: "flex-start" }} label={"updatedAt" in record ? "Enregistré sur le serveur" : "En attente d’envoi"} color={"updatedAt" in record ? "success" : "warning"} variant="outlined" />
        <Result label="Chambre occupée" text={record.occupied === true ? "Oui" : record.occupied === false ? "Non" : "Non renseignée"} status="neutral" />
        <Result label="État général" text={conditionLabels[record.condition]} status={record.condition === "bon" ? "ok" : "bad"} />
        <Result label="Ménage" text={cleaningText(record)} status={record.occupied === true || !record.cleaning ? "neutral" : record.cleaning === "faite" ? "ok" : "bad"} />
        <Typography variant="h6">Constats lors de cette visite</Typography>
        {roomProblems(record).length ? roomProblems(record).map((p, i) => <Alert severity="warning" key={i}>{p}</Alert>) : <Typography>Aucun problème signalé.</Typography>}
        {linked.length > 0 && <Box><Typography variant="subtitle2">Anomalies associées · statut actuel</Typography>{linked.map(i => <Typography key={i.id} variant="body2">{i.title} · {statuses[i.status]}{i.id !== record.id ? " · déjà signalée, non dupliquée" : ""}</Typography>)}</Box>}
        {previous && <details><summary style={{ cursor: "pointer" }}>Évolution des équipements depuis le {displayDate(previous.date)} · {changes.length} changement(s)</summary><Stack spacing={1} sx={{ mt: 1 }}>{changes.length ? changes.map((change, i) => <Typography key={i} variant="body2">{change}</Typography>) : <Typography variant="body2">Mêmes réponses pour les équipements.</Typography>}</Stack></details>}
        <Button variant="outlined" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? "Masquer les points de contrôle" : "Afficher tous les points de contrôle"}</Button>
        {showAll && <Stack spacing={1.5}>
          <Result label="Cafards / nuisibles" text={record.bugs === "oui" ? "Détectés" : record.bugs === "non" ? "Aucun" : "Non vérifié"} status={record.bugs === "non" ? "ok" : record.bugs === "oui" ? "bad" : "neutral"} />
          {roomChecks.map(check => {
            const result = record.checks.find(c => c.key === check.key)?.result;
            return <Result key={check.key} label={check.label} text={result ? resultLabels[result] : "Non renseigné (ancien contrôle)"} status={result === "ok" ? "ok" : result === "probleme" || (result === "absent" && ["smoke", "door_closer"].includes(check.key)) ? "bad" : "neutral"} />;
          })}
          <Result label="Moquette" text={carpetLabels[record.carpet]} status={record.carpet === "ok" ? "ok" : "bad"} />
          {record.carpetNotes && <Typography>{record.carpetNotes}</Typography>}
          <Result label="Micro-ondes" text={record.microwave === "oui" ? "Présent" : record.microwave === "non" ? "Absent" : "Non vérifié"} status="neutral" />
          {record.microwave === "oui" && <Result label="Propreté du micro-ondes" text={record.microwaveCleaning ? applianceCleaningLabels[record.microwaveCleaning] : "Non renseignée"} status={record.microwaveCleaning === "propre" ? "ok" : record.microwaveCleaning === "sale" ? "bad" : "neutral"} />}
          {record.checks.some(c => c.key === "fridge" && ["ok", "probleme"].includes(c.result)) && <Result label="Propreté du minibar" text={record.fridgeCleaning ? applianceCleaningLabels[record.fridgeCleaning] : "Non renseignée"} status={record.fridgeCleaning === "propre" ? "ok" : record.fridgeCleaning === "sale" ? "bad" : "neutral"} />}
        </Stack>}
        <Typography variant="h6">Observations</Typography><Typography sx={{ whiteSpace: "pre-wrap" }}>{record.notes || "Aucune observation"}</Typography>
        <Button variant="outlined" onClick={() => setPhotos(!photos)} aria-expanded={photos}>{photos ? "Masquer les photos" : "Afficher les photos"}</Button>
        {photos && ("photoIds" in record ? (issuePhotoIds(record).length ? issuePhotoIds(record).map((_, index) => <IssuePhoto key={`${record.id}:${index}`} issueId={record.id} index={index} collection="roomInspections" alt={`Chambre ${record.room} · photo ${index + 1}`} />) : <Typography>Aucune photo</Typography>) : (record.photosData.length ? record.photosData.map((src, index) => <Box component="img" key={`${record.id}:${index}`} src={src} alt={`Photo ${index + 1}`} sx={{ width: "100%", objectFit: "contain" }} />) : <Typography>Aucune photo</Typography>))}
      </Stack>}
    </DialogContent>
    <DialogActions>{record && <Button onClick={() => setSelectedId(null)}>← Retour à l’historique</Button>}<Button onClick={onClose}>Fermer</Button></DialogActions>
  </Dialog>;
}
