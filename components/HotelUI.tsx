"use client";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import { priorities, statuses, type Issue } from "@/lib/domain";
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        ...{ mb: 3 },
        justifyContent: "space-between",
        alignItems: { xs: "stretch", sm: "center" },
      }}
    >
      <Box>
        {eyebrow && (
          <Typography
            variant="overline"
            color="primary"
            sx={{ letterSpacing: 2 }}
          >
            {eyebrow}
          </Typography>
        )}
        <Typography
          variant="h4"
          component="h1"
          sx={{ fontSize: { xs: 28, md: 36 }, letterSpacing: -1 }}
        >
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {description}
        </Typography>
      </Box>
      {action}
    </Stack>
  );
}
export function ConnectionBar() {
  const { mode, error, refresh, busy, logout } = useAppContext();
  return (
    <Box sx={{ mb: 3 }}>
      <Stack
        sx={{
          gap: 1,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
        direction="row"
      >
        <Chip
          size="small"
          variant="outlined"
          color={mode === "sheets" ? "success" : "default"}
          label={
            mode === "sheets"
              ? "Connecté à Google Sheets"
              : "Mode local · enregistré sur cet ordinateur"
          }
        />
        <Stack direction="row">
          <Button size="small" disabled={busy} onClick={() => void refresh()}>
            Actualiser
          </Button>
          <Button size="small" disabled={busy} onClick={() => void logout()}>
            Déconnexion
          </Button>
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
export function StatCards({
  items,
}: {
  items: {
    label: string;
    value: number | string;
    hint?: string;
    color?: string;
  }[];
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          md: `repeat(${items.length}, minmax(0, 1fr))`,
        },
        gap: 2,
        mb: 3,
      }}
    >
      {items.map((item) => (
        <Paper
          key={item.label}
          elevation={0}
          sx={{ p: { xs: 2, md: 3 }, border: "1px solid #e1e6de" }}
        >
          <Typography color="text.secondary" variant="body2">
            {item.label}
          </Typography>
          <Typography
            variant="h3"
            sx={{ my: 1, fontWeight: 700, color: item.color || "primary.main" }}
          >
            {item.value}
          </Typography>
          {item.hint && (
            <Typography variant="caption" color="text.secondary">
              {item.hint}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  );
}
export function IssueBadges({
  issue,
}: {
  issue: Pick<Issue, "priority" | "status">;
}) {
  return (
    <Stack sx={{ gap: 1, flexWrap: "wrap" }} direction="row">
      <Chip
        size="small"
        color={
          issue.priority === "critique"
            ? "error"
            : issue.priority === "haute"
            ? "warning"
            : "default"
        }
        label={priorities[issue.priority]}
      />
      <Chip
        size="small"
        variant="outlined"
        color={
          issue.status === "resolu"
            ? "success"
            : issue.status === "en_cours"
            ? "info"
            : "default"
        }
        label={statuses[issue.status]}
      />
    </Stack>
  );
}
export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 5, textAlign: "center", borderStyle: "dashed" }}
    >
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        {detail}
      </Typography>
    </Paper>
  );
}
