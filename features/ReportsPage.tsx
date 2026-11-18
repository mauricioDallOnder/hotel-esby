"use client";
import { useMemo, useState } from "react";
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
import { indexReportPhotos, reportPeriodEnd, reportRows, reportScopes, type ReportScope } from "@/lib/reportData";
export default function ReportsPage() {
  const { issues, inspections, roomInspections, workEvents, hotelName } = useAppContext();
  const [kind, setKind] = useState<"daily" | "monthly">("daily");
  const [scope, setScope] = useState<ReportScope>("all");
  const currentDay = today();
  const [date, setDate] = useState(currentDay);
  const [month, setMonth] = useState(currentDay.slice(0, 7));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const valid =
    kind === "daily"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= currentDay
      : /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= currentDay.slice(0, 7);
  const period = kind === "daily" ? date : month;
  const end = valid ? reportPeriodEnd(kind, period) : currentDay;
  const reportState = useMemo(() => ({ issues, inspections, roomInspections, workEvents }), [issues, inspections, roomInspections, workEvents]);
  const summary = useMemo(() => valid && kind === "monthly" && scope === "all"
    ? monthlySummary({ issues, inspections }, month) : null, [valid, kind, scope, issues, inspections, month]);
  const rounds =
    kind === "daily"
      ? inspections.filter((i) => i.date === date)
      : summary?.inspections || [];
  const getPhotos = useMemo(() => indexReportPhotos(reportState, end), [reportState, end]);
  const preview = useMemo(() => valid ? reportRows(reportState, kind, period, scope).map(row => ({
    ...row, photoCount: (row.photos ?? getPhotos(row.issue)).length,
  })) : [], [valid, reportState, kind, period, scope, getPhotos]);
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
        description="Téléchargez les problèmes à traiter et les résolutions, avec les photos des contrôles associés."
      />
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" } }}>
          <TextField
            select
            label="Type de rapport"
            value={kind}
            disabled={exporting}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <MenuItem value="daily">Rapport quotidien</MenuItem>
            <MenuItem value="monthly">Bilan mensuel</MenuItem>
          </TextField>
          <TextField select label="Contenu" value={scope} disabled={exporting} onChange={e => setScope(e.target.value as ReportScope)}>
            {Object.entries(reportScopes).map(([value, { label }]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          {kind === "daily" ? (
            <TextField
              type="date"
              label="Date"
              value={date}
              disabled={exporting}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: currentDay },
              }}
            />
          ) : (
            <TextField
              type="month"
              label="Mois"
              value={month}
              disabled={exporting}
              onChange={(e) => setMonth(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: currentDay.slice(0, 7) },
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
          {scope === "resolved" ? "Résolutions du jour ou du mois choisi, y compris les éléments réparés d’une fiche encore ouverte. Les éléments rouverts avant la fin de la période sont exclus."
            : scope === "complete" ? "Problèmes encore en attente à la fin de la période et éléments résolus pendant celle-ci, regroupés par fiche."
            : "Problèmes encore en attente à la fin de la période choisie, avec leurs photos enregistrées jusqu’à cette date."}
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
          {scope !== "all" ? (
            <StatCards items={[
              { label: "Fiches dans le PDF", value: preview.length },
              { label: "Photos associées", value: preview.reduce((sum, row) => sum + row.photoCount, 0) },
            ]} />
          ) : summary ? (
            <StatCards
              items={[
                {
                  label: "Anomalies reportées du mois précédent",
                  value: summary.pendingStart.length,
                },
                {
                  label: "Anomalies créées dans le mois",
                  value: summary.newIssues.length,
                },
                {
                  label: "Anomalies passées à résolu",
                  value: summary.resolvedCount,
                },
                {
                  label: "Fiches à traiter dans le PDF",
                  value: preview.length,
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
                { label: "Non résolues à cette date", value: preview.length },
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
              {reportScopes[scope].heading}
            </Typography>
            {!preview.length ? (
              <Typography color="text.secondary">
                {reportScopes[scope].empty}
              </Typography>
            ) : (
              <Stack spacing={1}>
                {preview.map(({ issue, title, description, status, photoCount }) => (
                  <Paper key={issue.id} variant="outlined" sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {issue.location} · Constat du {displayDate(issue.date)}
                      {(scope === "complete" || scope === "resolved") && ` · ${statuses[status]}`}
                    </Typography>
                    {scope !== "all" && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{description}</Typography>}
                    <Typography variant="body2" color="text.secondary">
                      {photoCount} photo(s) dans le PDF
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
