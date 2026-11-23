"use client";

import { useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { createId, displayDate } from "@/lib/domain";
import type { OccupancyImport } from "@/lib/occupancyImport";
import { latestWork } from "@/lib/work";

const labels = { occupied: "Occupée", available: "Libre", works: "En travaux" };

type Preview = { batch: OccupancyImport; ignoredRooms: string[] };

export function OccupancyImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const { readRecoveryState, importOccupancy, role } = useAppContext();
  const { pending, ready, online } = useEntries();
  const input = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [step, setStep] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const affected = new Set(preview?.batch.rows.map(row => row.room));
  const pendingRoom = pending.some(({entry}) => entry.type === "createWorkEvent" && entry.kind === "roomAvailability" && affected.has(entry.targetId));

  async function prepare(selected: File) {
    if (working.current) return;
    working.current = true;
    setFile(selected); setPreview(undefined); setStep("reading"); setError(""); setConflict(false);
    try {
      const { parseSejours } = await import("@/lib/parseSejours");
      const parsed = await parseSejours(selected);
      const state = await readRecoveryState();
      const current = latestWork(state.workEvents || [], "roomAvailability");
      const rows = parsed.rows.map(row => ({ ...row, expectedPreviousEventId: current.get(row.room)?.id || null }));
      setPreview({batch: {id: createId(), actor: role === "direction" ? "Direction" : "Employé", date: parsed.date, rows}, ignoredRooms: parsed.ignoredRooms});
    } catch (e) {
      setError(e instanceof Error ? e.message : "La fiche n’a pas pu être lue.");
    } finally { working.current = false; setStep(null); }
  }

  async function confirm() {
    if (!preview || working.current || !ready || !online || pendingRoom || conflict) return;
    working.current = true;
    setStep("saving"); setError("");
    try {
      await importOccupancy(preview.batch);
      onImported(`Fiche du ${displayDate(preview.batch.date)} importée · ${preview.batch.rows.length} chambres enregistrées.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "L’import n’a pas pu être confirmé.");
      setConflict(!!e && typeof e === "object" && "status" in e && e.status === 409);
    } finally { working.current = false; setStep(null); }
  }

  return <Dialog open fullWidth maxWidth="sm" onClose={step ? undefined : onClose} aria-labelledby="occupancy-import-title">
    <DialogTitle id="occupancy-import-title">Importer la fiche de séjours</DialogTitle>
    <DialogContent dividers><Stack spacing={2}>
      <input ref={input} hidden type="file" accept=".xlsx" aria-label="Fiche de séjours Excel" onChange={event => {
        const selected = event.target.files?.[0];
        event.target.value = "";
        if (selected) void prepare(selected);
      }} />
      <Button variant="outlined" disabled={!!step} onClick={() => input.current?.click()} sx={{ alignSelf: "flex-start" }}>
        {file ? "Choisir une autre fiche" : "Choisir une fiche Excel (.xlsx)"}
      </Button>
      <Typography variant="body2" color="text.secondary">Si la fiche couvre plusieurs jours, l’import utilise la première date du nom de fichier.</Typography>
      {file && <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{file.name}</Typography>}
      {step === "reading" && <Typography role="status">Lecture de la fiche…</Typography>}
      {error && <Alert severity="error">{error}</Alert>}
      {!online && <Alert severity="warning">Connectez-vous au réseau pour importer la fiche.</Alert>}
      {preview && <>
        <Typography variant="h6">Occupation au {displayDate(preview.batch.date)}</Typography>
        <Stack direction="row" useFlexGap sx={{ gap: 2, flexWrap: "wrap" }}>
          <Typography variant="body2">Occupées · {preview.batch.rows.filter(row => row.status === "occupied").length}</Typography>
          <Typography variant="body2">Libres · {preview.batch.rows.filter(row => row.status === "available").length}</Typography>
          <Typography variant="body2">En travaux · {preview.batch.rows.filter(row => row.status === "works").length}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">La fin de séjour correspond au dernier jour visible pour cet occupant dans la fiche.</Typography>
        {preview.ignoredRooms.length > 0 && <Alert severity="info">Chambres hors inventaire ignorées · {preview.ignoredRooms.join(", ")}</Alert>}
        {pendingRoom && <Alert severity="warning">Une modification d’occupation attend la synchronisation. Terminez son envoi, puis actualisez l’aperçu.</Alert>}
        <TableContainer sx={{maxHeight: 320}}>
          <Table size="small" stickyHeader aria-label="Aperçu de la fiche de séjours">
            <TableHead><TableRow>{["Chambre", "Occupation", "Occupant", "Jusqu’au"].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>{preview.batch.rows.map(row => <TableRow key={row.room}>
              <TableCell component="th" scope="row">{row.room}</TableCell><TableCell>{labels[row.status]}</TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{row.guestName}</TableCell><TableCell>{row.stayUntil && displayDate(row.stayUntil)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </TableContainer>
      </>}
      {file && ((!preview && error) || conflict || pendingRoom) && <Button disabled={!!step || !online} onClick={() => void prepare(file)}>Actualiser l’aperçu</Button>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose} disabled={!!step}>Annuler</Button>
      <Button variant="contained" disabled={!preview || !!step || !online || !ready || pendingRoom || conflict} onClick={() => void confirm()}>
        {step === "saving" ? "Import en cours…" : "Confirmer l’import"}
      </Button>
    </DialogActions>
  </Dialog>;
}
