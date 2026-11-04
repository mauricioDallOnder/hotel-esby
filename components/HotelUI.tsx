"use client";
import { useState } from "react";
import { CheckCircleOutlined, CloudOffOutlined, RefreshOutlined, SyncOutlined, WarningAmberRounded } from "@mui/icons-material";
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
import { SyncStatus, useEntries } from "@/context/EntriesContext";
import { priorities, statuses, type Issue } from "@/lib/domain";
import { roles } from "@/lib/roles";
import { syncSummary } from "@/lib/syncStatus";
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
  const { mode, error, saveError, clearSaveError, refresh, busy, logout, role, cachedAt } = useAppContext();
  const { pending, ready, online, working, storageError, retry } = useEntries();
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionError, setActionError] = useState("");
  const summary = syncSummary({ ready, online, working, pending, storageError, saving: busy, saveError, stale: !!cachedAt || !!error, refreshing });
  const disabled = busy || refreshing || loggingOut;

  async function runAction(action: "refresh" | "logout") {
    const setWorking = action === "refresh" ? setRefreshing : setLoggingOut;
    setWorking(true);
    setActionError("");
    try { await (action === "refresh" ? refresh() : logout()); }
    catch (e) { setActionError(e instanceof Error ? e.message : "Action impossible. Réessayez."); }
    finally { setWorking(false); }
  }

  return (
    <Paper variant="outlined" component="section" aria-label="État des enregistrements" sx={{ p: 1.5, mb: 3 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ gap: 1, alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minWidth: 0, maxWidth: "100%" }}>
              <Chip
                size="small"
                variant="outlined"
                color={summary.color}
                icon={summary.color === "error" ? <WarningAmberRounded /> : !online ? <CloudOffOutlined /> : summary.color === "success" ? <CheckCircleOutlined /> : summary.color === "warning" ? <WarningAmberRounded /> : <SyncOutlined />}
                label={summary.label}
                sx={{ maxWidth: "100%", height: "auto", py: 0.5, "& .MuiChip-label": { whiteSpace: "normal", lineHeight: 1.4 } }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">{mode === "sheets" ? "Google Sheets" : "Stockage local"}</Typography>
          </Stack>
          {summary.color !== "success" && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{summary.detail}</Typography>}
        </Box>
        <Stack direction="row" sx={{ gap: 0.5, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          {pending.length > 0 && <Button size="small" disabled={working || !online || !ready} onClick={retry}>Réessayer l’envoi</Button>}
          <Chip size="small" label={roles[role]} />
          <Button size="small" startIcon={<RefreshOutlined />} disabled={disabled || !online} onClick={() => void runAction("refresh")}>
            {refreshing ? "Actualisation…" : "Actualiser"}
          </Button>
          <Button size="small" disabled={disabled} onClick={() => void runAction("logout")}>
            Déconnexion
          </Button>
        </Stack>
      </Stack>
      <SyncStatus />
      {cachedAt && <Alert severity="warning" sx={{ mt: 1.5 }}>Copie enregistrée sur cet appareil le {new Date(cachedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}. Les données peuvent avoir changé. Actualisez dès que la connexion le permet.{error ? ` ${error}` : ""}</Alert>}
      {!cachedAt && error && <Alert severity="warning" sx={{ mt: 1.5 }}>Actualisation impossible. Les données déjà chargées restent affichées. {error}</Alert>}
      {saveError && <Alert severity="error" onClose={clearSaveError} closeText="Masquer ce message" sx={{ mt: 1.5 }}>Dernier enregistrement non confirmé : {saveError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mt: 1.5 }}>{actionError}</Alert>}
    </Paper>
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
