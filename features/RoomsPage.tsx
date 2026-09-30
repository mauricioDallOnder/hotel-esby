"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { IssuePhoto } from "@/components/IssuePhoto";
import { createId, displayDate, today } from "@/lib/domain";
import { carpetLabels, cleaningLabels, conditionLabels, resultLabels, roomChecks, roomEntrySchema, roomGroups, rooms, type RoomEntry, type RoomInspection } from "@/lib/rooms";
import { compressPhoto } from "@/lib/photos";
import { useDeviceDraft } from "@/lib/useDeviceDraft";

type Draft = Omit<RoomEntry, "condition" | "cleaning" | "carpet"> & { condition: RoomEntry["condition"] | ""; cleaning: RoomEntry["cleaning"] | ""; carpet: RoomEntry["carpet"] | "" };
function RoomForm({ room, onClose }: { room: string; onClose: () => void }) {
  const { enqueue } = useEntries();
  const draft = useDeviceDraft<Draft>(`draft:room:${room}`, () => ({
    type: "createRoomInspection", id: createId(), room, date: today(), actor: "", notes: "", condition: "", cleaning: "", carpet: "", carpetNotes: "", microwave: "non_verifie", photosData: [],
    checks: roomChecks.map(c => ({ key: c.key, result: "non_verifie" })),
  }));
  const value = draft.value;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = roomEntrySchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(" ")); return; }
    setBusy(true);
    try { await enqueue(parsed.data); await draft.clear(); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function addPhotos(files: File[]) {
    if (!value || !files.length) return;
    if (value.photosData.length + files.length > 3) { setError("Ajoutez au maximum 3 photos."); return; }
    setCompressing(true); setError("");
    try {
      const photos = [];
      for (const file of files) photos.push(await compressPhoto(file, true));
      draft.update({ ...value, photosData: [...value.photosData, ...photos] });
    } catch (e) { setError((e as Error).message); }
    finally { setCompressing(false); }
  }
  return <Dialog open fullWidth maxWidth="sm" onClose={busy || compressing ? undefined : onClose}>
    <DialogTitle>Contrôle · chambre {room}</DialogTitle>
    <DialogContent>
      <Stack component="form" onSubmit={submit} spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {draft.error && <Alert severity="error">{draft.error}</Alert>}
        {value ? <Box component="fieldset" disabled={busy || compressing} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}><Stack spacing={2}>
          <TextField required label="Date du contrôle" type="date" value={value.date} onChange={e => draft.update({ ...value, date: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />
          <TextField required label="Inspecteur" value={value.actor} onChange={e => draft.update({ ...value, actor: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField select required label="État général de la chambre" value={value.condition} onChange={e => draft.update({ ...value, condition: e.target.value as Draft["condition"] })}>
            {Object.entries(conditionLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <TextField select required label="Nettoyage / ménage" value={value.cleaning} onChange={e => draft.update({ ...value, cleaning: e.target.value as Draft["cleaning"] })}>
            {Object.entries(cleaningLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <Typography variant="h6">Points de contrôle</Typography>
          <Typography variant="body2" color="text.secondary">Laissez « Non vérifié » si vous n’avez pas pu contrôler un point. Aucun équipement n’est déclaré conforme automatiquement.</Typography>
          {roomChecks.map(check => <TextField key={check.key} select label={check.label} value={value.checks.find(c => c.key === check.key)!.result} onChange={e => draft.update({ ...value, checks: value.checks.map(c => c.key === check.key ? { ...c, result: e.target.value as RoomEntry["checks"][number]["result"] } : c) })}>
            {Object.entries(resultLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>)}
          <TextField select required label="État de la moquette" value={value.carpet} onChange={e => draft.update({ ...value, carpet: e.target.value as Draft["carpet"] })}>
            {Object.entries(carpetLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          {value.carpet && value.carpet !== "ok" && <TextField required label="Précisez les taches ou salissures" multiline minRows={2} value={value.carpetNotes} onChange={e => draft.update({ ...value, carpetNotes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />}
          <TextField select label="Micro-ondes présent ?" value={value.microwave} onChange={e => draft.update({ ...value, microwave: e.target.value as RoomEntry["microwave"] })}>
            <MenuItem value="non_verifie">Non vérifié</MenuItem><MenuItem value="oui">Oui</MenuItem><MenuItem value="non">Non</MenuItem>
          </TextField>
          <TextField label="Observations et problèmes constatés" required={value.condition === "a_revoir" || value.condition === "mauvais" || value.checks.some(c => c.result === "probleme")} multiline minRows={3} value={value.notes} onChange={e => draft.update({ ...value, notes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />
          <Typography variant="h6">Photos du problème · {value.photosData.length}/3</Typography>
          <Typography variant="caption">Facultatives. Les photos sont réduites avant l’envoi pour économiser la connexion.</Typography>
          <Stack direction="row" spacing={1}>
            <Button component="label" variant="outlined" disabled={compressing || value.photosData.length >= 3}>Prendre une photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
            <Button component="label" disabled={compressing || value.photosData.length >= 3}>Galerie<input hidden multiple type="file" accept="image/*" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
          </Stack>
          {value.photosData.map((photo, i) => <Box key={i}>
            <Box component="img" src={photo} alt={`Photo du problème ${i + 1}`} sx={{ width: "100%", maxHeight: 220, objectFit: "contain" }} />
            <Button color="error" onClick={() => draft.update({ ...value, photosData: value.photosData.filter((_, index) => index !== i) })}>Retirer la photo {i + 1}</Button>
          </Box>)}
          <Typography variant="caption">{compressing ? "Compression des photos…" : draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil pendant la saisie."}</Typography>
          <Button variant="contained" type="submit" disabled={busy || compressing}>Enregistrer le contrôle</Button>
        </Stack></Box> : <Typography>Chargement du brouillon…</Typography>}
        <Button disabled={busy || compressing} onClick={onClose}>Fermer · garder le brouillon</Button>
      </Stack>
    </DialogContent>
  </Dialog>;
}
function InspectionDetails({ record, onClose }: { record: RoomInspection | RoomEntry; onClose: () => void }) {
  const [photos, setPhotos] = useState(false);
  const count = "photoIds" in record ? record.photoIds.length : record.photosData.length;
  return <Dialog open onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>Chambre {record.room} · {displayDate(record.date)}</DialogTitle><DialogContent><Stack spacing={2}>
    <Typography>Inspecteur : {record.actor}</Typography>
    <Typography>État : {conditionLabels[record.condition]} · Ménage : {cleaningLabels[record.cleaning]}</Typography>
    {roomChecks.map(check => <Typography key={check.key}>{check.label} : <strong>{resultLabels[record.checks.find(c => c.key === check.key)!.result]}</strong></Typography>)}
    <Typography>Moquette : {carpetLabels[record.carpet]} {record.carpet !== "ok" ? record.carpetNotes : ""}</Typography>
    <Typography>Micro-ondes : {record.microwave === "oui" ? "Oui" : record.microwave === "non" ? "Non" : "Non vérifié"}</Typography>
    <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{record.notes}</Typography>
    {count > 0 && <Button onClick={() => setPhotos(!photos)}>{photos ? "Masquer les photos" : `Afficher les ${count} photo(s)`}</Button>}
    {photos && ("photoIds" in record ? record.photoIds.map((_, index) => <IssuePhoto key={index} issueId={record.id} index={index} collection="roomInspections" alt={`Chambre ${record.room} · photo ${index + 1}`} />) : record.photosData.map((src, index) => <Box component="img" key={index} src={src} alt={`Photo ${index + 1}`} sx={{ width: "100%" }} />))}
    <Button onClick={onClose}>Fermer</Button>
  </Stack></DialogContent></Dialog>;
}
export default function RoomsPage() {
  const { roomInspections = [] } = useAppContext();
  const { pending } = useEntries();
  const [room, setRoom] = useState<string | null>(null);
  const [detail, setDetail] = useState<RoomInspection | RoomEntry | null>(null);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState("all");
  const [historyRoom, setHistoryRoom] = useState("");
  const queued = pending.filter(p => p.entry.type === "createRoomInspection").map(p => p.entry as RoomEntry);
  const history = [...queued, ...roomInspections.filter(i => !queued.some(q => q.id === i.id))].sort((a, b) => b.date.localeCompare(a.date) || ("updatedAt" in b ? b.updatedAt : "z").localeCompare("updatedAt" in a ? a.updatedAt : "z"));
  const latest = new Map<string, RoomEntry | RoomInspection>();
  history.forEach(record => { if (!latest.has(record.room)) latest.set(record.room, record); });
  function hasProblem(record: RoomEntry | RoomInspection) { return record.condition !== "bon" || record.carpet !== "ok" || record.checks.some(c => c.result === "probleme" || (c.key === "smoke" && c.result === "absent")); }
  const visibleHistory = history.filter(record => !historyRoom || record.room === historyRoom);
  const [historyLimit, setHistoryLimit] = useState(20);
  return <>
    <ConnectionBar />
    <PageTitle title="Checklist des chambres" description="89 chambres · État, ménage, équipements et photos des problèmes." />
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}><Chip label={`${latest.size}/${rooms.length} chambres contrôlées`} /><Chip label={`${[...latest.values()].filter(hasProblem).length} à revoir`} color="warning" variant="outlined" /></Stack>
      <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <TextField fullWidth label="Rechercher une chambre" value={search} onChange={e => setSearch(e.target.value)} />
        <TextField fullWidth select label="Groupe de chambres" value={group} onChange={e => setGroup(e.target.value)}><MenuItem value="all">Tous les groupes</MenuItem>{roomGroups.map(g => <MenuItem key={g.start} value={String(g.start)}>{g.label}</MenuItem>)}</TextField>
        <TextField fullWidth select label="Afficher" value={filter} onChange={e => setFilter(e.target.value)}><MenuItem value="all">Toutes les chambres</MenuItem><MenuItem value="missing">Jamais contrôlées</MenuItem><MenuItem value="problems">À revoir</MenuItem><MenuItem value="cleaning">Ménage non fait</MenuItem></TextField>
      </Stack></Paper>
      {roomGroups.filter(g => group === "all" || group === String(g.start)).map(g => {
        const numbers = rooms.filter(n => Number(n) >= g.start && Number(n) <= g.end && n.includes(search.trim())).filter(n => { const r = latest.get(n); return filter === "all" || (filter === "missing" ? !r : !!r && (filter === "problems" ? hasProblem(r) : r.cleaning === "non_faite")); });
        if (!numbers.length) return null;
        return <Box key={g.start}><Typography variant="h6" sx={{ mb: 1.5 }}>{g.label}</Typography><Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1.5 }}>
          {numbers.map(n => { const record = latest.get(n); return <Paper key={n} variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
            <Typography variant="h5">{n}</Typography>
            <Typography variant="caption">{record ? `Dernier contrôle : ${displayDate(record.date)}` : "Pas encore contrôlée"}</Typography>
            {record && <><Chip size="small" label={hasProblem(record) ? "À revoir" : record.checks.some(c => c.result === "non_verifie") || record.microwave === "non_verifie" ? "Vérification partielle" : "Contrôlée"} color={hasProblem(record) ? "warning" : "default"} /><Typography variant="caption">Ménage : {cleaningLabels[record.cleaning]}{queued.some(q => q.id === record.id) ? " · En attente d’envoi" : ""}</Typography></>}
            <Button variant="outlined" onClick={() => setRoom(n)} aria-label={`Contrôler la chambre ${n}`}>Contrôler</Button>
            <Button size="small" onClick={() => { setHistoryRoom(n); setHistoryLimit(20); document.getElementById("room-history")?.scrollIntoView({ behavior: "smooth" }); }}>Historique</Button>
          </Stack></Paper>; })}
        </Box></Box>;
      })}
      <Box id="room-history"><Typography variant="h6" sx={{ mb: 2 }}>Historique des contrôles</Typography><TextField select fullWidth label="Historique de la chambre" value={historyRoom} onChange={e => { setHistoryRoom(e.target.value); setHistoryLimit(20); }} sx={{ mb: 2 }}><MenuItem value="">Toutes les chambres</MenuItem>{rooms.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}</TextField>
        <Stack spacing={1}>{visibleHistory.slice(0, historyLimit).map(record => <Paper key={record.id} variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <Typography>Ch. {record.room} · {displayDate(record.date)} · {record.actor}</Typography><Typography variant="body2">{conditionLabels[record.condition]} · Ménage : {cleaningLabels[record.cleaning]}</Typography>
          <Typography variant="caption">{queued.some(q => q.id === record.id) ? "En attente d’envoi" : "Enregistré sur le serveur"}</Typography><Button onClick={() => setDetail(record)}>Voir le contrôle</Button>
        </Stack></Paper>)}</Stack>
        {!visibleHistory.length && <Typography color="text.secondary">Aucun contrôle enregistré.</Typography>}
        {visibleHistory.length > historyLimit && <Button onClick={() => setHistoryLimit(n => n + 20)}>Afficher plus</Button>}
      </Box>
    </Stack>
    {room && <RoomForm key={room} room={room} onClose={() => setRoom(null)} />}
    {detail && <InspectionDetails record={detail} onClose={() => setDetail(null)} />}
  </>;
}
