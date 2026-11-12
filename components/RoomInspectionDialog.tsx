"use client";
import { useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { createId, displayDate, issueResponsible, statuses, today } from "@/lib/domain";
import { cafardCases, cafardStatusLabels, cafardTreatmentReminder } from "@/lib/cafards";
import { cafardSeedsFromIssues } from "@/lib/cafardsLegacy";
import { normalizeRoomDraft, roomCheckResultLabel, roomChecks, roomEntrySchema, roomFindings, roomProblems, type RoomCheckKey, type RoomEntry } from "@/lib/rooms";
import { matchesRoomFinding, openRoomIssues, planRoomIssue } from "@/lib/roomIssueMatching";
import { problemPresetsForCheck } from "@/lib/problemPresets";
import { preparePhotos } from "@/lib/photos";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { QuickChoice } from "./QuickChoice";
import { ProblemTypeSelect } from "./ProblemTypeSelect";

type Draft = Omit<RoomEntry, "condition" | "carpet"> & {
  condition: RoomEntry["condition"] | ""; carpet: RoomEntry["carpet"] | "";
  // Draft-only answer: presence alone must not certify an untested fridge as functional.
  fridgePresent?: boolean;
};
const sections = ["Équipements", "État et ménage", "Résumé"];
function rememberedActor() { try { return localStorage.getItem("room-inspector") || ""; } catch { return ""; } }
const yesNo = [{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }] as const;
const cleanliness = [{ value: "propre", label: "Propre", color: "success" }, { value: "sale", label: "Sale", color: "warning" }] as const;

export function RoomInspectionDialog({ room, nextRoom, onClose, onSaved, onDefer, recovery }: {
  room: string; nextRoom?: string; onClose: () => void; onSaved: (next: boolean) => void; onDefer: () => void;
  recovery?: { originalId: string; entry: RoomEntry; onSubmit: (entry: RoomEntry) => Promise<void> };
}) {
  const { issues } = useAppContext();
  const { enqueue } = useEntries();
  const { history, day } = useRoomObservations();
  const { events } = useWorkEvents();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const content = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const preparingPhotos = useRef(false);
  const draft = useDeviceDraft<Draft>(recovery ? `draft:room-recovery:${recovery.originalId}` : `draft:room:${room}`, () => recovery ? normalizeRoomDraft(recovery.entry) as Draft : ({
    type: "createRoomInspection", schemaVersion: 5, id: createId(), room, date: today(), actor: rememberedActor(), notes: "", condition: "", occupied: null,
    cleaning: null, carpet: "", carpetNotes: "", microwave: "non_verifie", microwaveCleaning: "non_verifie", fridgeCleaning: "non_verifie", bugs: "non_verifie", photosData: [],
    checks: roomChecks.map(c => ({ key: c.key, result: "non_verifie" })), issueLinks: [], problemDetails: [],
  }), value => normalizeRoomDraft({ ...value, cleaning: value.cleaning || null }));
  const value = draft.value;
  const fridgeResult = value?.checks.find(check => check.key === "fridge")?.result;
  const fridgePresence = fridgeResult === "absent" ? "non" : fridgeResult === "ok" || fridgeResult === "probleme" || value?.fridgePresent ? "oui" : "";
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [photoProgress, setPhotoProgress] = useState({ completed: 0, total: 0 });
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  // After the first attempt, errors describe the current draft, including conditional fields.
  const validation = validationAttempted && value
    ? roomEntrySchema.safeParse({ ...value, inspectedAt: value.inspectedAt || undefined }) : undefined;
  const validationProblems = validation && !validation.success ? validation.error.issues : [];
  const invalid = validationProblems.map(issue => issue.path.join("."));
  const known = useMemo(() => openRoomIssues(issues, room), [issues, room]);
  const cafardCase = useMemo(() => cafardCases(history.filter(record => record.room === room), events.filter(event => event.room === room), cafardSeedsFromIssues(issues).filter(seed => seed.room === room))[0], [history, events, issues, room]);
  const cafardReminder = cafardCase ? cafardTreatmentReminder(cafardCase, day) : null;
  const review: RoomEntry | undefined = value ? { ...value, condition: value.condition || "bon", carpet: value.carpet || "ok" } : undefined;
  const findings = review ? roomFindings(review) : [];
  const findingLabels = new Set(findings.flatMap(finding => {
    const check = roomChecks.find(item => item.key === finding.key);
    return [finding.label, ...(check ? [`${check.label} : ${roomCheckResultLabel(check.key, "probleme")}`] : [])];
  }));
  const otherProblems = review ? roomProblems(review).filter(label => !findingLabels.has(label)) : [];
  const plan = value && findings.length ? planRoomIssue({ room, roomFindings: findings } as Parameters<typeof planRoomIssue>[0], { room, notes: value.notes, issueLinks: value.issueLinks, distinctProblemKeys: value.distinctProblemKeys }, issues) : undefined;
  const needsIssueChoice = !!plan?.requiresChoice.length;
  const issuePlanError = plan?.conflicts[0];
  const invalidField = (field: string) => invalid.some(item => item === field || item.startsWith(field + "."));
  const fieldMessage = (field: string) => validationProblems.find(problem => problem.path.join(".") === field)?.message;
  function goStep(next: number) { setStep(next); content.current?.scrollTo({ top: 0 }); }
  function update(patch: Partial<Draft>) { if (value) draft.update({ ...value, ...patch }); }
  function updateCheck(key: RoomCheckKey, result: RoomEntry["checks"][number]["result"]) {
    if (!value) return;
    update({ checks: value.checks.map(check => check.key === key ? { ...check, result } : check),
      ...(result !== "probleme" ? {
        problemDetails: value.problemDetails?.filter(detail => detail.key !== key),
        issueLinks: value.issueLinks?.filter(link => link.key !== key),
        distinctProblemKeys: value.distinctProblemKeys?.filter(item => item !== key),
      } : {}),
    });
  }
  function selectProblem(key: RoomCheckKey, problemType: string) {
    if (!value) return;
    const previous = value.problemDetails?.find(detail => detail.key === key);
    update({ problemDetails: [...(value.problemDetails || []).filter(detail => detail.key !== key),
      ...(problemType ? [{ key, problemType, ...(previous?.description ? { description: previous.description } : {}) }] : [])],
      issueLinks: value.issueLinks?.filter(link => link.key !== key),
      distinctProblemKeys: value.distinctProblemKeys?.filter(item => item !== key),
    });
  }
  function describeProblem(key: RoomCheckKey, description: string) {
    if (!value) return;
    update({ problemDetails: value.problemDetails?.map(detail => detail.key === key ? { ...detail, description } : detail) });
  }
  function updateFridgePresence(present: "oui" | "non") {
    if (!value) return;
    update({
      checks: value.checks.map(check => check.key === "fridge"
        ? { ...check, result: present === "non" ? "absent" : check.result === "absent" ? "non_verifie" : check.result }
        : check),
      fridgePresent: present === "oui",
      fridgeCleaning: present === "non" ? null : value.fridgeCleaning || "non_verifie",
    });
  }
  async function submit(next = false) {
    if (!value || submitting.current) return;
    setError("");
    const parsed = roomEntrySchema.safeParse({ ...value, inspectedAt: value.inspectedAt || new Date().toISOString() });
    if (!parsed.success) {
      const fields = parsed.error.issues.map(i => i.path.join("."));
      setValidationAttempted(true);
      goStep(fields.some(f => f.startsWith("checks") || f.startsWith("problemDetails")) ? 0 : fields.some(f => !["actor", "date", "notes", "issueLinks"].some(key => f === key || f.startsWith(key + "."))) ? 1 : 2);
      setShowMetadata(true);
      setTimeout(() => content.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    if (issuePlanError || needsIssueChoice) {
      setError(issuePlanError || "Choisissez le problème existant à utiliser pour chaque constat indiqué dans le résumé.");
      goStep(2);
      return;
    }
    setValidationAttempted(false); submitting.current = true; setBusy(true);
    try {
      draft.update({ ...value, inspectedAt: parsed.data.inspectedAt });
      if (recovery) await recovery.onSubmit(parsed.data);
      else await enqueue(parsed.data);
      try { localStorage.setItem("room-inspector", parsed.data.actor); } catch { /* Optional convenience. */ }
      if (recovery) { try { await draft.clear(); } catch { /* The replacement is already durable in the queue. */ } }
      else await draft.clear();
      onSaved(next);
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function addPhotos(files: File[]) {
    if (!value || !files.length || preparingPhotos.current) return;
    if (value.photosData.length + files.length > 3) { setError("Ajoutez au maximum 3 photos."); return; }
    preparingPhotos.current = true;
    setCompressing(true); setPhotoProgress({ completed: 0, total: files.length }); setError("");
    try { const photos = await preparePhotos(files, setPhotoProgress); update({ photosData: [...value.photosData, ...photos] }); }
    catch (e) { setError((e as Error).message); }
    finally { preparingPhotos.current = false; setCompressing(false); }
  }
  const checked = value?.checks.filter(c => c.result !== "non_verifie").length || 0;
  return <Dialog open fullWidth fullScreen={mobile} maxWidth="sm" onClose={busy || compressing ? undefined : onClose} aria-labelledby="inspection-title">
    <DialogTitle id="inspection-title" sx={{ pb: 1 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Box><Typography component="span" variant="h5" sx={{ fontWeight: 800 }}>Chambre {room}</Typography><Typography variant="body2" color="text.secondary">Contrôle rapide · {checked}/{roomChecks.length} équipements vérifiés</Typography></Box>
        <Button disabled={busy || compressing} onClick={onClose}>Fermer</Button>
      </Stack>
      <LinearProgress variant="determinate" value={checked / roomChecks.length * 100} sx={{ my: 1.5, height: 5, borderRadius: 4 }} />
      <Stack direction="row" spacing={0.5} role="navigation" aria-label="Étapes du contrôle">{sections.map((section, index) => <Button key={section} disabled={busy || compressing} onClick={() => goStep(index)} variant={step === index ? "contained" : "text"} aria-current={step === index ? "step" : undefined} sx={{ flex: 1, px: 0.5 }}>{index + 1}. {section}</Button>)}</Stack>
    </DialogTitle>
    <DialogContent ref={content} dividers sx={{ px: { xs: 2, sm: 3 } }}>
      {invalid.length > 0 && <Alert severity="error" sx={{ mb: 2 }}>Il reste des points à vérifier. Aucun contrôle n’a été enregistré.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {draft.error && <Alert severity="error">{draft.error}</Alert>}
      {recovery && <Alert severity="info" sx={{ mb: 2 }}>Correction d’un envoi refusé. Les réponses, photos et date du contrôle sont conservées. La demande précédente restera disponible jusqu’à l’enregistrement de cette correction.</Alert>}
      {!value ? <Typography>Chargement du brouillon…</Typography> : <Box component="fieldset" disabled={busy || compressing} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Stack spacing={2}>
          {known.length > 0 && <Box>
            <Button color="warning" onClick={() => setShowIssues(!showIssues)} aria-expanded={showIssues}>{known.length} problème(s) technique(s) déjà signalé(s)</Button>
            {showIssues && <Stack spacing={1}>{known.map(issue => <Alert key={issue.id} severity="warning" icon={false}><strong>{issue.title}</strong><Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{issue.description}</Typography><Typography variant="caption">{statuses[issue.status]} · {issueResponsible(issue) || "Non attribuée"}</Typography></Alert>)}</Stack>}
          </Box>}
          {cafardCase && <Alert severity={cafardCase.status === "resolu" ? "success" : cafardReminder?.due ? "warning" : "info"}>
            <Typography variant="subtitle2">Suivi des cafards déjà existant · {cafardStatusLabels[cafardCase.status]}</Typography>
            {cafardCase.detectedOn && <Typography variant="body2">Détection : {displayDate(cafardCase.detectedOn)}</Typography>}
            {cafardCase.treatedOn && <Typography variant="body2">Dernière application : {displayDate(cafardCase.treatedOn)}</Typography>}
            {cafardReminder?.due && <Typography variant="body2" sx={{ fontWeight: 700 }}>Vérification après traitement à faire depuis le {displayDate(cafardReminder.dueOn)}.</Typography>}
            <Typography variant="body2">{cafardCase.status === "resolu" ? "Une nouvelle détection rouvrira ce même suivi, en conservant son historique." : "Une nouvelle détection complétera ce même suivi, sans créer de doublon."}</Typography>
            {cafardCase.treatedOn && cafardCase.status !== "resolu" && <Typography variant="body2">L’application du produit et l’étape du suivi seront conservées. La vérification après traitement reste à effectuer.</Typography>}
            <Typography variant="caption">« Aucun » ne clôture pas le suivi : confirmez la résolution dans « Suivi des cafards ».</Typography>
          </Alert>}
          {step === 0 && <>
            <Typography variant="body2" color="text.secondary">Un toucher par résultat. « Absent » indique que l’équipement n’existe pas dans la chambre.</Typography>
            <Button variant="outlined" onClick={() => update({ checks: value.checks.map(c => c.result === "non_verifie" && !known.some(i => matchesRoomFinding(i, { key: c.key, label: "" })) ? { ...c, result: "ok" } : c) })}>J’ai vérifié : les équipements restants sont OK</Button>
            <Typography variant="caption" color="text.secondary">Le détecteur de fumée et le ferme-porte sont inclus. Pour le radiateur, OK signifie « Libre ». Les équipements déjà signalés restent à vérifier individuellement. Les réponses saisies sont conservées.</Typography>
            {roomChecks.map(check => {
              const result = value.checks.find(item => item.key === check.key)?.result;
              const detailIndex = value.problemDetails?.findIndex(detail => detail.key === check.key) ?? -1;
              const detail = detailIndex >= 0 ? value.problemDetails?.[detailIndex] : undefined;
              const presets = problemPresetsForCheck(check.key);
              const problemError = fieldMessage(`problemDetails.${detailIndex}.problemType`) || (check.key === "damage" ? fieldMessage("problemDetails") : undefined);
              const descriptionError = fieldMessage(`problemDetails.${detailIndex}.description`);
              return <Stack key={check.key} spacing={1.5}>
              <QuickChoice label={check.label} value={result} error={invalidField(`checks.${check.key}`)}
              options={check.key === "radiator_clear"
                ? [{ value: "ok", label: "Libre", color: "success" }, { value: "probleme", label: "Caché", color: "error" }]
                : [{ value: "ok", label: "OK", color: "success" }, { value: "probleme", label: "Problème", color: "error" }, { value: "absent", label: "Absent" }]}
              onChange={answer => updateCheck(check.key, answer)}
              hint={<>{check.key === "door_closer" && <Typography variant="caption" sx={{ display: "block" }}>Ouvrir puis relâcher la porte : vérifier qu’elle se referme. Noter aussi l’absence du mécanisme dans le contrôle.</Typography>}{check.key === "radiator_clear" && <Typography variant="caption" sx={{ display: "block" }}>« Libre » : rien ne couvre ou ne cache le radiateur. « Caché » : un signalement sera ajouté dans « Problèmes techniques ».</Typography>}{known.filter(i => matchesRoomFinding(i, { key: check.key, label: "" })).map(i => <Typography key={i.id} variant="caption" color="warning.main" sx={{ display: "block" }}>Déjà signalé : {i.title}</Typography>)}</>} />
              {result === "probleme" && presets.length > 0 && <Stack spacing={1.5} sx={{ pl: { xs: 0, sm: 2 } }}>
                <ProblemTypeSelect label={`Problème constaté · ${check.label}`} value={detail?.problemType || ""}
                  onChange={problemType => selectProblem(check.key, problemType)} options={presets} emptyLabel="Préciser le problème" disabled={busy || compressing}
                  helperText={problemError || "Choisissez le problème constaté. Vous pourrez le relier à une fiche déjà ouverte dans le résumé."}
                  error={!!problemError} />
                {detail && <TextField label={detail.problemType === "other" ? `Décrivez le problème · ${check.label}` : `Précision / emplacement · ${check.label}`}
                  required={detail.problemType === "other"} multiline minRows={2} value={detail.description || ""}
                  onChange={event => describeProblem(check.key, event.target.value)} error={invalidField(`problemDetails.${detailIndex}.description`)}
                  helperText={descriptionError || (detail.problemType === "other" ? "Décrivez ce qui ne va pas, en 1 000 caractères maximum." : "Facultatif, par exemple : prise près du lit, fenêtre côté rue. 1 000 caractères maximum.")}
                  slotProps={{ htmlInput: { maxLength: 1000 } }} />}
              </Stack>}
              </Stack>;
            })}
          </>}
          {step === 1 && <>
            <QuickChoice label="Chambre occupée" value={value.occupied === true ? "oui" : value.occupied === false ? "non" : ""} options={[{ value: "oui", label: "Occupée" }, { value: "non", label: "Libre" }]} error={invalidField("occupied")} onChange={v => update({ occupied: v === "oui", cleaning: v === "oui" ? null : value.cleaning })} />
            <QuickChoice label="État général de la chambre" value={value.condition} options={[{ value: "bon", label: "Bon", color: "success" }, { value: "a_revoir", label: "À revoir", color: "warning" }, { value: "mauvais", label: "Mauvais", color: "error" }]} error={invalidField("condition")} onChange={condition => update({ condition })} />
            <Typography variant="caption" color="text.secondary">« Mauvais » prévoit un nouveau contrôle prioritaire après quatre jours, sans créer de problème technique à lui seul.</Typography>
            {value.occupied === false && <QuickChoice label="Nettoyage / ménage" value={value.cleaning} options={[{ value: "faite", label: "Fait", color: "success" }, { value: "non_faite", label: "Non fait", color: "warning" }]} error={invalidField("cleaning")} onChange={cleaning => update({ cleaning })} />}
            <QuickChoice label="Présence de cafards ou nuisibles" value={value.bugs} options={[{ value: "non", label: "Aucun", color: "success" }, { value: "oui", label: "Détectés", color: "error" }]} error={invalidField("bugs")} onChange={bugs => update({ bugs })} />
            {value.bugs === "oui" && <Alert severity="info">{cafardCase ? "Cette détection sera ajoutée au suivi existant de cette chambre, sans créer de doublon." : "Après enregistrement, cette détection apparaîtra dans « Suivi des cafards » pour noter le traitement et les vérifications."}</Alert>}
            <QuickChoice label="État de la moquette" value={value.carpet} options={[{ value: "ok", label: "OK", color: "success" }, { value: "tachee", label: "Tachée", color: "warning" }, { value: "sale", label: "Sale", color: "warning" }]} error={invalidField("carpet")} onChange={carpet => update({ carpet })} />
            {value.carpet && value.carpet !== "ok" && <TextField label="Précisez les taches ou salissures" multiline minRows={2} value={value.carpetNotes} onChange={e => update({ carpetNotes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />}
            <QuickChoice label="Micro-ondes présent ?" value={value.microwave} options={[...yesNo]} error={invalidField("microwave")} onChange={microwave => update({ microwave })} />
            {value.microwave === "oui" && <QuickChoice label="Propreté du micro-ondes" value={value.microwaveCleaning} options={[...cleanliness]} error={invalidField("microwaveCleaning")} onChange={microwaveCleaning => update({ microwaveCleaning })} />}
            <QuickChoice label="Minibar / réfrigérateur présent ?" value={fridgePresence}
              options={[...yesNo]} error={!fridgePresence && invalidField("checks.fridge")} onChange={updateFridgePresence}
              hint={<Typography variant="caption">« Non » marque le minibar absent dans les équipements. Sa propreté n’est alors pas demandée.</Typography>} />
            {fridgePresence === "oui" && fridgeResult === "non_verifie" && <QuickChoice label="Minibar fonctionnel" value={fridgeResult}
              options={[{ value: "ok", label: "OK", color: "success" }, { value: "probleme", label: "Problème", color: "error" }]}
              error={invalidField("checks.fridge")} onChange={result => update({ checks: value.checks.map(check => check.key === "fridge" ? { ...check, result } : check) })} />}
            {fridgePresence === "oui" && <QuickChoice label="Propreté du minibar" value={value.fridgeCleaning} options={[...cleanliness]} error={invalidField("fridgeCleaning")} onChange={fridgeCleaning => update({ fridgeCleaning })} />}
          </>}
          {step === 2 && <>
            <TextField required label="Inspecteur" value={value.actor} error={invalidField("actor")} onChange={e => update({ actor: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} helperText="Mémorisé sur cet appareil pour le prochain contrôle." />
            <Button onClick={() => setShowMetadata(!showMetadata)} aria-expanded={showMetadata}>Date : {value.date.split("-").reverse().join("/")} · Modifier</Button>
            {showMetadata && <TextField required label="Date du contrôle" type="date" value={value.date} error={invalidField("date")} onChange={e => update({ date: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />}
            <Typography variant="h6">Problèmes techniques constatés · {findings.length}</Typography>
            {value.bugs === "oui" && <Alert severity="info">{cafardCase ? "Cafards détectés : constat ajouté au suivi existant de cette chambre. Aucun doublon." : "Cafards détectés : le suivi sera ajouté dans « Suivi des cafards »."}</Alert>}
            {!findings.length && <Alert severity="info">Aucune anomalie automatique à signaler. Les autres constats restent dans l’historique du contrôle.</Alert>}
            {issuePlanError && <Alert severity={needsIssueChoice ? "warning" : "error"}>{issuePlanError} Vérifiez les associations ci-dessous.</Alert>}
            {needsIssueChoice && !issuePlanError && <Alert severity="warning">Un problème déjà signalé peut correspondre à votre constat. Choisissez la fiche à utiliser ci-dessous. S’il s’agit d’un autre défaut, précisez-le dans les équipements.</Alert>}
            {findings.map(finding => {
              const matching = known.filter(issue => matchesRoomFinding(issue, finding));
              const explicit = value.issueLinks?.find(link => link.key === finding.key)?.issueId;
              const needsChoice = !!plan?.requiresChoice.includes(finding.key);
              const linked = known.find(issue => issue.id === explicit) || (!explicit && !needsChoice && matching.length === 1 ? matching[0] : undefined);
              const unavailable = !!explicit && !known.some(issue => issue.id === explicit);
              const options = [...matching, ...known.filter(issue => !matching.some(candidate => candidate.id === issue.id))];
              const checkLabel = roomChecks.find(check => check.key === finding.key)?.label || finding.label;
              return <Stack key={finding.key} spacing={1.5} sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 700 }}>{finding.label}</Typography>
                <Typography variant="caption" color={linked ? "warning.main" : needsChoice || unavailable ? "error.main" : "text.secondary"}>
                  {linked ? `Déjà signalé : ${linked.title} · aucun doublon` : needsChoice ? "Choix du suivi nécessaire" : unavailable ? "Le suivi choisi n’est plus disponible." : "Nouveau signalement"}
                </Typography>
                {(known.length > 0 || unavailable) && <TextField select fullWidth label={`Associer au problème existant · ${checkLabel}`} value={explicit || ""} disabled={busy || compressing}
                  error={needsChoice || unavailable} helperText={linked ? "Ce contrôle utilisera la fiche existante, avec son historique et son état de résolution." : "Tous les problèmes ouverts de cette chambre sont proposés, même si leur titre est différent."}
                  onChange={event => update({ distinctProblemKeys: value.distinctProblemKeys?.filter(key => key !== finding.key),
                    issueLinks: [...(value.issueLinks || []).filter(link => link.key !== finding.key), ...(event.target.value ? [{ key: finding.key, issueId: event.target.value }] : [])] })}
                  sx={{ "& .MuiSelect-select": { whiteSpace: "normal", overflowWrap: "anywhere" } }}>
                  <MenuItem value="" sx={{ whiteSpace: "normal" }}>{needsChoice ? "Choisir le problème déjà signalé" : linked ? `Correspondance automatique : ${linked.title}` : "Nouveau problème, aucune fiche sélectionnée"}</MenuItem>
                  {unavailable && <MenuItem value={explicit} disabled>Ancien suivi indisponible · choisissez une fiche</MenuItem>}
                  {options.map(issue => <MenuItem key={issue.id} value={issue.id} sx={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "calc(100vw - 32px)" }}>
                    {issue.title} · {statuses[issue.status]}{matching.some(candidate => candidate.id === issue.id) ? " · Correspondance possible" : ""}
                  </MenuItem>)}
                </TextField>}
              </Stack>;
            })}
            {!!plan?.relatedIssueIds.length && <Chip label={`${plan.relatedIssueIds.length} problème(s) existant(s) réutilisé(s)`} color="warning" variant="outlined" />}
            {!!otherProblems.length && <Box>
              <Typography variant="subtitle2">Autres constats conservés dans le contrôle</Typography>
              <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>{otherProblems.map(label => <Typography component="li" variant="body2" key={label}>{label}</Typography>)}</Box>
            </Box>}
            {value.condition === "mauvais" && <Alert severity="info">Mauvais état : nouveau contrôle prioritaire après quatre jours. Les autres chambres continuent de tourner pendant ce délai.</Alert>}
            <TextField label="Observations et problèmes constatés" multiline minRows={2} value={value.notes} onChange={e => update({ notes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} helperText="Facultatif : les boutons décrivent déjà les constats. Les détails restent dans l’historique." />
            <Typography variant="subtitle2">Photos · {value.photosData.length}/3</Typography>
            <Stack direction="row" spacing={1}>
              <Button component="label" variant="outlined" disabled={compressing || value.photosData.length >= 3}>Prendre une photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
              <Button component="label" disabled={compressing || value.photosData.length >= 3}>Galerie<input hidden multiple type="file" accept="image/*" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
            </Stack>
            {compressing && <LinearProgress aria-label="Préparation des photos" variant="determinate" value={photoProgress.total ? photoProgress.completed / photoProgress.total * 100 : 0} />}
            {value.photosData.map((photo, i) => <Box key={i}><Box component="img" src={photo} alt={`Photo du contrôle ${i + 1}`} decoding="async" sx={{ width: "100%", maxHeight: 180, objectFit: "contain" }} /><Button color="error" onClick={() => update({ photosData: value.photosData.filter((_, index) => index !== i) })}>Retirer la photo {i + 1}</Button></Box>)}
            <Typography variant="caption">Les problèmes ouverts sont vérifiés à l’envoi. Un contrôle OK ne les clôture pas : la direction conserve le suivi des interventions.</Typography>
          </>}
          <Typography variant="caption" color="text.secondary" role={compressing ? "status" : undefined}>{compressing ? `Préparation des photos… ${photoProgress.completed} / ${photoProgress.total}` : draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil."}</Typography>
        </Stack>
      </Box>}
    </DialogContent>
    <DialogActions sx={{ p: 2, flexDirection: "column", gap: 1, alignItems: "stretch", "& > :not(style) ~ :not(style)": { ml: 0 } }}>
      {step < 2 ? <Button variant="contained" size="large" disabled={!value || busy || compressing} onClick={() => goStep(step + 1)}>Continuer · {sections[step + 1]}</Button> : <>
        <Button variant="contained" size="large" disabled={!value || busy || compressing || needsIssueChoice || !!issuePlanError} onClick={() => void submit(false)}>{busy ? "Enregistrement…" : "Enregistrer le contrôle"}</Button>
        {nextRoom && <Button variant="outlined" disabled={!value || busy || compressing || needsIssueChoice || !!issuePlanError} onClick={() => void submit(true)}>Enregistrer et passer à {nextRoom}</Button>}
      </>}
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        {step > 0 && <Button disabled={busy || compressing} onClick={() => goStep(step - 1)}>Retour</Button>}
        {!recovery && <Button disabled={busy || compressing} onClick={onDefer}>Reporter à demain</Button>}
      </Stack>
    </DialogActions>
  </Dialog>;
}
