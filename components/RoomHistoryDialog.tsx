"use client";
import { useState } from "react";
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import CancelRounded from "@mui/icons-material/CancelRounded";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import { IssuePhoto } from "./IssuePhoto";
import { displayDate, issuePhotoIds } from "@/lib/domain";
import { carpetLabels, cleaningText, conditionLabels, roomChecks, type RoomEntry, type RoomInspection } from "@/lib/rooms";

type Record = RoomEntry | RoomInspection;
function Result({ label, text, status }: { label: string; text: string; status: "ok" | "bad" | "neutral" }) {
  const Icon = status === "ok" ? CheckCircleRounded : status === "bad" ? CancelRounded : HelpOutlineRounded;
  return <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }} data-result={status}>
    <Icon aria-hidden color={status === "ok" ? "success" : status === "bad" ? "error" : "disabled"} />
    <Typography sx={{ minWidth: 0 }}>{label} : <strong>{text}</strong></Typography>
  </Stack>;
}
export function RoomHistoryDialog({ room, history, onClose }: { room: string; history: Record[]; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records = [...new Map(history.filter(r => r.room === room).map(r => [r.id, r])).values()]
    .sort((a, b) => b.date.localeCompare(a.date) || ("updatedAt" in b ? b.updatedAt : "z").localeCompare("updatedAt" in a ? a.updatedAt : "z") || a.id.localeCompare(b.id));
  const record = records.find(r => r.id === selectedId);
  function dateLabel(r: Record) {
    const date = displayDate(r.date);
    if (!("updatedAt" in r)) return `${date} · En attente d’envoi`;
    if (records.filter(other => other.date === r.date).length > 1 && Number.isFinite(Date.parse(r.updatedAt)))
      return `${date} · ${new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(r.updatedAt))}`;
    return date;
  }
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="room-history-title" slotProps={{ paper: { sx: { m: 2, width: "calc(100% - 32px)", overflowWrap: "anywhere" } } }}>
    <DialogTitle id="room-history-title">Historique · chambre {room}</DialogTitle>
    <DialogContent dividers>
      {!record ? <>
        <Typography variant="h6">Liste des contrôles</Typography>
        {!records.length && <Typography>Aucun contrôle enregistré pour cette chambre.</Typography>}
        <List>{records.map(r => <ListItemButton key={r.id} onClick={() => setSelectedId(r.id)}>
          <ListItemText primary={dateLabel(r)} secondary={r.actor} />
        </ListItemButton>)}</List>
      </> : <Stack key={record.id} spacing={2}>
        <Typography variant="h6">Détail du contrôle · {dateLabel(record)}</Typography>
        {!("updatedAt" in record) && <Chip label="En attente d’envoi" />}
        <Typography>Inspecteur : {record.actor}</Typography>
        <Result label="Chambre occupée" text={record.occupied === true ? "Oui" : record.occupied === false ? "Non" : "Non renseignée"} status="neutral" />
        <Result label="État général" text={conditionLabels[record.condition] || "Non renseigné"} status={record.condition === "bon" ? "ok" : record.condition ? "bad" : "neutral"} />
        <Result label="Ménage" text={cleaningText(record)} status={record.occupied === false || !record.cleaning ? "neutral" : record.cleaning === "faite" ? "ok" : "bad"} />
        {roomChecks.map(check => {
          const result = record.checks.find(c => c.key === check.key)?.result;
          return <Result key={check.key} label={check.label} text={result === "ok" ? "OK" : result === "probleme" ? "Problème" : result === "absent" ? "Absent" : result === "non_verifie" ? "Non vérifié" : "Non renseigné"} status={result === "ok" ? "ok" : result === "probleme" || result === "absent" ? "bad" : "neutral"} />;
        })}
        <Result label="Moquette" text={carpetLabels[record.carpet] || "Non renseignée"} status={record.carpet === "ok" ? "ok" : record.carpet ? "bad" : "neutral"} />
        {record.carpetNotes && <Typography sx={{ whiteSpace: "pre-wrap" }}>{record.carpetNotes}</Typography>}
        <Result label="Micro-ondes" text={record.microwave === "oui" ? "Oui" : record.microwave === "non" ? "Non" : "Non vérifié"} status={record.microwave === "oui" ? "ok" : record.microwave === "non" ? "bad" : "neutral"} />
        <Typography variant="h6">Photos</Typography>
        {"photoIds" in record ? (issuePhotoIds(record).length ? issuePhotoIds(record).map((_, index) => <IssuePhoto key={`${record.id}:${index}`} issueId={record.id} index={index} collection="roomInspections" alt={`Chambre ${record.room} · photo ${index + 1}`} />) : <Typography>Aucune photo</Typography>) : (record.photosData.length ? record.photosData.map((src, index) => <Box component="img" key={`${record.id}:${index}`} src={src} alt={`Photo ${index + 1}`} sx={{ width: "100%", maxWidth: "100%", objectFit: "contain" }} />) : <Typography>Aucune photo</Typography>)}
        <Typography variant="h6">Observations</Typography>
        <Typography sx={{ whiteSpace: "pre-wrap" }}>{record.notes || "Aucune observation"}</Typography>
      </Stack>}
    </DialogContent>
    <DialogActions>{record && <Button onClick={() => setSelectedId(null)}>← Retour</Button>}<Button onClick={onClose}>Fermer</Button></DialogActions>
  </Dialog>;
}
