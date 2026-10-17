"use client";
import { useRef, useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { useEntries } from "@/context/EntriesContext";
import { createId, statuses, today } from "@/lib/domain";
import { normalizeRoomDraft, roomChecks, roomEntrySchema, roomFindings, type RoomEntry } from "@/lib/rooms";
import { matchesRoomFinding, openRoomIssues, planRoomIssue } from "@/lib/roomIssueMatching";
import { compressPhoto } from "@/lib/photos";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { QuickChoice } from "./QuickChoice";

type Draft = Omit<RoomEntry, "condition" | "carpet"> & { condition: RoomEntry["condition"] | ""; carpet: RoomEntry["carpet"] | "" };
const sections = ["Équipements", "État et ménage", "Résumé"];
function rememberedActor() { try { return localStorage.getItem("room-inspector") || ""; } catch { return ""; } }
const yesNo = [{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }] as const;
const cleanliness = [{ value: "propre", label: "Propre", color: "success" }, { value: "sale", label: "Sale", color: "warning" }] as const;

export function RoomInspectionDialog({ room, nextRoom, onClose, onSaved, onDefer }: {
  room: string; nextRoom?: string; onClose: () => void; onSaved: (next: boolean) => void; onDefer: () => void;
}) {
  const { issues } = useAppContext();
  const { enqueue } = useEntries();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const content = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const draft = useDeviceDraft<Draft>(`draft:room:${room}`, () => ({
    type: "createRoomInspection", schemaVersion: 4, id: createId(), room, date: today(), actor: rememberedActor(), notes: "", condition: "", occupied: null,
    cleaning: null, carpet: "", carpetNotes: "", microwave: "non_verifie", microwaveCleaning: "non_verifie", fridgeCleaning: "non_verifie", bugs: "non_verifie", photosData: [],
    checks: roomChecks.map(c => ({ key: c.key, result: "non_verifie" })), issueLinks: [],
  }), value => normalizeRoomDraft({ ...value, cleaning: value.cleaning || null }));
  const value = draft.value;
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const known = openRoomIssues(issues, room);
  const findings = value ? roomFindings({ ...value, condition: value.condition || "bon", carpet: value.carpet || "ok" }) : [];
  const plan = value ? planRoomIssue({ room, roomFindings: findings } as Parameters<typeof planRoomIssue>[0], { room, notes: value.notes, issueLinks: value.issueLinks, distinctProblemKeys: value.distinctProblemKeys }, issues) : undefined;
  const invalidField = (field: string) => invalid.some(item => item === field || item.startsWith(field + "."));
  function goStep(next: number) { setStep(next); content.current?.scrollTo({ top: 0 }); }
  function update(patch: Partial<Draft>) { if (value) draft.update({ ...value, ...patch }); }
  async function submit(next = false) {
    if (!value || submitting.current) return;
    setError("");
    const parsed = roomEntrySchema.safeParse({ ...value, inspectedAt: value.inspectedAt || new Date().toISOString() });
    if (!parsed.success) {
      const fields = parsed.error.issues.map(i => i.path.join("."));
      setInvalid(fields);
      goStep(fields.some(f => f.startsWith("checks")) ? 0 : fields.some(f => !["actor", "date", "notes"].includes(f)) ? 1 : 2);
      setShowMetadata(true);
      setError("Il reste des points à vérifier. Aucun contrôle n’a été enregistré.");
      setTimeout(() => content.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setInvalid([]); submitting.current = true; setBusy(true);
    try {
      draft.update({ ...value, inspectedAt: parsed.data.inspectedAt });
      await enqueue(parsed.data);
      try { localStorage.setItem("room-inspector", parsed.data.actor); } catch { /* Optional convenience. */ }
      await draft.clear(); onSaved(next);
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function addPhotos(files: File[]) {
    if (!value || !files.length) return;
    if (value.photosData.length + files.length > 3) { setError("Ajoutez au maximum 3 photos."); return; }
    setCompressing(true); setError("");
    try { const photos = []; for (const file of files) photos.push(await compressPhoto(file, true)); update({ photosData: [...value.photosData, ...photos] }); }
    catch (e) { setError((e as Error).message); }
    finally { setCompressing(false); }
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
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {draft.error && <Alert severity="error">{draft.error}</Alert>}
      {!value ? <Typography>Chargement du brouillon…</Typography> : <Box component="fieldset" disabled={busy || compressing} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Stack spacing={2}>
          {known.length > 0 && <Box>
            <Button color="warning" onClick={() => setShowIssues(!showIssues)} aria-expanded={showIssues}>{known.length} anomalie(s) déjà signalée(s)</Button>
            {showIssues && <Stack spacing={1}>{known.map(issue => <Alert key={issue.id} severity="warning" icon={false}><strong>{issue.title}</strong><Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{issue.description}</Typography><Typography variant="caption">{statuses[issue.status]} · {issue.assignee || "Non attribuée"}</Typography></Alert>)}</Stack>}
          </Box>}
          {step === 0 && <>
            <Typography variant="body2" color="text.secondary">Un toucher par résultat. « Absent » indique que l’équipement n’existe pas dans la chambre.</Typography>
            <Button variant="outlined" onClick={() => update({ checks: value.checks.map(c => c.result === "non_verifie" && c.key !== "smoke" && !known.some(i => matchesRoomFinding(i, { key: c.key, label: "" })) ? { ...c, result: "ok" } : c) })}>J’ai vérifié : les équipements restants sont OK</Button>
            <Typography variant="caption" color="text.secondary">Le ferme-porte est inclus. Le détecteur et les équipements déjà signalés restent à vérifier individuellement. Les réponses saisies sont conservées.</Typography>
            {roomChecks.map(check => <QuickChoice key={check.key} label={check.label} value={value.checks.find(c => c.key === check.key)?.result} error={invalidField(`checks.${check.key}`)}
              options={[{ value: "ok", label: "OK", color: "success" }, { value: "probleme", label: "Problème", color: "error" }, { value: "absent", label: "Absent" }]}
              onChange={result => update({ checks: value.checks.map(c => c.key === check.key ? { ...c, result } : c) })}
              hint={<>{check.key === "door_closer" && <Typography variant="caption" sx={{ display: "block" }}>Ouvrir puis relâcher la porte : vérifier qu’elle se referme. Signaler aussi l’absence du mécanisme.</Typography>}{known.filter(i => matchesRoomFinding(i, { key: check.key, label: "" })).map(i => <Typography key={i.id} variant="caption" color="warning.main" sx={{ display: "block" }}>Déjà signalé : {i.title}</Typography>)}</>} />)}
          </>}
          {step === 1 && <>
            <QuickChoice label="Chambre occupée" value={value.occupied === true ? "oui" : value.occupied === false ? "non" : ""} options={[{ value: "oui", label: "Occupée" }, { value: "non", label: "Libre" }]} error={invalidField("occupied")} onChange={v => update({ occupied: v === "oui", cleaning: v === "oui" ? null : value.cleaning })} />
            <QuickChoice label="État général de la chambre" value={value.condition} options={[{ value: "bon", label: "Bon", color: "success" }, { value: "a_revoir", label: "À revoir", color: "warning" }, { value: "mauvais", label: "Mauvais", color: "error" }]} error={invalidField("condition")} onChange={condition => update({ condition })} />
            {value.occupied === false && <QuickChoice label="Nettoyage / ménage" value={value.cleaning} options={[{ value: "faite", label: "Fait", color: "success" }, { value: "non_faite", label: "Non fait", color: "warning" }]} error={invalidField("cleaning")} onChange={cleaning => update({ cleaning })} />}
            <QuickChoice label="Présence de cafards ou nuisibles" value={value.bugs} options={[{ value: "non", label: "Aucun", color: "success" }, { value: "oui", label: "Détectés", color: "error" }]} error={invalidField("bugs")} onChange={bugs => update({ bugs })} />
            <QuickChoice label="État de la moquette" value={value.carpet} options={[{ value: "ok", label: "OK", color: "success" }, { value: "tachee", label: "Tachée", color: "warning" }, { value: "sale", label: "Sale", color: "warning" }]} error={invalidField("carpet")} onChange={carpet => update({ carpet })} />
            {value.carpet && value.carpet !== "ok" && <TextField label="Précisez les taches ou salissures" multiline minRows={2} value={value.carpetNotes} onChange={e => update({ carpetNotes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} />}
            <QuickChoice label="Micro-ondes présent ?" value={value.microwave} options={[...yesNo]} error={invalidField("microwave")} onChange={microwave => update({ microwave })} />
            {value.microwave === "oui" && <QuickChoice label="Propreté du micro-ondes" value={value.microwaveCleaning} options={[...cleanliness]} error={invalidField("microwaveCleaning")} onChange={microwaveCleaning => update({ microwaveCleaning })} />}
            {value.checks.some(c => c.key === "fridge" && ["ok", "probleme"].includes(c.result)) && <QuickChoice label="Propreté du minibar" value={value.fridgeCleaning} options={[...cleanliness]} error={invalidField("fridgeCleaning")} onChange={fridgeCleaning => update({ fridgeCleaning })} />}
          </>}
          {step === 2 && <>
            <TextField required label="Inspecteur" value={value.actor} error={invalidField("actor")} onChange={e => update({ actor: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} helperText="Mémorisé sur cet appareil pour le prochain contrôle." />
            <Button onClick={() => setShowMetadata(!showMetadata)} aria-expanded={showMetadata}>Date : {value.date.split("-").reverse().join("/")} · Modifier</Button>
            {showMetadata && <TextField required label="Date du contrôle" type="date" value={value.date} error={invalidField("date")} onChange={e => update({ date: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }} />}
            <Typography variant="h6">Constats · {findings.length}</Typography>
            {!findings.length && <Alert severity="success">Aucun problème sélectionné.</Alert>}
            {findings.map(finding => {
              const linked = value.distinctProblemKeys?.includes(finding.key) ? undefined : known.find(i => value.issueLinks?.some(link => link.key === finding.key && link.issueId === i.id)) || known.find(i => matchesRoomFinding(i, finding));
              return <Box key={finding.key} sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 700 }}>{finding.label}</Typography>
                <Typography variant="caption" color={linked ? "warning.main" : "error.main"}>{linked ? `Déjà signalé : ${linked.title} · aucun doublon` : "Nouveau signalement"}</Typography>
                {known.length > 0 && <details><summary style={{ cursor: "pointer", paddingTop: 8 }}>Associer à une anomalie existante</summary><Stack spacing={1} sx={{ mt: 1 }}>{known.map(i => <Button key={i.id} variant={linked?.id === i.id ? "contained" : "outlined"} onClick={() => update({ distinctProblemKeys: value.distinctProblemKeys?.filter(key => key !== finding.key), issueLinks: [...(value.issueLinks || []).filter(l => l.key !== finding.key), { key: finding.key, issueId: i.id }] })}>{i.title}</Button>)}<Button color="warning" onClick={() => update({ issueLinks: value.issueLinks?.filter(l => l.key !== finding.key), distinctProblemKeys: [...new Set([...(value.distinctProblemKeys || []), finding.key])] })}>Signaler un problème distinct</Button></Stack></details>}
              </Box>;
            })}
            {!!plan?.relatedIssueIds.length && <Chip label={`${plan.relatedIssueIds.length} anomalie(s) existante(s) réutilisée(s)`} color="warning" variant="outlined" />}
            <TextField label="Observations et problèmes constatés" multiline minRows={2} value={value.notes} onChange={e => update({ notes: e.target.value })} slotProps={{ htmlInput: { maxLength: 4000 } }} helperText="Facultatif : les boutons décrivent déjà les constats. Les détails restent dans l’historique." />
            <Typography variant="subtitle2">Photos · {value.photosData.length}/3</Typography>
            <Stack direction="row" spacing={1}>
              <Button component="label" variant="outlined" disabled={compressing || value.photosData.length >= 3}>Prendre une photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
              <Button component="label" disabled={compressing || value.photosData.length >= 3}>Galerie<input hidden multiple type="file" accept="image/*" onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} /></Button>
            </Stack>
            {value.photosData.map((photo, i) => <Box key={i}><Box component="img" src={photo} alt={`Photo du problème ${i + 1}`} sx={{ width: "100%", maxHeight: 180, objectFit: "contain" }} /><Button color="error" onClick={() => update({ photosData: value.photosData.filter((_, index) => index !== i) })}>Retirer la photo {i + 1}</Button></Box>)}
            <Typography variant="caption">Les anomalies ouvertes sont rapprochées à l’envoi. Un contrôle OK ne les clôture pas : la direction conserve le suivi des interventions.</Typography>
          </>}
          <Typography variant="caption" color="text.secondary">{compressing ? "Compression des photos…" : draft.saving ? "Sauvegarde du brouillon…" : "Brouillon conservé sur cet appareil."}</Typography>
        </Stack>
      </Box>}
    </DialogContent>
    <DialogActions sx={{ p: 2, flexDirection: "column", gap: 1, alignItems: "stretch", "& > :not(style) ~ :not(style)": { ml: 0 } }}>
      {step < 2 ? <Button variant="contained" size="large" disabled={!value || busy || compressing} onClick={() => goStep(step + 1)}>Continuer · {sections[step + 1]}</Button> : <>
        <Button variant="contained" size="large" disabled={!value || busy || compressing} onClick={() => void submit(false)}>{busy ? "Enregistrement…" : "Enregistrer le contrôle"}</Button>
        {nextRoom && <Button variant="outlined" disabled={!value || busy || compressing} onClick={() => void submit(true)}>Enregistrer et passer à {nextRoom}</Button>}
      </>}
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        {step > 0 && <Button disabled={busy || compressing} onClick={() => goStep(step - 1)}>Retour</Button>}
        <Button disabled={busy || compressing} onClick={onDefer}>Reporter à demain</Button>
      </Stack>
    </DialogActions>
  </Dialog>;
}
