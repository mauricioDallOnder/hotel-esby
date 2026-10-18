"use client";
import { useRef, useState } from "react";
import { Alert, Box, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import PhotoCameraOutlined from "@mui/icons-material/PhotoCameraOutlined";
import { useAppContext } from "@/context/AppContext";
import { compressPhoto } from "@/lib/photos";
import { categories, commandSchema, displayDate, issuePhotoIds, MAX_ISSUE_PHOTOS, createId, priorities, statuses, today, type Issue, type IssueFields, type Status } from "@/lib/domain";
import { issueRoom, openRoomIssues } from "@/lib/roomIssueMatching";
import { IssueBadges } from "./HotelUI";
import { IssuePhoto } from "./IssuePhoto";
import { QuickChoice } from "./QuickChoice";

export function IssueDialog({ issue, defaults, onClose, onSaved }: {
  issue?: Issue;
  defaults?: { title?: string; location?: string; actor?: string; priority?: IssueFields["priority"]; date?: string };
  onClose: () => void; onSaved?: (issue: Issue) => void;
}) {
  const { mutate, busy, role, issues } = useAppContext();
  const readOnly = !!issue && role !== "direction";
  const theme = useTheme(), mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [id] = useState(() => issue?.id || createId());
  const [initial] = useState<IssueFields>({ title: issue?.title || defaults?.title || "", location: issue?.location || defaults?.location || "", category: issue?.category || "Plomberie",
    priority: issue?.priority || defaults?.priority || "normale", description: issue?.description || "", assignee: issue?.assignee || "" });
  const [initialDate] = useState(() => defaults?.date || today());
  const [fields, setFields] = useState<IssueFields>(initial);
  const [date, setDate] = useState(initialDate);
  const [actor, setActor] = useState(defaults?.actor || "");
  const [status, setStatus] = useState<Status>(issue?.status || "ouvert");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(!issue || readOnly);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const dirty = !readOnly && (JSON.stringify(fields) !== JSON.stringify(initial) || actor !== (defaults?.actor || "") || !!note || !!photos.length || status !== (issue?.status || "ouvert") || date !== initialDate);
  const room = issueRoom({ location: fields.location });
  const known = !issue && room ? openRoomIssues(issues, room) : [];
  function change<K extends keyof IssueFields>(key: K, value: IssueFields[K]) { setFields(current => ({ ...current, [key]: value })); }
  function close() { if (!busy && !processing) { if (dirty) setConfirmClose(true); else onClose(); } }
  function showError(message: string) { setError(message); content.current?.scrollTo({ top: 0 }); }
  async function loadPhotos(files: File[]) {
    if (!files.length || processing || busy) return;
    if (photos.length + files.length > MAX_ISSUE_PHOTOS) { showError(`Ajoutez au maximum ${MAX_ISSUE_PHOTOS} photos.`); return; }
    setProcessing(true); setError("");
    try { const added = await Promise.all(files.map(file => compressPhoto(file, true))); setPhotos(current => [...current, ...added]); }
    catch (e) { showError((e as Error).message); }
    finally { setProcessing(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || processing || busy || submitting.current) return;
    setError("");
    const parsed = commandSchema.safeParse(issue ? { type: "updateIssue", id, version: issue.version, actor: fields.assignee, note, status, fields }
      : { type: "createIssue", id, date, actor, fields, photosData: photos });
    if (!parsed.success) {
      if (parsed.error.issues.some(i => i.path[0] === "fields")) setDetailsOpen(true);
      showError(issue ? "Vérifiez les champs obligatoires : titre, lieu, description, responsable de l’intervention et note d’intervention." : "Vérifiez les champs obligatoires : titre, lieu, description, nom de la personne qui signale et date du constat.");
      return;
    }
    submitting.current = true;
    try {
      const result = await mutate(parsed.data);
      const saved = result.issues.find(i => i.id === id)!;
      onSaved?.(saved); onClose();
    } catch (e) { showError((e as Error).message); }
    finally { submitting.current = false; }
  }
  const existingPhotos = issue ? issuePhotoIds(issue) : [];
  return <>
    <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy || processing ? undefined : close} aria-labelledby="issue-dialog-title">
      <Box component="form" noValidate onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: mobile ? "100%" : undefined, maxHeight: "100%" }}>
        <DialogTitle id="issue-dialog-title" sx={{ pb: 1.5 }}>
          {readOnly ? "Consulter l’anomalie" : issue ? "Suivi de l’anomalie" : "Signaler une anomalie"}
          {issue && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{issue.location} · {issue.title}</Typography>}
        </DialogTitle>
        <DialogContent ref={content} dividers sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {issue && <><IssueBadges issue={issue} /><Typography variant="caption" color="text.secondary">Signalée le {displayDate(issue.date)} par {issue.reportedBy}</Typography></>}
            {readOnly && <Typography variant="body2" color="text.secondary">La direction gère les interventions et les changements d’état.</Typography>}
            <Box component="fieldset" disabled={busy || processing} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
              <Stack spacing={2.5}>
                {issue && !readOnly && <Stack spacing={2}>
                  <Typography variant="h6">Ajouter une intervention</Typography>
                  <QuickChoice label="État de résolution" value={status} options={[{ value: "ouvert", label: "À traiter", color: "warning" }, { value: "en_cours", label: "En cours" }, { value: "resolu", label: "Résolu", color: "success" }]} onChange={setStatus} />
                  <TextField label="Responsable de l’intervention" required value={fields.assignee} onChange={e => change("assignee", e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                  <TextField required label={status === "resolu" ? "Travaux effectués / résolution" : "Intervention ou modification effectuée"} multiline minRows={3} value={note} onChange={e => setNote(e.target.value)} helperText="La date, le nom du responsable et cette note seront ajoutés à l’historique et au bilan mensuel." slotProps={{ htmlInput: { maxLength: 4000 } }} />
                  {status === "resolu" && issue.status !== "resolu" && <Alert severity="info">Après enregistrement, l’anomalie sera accessible avec le filtre « Résolu ».</Alert>}
                </Stack>}
                {issue && <Button onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen} sx={{ justifyContent: "flex-start" }}>{readOnly ? "Fiche et photos" : "Modifier la fiche / voir les photos"}{existingPhotos.length ? ` (${existingPhotos.length})` : ""}</Button>}
                <Collapse in={detailsOpen} unmountOnExit>
                  <Stack spacing={2}>
                    <TextField required label="Titre" disabled={readOnly} placeholder="Ex. : Fuite sous le lavabo" value={fields.title} onChange={e => change("title", e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                    <TextField required label="Lieu précis" disabled={readOnly} placeholder="Ex. : Chambre 204 · salle de bain" value={fields.location} onChange={e => change("location", e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                    {known.length > 0 && <Alert severity="info"><strong>{known.length} anomalie(s) déjà ouverte(s) dans cette chambre</strong>{known.slice(0, 3).map(item => <Typography key={item.id} variant="body2">{item.title} · {statuses[item.status]}</Typography>)}<Typography variant="caption">Vérifiez qu’il s’agit d’un nouveau problème avant de l’enregistrer.</Typography></Alert>}
                    <TextField required disabled={readOnly} label="Description du problème" placeholder="Ex. : fuite sous le lavabo, eau au sol…" multiline minRows={3} value={fields.description} onChange={e => change("description", e.target.value)} slotProps={{ htmlInput: { maxLength: 4000 } }} />
                    <TextField select label="Catégorie" disabled={readOnly} value={fields.category} onChange={e => change("category", e.target.value as IssueFields["category"])}>{categories.map(category => <MenuItem key={category} value={category}>{category}</MenuItem>)}</TextField>
                    {readOnly ? <Typography variant="body2">Priorité : {priorities[fields.priority]} · Responsable : {fields.assignee || "À désigner"}</Typography>
                      : <QuickChoice label="Priorité" value={fields.priority} options={[{ value: "normale", label: "Normale" }, { value: "haute", label: "Haute", color: "warning" }, { value: "critique", label: "Critique", color: "error" }]} onChange={value => change("priority", value)} />}
                    {!issue && <>
                      <TextField required label="Signalé par" value={actor} onChange={e => setActor(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                        <TextField fullWidth type="date" required label="Date du constat" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />
                        <TextField fullWidth label="Responsable de l’intervention" value={fields.assignee} onChange={e => change("assignee", e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                      </Stack>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Photos · facultatif</Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Button variant="outlined" component="label" startIcon={<PhotoCameraOutlined />} disabled={processing || busy || photos.length >= MAX_ISSUE_PHOTOS}>Prendre une photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => { void loadPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
                        <Button component="label" disabled={processing || busy || photos.length >= MAX_ISSUE_PHOTOS}>Choisir des photos<input hidden type="file" accept="image/*" multiple onChange={e => { void loadPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">{photos.length} / {MAX_ISSUE_PHOTOS} photos · facultatif</Typography>
                      {processing && <Typography>Préparation des photos…</Typography>}
                      {photos.map((src, index) => <Box key={index}><Box component="img" className="photo-preview" src={src} alt={`Photo ${index + 1} du problème signalé`} /><Button disabled={busy || processing} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>Retirer la photo {index + 1}</Button></Box>)}
                    </>}
                    {issue && existingPhotos.map((photoId, index) => <IssuePhoto key={photoId} issueId={issue.id} index={index} alt={`Photo ${index + 1} du problème signalé`} lazy={false} />)}
                  </Stack>
                </Collapse>
              </Stack>
            </Box>
            {issue && <Box>
              <Button onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}>Historique ({issue.history.length})</Button>
              <Collapse in={historyOpen} unmountOnExit><Stack spacing={2} sx={{ pt: 1 }}>
                {issue.history.length === 0 && <Typography variant="body2">Aucune intervention enregistrée.</Typography>}
                {issue.history.toReversed().map((event, index) => <Box key={`${event.at}-${index}`} sx={{ borderLeft: "3px solid", borderColor: event.status === "resolu" ? "success.main" : "divider", pl: 2 }}>
                  <Typography variant="subtitle2">{event.actor} · {statuses[event.status]}</Typography>
                  <Typography variant="caption" color="text.secondary">{new Date(event.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</Typography>
                  <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", my: 0.5 }}>{event.note}</Typography>
                  <Typography variant="caption" color="text.secondary">{priorities[event.priority]} · {event.assignee || "Sans responsable"}</Typography>
                </Box>)}
              </Stack></Collapse>
            </Box>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: "wrap", gap: 1 }}>
          <Button disabled={busy || processing} onClick={close}>{readOnly ? "Fermer" : "Annuler"}</Button>
          {!readOnly && <Button disabled={busy || processing} variant="contained" type="submit">{busy ? "Enregistrement…" : issue ? "Enregistrer le suivi" : "Enregistrer l’anomalie"}</Button>}
        </DialogActions>
      </Box>
    </Dialog>
    <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} fullWidth maxWidth="xs" aria-labelledby="discard-issue-title">
      <DialogTitle id="discard-issue-title">Fermer sans enregistrer ?</DialogTitle>
      <DialogContent>Les modifications saisies dans ce formulaire n’ont pas encore été enregistrées.</DialogContent>
      <DialogActions><Button onClick={() => setConfirmClose(false)}>Continuer la saisie</Button><Button color="error" onClick={onClose}>Abandonner les modifications</Button></DialogActions>
    </Dialog>
  </>;
}
