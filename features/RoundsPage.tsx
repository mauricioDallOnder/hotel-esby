"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAppContext } from "@/context/AppContext";
import {
  checklist,
  checkLabels,
  displayDate,
  emptyInspection,
  today,
  type Inspection,
} from "@/lib/domain";
import { ConnectionBar, EmptyState, PageTitle } from "@/components/HotelUI";
import { IssueDialog } from "@/components/IssueDialog";
export default function RoundsPage() {
  const { inspections, issues, mutate, busy } = useAppContext();
  const [date, setDate] = useState(today());
  const [draft, setDraft] = useState<Inspection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newIssueKey, setNewIssueKey] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(next: Inspection) {
    setDraft(next);
    setDirty(true);
    setSuccess("");
  }
  function changeCheck(
    key: string,
    patch: Partial<Inspection["checks"][number]>
  ) {
    if (draft)
      edit({
        ...draft,
        checks: draft.checks.map((c) =>
          c.key === key ? { ...c, ...patch } : c
        ),
      });
  }
  function open(next: Inspection | null) {
    if (
      dirty &&
      !window.confirm("Abandonner les modifications non enregistrées ?")
    )
      return;
    setDraft(next);
    setDirty(false);
    setError("");
    setSuccess("");
  }
  async function save(completed: boolean) {
    if (!draft) return;
    setError("");
    setSuccess("");
    try {
      const data = await mutate({
        type: "saveInspection",
        inspection: { ...draft, completed },
      });
      setDraft(data.inspections.find((i) => i.id === draft.id)!);
      setDirty(false);
      setSuccess(
        completed
          ? "Ronde terminée. Le rapport est disponible dans Rapports & bilan mensuel."
          : "Brouillon enregistré."
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const selected = inspections.filter((i) => i.date === date);
  const count =
    draft?.checks.filter((c) => c.result !== "non_verifie").length || 0;
  const issueCheck = checklist.find((c) => c.id === newIssueKey);
  return (
    <>
      <ConnectionBar />
      <PageTitle
        eyebrow="La visite du matin"
        title="Ronde quotidienne"
        description="Parcourez les points essentiels et consignez chaque anomalie."
        action={
          <Button
            disabled={busy}
            variant="contained"
            onClick={() => open(emptyInspection(date))}
          >
            Nouvelle ronde
          </Button>
        }
      />
      {!draft ? (
        <>
          <TextField
            type="date"
            label="Date de la ronde"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { max: today() },
            }}
            sx={{ mb: 3 }}
          />
          {!selected.length ? (
            <EmptyState
              title="Aucune ronde pour cette date"
              detail="Commencez une ronde pour vérifier les espaces de l’hôtel. Vous pouvez créer une ronde par étage ou par zone."
            />
          ) : (
            <Stack spacing={2}>
              {selected.map((round) => (
                <Paper key={round.id} variant="outlined" sx={{ p: 3 }}>
                  <Stack
                    sx={{ justifyContent: "space-between" }}
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                  >
                    <Box>
                      <Typography variant="h6">{round.area}</Typography>
                      <Typography color="text.secondary">
                        {round.inspector} · {displayDate(round.date)}
                      </Typography>
                    </Box>
                    <Stack
                      sx={{ gap: 2, alignItems: "center" }}
                      direction="row"
                    >
                      <Chip
                        label={round.completed ? "Terminée" : "Brouillon"}
                        color={round.completed ? "success" : "default"}
                      />
                      <Button onClick={() => open(round)}>
                        {round.completed ? "Consulter" : "Continuer"}
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </>
      ) : (
        <Stack spacing={3}>
          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}
          <Stack
            sx={{ alignItems: "center", justifyContent: "space-between" }}
            direction="row"
          >
            <Button disabled={busy} onClick={() => open(null)}>
              ← Toutes les rondes
            </Button>
            <Chip
              label={
                draft.completed
                  ? "Ronde terminée"
                  : dirty
                  ? "Modifications non enregistrées"
                  : draft.version
                  ? "Brouillon enregistré"
                  : "Nouvelle ronde"
              }
              color={draft.completed ? "success" : "default"}
            />
          </Stack>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Stack sx={{ gap: 2 }} direction={{ xs: "column", md: "row" }}>
                <TextField
                  disabled={draft.completed || busy}
                  required
                  type="date"
                  label="Date"
                  value={draft.date}
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { max: today() },
                  }}
                  onChange={(e) => edit({ ...draft, date: e.target.value })}
                />
                <TextField
                  disabled={draft.completed || busy}
                  required
                  label="Inspecteur / inspectrice"
                  value={draft.inspector}
                  onChange={(e) =>
                    edit({ ...draft, inspector: e.target.value })
                  }
                  fullWidth
                />
                <TextField
                  disabled={draft.completed || busy}
                  required
                  label="Zone inspectée"
                  placeholder="Ex. : 2e étage et couloir"
                  value={draft.area}
                  onChange={(e) => edit({ ...draft, area: e.target.value })}
                  fullWidth
                />
              </Stack>
              <Stack sx={{ justifyContent: "space-between" }} direction="row">
                <Typography variant="body2">
                  Progression de la vérification
                </Typography>
                <Typography variant="body2">
                  {count} / {checklist.length}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={(count / checklist.length) * 100}
                sx={{ height: 7, borderRadius: 9 }}
              />
            </Stack>
          </Paper>
          {draft.checks.map((check, index) => {
            const template = checklist.find((c) => c.id === check.key)!;
            const linked = issues.find((i) => i.id === check.issueId);
            return (
              <Paper
                key={check.key}
                variant="outlined"
                sx={{
                  p: { xs: 2, md: 3 },
                  borderColor:
                    check.result === "anomalie" ? "#e4bdb3" : undefined,
                }}
              >
                <Stack spacing={2}>
                  <Stack
                    sx={{ justifyContent: "space-between" }}
                    direction={{ xs: "column", md: "row" }}
                    spacing={2}
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        POINT {String(index + 1).padStart(2, "0")}
                        {template.critical ? " · PRIORITAIRE" : ""}
                      </Typography>
                      <Typography variant="h6" sx={{ fontSize: 17, mt: 0.5 }}>
                        {template.label}
                      </Typography>
                    </Box>
                    <TextField
                      select
                      disabled={draft.completed || busy}
                      label={`Résultat du point ${index + 1}`}
                      value={check.result}
                      onChange={(e) =>
                        changeCheck(check.key, {
                          result: e.target.value as typeof check.result,
                          issueId: null,
                        })
                      }
                      sx={{ minWidth: 190 }}
                    >
                      {Object.entries(checkLabels).map(([key, label]) => (
                        <MenuItem key={key} value={key}>
                          {label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  {check.result === "anomalie" && (
                    <Box sx={{ bgcolor: "#fff8f5", p: 2, borderRadius: 2 }}>
                      <Stack spacing={2}>
                        <Typography variant="body2">
                          Associez le problème à un signalement pour suivre sa
                          résolution.
                        </Typography>
                        <TextField
                          select
                          fullWidth
                          disabled={draft.completed || busy}
                          label="Anomalie associée"
                          value={check.issueId || ""}
                          onChange={(e) =>
                            changeCheck(check.key, {
                              issueId: e.target.value || null,
                            })
                          }
                        >
                          <MenuItem value="">
                            Sélectionner un signalement
                          </MenuItem>
                          {issues
                            .filter((i) => i.date <= draft.date)
                            .map((i) => (
                              <MenuItem key={i.id} value={i.id}>
                                {i.location} · {i.title}
                                {i.status === "resolu" ? " (résolu)" : ""}
                              </MenuItem>
                            ))}
                        </TextField>
                        {linked && (
                          <Typography variant="body2">
                            {linked.status === "resolu"
                              ? "✓ Résolu"
                              : linked.status === "en_cours"
                              ? "Intervention en cours"
                              : "À traiter"}{" "}
                            · {linked.description}
                          </Typography>
                        )}
                        {!draft.completed && (
                          <Button
                            disabled={busy}
                            variant="outlined"
                            onClick={() => setNewIssueKey(check.key)}
                          >
                            + Signaler avec une photo
                          </Button>
                        )}
                      </Stack>
                    </Box>
                  )}
                  <TextField
                    disabled={draft.completed || busy}
                    label="Observation (facultative)"
                    value={check.note}
                    onChange={(e) =>
                      changeCheck(check.key, { note: e.target.value })
                    }
                    size="small"
                    fullWidth
                  />
                </Stack>
              </Paper>
            );
          })}
          <TextField
            disabled={draft.completed || busy}
            label="Notes générales de la ronde"
            multiline
            minRows={3}
            value={draft.notes}
            onChange={(e) => edit({ ...draft, notes: e.target.value })}
          />
          {!draft.completed && (
            <Stack
              sx={{ justifyContent: "flex-end", gap: 2 }}
              direction={{ xs: "column", sm: "row" }}
            >
              <Button
                disabled={busy}
                variant="outlined"
                onClick={() => void save(false)}
              >
                Enregistrer le brouillon
              </Button>
              <Button
                disabled={busy || count !== checklist.length}
                variant="contained"
                onClick={() => void save(true)}
              >
                {busy ? "Enregistrement…" : "Terminer la ronde"}
              </Button>
            </Stack>
          )}
        </Stack>
      )}
      {draft && issueCheck && (
        <IssueDialog
          defaults={{
            title: issueCheck.label,
            priority: issueCheck.critical ? "critique" : "normale",
            location: draft.area,
            actor: draft.inspector,
            date: draft.date,
          }}
          onSaved={(issue) => changeCheck(issueCheck.id, { issueId: issue.id })}
          onClose={() => setNewIssueKey(null)}
        />
      )}
    </>
  );
}
