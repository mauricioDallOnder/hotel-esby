"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { canReplaceWorkRequest, pendingEntryLabel, workRecoveryBlockReason, workRequestDetails, type EntryRecoveryReview } from "@/lib/entryRecovery";
import type { PendingEntry } from "@/lib/entryQueue";
import { latestCafardObservationId } from "@/lib/work";

export type EntryRecoveryAction = "acknowledge" | "edit" | "replace" | "dismiss" | "retry";

export function EntryRecoveryDialog({ item, pending, onCheck, onResolve, onClose }: {
  item: PendingEntry; pending: readonly PendingEntry[];
  onCheck: () => Promise<EntryRecoveryReview>;
  onResolve: (review: EntryRecoveryReview, action: EntryRecoveryAction) => Promise<void>;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [review, setReview] = useState<EntryRecoveryReview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const running = useRef(false);
  const checkRef = useRef(onCheck);
  useEffect(() => { checkRef.current = onCheck; }, [onCheck]);
  useEffect(() => {
    let active = true;
    void checkRef.current().then(value => { if (active) setReview(value); })
      .catch(failure => { if (active) setError((failure as Error).message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [item.entry.id]);

  async function checkAgain() {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setReview(null); setConfirmed(false); setDiscardConfirmed(false);
    try { setReview(await onCheck()); }
    catch (failure) { setError((failure as Error).message); }
    finally { running.current = false; setBusy(false); }
  }
  async function resolve(action: EntryRecoveryAction) {
    if (!review || running.current || action === "replace" && !confirmed || action === "dismiss" && !discardConfirmed) return;
    running.current = true; setBusy(true); setError("");
    try { await onResolve(review, action); }
    catch (failure) { setError((failure as Error).message); setReview(null); setConfirmed(false); setDiscardConfirmed(false); }
    finally { running.current = false; setBusy(false); }
  }
  const canReplace = !!review && canReplaceWorkRequest(review, pending);
  const entry = item.entry;
  const workBlockReason = review ? workRecoveryBlockReason(review, pending) : undefined;
  const currentDetection = review && entry.type === "createWorkEvent" && entry.kind === "cafardFollowup"
    ? (review.state.roomInspections || []).find(record => record.id === latestCafardObservationId(review.state.roomInspections || [], entry.room)) : undefined;
  return <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="entry-recovery-title">
    <DialogTitle id="entry-recovery-title">Vérifier l’envoi · {pendingEntryLabel(entry)}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {busy && <Stack direction="row" spacing={1.5}><CircularProgress size={20} /><Typography role="status">Vérification de l’enregistrement…</Typography></Stack>}
        {review && <Alert severity={review.kind === "saved" ? "success" : "warning"}>{review.message}</Alert>}
        <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
          <Typography variant="subtitle2">Votre demande conservée</Typography>
          <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.type === "createWorkEvent"
            ? workRequestDetails(entry) : `${entry.date} · ${entry.actor}\n${entry.notes || "Sans observation complémentaire"}`}</Typography>
          {entry.type === "createRoomInspection" && <Typography variant="body2" sx={{ mt: 1 }}>{entry.checks.filter(check => check.result !== "non_verifie").length} équipements vérifiés · {entry.photosData.length} photo(s) conservée(s)</Typography>}
        </Box>
        {review?.current && <Box sx={{ p: 2, bgcolor: "action.hover", borderRadius: 2 }}>
          <Typography variant="subtitle2">État actuellement enregistré</Typography>
          <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{workRequestDetails(review.current)}</Typography>
        </Box>}
        {currentDetection && <Alert severity="warning">
          <Typography variant="subtitle2">Dernière détection enregistrée · {currentDetection.date}</Typography>
          <Typography variant="body2">Contrôle de {currentDetection.actor}</Typography>
          {currentDetection.notes && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{currentDetection.notes}</Typography>}
          <Typography variant="body2">Tenez compte de cette détection avant de confirmer l’état du suivi.</Typography>
        </Alert>}
        {review && review.dependentIds.length > 0 && <Alert severity="info">{review.dependentIds.length} autre(s) demande(s) dépendent de cet envoi. Elles resteront à vérifier, même si vous annulez celui-ci.</Alert>}
        {review?.kind === "missing" && workBlockReason && <Typography variant="body2">{workBlockReason}</Typography>}
        {canReplace && !discarding && <FormControlLabel sx={{ alignItems: "flex-start" }} control={<Checkbox checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />}
          label="J’ai comparé les informations. Je confirme que ma demande ci-dessus décrit bien l’état à enregistrer maintenant." />}
        {review && !["saved", "partial"].includes(review.kind) && (discarding ? <Alert severity="warning">
          <Typography variant="body2">L’annulation retire uniquement cette demande du navigateur. Les informations déjà enregistrées et les autres demandes sont conservées.</Typography>
          <FormControlLabel control={<Checkbox checked={discardConfirmed} disabled={busy} onChange={event => setDiscardConfirmed(event.target.checked)} />} label="Je confirme l’annulation de cette demande." />
          <Button disabled={busy} onClick={() => { setDiscarding(false); setDiscardConfirmed(false); }}>Conserver la demande</Button>
        </Alert> : <Button color="inherit" disabled={busy} onClick={() => setDiscarding(true)} sx={{ alignSelf: "flex-start", minHeight: 44 }}>Annuler cette demande en attente</Button>)}
        {!busy && <Button onClick={() => void checkAgain()} sx={{ alignSelf: "flex-start", minHeight: 44 }}>Vérifier à nouveau</Button>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2, flexWrap: "wrap", gap: 1 }}>
      <Button disabled={busy} onClick={onClose} sx={{ minHeight: 48 }}>Fermer</Button>
      {review && (review.kind === "saved" ? <Button variant="contained" disabled={busy} onClick={() => void resolve("acknowledge")}>Fermer l’envoi confirmé</Button>
        : review.kind === "partial" ? <Button variant="contained" disabled={busy} onClick={() => void resolve("retry")}>Terminer la synchronisation</Button>
        : discarding ? <Button variant="contained" color="error" disabled={busy || !discardConfirmed} onClick={() => void resolve("dismiss")}>Confirmer l’annulation</Button>
        : review.kind !== "missing" ? null
        : entry.type === "createRoomInspection" ? <Button variant="contained" disabled={busy} onClick={() => void resolve("edit")}>Corriger le contrôle</Button>
        : entry.type === "createFamilyEvent" ? <Button variant="contained" disabled={busy} onClick={() => void resolve("retry")}>Réessayer cet envoi</Button>
        : canReplace ? <Button variant="contained" disabled={busy || !confirmed} onClick={() => void resolve("replace")}>Confirmer une nouvelle modification</Button> : null)}
    </DialogActions>
  </Dialog>;
}
