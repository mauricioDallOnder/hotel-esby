"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import PhotoCameraOutlined from "@mui/icons-material/PhotoCameraOutlined";
import { useAppContext } from "@/context/AppContext";
import { preparePhotos, type PhotoProgress } from "@/lib/photos";
import { categories, commandSchema, displayDate, issuePhotoIds, issueResponsible, MAX_ISSUE_PHOTOS, createId, priorities, statuses, today, type Issue, type IssueFields, type Status } from "@/lib/domain";
import { duplicateRoomIssueMessage, findDuplicateOpenIssue, isCafardTechnicalReport, issueRoom, openRoomIssues, shouldCheckIssueDuplicate } from "@/lib/roomIssueMatching";
import { getProblemPreset, problemPresets } from "@/lib/problemPresets";
import { cafardCases, emptyCafardCase, type CafardCase } from "@/lib/cafards";
import { cafardSeedsFromIssues } from "@/lib/cafardsLegacy";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { rooms } from "@/lib/rooms";
import { CafardFollowupDialog } from "./CafardFollowupDialog";
import { IssueBadges } from "./HotelUI";
import { IssuePhoto } from "./IssuePhoto";
import { QuickChoice } from "./QuickChoice";
import { ProblemTypeSelect } from "./ProblemTypeSelect";
import { flushDeviceDrafts, useDeviceDraft } from "@/lib/useDeviceDraft";
import { deviceStore } from "@/lib/deviceStore";
import { freshIssueDraft, issueDraftCommand, issueDraftIsStale, issueDraftKey, type ActiveIssueDraft, type IssueDefaults, type IssueDraft } from "@/lib/issueDraft";
import { aggregateFindingStatus, findingDetailsText, issueFindingStates, type FindingDetail, type FindingState } from "@/lib/issueFindings";

const problemOptions = [...problemPresets.filter(preset => preset.id !== "other"),
  { id: "cafards", label: "Cafards / nuisibles · suivi dédié" }, ...problemPresets.filter(preset => preset.id === "other")];

type IssueDialogProps = {
  issue?: Issue;
  defaults?: IssueDefaults;
  draftKey?: string;
  onClose: () => void; onSaved?: (issue: Issue) => void;
  onOpenExisting?: (issue: Issue) => void;
};

export function IssueDialog(props: IssueDialogProps) {
  const { role } = useAppContext();
  const key = props.draftKey || issueDraftKey(props.issue, props.defaults);
  const draft = useDeviceDraft<IssueDraft>(key, () => freshIssueDraft(props.issue, props.defaults));
  const activeWritten = useRef(false);
  async function persist(value: IssueDraft) {
    draft.update(value);
    await flushDeviceDrafts();
    if (!activeWritten.current) {
      await deviceStore<ActiveIssueDraft>("put", "active-issue-draft", { key, ...(props.issue ? { issueId: props.issue.id } : {}) });
      activeWritten.current = true;
      window.dispatchEvent(new Event("issue-draft-change"));
    }
  }
  async function clear() {
    await draft.clear();
    const active = await deviceStore<ActiveIssueDraft | undefined>("get", "active-issue-draft");
    if (active?.key === key) await deviceStore("delete", "active-issue-draft");
    window.dispatchEvent(new Event("issue-draft-change"));
  }
  if (!draft.value) return <Dialog open fullWidth maxWidth="sm"><DialogTitle>Chargement du brouillon…</DialogTitle><DialogContent>{draft.error && <Alert severity="error">{draft.error}</Alert>}</DialogContent></Dialog>;
  return <IssueDialogForm {...props} storedDraft={props.issue && role !== "direction" ? freshIssueDraft(props.issue) : draft.value} persistDraft={persist} clearDraft={clear} draftError={draft.error} draftSaving={draft.saving} />;
}

function IssueDialogForm({ issue, onClose, onSaved, onOpenExisting, storedDraft, persistDraft, clearDraft, draftError, draftSaving }: IssueDialogProps & {
  storedDraft: IssueDraft; persistDraft: (value: IssueDraft) => Promise<void>; clearDraft: () => Promise<void>; draftError: string; draftSaving: boolean;
}) {
  const { mutate, busy, role, issues, refresh } = useAppContext();
  const { history: roomHistory } = useRoomObservations();
  const { events: workEvents } = useWorkEvents();
  const readOnly = !!issue && role !== "direction";
  const theme = useTheme(), mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [id] = useState(storedDraft.id);
  const [initial, setInitial] = useState<IssueFields>(storedDraft.baseline);
  const [expectedVersion, setExpectedVersion] = useState(storedDraft.expectedVersion);
  const [commandId, setCommandId] = useState(storedDraft.commandId);
  const [initialDate] = useState(storedDraft.baselineDate);
  const [initialActor] = useState(storedDraft.baselineActor);
  const [fields, setFields] = useState<IssueFields>(storedDraft.fields);
  const [customTitle, setCustomTitle] = useState(storedDraft.customTitle);
  const [cafardMode, setCafardMode] = useState(storedDraft.cafardMode);
  const [cafardDialog, setCafardDialog] = useState<CafardCase | null>(null);
  const [embeddedIssue, setEmbeddedIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState("");
  const [date, setDate] = useState(storedDraft.date);
  const [actor, setActor] = useState(storedDraft.actor);
  const [status, setStatus] = useState<Status>(storedDraft.status);
  const [note, setNote] = useState(storedDraft.note);
  const [photos, setPhotos] = useState<string[]>(storedDraft.photos);
  const [findingStates, setFindingStates] = useState<FindingState[]>(storedDraft.findingStates);
  const [findingDetails, setFindingDetails] = useState<FindingDetail[]>(storedDraft.findingDetails);
  const [findingDetailsReviewed, setFindingDetailsReviewed] = useState(storedDraft.findingDetailsReviewed);
  const [distinctFromIssueIds, setDistinctFromIssueIds] = useState(storedDraft.distinctFromIssueIds);
  const [distinctReason, setDistinctReason] = useState(storedDraft.distinctReason);
  const [attempt, setAttempt] = useState(storedDraft.attempt);
  const [processing, setProcessing] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<PhotoProgress>({ completed: 0, total: 0 });
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(!issue || readOnly);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [nextIssue, setNextIssue] = useState<Issue | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const finished = useRef(false);
  const dirty = !readOnly && (JSON.stringify(fields) !== JSON.stringify(initial) || actor !== initialActor || !!note || !!photos.length || status !== storedDraft.baselineStatus || date !== initialDate || distinctFromIssueIds.length !== (issue?.distinctFromIssueIds?.length || 0) ||
    JSON.stringify(findingStates) !== JSON.stringify(issue ? issueFindingStates(issue) : []) || distinctReason !== (issue?.distinctReason || "") || findingDetailsReviewed !== (issue?.roomFindingsActive !== false));
  const snapshot = useMemo<IssueDraft>(() => ({ id, commandId, expectedVersion, fields, baseline: initial, baselineStatus: storedDraft.baselineStatus, baselineDate: initialDate, baselineActor: initialActor,
    date, actor, status, note, photos, customTitle, cafardMode, findingStates, findingDetails, findingDetailsReviewed, distinctFromIssueIds, distinctReason, ...(attempt ? { attempt } : {}) }),
  [id, commandId, expectedVersion, fields, initial, storedDraft.baselineStatus, initialDate, initialActor, date, actor, status, note, photos, customTitle, cafardMode, findingStates, findingDetails, findingDetailsReviewed, distinctFromIssueIds, distinctReason, attempt]);
  const persistence = useRef(persistDraft);
  useEffect(() => { persistence.current = persistDraft; }, [persistDraft]);
  useEffect(() => {
    if (!readOnly && !finished.current && (dirty || attempt)) void persistence.current(snapshot).catch(() => {});
  }, [snapshot, dirty, attempt, readOnly]);
  const currentIssue = issue ? issues.find(record => record.id === issue.id) || issue : undefined;
  const stale = issueDraftIsStale(snapshot, currentIssue);
  const frozen = !!attempt;
  const grouped = findingDetails.length > 1;
  const room = issueRoom({ location: fields.location });
  const validCafardRoom = !!room && rooms.includes(room);
  const known = !issue && room ? openRoomIssues(issues, room) : [];
  const candidate = issue ? { ...issue, ...fields, room, status, distinctFromIssueIds, distinctReason,
    ...(fields.title !== initial.title || fields.description !== initial.description ? { roomFindingsActive: false } : {}) }
    : { ...fields, id, distinctFromIssueIds, distinctReason };
  const cafardReport = !issue && (cafardMode || isCafardTechnicalReport(candidate));
  const presetSelected = !issue && !!fields.problemType && fields.problemType !== "other";
  const cafardRecords = useMemo(() => cafardCases(roomHistory, workEvents, cafardSeedsFromIssues(issues)), [roomHistory, workEvents, issues]);
  const existingCafard = room ? cafardRecords.find(record => record.room === room) : undefined;
  const checkDuplicate = !readOnly && (!issue || shouldCheckIssueDuplicate({ ...issue, ...fields, room, status }, issue));
  const duplicate = checkDuplicate && !cafardReport ? findDuplicateOpenIssue(candidate, issues) : undefined;
  function changeStatus(next: Status) {
    setStatus(next);
    setFindingStates(current => current.map(finding => ({ ...finding, status: next })));
  }
  function changeFindingState(key: string, next: Status) {
    const values = findingStates.map(finding => finding.key === key ? { ...finding, status: next } : finding);
    setFindingStates(values); setStatus(aggregateFindingStatus(values, status));
  }
  function changeFindingDetail(key: string, description: string) {
    const values = findingDetails.map(finding => finding.key === key ? { ...finding, label: getProblemPreset(finding.problemType)?.label || finding.label, description } : finding);
    setFindingDetails(values); setFields(current => ({ ...current, description: findingDetailsText(values).slice(0, 4000) }));
  }
  function changeFindingType(key: string, problemType: string) {
    const preset = getProblemPreset(problemType);
    if (!preset) return;
    const values = findingDetails.map(finding => finding.key === key ? { ...finding, label: preset.label, problemType } : finding);
    setFindingDetails(values); setFields(current => ({ ...current, description: findingDetailsText(values).slice(0, 4000) }));
  }
  function useCurrentVersion() {
    if (!currentIssue || frozen) return;
    const fresh = freshIssueDraft(currentIssue);
    setInitial(fresh.fields); setFields(fresh.fields); setExpectedVersion(fresh.expectedVersion); setCommandId(fresh.commandId);
    setStatus(fresh.status); setFindingStates(fresh.findingStates); setFindingDetails(fresh.findingDetails);
    setFindingDetailsReviewed(fresh.findingDetailsReviewed);
    setDistinctFromIssueIds(fresh.distinctFromIssueIds); setDistinctReason(fresh.distinctReason); setCustomTitle(fresh.customTitle);
    setError("");
  }
  function change<K extends keyof IssueFields>(key: K, value: IssueFields[K]) { setFields(current => ({ ...current, [key]: value })); }
  function changeTitle(title: string) {
    setCustomTitle(title);
    setFields(current => ({ ...current, title,
      ...(issue && current.problemType && title.trim() !== current.title.trim() ? { problemType: "other" } : {}),
    }));
  }
  function close() { if (!busy && !processing) { setNextIssue(null); if (dirty) setConfirmClose(true); else onClose(); } }
  async function leaveForm(discard = false) {
    try {
      if (discard) {
        if (frozen) { showError("Confirmez d’abord le résultat de l’envoi en réessayant. Le brouillon reste conservé."); return; }
        finished.current = true;
        await clearDraft();
      } else if (dirty) await persistDraft(snapshot);
      if (nextIssue && onOpenExisting) onOpenExisting(nextIssue); else onClose();
    } catch (error) { finished.current = false; showError((error as Error).message); setConfirmClose(false); }
  }
  function openExisting(existing: Issue) {
    if (busy || processing) return;
    if (!onOpenExisting) { setEmbeddedIssue(existing); return; }
    if (dirty) { setNextIssue(existing); setConfirmClose(true); }
    else onOpenExisting(existing);
  }
  function openCafardFollowup() {
    if (busy || processing) return;
    if (!room || !validCafardRoom) { showError("Indiquez une chambre de l’hôtel dans « Lieu précis » pour ouvrir son suivi des cafards."); return; }
    setError("");
    setCafardDialog(existingCafard || emptyCafardCase(room));
  }
  function selectProblem(problemType: string) {
    if (busy || processing) return;
    setError(""); setFeedback("");
    if (problemType === "cafards") {
      setCafardMode(true);
      if (validCafardRoom) openCafardFollowup();
      return;
    }
    setCafardMode(false);
    const preset = getProblemPreset(problemType);
    if (!preset) return;
    const previousPreset = getProblemPreset(fields.problemType);
    const automaticDescription = !fields.description.trim() || fields.description === previousPreset?.label;
    setFields(current => ({ ...current, problemType,
      title: problemType === "other" ? customTitle : preset.label,
      category: problemType === "other" ? current.category : preset.category,
      description: automaticDescription ? problemType === "other" ? "" : preset.label : current.description,
    }));
  }
  function showError(message: string) { setError(message); content.current?.scrollTo({ top: 0 }); }
  async function loadPhotos(files: File[]) {
    if (!files.length || processing || busy) return;
    if (photos.length + files.length > MAX_ISSUE_PHOTOS) { showError(`Ajoutez au maximum ${MAX_ISSUE_PHOTOS} photos.`); return; }
    setProcessing(true); setError("");
    try { const added = await preparePhotos(files, setPhotoProgress); setPhotos(current => [...current, ...added]); }
    catch (e) { showError((e as Error).message); }
    finally { setProcessing(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || processing || busy || submitting.current) return;
    setError("");
    if (!attempt && stale) { showError("Cette fiche a changé. Rechargez sa version actuelle en conservant votre note avant de continuer."); return; }
    if (!attempt && cafardReport) { openCafardFollowup(); return; }
    if (!attempt && duplicate) { showError(duplicateRoomIssueMessage(duplicate)); return; }
    const parsed = commandSchema.safeParse(issueDraftCommand(snapshot, currentIssue));
    if (!parsed.success) {
      if (parsed.error.issues.some(i => i.path[0] === "fields")) setDetailsOpen(true);
      showError(issue ? "Vérifiez les champs obligatoires : titre, lieu, description, nom de la personne qui saisit l’intervention et note d’intervention." : "Vérifiez les champs obligatoires : titre, lieu, description, nom de la personne qui signale et date du constat.");
      return;
    }
    submitting.current = true;
    try {
      const submitted = { ...snapshot, attempt: parsed.data };
      setAttempt(parsed.data);
      // The exact request, including compressed photos and its identifier, must
      // survive an expired session or an uncertain HTTP response.
      await persistDraft(submitted);
      const result = await mutate(parsed.data);
      const saved = result.issues.find(i => i.id === id);
      if (!saved) throw new Error("Confirmation d’enregistrement absente. Le brouillon est conservé ; réessayez.");
      finished.current = true;
      try { await clearDraft(); } catch { /* A confirmed request can safely be replayed if local cleanup fails. */ }
      onSaved?.(saved); onClose();
    } catch (e) {
      const responseStatus = (e as Error & { status?: number }).status;
      if ([400, 403, 409, 422].includes(responseStatus || 0)) {
        const nextCommandId = createId();
        setAttempt(undefined); setCommandId(nextCommandId);
        await persistDraft({ ...snapshot, commandId: nextCommandId, attempt: undefined }).catch(() => {});
      }
      showError((e as Error).message);
    }
    finally { submitting.current = false; }
  }
  const existingPhotos = issue ? issuePhotoIds(issue) : [];
  return <>
    <Dialog open={!embeddedIssue && !cafardDialog} fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy || processing ? undefined : close} aria-labelledby="issue-dialog-title">
      <Box component="form" noValidate onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: mobile ? "100%" : undefined, maxHeight: "100%" }}>
        <DialogTitle id="issue-dialog-title" sx={{ pb: 1.5 }}>
          {readOnly ? "Consulter l’anomalie" : issue ? "Suivi de l’anomalie" : "Signaler une anomalie"}
          {issue && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{issue.location} · {issue.title}</Typography>}
        </DialogTitle>
        <DialogContent ref={content} dividers sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {draftError && <Alert severity="error">{draftError}</Alert>}
            {feedback && <Alert severity="success">{feedback}</Alert>}
            {!readOnly && frozen && <Alert severity="warning">L’envoi reste à confirmer. Votre texte et vos photos sont conservés. Réessayez le même envoi avant de modifier ou supprimer ce brouillon.</Alert>}
            {!readOnly && stale && !frozen && <Alert severity="warning">
              Cette fiche a été modifiée depuis ce brouillon. Votre note est conservée ; vérifiez les informations actuelles avant d’ajouter votre intervention.
              <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
                <Button color="inherit" onClick={() => void refresh()}>Actualiser les données</Button>
                <Button color="inherit" onClick={useCurrentVersion}>Recharger la fiche en conservant ma note</Button>
              </Stack>
            </Alert>}
            {duplicate && <Alert severity="warning">
              {duplicateRoomIssueMessage(duplicate)}
              <Button color="inherit" disabled={busy || processing || frozen} onClick={() => openExisting(duplicate)} sx={{ display: "flex", mt: 1 }}>Ouvrir le signalement existant</Button>
              <Button color="inherit" disabled={busy || processing || frozen} onClick={() => setDistinctFromIssueIds(values => [...new Set([...values, duplicate.id])])} sx={{ display: "flex", mt: 1 }}>Il s’agit d’un autre équipement</Button>
            </Alert>}
            {!!distinctFromIssueIds.length && !readOnly && <TextField required disabled={busy || processing || frozen} label="Équipement différent : précisez l’emplacement ou le repère" value={distinctReason} multiline minRows={2}
              helperText="Cette précision sera conservée pour distinguer les suivis. Exemple : autre prise, sur le mur sud. Au moins 8 caractères."
              onChange={event => setDistinctReason(event.target.value)} slotProps={{ htmlInput: { minLength: 8, maxLength: 1000 } }} />}
            {issue && <><IssueBadges issue={issue} /><Typography variant="body2" sx={{ fontWeight: 600 }}>Responsable : {issueResponsible(issue) || "Non renseigné"}</Typography><Typography variant="caption" color="text.secondary">Signalée le {displayDate(issue.date)}</Typography></>}
            {readOnly && <Typography variant="body2" color="text.secondary">La direction gère les interventions et les changements d’état.</Typography>}
            {readOnly && issue?.roomFindingsActive === false && <Typography variant="caption">La fiche a été corrigée. Les constats ci-dessous proviennent du contrôle d’origine.</Typography>}
            {readOnly && issue?.roomFindings?.map(finding => <Typography key={finding.key} variant="body2">{finding.label} · {statuses[issueFindingStates(issue).find(value => value.key === finding.key)!.status]}</Typography>)}
            <Box component="fieldset" disabled={busy || processing || frozen} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
              <Stack spacing={2.5}>
                {issue && !readOnly && <Stack spacing={2}>
                  <Typography variant="h6">Ajouter une intervention</Typography>
                  {findingDetails.length > 0 && <Stack spacing={2}>
                    {!grouped && currentIssue?.roomFindingsActive === false && <Typography variant="caption">Constat du contrôle d’origine ci-dessous. La description corrigée de la fiche fait foi pour les prochains signalements.</Typography>}
                    {grouped && !findingDetailsReviewed && <Alert severity="warning">Les constats d’origine précèdent une correction de la fiche. Vérifiez chaque détail avant de les réutiliser pour les rapprochements.
                      <Button color="inherit" onClick={() => setFindingDetailsReviewed(true)}>Je confirme la liste des problèmes ci-dessous</Button>
                    </Alert>}
                    <Typography variant="subtitle2">{findingStates.filter(finding => finding.status !== "resolu").length} / {findingStates.length} problème(s) restant(s)</Typography>
                    {findingDetails.map(finding => <Box key={finding.key} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
                      <Typography sx={{ fontWeight: 600 }}>{finding.label}</Typography>
                      {finding.description && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{finding.description}</Typography>}
                      {grouped && <QuickChoice label={`État · ${finding.label}`} value={findingStates.find(item => item.key === finding.key)?.status || status}
                        options={[{ value: "ouvert", label: "À traiter", color: "warning" }, { value: "en_cours", label: "En cours" }, { value: "resolu", label: "Résolu", color: "success" }]}
                        onChange={next => changeFindingState(finding.key, next)} />}
                      {grouped && <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                        <ProblemTypeSelect label={`Type · ${finding.label}`} value={finding.problemType || "other"} options={problemPresets} onChange={type => changeFindingType(finding.key, type)} />
                        <TextField label={`Détail / emplacement · ${finding.label}`} multiline value={finding.description || ""} onChange={event => changeFindingDetail(finding.key, event.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
                      </Stack>}
                    </Box>)}
                  </Stack>}
                  {grouped ? <Stack spacing={1}>
                    <Typography variant="subtitle2" role="status">État global : {statuses[status]}</Typography>
                    <Typography variant="caption">La fiche devient résolue quand tous ses problèmes sont terminés. Utilisez chaque ligne pour une réparation partielle.</Typography>
                    <Button variant="outlined" color="success" disabled={status === "resolu"} onClick={() => changeStatus("resolu")}>
                      Marquer tous les problèmes résolus
                    </Button>
                  </Stack> : <QuickChoice label="État de résolution" value={status} options={[{ value: "ouvert", label: "À traiter", color: "warning" }, { value: "en_cours", label: "En cours" }, { value: "resolu", label: "Résolu", color: "success" }]} onChange={changeStatus} />}
                  <TextField label="Intervention saisie par" required value={actor} onChange={e => setActor(e.target.value)} helperText="Votre nom sera enregistré dans l’historique de cette intervention." slotProps={{ htmlInput: { maxLength: 200 } }} />
                  <TextField required label={status === "resolu" ? "Travaux effectués / résolution" : "Intervention ou modification effectuée"} multiline minRows={3} value={note} onChange={e => setNote(e.target.value)} helperText="La date, votre nom et cette note seront ajoutés à l’historique et au bilan mensuel." slotProps={{ htmlInput: { maxLength: 4000 } }} />
                  {status === "resolu" && issue.status !== "resolu" && <Alert severity="info">Après enregistrement, l’anomalie sera accessible avec le filtre « Résolu ».</Alert>}
                </Stack>}
                {issue && <Button onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen} sx={{ justifyContent: "flex-start" }}>{readOnly ? "Fiche et photos" : "Modifier la fiche / voir les photos"}{existingPhotos.length ? ` (${existingPhotos.length})` : ""}</Button>}
                <Collapse in={detailsOpen} unmountOnExit>
                  <Stack spacing={2}>
                    {!issue && <ProblemTypeSelect value={cafardMode ? "cafards" : fields.problemType || "other"} onChange={selectProblem} options={problemOptions} disabled={busy || processing}
                      helperText="Choisissez un problème fréquent ou « Autre problème » pour le décrire librement." />}
                    {!cafardMode && (issue || !fields.problemType || fields.problemType === "other") && <TextField required label="Titre" disabled={readOnly} placeholder="Ex. : Fuite sous le lavabo" value={fields.title} onChange={e => changeTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />}
                    <TextField required label="Lieu précis" disabled={readOnly} placeholder="Ex. : Chambre 204 · salle de bain" value={fields.location} onChange={e => change("location", e.target.value)}
                      error={cafardReport && !!fields.location.trim() && !validCafardRoom} helperText={cafardReport && !!fields.location.trim() && !validCafardRoom ? "Indiquez le numéro d’une chambre de l’hôtel." : undefined}
                      slotProps={{ htmlInput: { maxLength: 200 } }} />
                    {cafardReport && <Alert severity="info">
                      <Typography variant="subtitle2">{existingCafard ? `Un suivi des cafards existe déjà pour la chambre ${room}.` : "Les cafards ont leur propre suivi par chambre."}</Typography>
                      <Typography variant="body2">Utilisez ce suivi pour conserver les détections, les applications et les vérifications au même endroit. Votre saisie technique reste disponible en revenant.</Typography>
                      <Button color="inherit" disabled={!validCafardRoom || busy || processing} onClick={openCafardFollowup} sx={{ mt: 1 }}>{existingCafard ? "Ouvrir le suivi des cafards existant" : "Ouvrir le suivi des cafards"}</Button>
                      {!validCafardRoom && <Typography variant="caption" sx={{ display: "block" }}>Renseignez d’abord le numéro de chambre dans « Lieu précis ».</Typography>}
                    </Alert>}
                    {!cafardMode && <>
                    {known.length > 0 && <Alert severity="info">
                      <Typography variant="subtitle2">{known.length} problème(s) déjà ouvert(s) dans cette chambre</Typography>
                      <Typography variant="body2">Si le problème est déjà signalé, ouvrez sa fiche pour consulter le suivi.</Typography>
                      <Stack spacing={1} sx={{ mt: 1 }}>{known.map(item => <Box key={item.id}>
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{item.title} · {statuses[item.status]}</Typography>
                        <Button color="inherit" disabled={busy || processing} onClick={() => openExisting(item)} aria-label={`Ouvrir le suivi · ${item.title}`} sx={{ justifyContent: "flex-start", textAlign: "left" }}>Ouvrir ce suivi</Button>
                      </Box>)}</Stack>
                    </Alert>}
                    <TextField required={!presetSelected} disabled={readOnly || grouped} label="Description du problème" placeholder="Ex. : fuite sous le lavabo, eau au sol…" multiline minRows={3} value={fields.description} onChange={e => change("description", e.target.value)}
                      helperText={grouped ? "Modifiez chaque problème ci-dessus pour conserver ses détails et son état individuel." : presetSelected ? "Facultatif : le problème choisi suffit. Précisez l’emplacement ou le défaut si nécessaire." : undefined}
                      slotProps={{ htmlInput: { maxLength: 4000 } }} />
                    <TextField select label="Catégorie" disabled={readOnly} value={fields.category} onChange={e => change("category", e.target.value as IssueFields["category"])}>{categories.map(category => <MenuItem key={category} value={category}>{category}</MenuItem>)}</TextField>
                    {readOnly ? <Typography variant="body2">Priorité : {priorities[fields.priority]}</Typography>
                      : <QuickChoice label="Priorité" value={fields.priority} options={[{ value: "normale", label: "Normale" }, { value: "haute", label: "Haute", color: "warning" }, { value: "critique", label: "Critique", color: "error" }]} onChange={value => change("priority", value)} />}
                    {!issue && <>
                      <TextField required label="Signalé par" value={actor} onChange={e => setActor(e.target.value)} helperText="La personne qui signale devient automatiquement responsable de cette anomalie." slotProps={{ htmlInput: { maxLength: 200 } }} />
                      <TextField fullWidth type="date" required label="Date du constat" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Photos · facultatif</Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Button variant="outlined" component="label" startIcon={<PhotoCameraOutlined />} disabled={processing || busy || photos.length >= MAX_ISSUE_PHOTOS}>Prendre une photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => { void loadPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
                        <Button component="label" disabled={processing || busy || photos.length >= MAX_ISSUE_PHOTOS}>Choisir des photos<input hidden type="file" accept="image/*" multiple onChange={e => { void loadPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">{photos.length} / {MAX_ISSUE_PHOTOS} photos · facultatif</Typography>
                      {processing && <Box role="status"><Typography variant="body2">Préparation de la photo {Math.min(photoProgress.completed + 1, photoProgress.total)} / {photoProgress.total}…</Typography><LinearProgress variant="determinate" value={photoProgress.total ? 100 * photoProgress.completed / photoProgress.total : 0} sx={{ mt: 1 }} /></Box>}
                      {photos.map((src, index) => <Box key={index}><Box component="img" className="photo-preview" src={src} alt={`Photo ${index + 1} du problème signalé`} /><Button disabled={busy || processing} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>Retirer la photo {index + 1}</Button></Box>)}
                    </>}
                    {issue && existingPhotos.map((photoId, index) => <IssuePhoto key={photoId} issueId={issue.id} index={index} photoCount={existingPhotos.length} alt={`Photo ${index + 1} du problème signalé`} lazy={false} />)}
                    </>}
                  </Stack>
                </Collapse>
              </Stack>
            </Box>
            {issue && <Box>
              <Button onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}>Historique ({issue.history.length})</Button>
              <Collapse in={historyOpen} unmountOnExit><Stack spacing={2} sx={{ pt: 1 }}>
                {issue.history.length === 0 && <Typography variant="body2">Aucune intervention enregistrée.</Typography>}
                {issue.history.toReversed().map((event, index) => {
                  const assignment = event.assignee?.trim();
                  return <Box key={`${event.at}-${index}`} sx={{ borderLeft: "3px solid", borderColor: event.status === "resolu" ? "success.main" : "divider", pl: 2 }}>
                    <Typography variant="subtitle2">{event.actor} · {statuses[event.status]}</Typography>
                    <Typography variant="caption" color="text.secondary">{new Date(event.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</Typography>
                    <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", my: 0.5 }}>{event.note}</Typography>
                    {event.findingStates?.map(finding => <Typography key={finding.key} variant="body2">{event.findingDetails?.find(detail => detail.key === finding.key)?.label || issue.roomFindings?.find(detail => detail.key === finding.key)?.label || finding.key} : {statuses[finding.status]}</Typography>)}
                    <Typography variant="caption" color="text.secondary">{priorities[event.priority]}{assignment && assignment !== event.actor?.trim() ? ` · Responsable indiqué à cette date : ${assignment}` : ""}</Typography>
                  </Box>;
                })}
              </Stack></Collapse>
            </Box>}
            {!readOnly && <Typography variant="caption" color="text.secondary">{draftSaving ? "Sauvegarde du brouillon…" : "Brouillon et photos conservés sur cet appareil jusqu’à confirmation de l’enregistrement."}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: "wrap", gap: 1 }}>
          <Button disabled={busy || processing} onClick={close}>{readOnly ? "Fermer" : "Annuler"}</Button>
          {!readOnly && <Button disabled={busy || processing || (!attempt && (stale || !!duplicate || (distinctFromIssueIds.length > 0 && distinctReason.trim().length < 8) || (cafardReport && !validCafardRoom)))} variant="contained" type="submit">{busy ? "Enregistrement…" : attempt ? "Réessayer le même envoi" : cafardReport ? "Continuer dans le suivi des cafards" : issue ? "Enregistrer le suivi" : "Enregistrer l’anomalie"}</Button>}
        </DialogActions>
      </Box>
    </Dialog>
    <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} fullWidth maxWidth="xs" aria-labelledby="discard-issue-title">
      <DialogTitle id="discard-issue-title">{nextIssue ? "Ouvrir le suivi existant ?" : "Fermer sans enregistrer ?"}</DialogTitle>
      <DialogContent>Votre texte et vos photos peuvent rester sur cet appareil pour reprendre la saisie.{nextIssue ? " Le texte et les photos de cette nouvelle saisie ne seront pas ajoutés automatiquement au signalement existant." : ""}</DialogContent>
      <DialogActions sx={{ flexWrap: "wrap" }}><Button disabled={busy || processing} onClick={() => { setConfirmClose(false); setNextIssue(null); }}>Continuer la saisie</Button>
        {!frozen && <Button color="error" disabled={busy || processing} onClick={() => void leaveForm(true)}>Abandonner les modifications</Button>}
        <Button disabled={busy || processing} onClick={() => void leaveForm()}>Fermer et conserver</Button></DialogActions>
    </Dialog>
    {embeddedIssue && <IssueDialog key={embeddedIssue.id} issue={embeddedIssue} onClose={() => setEmbeddedIssue(null)}
      onSaved={() => { setEmbeddedIssue(null); setFeedback("Le suivi existant a été mis à jour. Votre nouvelle saisie est conservée."); }} />}
    {cafardDialog && <CafardFollowupDialog key={cafardDialog.room} record={cafardDialog}
      onClose={() => { setCafardDialog(null); setCafardMode(false); }}
      onSaved={() => { setFeedback(`Suivi des cafards enregistré pour la chambre ${cafardDialog.room}.`); setCafardDialog(null); setCafardMode(false); }} />}
  </>;
}
