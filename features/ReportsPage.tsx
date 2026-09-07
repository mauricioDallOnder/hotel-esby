"use client";
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PictureAsPdfOutlined from "@mui/icons-material/PictureAsPdfOutlined";
import { useAppContext } from "@/context/AppContext";
import {
  displayDate,
  eventAt,
  monthlySummary,
  statuses,
  today,
} from "@/lib/domain";
import {
  ConnectionBar,
  EmptyState,
  PageTitle,
  StatCards,
} from "@/components/HotelUI";
export default function ReportsPage() {
  const { issues, inspections, hotelName } = useAppContext();
  const [kind, setKind] = useState<"daily" | "monthly">("daily");
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const valid =
    kind === "daily"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today()
      : /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= today().slice(0, 7);
  const summary =
    valid && kind === "monthly"
      ? monthlySummary({ issues, inspections }, month)
      : null;
  const rounds =
    kind === "daily"
      ? inspections.filter((i) => i.date === date)
      : summary?.inspections || [];
  const pending =
    summary?.pendingEnd ||
    issues.filter(
      (i) =>
        i.date <= date && (eventAt(i, date)?.status ?? "ouvert") !== "resolu"
    );
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      const { downloadReport } = await import("@/lib/pdfExport");
      await downloadReport({
        kind,
        period: kind === "daily" ? date : month,
        hotelName,
        state: { issues, inspections },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <ConnectionBar />
      <PageTitle
        eyebrow="Les faits, en un document"
        title="Rapports & bilan mensuel"
        description="Retrouvez les constats, les photos et le travail accompli."
      />
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Stack
          sx={{ alignItems: { xs: "stretch", sm: "center" } }}
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
        >
          <TextField
            select
            label="Type de rapport"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="daily">Rapport quotidien</MenuItem>
            <MenuItem value="monthly">Bilan mensuel</MenuItem>
          </TextField>
          {kind === "daily" ? (
            <TextField
              type="date"
              label="Date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: today() },
              }}
            />
          ) : (
            <TextField
              type="month"
              label="Mois"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: today().slice(0, 7) },
              }}
            />
          )}
          <Button
            disabled={exporting || !valid}
            startIcon={<PictureAsPdfOutlined />}
            variant="contained"
            onClick={() => void exportPdf()}
            sx={{ ml: { sm: "auto !important" } }}
          >
            {exporting ? "Préparation du PDF…" : "Télécharger le PDF"}
          </Button>
        </Stack>
      </Paper>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      {!valid ? (
        <Alert severity="info">
          Choisissez une période valide, au plus tard aujourd’hui.
        </Alert>
      ) : (
        <>
          {summary ? (
            <StatCards
              items={[
                {
                  label: "Report du mois précédent",
                  value: summary.pendingStart.length,
                },
                {
                  label: "Nouvelles anomalies",
                  value: summary.newIssues.length,
                },
                {
                  label: "Résolues dans le mois",
                  value: summary.resolvedCount,
                },
                {
                  label: "Restantes en fin de période",
                  value: summary.pendingEnd.length,
                },
              ]}
            />
          ) : (
            <StatCards
              items={[
                {
                  label: "Rondes terminées",
                  value: rounds.filter((r) => r.completed).length,
                },
                {
                  label: "Nouvelles anomalies",
                  value: issues.filter((i) => i.date === date).length,
                },
                { label: "Non résolues à cette date", value: pending.length },
              ]}
            />
          )}
          {rounds.some((i) => !i.completed) && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              Des rondes sont encore en brouillon. Le PDF les identifiera comme
              incomplètes.
            </Alert>
          )}
          <Typography variant="h5" sx={{ mb: 2 }}>
            {summary ? "Travaux et interventions du mois" : "Rondes du jour"}
          </Typography>
          {summary ? (
            !summary.interventions.length ? (
              <EmptyState
                title="Aucune intervention consignée"
                detail="Les notes de suivi et les résolutions apparaîtront ici."
              />
            ) : (
              <Stack spacing={2}>
                {summary.interventions.map(({ issue, event }, index) => (
                  <Paper variant="outlined" key={index} sx={{ p: 2.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {displayDate(today(new Date(event.at)))} · {event.actor} ·{" "}
                      {statuses[event.status]}
                    </Typography>
                    <Typography variant="h6">
                      {issue.title} · {issue.location}
                    </Typography>
                    <Typography
                      sx={{
                        mt: 1,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {event.note}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            )
          ) : !rounds.length ? (
            <EmptyState
              title="Aucune ronde enregistrée"
              detail="Vous pouvez tout de même exporter les anomalies et les anciens problèmes en attente à cette date."
            />
          ) : (
            <Stack spacing={2}>
              {rounds.map((round) => (
                <Paper key={round.id} variant="outlined" sx={{ p: 2.5 }}>
                  <Typography variant="h6">{round.area}</Typography>
                  <Typography color="text.secondary">
                    {round.inspector} ·{" "}
                    {round.completed ? "Terminée" : "Brouillon"} ·{" "}
                    {round.checks.filter((c) => c.result === "anomalie").length}{" "}
                    point(s) en anomalie
                  </Typography>
                </Paper>
              ))}
            </Stack>
          )}
          <Box sx={{ mt: 4 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>
              Anomalies non résolues{" "}
              {summary ? "en fin de période" : "à cette date"}
            </Typography>
            {!pending.length ? (
              <Typography color="text.secondary">
                Aucune anomalie en attente.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {pending.map((issue) => (
                  <Paper key={issue.id} variant="outlined" sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {issue.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {issue.location} · Constat du {displayDate(issue.date)}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        </>
      )}
    </>
  );
}
