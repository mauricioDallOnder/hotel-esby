"use client";
import { useState } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { createId, displayDate, today } from "@/lib/domain";
import type { FamilyEntry, WorkEntry } from "@/lib/rooms";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { familyComments } from "@/lib/work";
import { WorkEntryEditor } from "./WorkEntryEditor";
import { useEntries } from "@/context/EntriesContext";

export function FamilyComments({ family }: { family: FamilyEntry }) {
  const { events, isPending } = useWorkEvents();
  const { pending, reviewPending } = useEntries();
  const blocked = pending.some(item => item.entry.id === family.id && item.blocked);
  const blockedComments = pending.filter(item => item.blocked && item.entry.type === "createWorkEvent" && item.entry.kind === "familyComment" && item.entry.familyEventId === family.id);
  const comments = familyComments(family, events);
  const [editing, setEditing] = useState<{ entry: WorkEntry; key: string } | null>(null);
  function add() {
    setEditing({ key: `draft:comment:new:${family.id}`, entry: { type: "createWorkEvent", id: createId(), kind: "familyComment", targetId: createId(), expectedRevision: 0, expectedPreviousEventId: null,
      room: family.room, familyEventId: family.id, date: today(), actor: "", notes: "", occurredAt: new Date().toISOString() } });
  }
  return <Stack spacing={1.5} sx={{ pt: 1 }}>
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Commentaires · {comments.length}</Typography>
      <Button disabled={blocked} onClick={add}>+ Ajouter un commentaire</Button>
    </Stack>
    {blocked && <Alert severity="warning">Cet événement doit être vérifié dans les envois en attente avant d’ajouter ou modifier ses commentaires.</Alert>}
    {blockedComments.map(item => <Alert key={item.entry.id} severity="warning" action={<Button color="inherit" onClick={() => reviewPending(item.entry.id)}>Vérifier</Button>}>Un commentaire attend votre vérification. {item.error}</Alert>)}
    {comments.map(comment => <Box key={comment.targetId} sx={{ borderLeft: "3px solid", borderColor: "primary.light", pl: 2, py: 1 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{displayDate(comment.date)} · {comment.actor}</Typography>
        {isPending(comment.id) && <Chip label="En attente d’envoi" size="small" variant="outlined" />}
      </Stack>
      <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", my: 1 }}>{comment.notes}</Typography>
      <Button size="small" disabled={blocked || blockedComments.some(item => item.entry.type === "createWorkEvent" && item.entry.targetId === comment.targetId)} onClick={() => setEditing({ key: `draft:comment:edit:${comment.targetId}`, entry: { ...comment, id: createId(), expectedRevision: comment.expectedRevision + 1, expectedPreviousEventId: comment.expectedRevision < 0 ? null : comment.id, actor: "", occurredAt: new Date().toISOString() } })}>Modifier le commentaire</Button>
      {comment.revisions.length > 1 && <details>
        <summary style={{ cursor: "pointer" }}>Historique des modifications ({comment.revisions.length - 1})</summary>
        <Stack spacing={1} sx={{ mt: 1 }}>{comment.revisions.slice(0, -1).reverse().map(revision => <Box key={revision.id} sx={{ p: 1, bgcolor: "action.hover", borderRadius: 1 }}>
          <Typography variant="caption">{displayDate(revision.date)} · {revision.actor}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{revision.notes}</Typography>
        </Box>)}</Stack>
      </details>}
    </Box>)}
    {!comments.length && <Typography variant="body2" color="text.secondary">Aucun commentaire pour le moment.</Typography>}
    {editing && <WorkEntryEditor key={editing.key} draftKey={editing.key} initial={editing.entry} title={editing.key.includes(":new:") ? "Ajouter un commentaire" : "Modifier le commentaire"} onClose={() => setEditing(null)} />}
  </Stack>;
}
