"use client";
import { useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { createId, displayDate, issueResponsible, statuses, today, type Issue } from "@/lib/domain";
import { cafardCases, cafardStatusLabels, cafardTreatmentReminder } from "@/lib/cafards";
import { cafardSeedsFromIssues } from "@/lib/cafardsLegacy";
import { normalizeRoomDraft, roomCheckResultLabel, roomChecks, roomEntrySchema, roomFindings, roomIssue, roomProblems, type RoomCheckKey, type RoomEntry } from "@/lib/rooms";
import { canLinkRoomIssue, isCafardTechnicalReport, linkableRoomIssueFindings, matchesRoomFinding, openRoomIssues, planRoomIssue } from "@/lib/roomIssueMatching";
import { problemPresetsForCheck } from "@/lib/problemPresets";
import { preparePhotos } from "@/lib/photos";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useRoomObservations } from "@/lib/useRoomObservations";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { QuickChoice } from "./QuickChoice";
import { PhotoCaptureButton } from "./PhotoCaptureButton";
import { ProblemTypeSelect } from "./ProblemTypeSelect";

type Draft = Omit<RoomEntry, "condition" | "carpet"> & {
  condition: RoomEntry["condition"] | ""; carpet: RoomEntry["carpet"] | "";
  // Draft-only answer: presence alone must not certify an untested fridge as functional.
  fridgePresent?: boolean;
  // A historical date is a deliberate choice for this Paris calendar day only.
  dateReviewedOn?: string;
};
const sections = ["Équipements", "État et ménage", "Résumé"];
const equipmentChecks = roomChecks.filter(check => check.key !== "room_clutter");
type IssueLink = NonNullable<RoomEntry["issueLinks"]>[number];
type Finding = NonNullable<Issue["roomFindings"]>[number];
function linkToIssue(finding: Finding, issue: Issue, outcome: "present" | "resolved", suggestedKey?: string): IssueLink {
  const eligible = linkableRoomIssueFindings(issue, finding);
  const target = eligible.length === 1 ? eligible[0] : eligible.find(item => item.key === (suggestedKey || finding.key));
  return { key: finding.key, issueId: issue.id, outcome, expectedVersion: issue.version, ...(target ? { findingKey: target.key } : {}) };
}
function rememberedActor() { try { return localStorage.getItem("room-inspector") || ""; } catch { return ""; } }
function newRoomDraft(room: string): Draft {
  return {
    type: "createRoomInspection", schemaVersion: 6, id: createId(), room, date: today(), actor: rememberedActor(), notes: "", condition: "", occupied: null,
    cleaning: null, carpet: "", carpetNotes: "", microwave: "non_verifie", microwaveCleaning: "non_verifie", fridgeCleaning: "non_verifie", bugs: "non_verifie", photosData: [],
    checks: roomChecks.map(c => ({ key: c.key, result: "non_verifie" })), issueLinks: [], problemDetails: [],
  };
}
const yesNo = [{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }] as const;
const cleanliness = [{ value: "propre", label: "Propre", color: "success" }, { value: "sale", label: "Sale", color: "warning" }] as const;

export function RoomInspectionDialog({ room, nextRoom, onClose, onSaved, onDefer, recovery }: {
  room: string; nextRoom?: string; onClose: () => void; onSaved: (next: boolean, visitDate: string) => void; onDefer?: () => void;
  recovery?: { originalId: string; entry: RoomEntry; onSubmit: (entry: RoomEntry) => Promise<void> };
}) {
  const { issues, role } = useAppContext();
  const { enqueue, pending } = useEntries();
  const { history, day } = useRoomObservations();
  const { events } = useWorkEvents();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const content = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const preparingPhotos = useRef(false);
  const draft = useDeviceDraft<Draft>(recovery ? `draft:room-recovery:${recovery.originalId}` : `draft:room:${room}`,
    () => recovery ? normalizeRoomDraft(recovery.entry) as Draft : newRoomDraft(room),
    value => normalizeRoomDraft({ ...value, cleaning: value.cleaning || null }));
  const value = draft.value;
  const submitted = !recovery && !!value && (history.some(entry => entry.id === value.id) || pending.some(item => item.entry.id === value.id));
  const currentDay = today();
  const needsDateReview = !recovery && !!value?.date && value.date < currentDay && value.dateReviewedOn !== currentDay;
  const fridgeResult = value?.checks.find(check => check.key === "fridge")?.result;
  const fridgePresence = fridgeResult === "absent" ? "non" : fridgeResult === "ok" || fridgeResult === "probleme" || value?.fridgePresent ? "oui" : "";
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [photoProgress, setPhotoProgress] = useState({ completed: 0, total: 0 });
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [repairKey, setRepairKey] = useState("");
  const [showMetadata, setShowMetadata] = useState(false);
  const known = useMemo(() => openRoomIssues(issues, room).filter(issue => !isCafardTechnicalReport(issue, "historical")), [issues, room]);
  const cafardCase = useMemo(() => cafardCases(history.filter(record => record.room === room), events.filter(event => event.room === room), cafardSeedsFromIssues(issues).filter(seed => seed.room === room))[0], [history, events, issues, room]);
  const cafardReminder = cafardCase ? cafardTreatmentReminder(cafardCase, day) : null;
  const review: RoomEntry | undefined = value ? { ...value, condition: value.condition || "bon", carpet: value.carpet || "ok" } : undefined;
  const findings = review ? roomFindings(review) : [];
  const findingLabels = new Set(findings.flatMap(finding => {
    const check = roomChecks.find(item => item.key === finding.key);
    return [finding.label, ...(check ? [`${check.label} : ${roomCheckResultLabel(check.key, "probleme")}`] : [])];
  }));
  const otherProblems = review ? roomProblems(review).filter(label => !findingLabels.has(label)) : [];
  const candidate = review && roomIssue({ ...review, version: 1, updatedAt: "", submissionHash: "", photoIds: [], photoId: null });
  const initialPlan = value && planRoomIssue(candidate, value, issues);
  const links = (value?.issueLinks || []).map(link => {
    const issue = !link.outcome && known.find(item => item.id === link.issueId);
    const finding = findings.find(item => item.key === link.key);
    return issue && finding && canLinkRoomIssue(issue, finding) ? linkToIssue(finding, issue, "present") : link;
  });
  // Freeze each suggested target and the version displayed at confirmation.
  // The server must detect a later edit even when the text still matches.
  for (const association of initialPlan?.associations || []) {
    if (association.source !== "existing" || links.some(link => link.key === association.key)) continue;
    const issue = known.find(item => item.id === association.issueId);
    const finding = findings.find(item => item.key === association.key);
    if (issue && finding) links.push(linkToIssue(finding, issue, "present", association.findingKey));
  }
  const plan = value && planRoomIssue(candidate, { ...value, issueLinks: links }, issues);
  const resolved = links.filter(link => link.outcome === "resolved");
  const repairChecks = roomChecks.filter(check =>
    value?.checks.some(answer => answer.key === check.key && answer.result === "ok") && !resolved.some(link => link.key === check.key));
  const resolutionRows = [...resolved.map(link => link.key), ...(repairChecks.some(check => check.key === repairKey) ? [repairKey] : [])];
  const optionalRows = roomChecks.filter(check => value?.checks.some(answer => answer.key === check.key && answer.result === "probleme") &&
    !findings.some(finding => finding.key === check.key) && (known.length || links.some(link => link.key === check.key)));
  const rows = [...findings, ...optionalRows, ...resolutionRows.map(key => ({ key, label: roomChecks.find(check => check.key === key)?.label || key }))];
  const orphanedLinks = links.filter(link => !rows.some(row => row.key === link.key));
  const needsIssueChoice = !!plan?.requiresChoice.length;
  const issuePlanError = plan?.conflicts[0] || (role !== "direction" && resolved.length
    ? "Seule la direction peut confirmer une résolution. Retirez la résolution pour transmettre ce contrôle avec vos observations." : undefined);
  const validation = validationAttempted && value
    ? roomEntrySchema.safeParse({ ...value, schemaVersion: 7, issueLinks: links, inspectedAt: value.inspectedAt || undefined }) : undefined;
  const validationProblems = validation && !validation.success ? validation.error.issues : [];
  const invalid = validationProblems.map(issue => issue.path.join("."));
  const invalidField = (field: string) => invalid.some(item => item === field || item.startsWith(field + "."));
  const fieldMessage = (field: string) => validationProblems.find(problem => problem.path.join(".") === field)?.message;
  function goStep(next: number) { setStep(next); content.current?.scrollTo({ top: 0 }); }
  function update(patch: Partial<Draft>) { if (value) draft.update({ ...value, ...patch }); }
  function chooseVisitDate(date: string) {
    if (!value) return;
    // A previous submission attempt may still have a receipt on another device.
    const changedAttempt = !recovery && value.inspectedAt && value.date !== date;
    update({ date, dateReviewedOn: today(), ...(changedAttempt ? { id: createId(), inspectedAt: undefined } : {}) });
    setError("");
  }
  function changeLink(key: string, link: IssueLink | undefined) {
    if (!value) return;
    const wasResolved = value.issueLinks?.some(previous => previous.key === key && previous.outcome === "resolved");
    const nextResult = link?.outcome === "resolved" ? "ok" : link?.outcome === "present" ? "probleme" : undefined;
    update({
      checks: value.checks.map(check => check.key === key && nextResult ? { ...check, result: nextResult } : check),
      issueLinks: [...(value.issueLinks || []).filter(previous => previous.key !== key), ...(link ? [link] : [])],
      distinctProblemKeys: value.distinctProblemKeys?.filter(item => item !== key),
      ...(wasResolved && !link ? { problemDetails: value.problemDetails?.filter(detail => detail.key !== key) } : {}),
    });
    if (repairKey === key) setRepairKey("");
  }
  function updateCheck(key: RoomCheckKey, result: RoomEntry["checks"][number]["result"]) {
    if (!value) return;
    if (value.checks.find(check => check.key === key)?.result === result) return;
    update({ checks: value.checks.map(check => check.key === key ? { ...check, result } : check),
      ...(key === "room_clutter" && result === "probleme" ? {
        problemDetails: [...(value.problemDetails || []).filter(detail => detail.key !== key),
          { key, problemType: "room_cluttered", ...value.problemDetails?.find(detail => detail.key === key) }],
      } : {}),
      ...(result !== "probleme" || value.issueLinks?.some(link => link.key === key && link.outcome === "resolved") ? {
        ...(result !== "probleme" ? { problemDetails: value.problemDetails?.filter(detail => detail.key !== key) } : {}),
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
      ...(present === "non" ? { issueLinks: value.issueLinks?.filter(link => link.key !== "fridge") } : {}),
    });
  }
  async function submit(next = false) {
    if (!value || submitting.current || submitted) return;
    // Recheck at the instant of the click: midnight may fall between two renders.
    const saveDay = today();
    if (!recovery && value.date && value.date < saveDay && value.dateReviewedOn !== saveDay) {
      setError("Confirmez la date de cette visite avant de l’enregistrer.");
      content.current?.scrollTo({ top: 0 });
      return;
    }
    setError("");
    const parsed = roomEntrySchema.safeParse({ ...value, schemaVersion: 7, issueLinks: links, inspectedAt: value.inspectedAt || new Date().toISOString() });
    if (!parsed.success) {
      const fields = parsed.error.issues.map(i => i.path.join("."));
      setValidationAttempted(true);
      const equipmentError = parsed.error.issues.some(issue => {
        if (issue.path[0] === "checks") return issue.path[1] !== "room_clutter";
        if (issue.path[0] === "problemDetails") {
          const index = issue.path[1];
          return typeof index !== "number" || value.problemDetails?.[index]?.key !== "room_clutter";
        }
        return false;
      });
      goStep(equipmentError ? 0 : fields.some(f => !["actor", "date", "notes", "issueLinks"].some(key => f === key || f.startsWith(key + "."))) ? 1 : 2);
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
      draft.update({ ...value, issueLinks: links, inspectedAt: parsed.data.inspectedAt });
      if (recovery) await recovery.onSubmit(parsed.data);
      else await enqueue(parsed.data);
      try { localStorage.setItem("room-inspector", parsed.data.actor); } catch { /* Optional convenience. */ }
      try { await draft.clear(); } catch { /* The entry is already durable. Reopening a leftover draft checks its submitted ID. */ }
      onSaved(next, parsed.data.date);
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
        <Box><Typography component="span" variant="h5" sx={{ fontWeight: 800 }}>Chambre {room}</Typography><Typography variant="body2" color="text.secondary">{value && `Visite du ${displayDate(value.date)} · `}{checked}/{roomChecks.length} points vérifiés</Typography></Box>
        <Button disabled={busy || compressing} onClick={onClose}>Fermer</Button>
      </Stack>
      <LinearProgress variant="determinate" value={checked / roomChecks.length * 100} sx={{ my: 1.5, height: 5, borderRadius: 4 }} />
      <Stack direction="row" spacing={0.5} role="navigation" aria-label="Étapes du contrôle">{sections.map((section, index) => <Button key={section} disabled={busy || compressing} onClick={() => goStep(index)} variant={step === index ? "contained" : "text"} aria-current={step === index ? "step" : undefined} sx={{ flex: 1, px: 0.5 }}>{index + 1}. {section}</Button>)}</Stack>
    </DialogTitle>
    <DialogContent ref={content} dividers sx={{ px: { xs: 2, sm: 3 } }}>
      {value && submitted && !busy && <Alert severity="info" sx={{ mb: 2 }}>
        Ce contrôle du {displayDate(value.date)} figure déjà dans les enregistrements ou les envois de cet appareil.
        <Button onClick={() => { draft.update(newRoomDraft(room)); setError(""); setValidationAttempted(false); goStep(0); }}>Commencer un nouveau contrôle</Button>
      </Alert>}
      {value && needsDateReview && !submitted && !busy && <Alert severity="warning" sx={{ mb: 2 }}>
        Ce brouillon est daté du {displayDate(value.date)}. Quel jour avez-vous effectué la visite ? Vos réponses et vos photos seront conservées.
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
          <Button variant="contained" disabled={compressing} onClick={() => chooseVisitDate(today())}>Visite d’aujourd’hui · {displayDate(currentDay)}</Button>
          <Button variant="outlined" disabled={compressing} onClick={() => chooseVisitDate(value.date)}>Garder le {displayDate(value.date)}</Button>
        </Stack>
      </Alert>}
      {invalid.length > 0 && <Alert severity="error" sx={{ mb: 2 }}>Il reste des points à vérifier. Aucun contrôle n’a été enregistré.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {draft.error && <Alert severity="error">{draft.error}</Alert>}
      {recovery && <Alert severity="info" sx={{ mb: 2 }}>Correction d’un envoi refusé. Les réponses, photos et date du contrôle sont conservées. La demande précédente restera disponible jusqu’à l’enregistrement de cette correction.</Alert>}
      {!value ? <Typography>Chargement du brouillon…</Typography> : <Box component="fieldset" disabled={busy || compressing || submitted} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Stack spacing={2}>
          {known.length > 0 && <Box>
            <Button color="warning" onClick={() => setShowIssues(!showIssues)} aria-expanded={showIssues}>{known.length} {known.length === 1 ? "signalement ouvert" : "signalements ouverts"} dans cette chambre</Button>
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
            <Button variant="outlined" onClick={() => update({ checks: value.checks.map(c => c.key !== "room_clutter" && c.result === "non_verifie" && !known.some(i => matchesRoomFinding(i, { key: c.key, label: "" })) ? { ...c, result: "ok" } : c) })}>J’ai vérifié : les équipements restants sont OK</Button>
            <Typography variant="caption" color="text.secondary">Les équipements déjà signalés restent à vérifier individuellement. Pour le radiateur, OK signifie « Libre ». Vérifiez l’encombrement de la chambre à l’étape suivante.</Typography>
            {equipmentChecks.map(check => {
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
              hint={<>
                {check.key === "damage" && <Typography variant="caption" sx={{ display: "block" }}>Vérifiez les meubles et leurs fixations. Si vous constatez un défaut, précisez l’élément concerné.</Typography>}
                {check.key === "door_closer" && <Typography variant="caption" sx={{ display: "block" }}>Ouvrez puis relâchez la porte pour vérifier sa fermeture. Si le mécanisme manque, choisissez « Absent ».</Typography>}
                {check.key === "radiator_clear" && <Typography variant="caption" sx={{ display: "block" }}>Choisissez « Caché » si des meubles, des vêtements ou des bagages couvrent le radiateur. Ce constat est suivi dans « Problèmes techniques ».</Typography>}
                {known.filter(i => matchesRoomFinding(i, { key: check.key, label: "" })).map(i => <Typography key={i.id} variant="caption" color="warning.main" sx={{ display: "block" }}>Déjà signalé : {i.title}</Typography>)}
              </>} />
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
            <Typography variant="caption" color="text.secondary">Une chambre en mauvais état est à revoir au bout de quatre jours.</Typography>
            <QuickChoice label="Chambre encombrée d’affaires" value={value.checks.find(check => check.key === "room_clutter")?.result}
              options={[{ value: "ok", label: "Non", color: "success" }, { value: "probleme", label: "Oui", color: "error" }]}
              error={invalidField("checks.room_clutter")} onChange={result => updateCheck("room_clutter", result)}
              hint={<><Typography variant="caption" sx={{ display: "block" }}>Trop de bagages ou d’affaires qui encombrent fortement la chambre. « Oui » ajoute un constat dans « État général de chambre ». Joignez les photos à l’étape Résumé pour les retrouver dans les rapports.</Typography>
                {known.filter(issue => matchesRoomFinding(issue, { key: "room_clutter", label: "" })).map(issue => <Typography key={issue.id} variant="caption" color="warning.main" sx={{ display: "block" }}>Déjà signalé : {issue.title} · le suivi existant sera proposé dans le résumé.</Typography>)}</>} />
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
            {showMetadata && <TextField required label="Date du contrôle" type="date" value={value.date} error={invalidField("date")} onChange={e => chooseVisitDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: currentDay } }} />}
            {value.date && value.date !== currentDay && <Alert severity="info">Ce contrôle comptera pour la tournée du {displayDate(value.date)}.</Alert>}
            <Typography variant="h6">Constats du contrôle · {findings.length + resolved.length + optionalRows.filter(row => links.some(link => link.key === row.key)).length}</Typography>
            {value.bugs === "oui" && <Alert severity="info">{cafardCase ? "Cafards détectés : constat ajouté au suivi existant de cette chambre. Aucun doublon." : "Cafards détectés : le suivi sera ajouté dans « Suivi des cafards »."}</Alert>}
            {!findings.length && !resolved.length && <Alert severity="info">Aucune anomalie automatique à signaler. Les autres constats restent dans l’historique du contrôle.</Alert>}
            {issuePlanError && <Alert severity={needsIssueChoice ? "warning" : "error"}>{issuePlanError} Vérifiez les associations ci-dessous.</Alert>}
            {orphanedLinks.map(link => <Alert key={link.key} severity="warning">
              Association sans constat correspondant · {roomChecks.find(check => check.key === link.key)?.label || link.key}
              <Button onClick={() => changeLink(link.key, undefined)}>Retirer cette association</Button>
            </Alert>)}
            {needsIssueChoice && !issuePlanError && <Alert severity="warning">Un problème déjà signalé peut correspondre à votre constat. Choisissez la fiche à utiliser ci-dessous. S’il s’agit d’un autre défaut, précisez-le dans les équipements.</Alert>}
            {role === "direction" && known.length > 0 && repairChecks.length > 0 && <TextField select
              label="Associer une réparation effectuée" value={repairChecks.some(check => check.key === repairKey) ? repairKey : ""}
              helperText="Choisissez un point vérifié OK pour enregistrer la résolution d’un problème déjà signalé."
              onChange={event => setRepairKey(event.target.value)}>
              <MenuItem value="">Choisir le point vérifié</MenuItem>
              {repairChecks.map(check => <MenuItem key={check.key} value={check.key}>{check.label}</MenuItem>)}
            </TextField>}
            {rows.map(finding => {
              const matching = known.filter(issue => matchesRoomFinding(issue, finding));
              const link = links.find(item => item.key === finding.key);
              const explicit = value.issueLinks?.find(item => item.key === finding.key)?.issueId;
              const repair = resolutionRows.includes(finding.key);
              const optional = optionalRows.some(row => row.key === finding.key);
              const needsChoice = !!plan?.requiresChoice.includes(finding.key);
              const options = [...matching, ...known.filter(issue => !matching.includes(issue) && canLinkRoomIssue(issue, finding))];
              const linked = options.find(issue => issue.id === link?.issueId);
              const unavailable = !!explicit && !linked;
              const checkLabel = roomChecks.find(item => item.key === finding.key)?.label || finding.label;
              const openFindings = linked ? linkableRoomIssueFindings(linked, finding) : [];
              const selectedFinding = openFindings.find(item => item.key === link?.findingKey);
              return <Stack key={finding.key} spacing={1.5} sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 700 }}>{finding.label}</Typography>
                <Typography variant="caption" color={linked ? "warning.main" : needsChoice || unavailable ? "error.main" : "text.secondary"}>
                  {linked ? `Déjà signalé : ${linked.title} · aucun doublon` : needsChoice ? "Choix du suivi nécessaire" : unavailable ? "Vérifiez la fiche associée à ce constat." : repair ? "Choisissez la fiche à résoudre." : optional ? "Constat conservé dans le contrôle. Association facultative." : "Nouveau signalement"}
                </Typography>
                {(options.length > 0 || unavailable) && <TextField select fullWidth label={`Associer au problème existant · ${checkLabel}`} value={link?.issueId || ""} disabled={busy || compressing}
                  error={needsChoice || unavailable} helperText={selectedFinding ? `Élément suivi · ${selectedFinding.label}`
                    : linked && linked.description !== finding.label && linked.description !== linked.title ? linked.description : undefined}
                  onChange={event => {
                    const issue = options.find(item => item.id === event.target.value);
                    changeLink(finding.key, issue ? linkToIssue(finding, issue, repair ? "resolved" : "present") : undefined);
                  }}
                  sx={{ "& .MuiSelect-select": { whiteSpace: "normal", overflowWrap: "anywhere" } }}>
                  {(!linked || explicit) && <MenuItem value="" sx={{ whiteSpace: "normal" }}>{repair ? "Aucune résolution" : optional ? "Conserver uniquement dans le contrôle" : needsChoice ? "Choisir le problème déjà signalé" : matching.length ? "Reprendre la suggestion du contrôle" : "Nouveau problème, aucune fiche sélectionnée"}</MenuItem>}
                  {unavailable && <MenuItem value={explicit} disabled>Association précédente à corriger</MenuItem>}
                  {options.map(issue => <MenuItem key={issue.id} value={issue.id} sx={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "calc(100vw - 32px)" }}>
                    {issue.title} · {statuses[issue.status]}{matching.some(candidate => candidate.id === issue.id) ? " · Correspondance possible" : ""}
                  </MenuItem>)}
                </TextField>}
                {linked && link && <>
                  {(openFindings.length > 1 || (openFindings.length === 1 && !selectedFinding)) && <TextField select label={`Élément de la fiche · ${checkLabel}`}
                    value={openFindings.some(item => item.key === link.findingKey) ? link.findingKey : ""} required
                    onChange={event => changeLink(finding.key, { ...link, expectedVersion: linked.version, findingKey: event.target.value })}>
                    {openFindings.map(item => <MenuItem key={item.key} value={item.key} sx={{ whiteSpace: "normal" }}>{item.label}</MenuItem>)}
                  </TextField>}
                  {role === "direction"
                    ? <QuickChoice label={`État après contrôle · ${checkLabel}`} value={link.outcome || "present"}
                      options={[{ value: "present", label: "Toujours présent", color: "warning" }, { value: "resolved", label: "Résolu", color: "success" }]}
                      onChange={outcome => changeLink(finding.key, { ...link, outcome, expectedVersion: linked.version })} />
                    : <Typography variant="body2">{repair ? "Résolution à confirmer par la direction." : "Toujours présent · la fiche reste ouverte."}</Typography>}
                  {link.expectedVersion !== undefined && link.expectedVersion !== linked.version &&
                    <Button variant="outlined" onClick={() => changeLink(finding.key, { ...link, expectedVersion: linked.version })}>Confirmer la version actuelle de cette fiche</Button>}
                  <TextField label={`Observation sur la fiche · ${checkLabel}`} value={link.note || ""} multiline
                    slotProps={{ htmlInput: { maxLength: 1000 } }}
                    onChange={event => changeLink(finding.key, { ...link, note: event.target.value })} />
                </>}
              </Stack>;
            })}
            {links.length > 0 && <Chip label={`${links.length - resolved.length} constat(s) lié(s) encore présent(s) · ${resolved.length} résolu(s)`} color="primary" variant="outlined" />}
            {!!otherProblems.length && <Box>
              <Typography variant="subtitle2">Autres constats conservés dans le contrôle</Typography>
              <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>{otherProblems.map(label => <Typography component="li" variant="body2" key={label}>{label}</Typography>)}</Box>
            </Box>}
            {value.condition === "mauvais" && <Alert severity="info">Chambre en mauvais état. La tournée prévoit une nouvelle vérification de son état au bout de quatre jours.</Alert>}
            <TextField label="Observations et problèmes constatés" multiline minRows={2} value={value.notes} onChange={e => update({ notes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} helperText="Facultatif : les boutons décrivent déjà les constats. Les détails restent dans l’historique." />
            <Typography variant="subtitle2">Photos · {value.photosData.length}/3</Typography>
            <Stack direction="row" spacing={1}>
              <PhotoCaptureButton disabled={compressing || value.photosData.length >= 3} onCapture={file => { void addPhotos([file]); }} />
              <Button component="label" disabled={compressing || value.photosData.length >= 3}>Galerie<input hidden multiple type="file" accept="image/*" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
            </Stack>
            {compressing && <LinearProgress aria-label="Préparation des photos" variant="determinate" value={photoProgress.total ? photoProgress.completed / photoProgress.total * 100 : 0} />}
            {value.photosData.map((photo, i) => <Box key={i}><Box component="img" src={photo} alt={`Photo du contrôle ${i + 1}`} decoding="async" sx={{ width: "100%", maxHeight: 180, objectFit: "contain" }} /><Button color="error" onClick={() => update({ photosData: value.photosData.filter((_, index) => index !== i) })}>Retirer la photo {i + 1}</Button></Box>)}
            <Typography variant="caption">Les photos restent dans ce contrôle. Les associations sont confirmées à l’enregistrement sur le serveur.</Typography>
          </>}
          <Typography variant="caption" color="text.secondary" role={compressing ? "status" : undefined}>{compressing ? `Préparation des photos… ${photoProgress.completed} / ${photoProgress.total}` : draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil."}</Typography>
        </Stack>
      </Box>}
    </DialogContent>
    <DialogActions sx={{ p: 2, flexDirection: "column", gap: 1, alignItems: "stretch", "& > :not(style) ~ :not(style)": { ml: 0 } }}>
      {step < 2 ? <Button variant="contained" size="large" disabled={!value || busy || compressing} onClick={() => goStep(step + 1)}>Continuer · {sections[step + 1]}</Button> : <>
        <Button variant="contained" size="large" disabled={!value || busy || compressing || submitted || needsIssueChoice || !!issuePlanError} onClick={() => void submit(false)}>{busy ? "Enregistrement…" : "Enregistrer le contrôle"}</Button>
        {nextRoom && <Button variant="outlined" disabled={!value || busy || compressing || submitted || needsIssueChoice || !!issuePlanError} onClick={() => void submit(true)}>Enregistrer et passer à {nextRoom}</Button>}
      </>}
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        {step > 0 && <Button disabled={busy || compressing} onClick={() => goStep(step - 1)}>Retour</Button>}
        {!recovery && onDefer && <Button disabled={busy || compressing} onClick={onDefer}>Reporter à demain</Button>}
      </Stack>
    </DialogActions>
  </Dialog>;
}
