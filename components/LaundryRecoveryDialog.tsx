"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { getLaundryEndsAt, getLaundryMachine } from "@/lib/laundry";
import type { LaundryRecoveryReview } from "@/lib/laundryRecovery";
import type { WorkEntry, WorkEvent } from "@/lib/rooms";

type Resolution = "retry" | "replace" | "dismiss";

function dateTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "date non renseignée";
  return new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
}

function requestedAction(entry: WorkEntry) {
  if (entry.laundryAddedMinutes) return `Ajout demandé : ${entry.laundryAddedMinutes} min`;
  if (entry.laundryStatus === "recupere") return "Retrait demandé";
  if (entry.laundryStatus === "annule") return "Annulation demandée";
  return "Démarrage demandé";
}

function RecordedState({ event }: { event: WorkEvent }) {
  const machine = getLaundryMachine(event.targetId);
  return <Box sx={{ bgcolor: "action.hover", borderRadius: 2, p: 2 }}>
    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>État enregistré</Typography>
    <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>Chambre {event.room} · {machine?.label || event.targetId}</Typography>
    {event.laundryOwner && <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{event.laundryOwner}</Typography>}
    <Typography variant="body2" sx={{ mt: 0.75, overflowWrap: "anywhere" }}>{event.laundryStatus === "recupere"
      ? `Linge récupéré le ${dateTime(event.laundryCollectedAt || event.occurredAt)} · ${event.laundryCollectedBy || event.actor}`
      : event.laundryStatus === "annule" ? `Cycle annulé le ${dateTime(event.occurredAt)} · ${event.actor}`
      : `Cycle en cours · fin prévue le ${dateTime(getLaundryEndsAt(event))}`}</Typography>
    <Typography variant="caption" color="text.secondary">Cycle démarré le {dateTime(event.laundryStartedAt)}</Typography>
    {event.notes && <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{event.notes}</Typography>}
  </Box>;
}

export function LaundryRecoveryDialog({ entry, onCheck, onResolve, onClose }: {
  entry: WorkEntry;
  onCheck: () => Promise<LaundryRecoveryReview>;
  onResolve: (review: LaundryRecoveryReview, action: Resolution) => Promise<void>;
  onClose: () => void;
}) {
  const mobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [review, setReview] = useState<LaundryRecoveryReview | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const active = useRef(true);
  const running = useRef(false);
  const checkRef = useRef(onCheck);
  const content = useRef<HTMLDivElement>(null);
  const machine = getLaundryMachine(entry.targetId);
  const busy = checking || saving;
  const recorded = review?.confirmed || review?.current;
  const completed = review?.kind === "completed" || review?.kind === "saved";

  useEffect(() => { checkRef.current = onCheck; }, [onCheck]);
  useEffect(() => {
    active.current = true;
    let current = true;
    void checkRef.current().then(result => {
      if (current) setReview(result);
    }).catch(failure => {
      if (current) setError(failure instanceof Error ? failure.message : "Vérification impossible. Réessayez lorsque la connexion sera disponible.");
    }).finally(() => { if (current) setChecking(false); });
    return () => { current = false; active.current = false; };
  }, [entry.id]);

  async function checkAgain() {
    if (running.current || busy) return;
    running.current = true;
    setChecking(true); setError(""); setReview(null); setEmptyConfirmed(false); setDiscarding(false); setDiscardConfirmed(false);
    try {
      const result = await onCheck();
      if (active.current) setReview(result);
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "Vérification impossible. Réessayez lorsque la connexion sera disponible.");
    } finally {
      running.current = false;
      if (active.current) setChecking(false);
    }
  }

  async function resolve(action: Resolution) {
    if (!review || running.current || busy || action === "replace" && !emptyConfirmed || action === "dismiss" && !completed && !discardConfirmed) return;
    running.current = true;
    setSaving(true); setError("");
    try { await onResolve(review, action); }
    catch (failure) {
      if (active.current) {
        setError(failure instanceof Error ? failure.message : "Cette demande reste conservée. Vérifiez de nouveau l’état avant de continuer.");
        setReview(null); setEmptyConfirmed(false); setDiscarding(false); setDiscardConfirmed(false);
        content.current?.scrollTo({ top: 0 });
      }
    } finally {
      running.current = false;
      if (active.current) setSaving(false);
    }
  }

  return <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={saving ? undefined : onClose} aria-labelledby="laundry-recovery-title">
    <DialogTitle id="laundry-recovery-title">Vérifier la demande · {machine?.label || entry.targetId}</DialogTitle>
    <DialogContent ref={content} dividers>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {checking && <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <CircularProgress size={20} aria-hidden="true" />
          <Typography role="status" variant="body2">Vérification de l’état actuel…</Typography>
        </Stack>}
        {review && <Alert severity={completed ? "success" : review.kind === "retry" ? "info" : "warning"}>{review.message}</Alert>}
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Demande en attente</Typography>
          <Typography sx={{ mt: 0.5, fontWeight: 700 }}>Chambre {entry.room} · {requestedAction(entry)}</Typography>
          {entry.laundryOwner && <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{entry.laundryOwner}</Typography>}
          <Typography variant="body2" sx={{ mt: 0.75, overflowWrap: "anywhere" }}>Demandé le {dateTime(entry.occurredAt)} · {entry.actor}</Typography>
          <Typography variant="caption" color="text.secondary">Cycle démarré le {dateTime(entry.laundryStartedAt)}</Typography>
          {entry.notes && <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.notes}</Typography>}
        </Box>
        {recorded && <RecordedState event={recorded} />}
        {review?.kind === "reconfirm" && !discarding && <Stack spacing={1}>
          <Typography variant="body2">{entry.laundryStatus === "annule" ? "L’annulation" : "Le retrait"} sera enregistré{entry.laundryStatus === "annule" ? "e" : ""} à l’heure de cette confirmation, au nom de {entry.actor}. La note d’origine sera conservée.</Typography>
          <FormControlLabel control={<Checkbox checked={emptyConfirmed} disabled={busy} onChange={event => setEmptyConfirmed(event.target.checked)} />}
            label="Je confirme que la machine est arrêtée et vide." sx={{ alignItems: "flex-start", "& .MuiFormControlLabel-label": { pt: 1 } }} />
        </Stack>}
        {completed && <Typography variant="body2" color="text.secondary">Fermer cette demande retire uniquement le message de cet appareil. L’historique enregistré reste inchangé.</Typography>}
        {review && !completed && <>
          {discarding ? <Box sx={{ border: "1px solid", borderColor: "warning.main", borderRadius: 2, p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>Annuler la demande en attente ?</Typography>
            <Typography variant="body2" sx={{ mt: 0.75 }}>Cette demande sera retirée de cet appareil sans enregistrer l’action demandée. Les données déjà enregistrées restent inchangées.</Typography>
            <FormControlLabel control={<Checkbox checked={discardConfirmed} disabled={busy} onChange={event => setDiscardConfirmed(event.target.checked)} />}
              label="Je confirme l’annulation de cette demande en attente." sx={{ alignItems: "flex-start", "& .MuiFormControlLabel-label": { pt: 1 } }} />
            <Button color="inherit" disabled={busy} onClick={() => { setDiscarding(false); setDiscardConfirmed(false); }} sx={{ minHeight: 44 }}>Conserver la demande</Button>
          </Box> : <Button color="inherit" disabled={busy} onClick={() => { setDiscarding(true); setEmptyConfirmed(false); }} sx={{ alignSelf: "flex-start", minHeight: 44 }}>Annuler cette demande en attente</Button>}
        </>}
        {!checking && <Button variant="text" disabled={busy} onClick={() => void checkAgain()} sx={{ alignSelf: "flex-start", minHeight: 44 }}>Vérifier à nouveau</Button>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2, gap: 1, flexWrap: "wrap" }}>
      <Button onClick={onClose} disabled={saving} sx={{ minHeight: 48 }}>Fermer</Button>
      {review && (discarding ? <Button color="error" variant="contained" disabled={busy || !discardConfirmed} onClick={() => void resolve("dismiss")} sx={{ minHeight: 48 }}>
        {saving ? "Annulation…" : "Confirmer l’abandon de la demande"}
      </Button> : completed ? <Button variant="contained" disabled={busy} onClick={() => void resolve("dismiss")} sx={{ minHeight: 48 }}>
        {saving ? "Fermeture…" : "Fermer la demande déjà traitée"}
      </Button> : review.kind === "retry" ? <Button variant="contained" disabled={busy} onClick={() => void resolve("retry")} sx={{ minHeight: 48 }}>
        {saving ? "Envoi…" : "Réessayer cet envoi"}
      </Button> : review.kind === "reconfirm" ? <Button variant="contained" disabled={busy || !emptyConfirmed} onClick={() => void resolve("replace")} sx={{ minHeight: 48 }}>
        {saving ? "Enregistrement…" : entry.laundryStatus === "annule" ? "Confirmer l’annulation maintenant" : "Confirmer le retrait maintenant"}
      </Button> : null)}
    </DialogActions>
  </Dialog>;
}
