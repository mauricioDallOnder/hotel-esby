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
import { isRoomClutterIssue, reportPendingIssues, reportPeriodEnd, reportPhotos, type ReportScope } from "@/lib/reportData";
export default function ReportsPage() {
  const { issues, inspections, roomInspections = [], hotelName } = useAppContext();
  const [kind, setKind] = useState<"daily" | "monthly">("daily");
  const [scope, setScope] = useState<ReportScope>("all");
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const valid =
    kind === "daily"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today()
      : /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= today().slice(0, 7);
  const period = kind === "daily" ? date : month;
  const end = valid ? reportPeriodEnd(kind, period) : today();
  const reportState = { issues, inspections, roomInspections };
  const scopedIssues = scope === "all" ? issues : issues.filter(issue => isRoomClutterIssue(issue, end));
  const summary =
    valid && kind === "monthly"
      ? monthlySummary({ issues: scopedIssues, inspections }, month)
      : null;
  const rounds =
    kind === "daily"
      ? inspections.filter((i) => i.date === date)
      : summary?.inspections || [];
  const pending = valid ? reportPendingIssues(reportState, kind, period, scope) : [];
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      const { downloadReport } = await import("@/lib/pdfExport");
      await downloadReport({
        kind,
        period,
        hotelName,
        state: reportState,
        scope,
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
        title="Rapports"
        description="Exportez les problèmes à traiter avec toutes les photos des contrôles associés."
      />
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" } }}>
          <TextField
            select
            label="Type de rapport"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <MenuItem value="daily">Rapport quotidien</MenuItem>
            <MenuItem value="monthly">Bilan mensuel</MenuItem>
          </TextField>
          <TextField select label="Contenu" value={scope} onChange={e => setScope(e.target.value as ReportScope)}>
            <MenuItem value="all">Tous les problèmes</MenuItem>
            <MenuItem value="room_clutter">Chambres encombrées</MenuItem>
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
            sx={{ minHeight: 56 }}
          >
            {exporting ? "Préparation du PDF…" : "Télécharger le PDF"}
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Le PDF contient les problèmes encore en attente à la date choisie et toutes leurs photos enregistrées jusqu’à cette date.
          {scope === "room_clutter" && " Seuls les signalements de chambres encombrées sont sélectionnés."}
        </Typography>
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
          {scope === "room_clutter" ? (
            <StatCards items={[
              { label: kind === "daily" ? "Nouveaux signalements du jour" : "Nouveaux signalements du mois", value: scopedIssues.filter(issue => kind === "daily" ? issue.date === date : issue.date.startsWith(month)).length },
              { label: "Signalements en attente", value: pending.length },
            ]} />
          ) : summary ? (
            <StatCards
              items={[
                {
                  label: "Report du mois précédent",
                  value: summary.pendingStart.length,
                },
                {
                  label: "Nouveaux problèmes",
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
                  label: "Nouveaux problèmes",
                  value: issues.filter((i) => i.date === date).length,
                },
                { label: "Non résolues à cette date", value: pending.length },
              ]}
            />
          )}
          {scope === "all" && <>
          {rounds.some((i) => !i.completed) && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              Des rondes sont encore en brouillon. Terminez-les pour finaliser les constats avant l’export.
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
              detail="Vous pouvez exporter les problèmes en attente à cette date, y compris ceux des checklists des chambres."
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
          </>}
          <Box sx={{ mt: 4 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>
              {scope === "room_clutter" ? "Chambres encombrées à traiter" : "Problèmes non résolus"}{" "}
              {summary ? "en fin de période" : "à cette date"}
            </Typography>
            {!pending.length ? (
              <Typography color="text.secondary">
                {scope === "room_clutter" ? "Aucune chambre encombrée en attente pour cette période. Les réponses « Oui » du checklist apparaîtront ici après leur enregistrement." : "Aucun problème en attente."}
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
                    <Typography variant="body2" color="text.secondary">
                      {reportPhotos(issue, reportState, end).length} photo(s) dans le PDF
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
