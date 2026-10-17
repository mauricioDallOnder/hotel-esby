"use client";
import { useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { createId, displayDate, today } from "@/lib/domain";
import type { FamilyEntry, WorkEntry } from "@/lib/rooms";
import { useWorkEvents } from "@/lib/useWorkEvents";
import { familyComments } from "@/lib/work";
import { WorkEntryEditor } from "./WorkEntryEditor";

export function FamilyComments({ family }: { family: FamilyEntry }) {
  const { events, isPending } = useWorkEvents();
  const comments = familyComments(family, events);
  const [editing, setEditing] = useState<{ entry: WorkEntry; key: string } | null>(null);
  function add() {
    setEditing({ key: `draft:comment:new:${family.id}`, entry: { type: "createWorkEvent", id: createId(), kind: "familyComment", targetId: createId(), expectedRevision: 0,
      room: family.room, familyEventId: family.id, date: today(), actor: "", notes: "", occurredAt: new Date().toISOString() } });
  }
  return <Stack spacing={1.5} sx={{ pt: 1 }}>
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Commentaires · {comments.length}</Typography>
      <Button onClick={add}>+ Ajouter un commentaire</Button>
    </Stack>
    {comments.map(comment => <Box key={comment.targetId} sx={{ borderLeft: "3px solid", borderColor: "primary.light", pl: 2, py: 1 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{displayDate(comment.date)} · {comment.actor}</Typography>
        {isPending(comment.id) && <Chip label="En attente d’envoi" size="small" variant="outlined" />}
      </Stack>
      <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", my: 1 }}>{comment.notes}</Typography>
      <Button size="small" onClick={() => setEditing({ key: `draft:comment:edit:${comment.targetId}`, entry: { ...comment, id: createId(), expectedRevision: comment.expectedRevision + 1, actor: "", occurredAt: new Date().toISOString() } })}>Modifier le commentaire</Button>
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
