"use client";
import Link from "next/link";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { useAppContext } from "@/context/AppContext";
import { today, type Issue } from "@/lib/domain";
import {
  ConnectionBar,
  EmptyState,
  IssueBadges,
  PageTitle,
  StatCards,
} from "@/components/HotelUI";
import { IssueDialog } from "@/components/IssueDialog";
import { useState } from "react";
export default function DashboardPage() {
  const { issues, inspections, hotelName } = useAppContext();
  const [active, setActive] = useState<Issue | "new" | null>(null);
  const date = today();
  const pending = issues.filter((i) => i.status !== "resolu");
  const critical = pending.filter((i) => i.priority === "critique");
  const daily = inspections.filter((i) => i.date === date);
  const rank = { critique: 0, haute: 1, normale: 2 };
  const focus = pending
    .toSorted(
      (a, b) =>
        rank[a.priority] - rank[b.priority] || a.date.localeCompare(b.date)
    )
    .slice(0, 6);
  return (
    <>
      <ConnectionBar />
      <PageTitle
        eyebrow={hotelName}
        title="Hôtel, gestion de pilotage."
        description={new Date().toLocaleDateString("fr-FR", {
          timeZone: "Europe/Paris",
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
        action={
          <Button variant="contained" onClick={() => setActive("new")}>
            + Signaler une anomalie
          </Button>
        }
      />
      <Paper
        elevation={0}
        sx={{
          background: "#173e36",
          color: "white",
          p: { xs: 3, md: 4 },
          mb: 3,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Stack
          sx={{
            justifyContent: "space-between",
            gap: 3,
            alignItems: { xs: "stretch", md: "center" },
          }}
          direction={{ xs: "column", md: "row" }}
        >
          <Box sx={{ maxWidth: 560 }}>
            <Chip
              label="LA RONDE"
              size="small"
              sx={{
                color: "#e4eedc",
                bgcolor: "#315449",
                mb: 2,
                letterSpacing: 1,
              }}
            />
           
            <Typography sx={{ color: "#cfddd4" }}>
              Vérifiez les points essentiels, photographiez les anomalies et
              gardez une trace de chaque intervention.
            </Typography>
          </Box>
          <Button
            component={Link}
            href="/rondes"
            variant="contained"
            endIcon={<ArrowForward />}
            sx={{
              bgcolor: "#e6edb3",
              color: "#183e36",
              p: 2,
              flexShrink: 0,
              "&:hover": { bgcolor: "#d4df96" },
            }}
          >
            Commencer la ronde
          </Button>
        </Stack>
      </Paper>
      <StatCards
        items={[
          {
            label: "Anomalies non résolues",
            value: pending.length,
            hint: "Toutes les dates",
          },
          {
            label: "Critiques à traiter",
            value: critical.length,
            hint: "À suivre en priorité",
            color: critical.length ? "#b83e30" : undefined,
          },
          {
            label: "Interventions en cours",
            value: pending.filter((i) => i.status === "en_cours").length,
          },
          {
            label: "Rondes terminées aujourd’hui",
            value: daily.filter((i) => i.completed).length,
            hint: `${daily.filter((i) => !i.completed).length} brouillon(s)`,
          },
        ]}
      />
      <Stack
        direction="row"
        sx={{
          ...{ my: 3 },
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h5">À suivre en priorité</Typography>
        <Button component={Link} href="/anomalies">
          Tout voir →
        </Button>
      </Stack>
      {!focus.length ? (
        <EmptyState
          title="Aucune anomalie en attente"
          detail="Continuez vos rondes quotidiennes pour garder un suivi à jour."
        />
      ) : (
        <Stack spacing={1.5}>
          {focus.map((issue) => (
            <Paper key={issue.id} variant="outlined" sx={{ p: 2.5 }}>
              <Stack
                sx={{
                  gap: 2,
                  alignItems: { xs: "stretch", sm: "center" },
                  justifyContent: "space-between",
                }}
                direction={{ xs: "column", sm: "row" }}
              >
                <Box>
                  <Typography variant="h6">{issue.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {issue.location} ·{" "}
                    {issue.assignee || "Responsable à désigner"}
                  </Typography>
                </Box>
                <Stack
                  sx={{
                    gap: 2,
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                  direction="row"
                >
                  <IssueBadges issue={issue} />
                  <Button onClick={() => setActive(issue)}>Suivre</Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      {active && (
        <IssueDialog
          key={active === "new" ? "new" : active.id}
          issue={active === "new" ? undefined : active}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
