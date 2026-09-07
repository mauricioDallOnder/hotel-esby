"use client";
import { useState } from "react";
import {
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Add from "@mui/icons-material/Add";
import { useAppContext } from "@/context/AppContext";
import { displayDate, priorities, statuses, type Issue } from "@/lib/domain";
import {
  ConnectionBar,
  EmptyState,
  IssueBadges,
  PageTitle,
} from "@/components/HotelUI";
import { IssueDialog } from "@/components/IssueDialog";
export default function IssuesPage() {
  const { issues } = useAppContext();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("pending");
  const [priority, setPriority] = useState("all");
  const [dialog, setDialog] = useState<Issue | "new" | null>(null);
  const rank = { critique: 0, haute: 1, normale: 2 };
  const filtered = issues
    .filter(
      (i) =>
        (status === "all" ||
          (status === "pending"
            ? i.status !== "resolu"
            : i.status === status)) &&
        (priority === "all" || i.priority === priority) &&
        `${i.title} ${i.location} ${i.description} ${i.assignee}`
          .toLocaleLowerCase("fr")
          .includes(query.toLocaleLowerCase("fr"))
    )
    .sort(
      (a, b) =>
        rank[a.priority] - rank[b.priority] || b.date.localeCompare(a.date)
    );
  return (
    <>
      <ConnectionBar />
      <PageTitle
        eyebrow="Maintenance"
        title="Anomalies & suivi"
        description="Un problème, une photo, un suivi jusqu’à sa résolution."
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setDialog("new")}
          >
            Signaler une anomalie
          </Button>
        }
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          fullWidth
          label="Rechercher un lieu ou un problème"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <TextField
          select
          label="État"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="pending">Non résolues</MenuItem>
          <MenuItem value="all">Tous les états</MenuItem>
          {Object.entries(statuses).map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Priorité"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">Toutes</MenuItem>
          {Object.entries(priorities).map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {filtered.length} anomalie(s)
      </Typography>
      {!filtered.length ? (
        <EmptyState
          title="Aucune anomalie dans cette sélection"
          detail="Signalez un problème ou modifiez les filtres pour consulter l’historique."
        />
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
            gap: 2,
          }}
        >
          {filtered.map((issue) => (
            <Paper
              variant="outlined"
              key={issue.id}
              sx={{
                p: 2.5,
                borderLeft:
                  issue.priority === "critique" && issue.status !== "resolu"
                    ? "4px solid #bd4437"
                    : undefined,
              }}
            >
              <Stack spacing={2}>
                <IssueBadges issue={issue} />
                {issue.photoId && (
                  <Box
                    component="img"
                    className="photo-preview"
                    src={`/api/photos/${issue.id}`}
                    alt={issue.title}
                    loading="lazy"
                  />
                )}
                <Box>
                  <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
                    {issue.title}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {issue.location} · {displayDate(issue.date)}
                  </Typography>
                </Box>
                <Typography
                  sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {issue.description}
                </Typography>
                <Stack
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 2,
                  }}
                  direction="row"
                >
                  <Typography variant="body2" color="text.secondary">
                    {issue.assignee || "Responsable à désigner"}
                  </Typography>
                  <Button variant="outlined" onClick={() => setDialog(issue)}>
                    Ouvrir le suivi
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Box>
      )}
      {dialog && (
        <IssueDialog
          key={dialog === "new" ? "new" : dialog.id}
          issue={dialog === "new" ? undefined : dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
