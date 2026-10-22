"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { ConnectionBar, PageTitle } from "@/components/HotelUI";
import { WorkEntryEditor } from "@/components/WorkEntryEditor";
import { useAppContext } from "@/context/AppContext";
import { createId, displayDate, today } from "@/lib/domain";
import type { WorkEntry } from "@/lib/rooms";
import { useDeviceDraft } from "@/lib/useDeviceDraft";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { dailyTasks } from "@/lib/work";

function TaskList({ date }: { date: string }) {
  const { hotelName, cachedAt } = useAppContext();
  const { events, queued, enqueue, actor, isPending } = useWorkEvents();
  const tasks = dailyTasks(events, date);
  const done = tasks.filter(t => t.done).length;
  const draft = useDeviceDraft<WorkEntry>(`draft:daily-task:${date}`, () => ({ type: "createWorkEvent", id: createId(), kind: "dailyTask", targetId: createId(), expectedRevision: 0,
    date, room: "", actor, notes: "", occurredAt: new Date().toISOString(), done: false, deleted: false }));
  const [editing, setEditing] = useState<WorkEntry | null>(null);
  const [deleting, setDeleting] = useState<WorkEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const generating = useRef(false);
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  async function save(entry: WorkEntry, added = false) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await enqueue(entry);
      if (added) await draft.clear();
      setDeleting(null);
    } catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  function revision(task: WorkEntry, patch: Partial<WorkEntry> = {}): WorkEntry {
    return { ...task, ...patch, id: createId(), actor, expectedRevision: task.expectedRevision + 1, occurredAt: new Date().toISOString() };
  }
  async function exportTasks() {
    if (saving.current || generating.current) return;
    generating.current = true;
    setExporting(true); setExportError(""); setExportMessage("");
    try {
      const { downloadDailyTasksPdf } = await import("@/lib/dailyTasksPdf");
      await downloadDailyTasksPdf({ mode: "day", hotelName, date, events,
        pendingIds: queued.filter(item => !item.blocked).map(item => item.entry.id), cachedAt: cachedAt || undefined });
      setExportMessage(`Téléchargement lancé pour le ${displayDate(date)}. Ouvrez le PDF et imprimez-le en A4, à 100 %.`);
    } catch {
      setExportError("Le PDF n’a pas pu être préparé. Veuillez réessayer.");
    } finally {
      generating.current = false;
      setExporting(false);
    }
  }
  return <Stack spacing={2}>
    {error && <Alert severity="error">{error}</Alert>}
    {draft.error && <Alert severity="error">{draft.error}</Alert>}
    <Paper component="form" variant="outlined" sx={{ p: 2 }} onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (draft.value) void save(draft.value, true); }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField fullWidth label="Que faut-il faire ?" placeholder="Ex. Préparer la chambre 102" required disabled={busy || !draft.value} value={draft.value?.notes || ""} onChange={e => { if (draft.value) draft.update({ ...draft.value, notes: e.target.value }); }} slotProps={{ htmlInput: { maxLength: 500 } }} />
        <Button type="submit" variant="contained" disabled={busy || !draft.value?.notes.trim()} sx={{ minWidth: 110 }}>Ajouter</Button>
      </Stack>
    </Paper>
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
        <Typography><strong>{done} / {tasks.length}</strong> tâche(s) terminée(s) · {displayDate(date)}</Typography>
        <Button variant="outlined" disabled={busy || exporting} onClick={() => void exportTasks()}>{exporting ? "Préparation du PDF…" : "Imprimer les tâches (PDF)"}</Button>
      </Stack>
      <LinearProgress variant="determinate" value={tasks.length ? done / tasks.length * 100 : 0} aria-label="Tâches terminées" sx={{ height: 8, borderRadius: 4 }} />
      <Typography variant="caption" color="text.secondary">Le PDF reprend la date affichée. Si la liste est vide, il contient des lignes à remplir.</Typography>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      {exportMessage && <Alert severity="success" role="status">{exportMessage}</Alert>}
    </Stack>
    {!tasks.length && <Alert severity="info">Aucune tâche pour cette date. Ajoutez ce que vous avez à faire.</Alert>}
    {tasks.map(task => <Paper variant="outlined" key={task.targetId} sx={{ p: 1.5, bgcolor: task.done ? "action.hover" : "background.paper" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <Checkbox checked={!!task.done} disabled={busy} onChange={(_, checked) => void save(revision(task, { done: checked }))} slotProps={{ input: { "aria-label": `Terminer : ${task.notes}` } }} />
        <Box sx={{ flex: 1, minWidth: 0, pt: 1 }}>
          <Typography sx={{ textDecoration: task.done ? "line-through" : "none", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.notes}</Typography>
          {isPending(task.id) && <Typography variant="caption" color="text.secondary">En attente d’envoi</Typography>}
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            <Button size="small" disabled={busy} onClick={() => setEditing(revision(task))}>Modifier</Button>
            <Button size="small" color="error" disabled={busy} onClick={() => setDeleting(task)}>Supprimer</Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>)}
    {editing && <WorkEntryEditor key={editing.targetId} initial={editing} draftKey={`draft:task:edit:${editing.targetId}`} title="Modifier la tâche" onClose={() => setEditing(null)} />}
    <Dialog open={!!deleting} onClose={busy ? undefined : () => setDeleting(null)} fullWidth maxWidth="xs">
      <DialogTitle>Supprimer cette tâche ?</DialogTitle>
      <DialogContent><Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{deleting?.notes}</Typography>{error && <Alert severity="error">{error}</Alert>}</DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDeleting(null)}>Annuler</Button><Button color="error" disabled={busy} onClick={() => { if (deleting) void save(revision(deleting, { deleted: true })); }}>Supprimer</Button></DialogActions>
    </Dialog>
  </Stack>;
}

export default function DailyChecklistPage() {
  const [day, setDay] = useState(today);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const date = selected || day;
  return <>
    <ConnectionBar />
    <PageTitle title="Tâches du jour" description="Écrivez vos tâches, cochez-les au fur et à mesure. Vous pouvez les modifier ou les supprimer." />
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <TextField label="Jour à afficher" type="date" value={date} onChange={e => setSelected(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <Button onClick={() => setSelected("")}>Aujourd’hui</Button>
        <Button component={Link} href="/anomalies">Signaler un problème →</Button>
      </Stack>
      <TaskList key={date} date={date} />
      <Typography variant="caption" color="text.secondary">Les tâches sont partagées entre les appareils après synchronisation. Les jours précédents restent consultables avec le sélecteur de date.</Typography>
    </Stack>
  </>;
}
