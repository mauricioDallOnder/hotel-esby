"use client";
import { useEffect, useState } from "react";
import { 
  Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, 
  Menu, MenuItem, Paper, Stack, TextField, Typography, LinearProgress 
} from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { RoomHistoryDialog } from "@/components/RoomHistoryDialog";
import { createId, displayDate, today } from "@/lib/domain";
import { 
  applianceCleaningLabels, carpetLabels, cleaningLabels, cleaningText, 
  countRoomsOnDate, latestRoomRecords, normalizeRoomDraft, conditionLabels, 
  resultLabels, roomChecks, roomEntrySchema, roomGroups, roomProblems, 
  rooms, type RoomEntry, type RoomInspection 
} from "@/lib/rooms";
import { compressPhoto } from "@/lib/photos";
import { useDeviceDraft } from "@/lib/useDeviceDraft";

type Draft = Omit<RoomEntry, "condition" | "carpet"> & { condition: RoomEntry["condition"] | ""; carpet: RoomEntry["carpet"] | "" };

function RoomForm({ room, onClose }: { room: string; onClose: () => void }) {
  const { enqueue } = useEntries();
  const draft = useDeviceDraft<Draft>(`draft:room:${room}`, () => ({
    type: "createRoomInspection", schemaVersion: 3, id: createId(), room, date: today(), actor: "", notes: "", condition: "", occupied: null, cleaning: null, carpet: "", carpetNotes: "", microwave: "non_verifie", microwaveCleaning: "non_verifie", fridgeCleaning: "non_verifie", photosData: [],
    checks: roomChecks.map(c => ({ key: c.key, result: "non_verifie" })),
  }), value => normalizeRoomDraft({ ...value, cleaning: value.cleaning || null }));
  
  const value = draft.value;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  
  const validation = (field: string) => ({ error: invalid.includes(field), helperText: invalid.includes(field) ? "Veuillez renseigner ce point." : undefined });
  
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = roomEntrySchema.safeParse(value);
    if (!parsed.success) {
      setInvalid(parsed.error.issues.map(i => i.path.join(".")));
      setError("Veuillez vérifier tous les points obligatoires avant d’enregistrer le contrôle.");
      setTimeout(() => document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setInvalid([]);
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
      <Stack component="form" noValidate onSubmit={submit} spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {draft.error && <Alert severity="error">{draft.error}</Alert>}
        {value ? <Box component="fieldset" disabled={busy || compressing} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}><Stack spacing={2}>
          <TextField required {...validation("date")} label="Date du contrôle" type="date" value={value.date} onChange={e => draft.update({ ...value, date: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />
          <TextField required {...validation("actor")} label="Inspecteur" value={value.actor} onChange={e => draft.update({ ...value, actor: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField select required {...validation("condition")} label="État général de la chambre" value={value.condition} onChange={e => draft.update({ ...value, condition: e.target.value as Draft["condition"] })}>
            {Object.entries(conditionLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <TextField select required {...validation("occupied")} label="Chambre occupée" value={value.occupied === true ? "oui" : value.occupied === false ? "non" : ""} onChange={e => draft.update({ ...value, occupied: e.target.value === "oui", cleaning: e.target.value === "oui" ? null : value.cleaning })}>
            <MenuItem value="oui">Oui</MenuItem><MenuItem value="non">Non</MenuItem>
          </TextField>
          {value.occupied === false && <TextField select required {...validation("cleaning")} label="Nettoyage / ménage" value={value.cleaning || ""} onChange={e => draft.update({ ...value, cleaning: (e.target.value || null) as Draft["cleaning"] })}>
            <MenuItem value="">Non renseigné</MenuItem>
            {Object.entries(cleaningLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>}
          <Typography variant="h6">Points de contrôle</Typography>
          <Typography variant="body2" color="text.secondary">Vérifiez tous les points avant d’enregistrer. Aucun équipement n’est déclaré conforme automatiquement.</Typography>
          {roomChecks.map(check => <TextField key={check.key} select required {...validation(`checks.${check.key}`)} label={check.label} value={value.checks.find(c => c.key === check.key)?.result || "non_verifie"} onChange={e => draft.update({ ...value, checks: value.checks.map(c => c.key === check.key ? { ...c, result: e.target.value as RoomEntry["checks"][number]["result"] } : c) })}>
            {Object.entries(resultLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>)}
          {value.checks.some(c => c.key === "fridge" && (c.result === "ok" || c.result === "probleme")) && <TextField select required {...validation("fridgeCleaning")} label="Propreté du minibar" value={value.fridgeCleaning || "non_verifie"} onChange={e => draft.update({ ...value, fridgeCleaning: e.target.value as Draft["fridgeCleaning"] })}>
            {Object.entries(applianceCleaningLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>}
          <TextField select required {...validation("carpet")} label="État de la moquette" value={value.carpet} onChange={e => draft.update({ ...value, carpet: e.target.value as Draft["carpet"] })}>
            {Object.entries(carpetLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          {value.carpet && value.carpet !== "ok" && <TextField required {...validation("carpetNotes")} label="Précisez les taches ou salissures" multiline minRows={2} value={value.carpetNotes} onChange={e => draft.update({ ...value, carpetNotes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />}
          <TextField select required {...validation("microwave")} label="Micro-ondes présent ?" value={value.microwave} onChange={e => draft.update({ ...value, microwave: e.target.value as RoomEntry["microwave"] })}>
            <MenuItem value="non_verifie">Non vérifié</MenuItem><MenuItem value="oui">Oui</MenuItem><MenuItem value="non">Non</MenuItem>
          </TextField>
          {value.microwave === "oui" && <TextField select required {...validation("microwaveCleaning")} label="Propreté du micro-ondes" value={value.microwaveCleaning || "non_verifie"} onChange={e => draft.update({ ...value, microwaveCleaning: e.target.value as Draft["microwaveCleaning"] })}>
            {Object.entries(applianceCleaningLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>}
          <TextField {...validation("notes")} label="Observations et problèmes constatés" required={value.condition === "a_revoir" || value.condition === "mauvais" || value.checks.some(c => c.result === "probleme")} multiline minRows={3} value={value.notes} onChange={e => draft.update({ ...value, notes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />
          <Typography variant="body2" color="text.secondary">Les problèmes, observations et photos de ce contrôle seront également enregistrés dans les anomalies après synchronisation.</Typography>
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

export default function RoomsPage() {
  const { roomInspections = [], hotelName } = useAppContext();
  const { pending } = useEntries();
  const [room, setRoom] = useState<string | null>(null);
  const [historyRoom, setHistoryRoom] = useState<string | null>(null);
  const [day, setDay] = useState(today);
  
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState("all");
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  
  const queued = pending.filter(p => p.entry.type === "createRoomInspection").map(p => p.entry as RoomEntry);
  const history = [...queued, ...roomInspections.filter(i => !queued.some(q => q.id === i.id))].sort((a, b) => b.date.localeCompare(a.date) || ("updatedAt" in b ? b.updatedAt : "z").localeCompare("updatedAt" in a ? a.updatedAt : "z"));
  const latest = latestRoomRecords(history);
  const freeRooms = [...latest.values()].filter(record => record.occupied === false);
  
  function hasProblem(record: RoomEntry | RoomInspection) { return roomProblems(record).length > 0; }
  
  async function exportFreeRooms() {
    setExportMenu(null); setExporting(true); setExportError("");
    try {
      const { downloadFreeRoomsReport } = await import("@/lib/roomPdfExport");
      downloadFreeRoomsReport({ hotelName, history });
    } catch (error) { setExportError((error as Error).message); }
    finally { setExporting(false); }
  }

  // ==============================================================
  // ALGORITMO: PLANO DO DIA (ROTAÇÃO E PRIORIDADES)
  // ==============================================================
  const DAILY_QUOTA = 15;

  // 1. O que já foi feito hoje?
  const inspectedTodayRecords = [...latest.values()].filter(r => r.date === day && rooms.includes(r.room));
  const inspectedTodayCount = inspectedTodayRecords.length;
  const inspectedTodayRooms = inspectedTodayRecords.map(r => r.room);

  // 2. Quartos com problemas de dias anteriores que AINDA NÃO foram revistos hoje (Prioridade 1)
  const needsReviewRooms = [...latest.values()]
    .filter(r => r.date < day && rooms.includes(r.room) && hasProblem(r) && !inspectedTodayRooms.includes(r.room))
    .sort((a, b) => a.date.localeCompare(b.date)) // Os problemas mais antigos primeiro
    .map(r => r.room);

  // 3. Quartos NUNCA inspecionados (Prioridade 2)
  const neverInspectedRooms = rooms.filter(r => !latest.has(r) && !inspectedTodayRooms.includes(r));

  // 4. Quartos que não têm problemas, ordenados do mais ANTIGO para o mais recente (Rotação)
  const oldInspectedRooms = [...latest.values()]
    .filter(r => r.date < day && rooms.includes(r.room) && !hasProblem(r) && !inspectedTodayRooms.includes(r.room))
    .sort((a, b) => a.date.localeCompare(b.date)) // Vistorias mais antigas primeiro
    .map(r => r.room);

  // 5. Juntar as filas por prioridade
  const priorityQueue = [...needsReviewRooms, ...neverInspectedRooms, ...oldInspectedRooms];

  // 6. Pegar apenas o que falta para fechar a cota diária de 15 quartos
  const remainingQuota = Math.max(0, DAILY_QUOTA - inspectedTodayCount);
  const targetRooms = priorityQueue.slice(0, remainingQuota);

  const isComplete = inspectedTodayCount >= DAILY_QUOTA && needsReviewRooms.length === 0;

  return <>
    <ConnectionBar />
    <PageTitle title="Checklist des chambres" description={`${rooms.length} chambres · Planification automatique, ménage et suivi.`} />
    
    <Stack spacing={3}>
      
      {/* ========================================================= */}
      {/* NOVA SEÇÃO: OBJECTIF DU JOUR (PLAN DO DIA)                */}
      {/* ========================================================= */}
      <Paper 
        variant="outlined" 
        sx={{ 
          p: 2.5, 
          borderColor: isComplete ? "success.main" : "primary.main", 
          bgcolor: isComplete ? "#f2f7f4" : "#f4f8f7",
          borderWidth: 2
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="h6" color={isComplete ? "success.main" : "primary.main"} sx={{ fontWeight: 800 }}>
                {isComplete ? "Objectif du jour atteint ! 🎉" : "Objectif du jour"}
              </Typography>
              <Typography variant="h6" color={isComplete ? "success.main" : "primary.main"} sx={{ fontWeight: 800 }}>
                {inspectedTodayCount} / {DAILY_QUOTA}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (inspectedTodayCount / DAILY_QUOTA) * 100)}
              color={isComplete ? "success" : "primary"}
              sx={{ height: 10, borderRadius: 4, mt: 1.5 }}
            />
          </Box>

          {!isComplete && targetRooms.length > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontWeight: 700 }}>
                Recommandation intelligente : {targetRooms.length} chambre(s) à faire maintenant
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {targetRooms.map(n => {
                  const isReview = needsReviewRooms.includes(n);
                  return (
                    <Button
                      key={n}
                      variant={isReview ? "contained" : "outlined"}
                      color={isReview ? "warning" : "primary"}
                      size="medium"
                      onClick={() => setRoom(n)}
                      sx={{ borderRadius: 2, fontWeight: 700 }}
                    >
                      {n} {isReview ? " (À revoir)" : ""}
                    </Button>
                  );
                })}
              </Box>
            </Box>
          )}
          
          {isComplete && needsReviewRooms.length > 0 && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              Vous avez atteint votre quota, mais il reste {needsReviewRooms.length} chambre(s) avec des problèmes à vérifier en priorité demain (ou aujourd'hui si vous avez le temps).
            </Alert>
          )}
        </Stack>
      </Paper>

      <Box>
        <Button variant="outlined" disabled={exporting} aria-haspopup="menu" aria-expanded={Boolean(exportMenu)} onClick={e => setExportMenu(e.currentTarget)}>{exporting ? "Préparation du PDF…" : "Exporter en PDF"}</Button>
        <Menu anchorEl={exportMenu} open={Boolean(exportMenu)} onClose={() => setExportMenu(null)}>
          <MenuItem disabled={!freeRooms.length} onClick={() => void exportFreeRooms()}>Chambres libres · {freeRooms.length}</MenuItem>
        </Menu>
        <Typography variant="caption" sx={{ display: "block", mt: 1 }}>Dernier checklist de chaque chambre libre : état, ménage, micro-ondes et minibar. Les données en attente d’envoi sont signalées dans le PDF.</Typography>
      </Box>
      
      {exportError && <Alert severity="error">{exportError}</Alert>}
      
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip label={`${countRoomsOnDate(history, day)}/${rooms.length} contrôlées aujourd'hui`} />
        <Chip label={`${[...latest.values()].filter(r => rooms.includes(r.room)).filter(hasProblem).length} à revoir au total`} color="warning" variant="outlined" />
      </Stack>
      
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField fullWidth label="Rechercher une chambre" value={search} onChange={e => setSearch(e.target.value)} />
          <TextField fullWidth select label="Groupe de chambres" value={group} onChange={e => setGroup(e.target.value)}>
            <MenuItem value="all">Tous les groupes</MenuItem>
            {roomGroups.map(g => <MenuItem key={g.label} value={g.label}>{g.label}</MenuItem>)}
          </TextField>
          <TextField fullWidth select label="Afficher" value={filter} onChange={e => setFilter(e.target.value)}>
            <MenuItem value="all">Toutes les chambres</MenuItem>
            <MenuItem value="target">Objectif du jour 🎯</MenuItem>
            <MenuItem value="free">Chambres libres</MenuItem>
            <MenuItem value="missing">Jamais contrôlées</MenuItem>
            <MenuItem value="problems">À revoir</MenuItem>
            <MenuItem value="cleaning">Ménage non fait</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      
      {roomGroups.filter(g => group === "all" || group === g.label).map(g => {
        const numbers = g.rooms.filter(n => n.includes(search.trim())).filter(n => { 
          const r = latest.get(n); 
          if (filter === "all") return true;
          if (filter === "target") return targetRooms.includes(n) || inspectedTodayRooms.includes(n);
          if (filter === "missing") return !r;
          if (filter === "problems") return !!r && hasProblem(r);
          if (filter === "free") return !!r && r.occupied === false;
          if (filter === "cleaning") return !!r && r.occupied === false && r.cleaning === "non_faite";
          return true;
        });
        
        if (!numbers.length) return null;
        
        return <Box key={g.label}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>{g.label}</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1.5 }}>
            {numbers.map(n => { 
              const record = latest.get(n); 
              const isTarget = targetRooms.includes(n);
              const isDoneToday = inspectedTodayRooms.includes(n);
              
              return <Paper key={n} variant="outlined" sx={{ p: 2, borderColor: isTarget ? "primary.main" : (isDoneToday ? "success.light" : "divider"), bgcolor: isDoneToday ? "#fafdfa" : "inherit" }}>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h5" color={isDoneToday ? "success.main" : "text.primary"}>{n}</Typography>
                    {isTarget && <Chip label="Priorité" size="small" color="primary" />}
                    {isDoneToday && <Chip label="Fait" size="small" color="success" variant="outlined" />}
                  </Stack>
                  <Typography variant="caption">{record ? `Dernier contrôle : ${displayDate(record.date)}` : "Pas encore contrôlée"}</Typography>
                  {record && <>
                    <Chip size="small" label={hasProblem(record) ? "À revoir" : record.checks.some(c => c.result === "non_verifie") || record.microwave === "non_verifie" ? "Vérification partielle" : "Contrôlée"} color={hasProblem(record) && !isDoneToday ? "warning" : "default"} />
                    <Typography variant="caption">{record.occupied === false ? `Chambre libre · Ménage : ${cleaningText(record)}` : record.occupied === true ? "Chambre occupée" : "Occupation non renseignée"}{queued.some(q => q.id === record.id) ? " · En attente d’envoi" : ""}</Typography>
                  </>}
                  <Button variant="contained" color={isDoneToday ? "inherit" : "primary"} onClick={() => setRoom(n)} aria-label={`Contrôler la chambre ${n}`}>
                    {isDoneToday ? "Recontrôler" : "Contrôler"}
                  </Button>
                  <Button size="small" aria-label={`Historique de la chambre ${n}`} onClick={() => setHistoryRoom(n)}>Historique</Button>
                </Stack>
              </Paper>; 
            })}
          </Box>
        </Box>;
      })}
    </Stack>
    {room && <RoomForm key={room} room={room} onClose={() => setRoom(null)} />}
    {historyRoom && <RoomHistoryDialog key={historyRoom} room={historyRoom} history={history} onClose={() => setHistoryRoom(null)} />}
  </>;
}