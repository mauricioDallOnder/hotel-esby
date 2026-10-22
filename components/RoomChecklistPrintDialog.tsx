"use client";
import { useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormLabel, LinearProgress, Radio, RadioGroup, Stack, Typography } from "@mui/material";
import type { RoomEntry, RoomInspection } from "@/lib/rooms";

type Props = {
  hotelName: string;
  selectedRooms: string[];
  history: (RoomEntry | RoomInspection)[];
  date: string;
  blockedIds: string[];
  onClose: () => void;
};

export function RoomChecklistPrintDialog({ hotelName, selectedRooms, history, date, blockedIds, onClose }: Props) {
  const [mode, setMode] = useState<"blank" | "latest">("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const generating = useRef(false);

  async function download() {
    if (generating.current || (mode === "latest" && !selectedRooms.length)) return;
    generating.current = true;
    setBusy(true); setError(""); setDownloaded(false);
    try {
      const { downloadRoomChecklist } = await import("@/lib/roomChecklistPdf");
      await downloadRoomChecklist(mode === "blank"
        ? { hotelName, mode: "blank" }
        : { hotelName, mode: "latest", selectedRooms, history, date, blockedIds });
      setDownloaded(true);
    } catch {
      setError("Le PDF n’a pas pu être préparé. Veuillez réessayer.");
    } finally {
      generating.current = false;
      setBusy(false);
    }
  }

  return <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="room-checklist-print-title" aria-describedby="room-checklist-print-description" slotProps={{ paper: { sx: { overflowWrap: "anywhere" } } }}>
    <DialogTitle id="room-checklist-print-title">Imprimer le checklist des chambres</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Typography id="room-checklist-print-description">Préparez une fiche vierge ou imprimez les derniers contrôles des chambres affichées.</Typography>
        <FormControl component="fieldset" disabled={busy}>
          <FormLabel component="legend" id="room-checklist-print-mode">Contenu du PDF</FormLabel>
          <RadioGroup aria-labelledby="room-checklist-print-mode" value={mode} onChange={event => { setMode(event.target.value as "blank" | "latest"); setError(""); setDownloaded(false); }}>
            <FormControlLabel value="blank" control={<Radio />} label="Fiche vierge à remplir" />
            <FormControlLabel value="latest" control={<Radio />} disabled={busy || !selectedRooms.length} label={`Derniers contrôles des chambres affichées (${selectedRooms.length})`} />
          </RadioGroup>
        </FormControl>
        <Typography variant="body2" color="text.secondary">{mode === "blank"
          ? "Une page vierge réutilisable, à photocopier et à remplir pendant votre tournée."
          : "Une fiche par chambre selon les filtres de la page. Les chambres sans contrôle sont incluses et signalées. Les observations longues peuvent continuer sur une autre page."}</Typography>
        {!selectedRooms.length && <Alert severity="info">Aucune chambre ne correspond aux filtres actuels. Vous pouvez télécharger une fiche vierge.</Alert>}
        <Typography variant="body2">Après le téléchargement, ouvrez le PDF et imprimez-le en A4, orientation portrait, à 100 %.</Typography>
        {busy && <LinearProgress aria-label="Préparation du PDF" />}
        {error && <Alert severity="error">{error}</Alert>}
        {downloaded && <Alert severity="success" role="status">Téléchargement lancé. Ouvrez le fichier PDF pour l’imprimer.</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 3, py: 2, flexWrap: "wrap", gap: 1 }}>
      <Button onClick={onClose} disabled={busy}>Fermer</Button>
      <Button variant="contained" onClick={() => void download()} disabled={busy || (mode === "latest" && !selectedRooms.length)}>{busy ? "Préparation du PDF…" : "Télécharger le PDF"}</Button>
    </DialogActions>
  </Dialog>;
}
