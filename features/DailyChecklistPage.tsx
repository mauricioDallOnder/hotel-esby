"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  List,
  ListItemButton,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";

import AccessTimeRounded from "@mui/icons-material/AccessTimeRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRounded from "@mui/icons-material/RadioButtonUncheckedRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";

import {
  ConnectionBar,
  PageTitle,
} from "@/components/HotelUI";

type Task = {
  id: string;
  title: string;
  detail: string;
  time?: string;
  bin?: string;
};

type Checks = Record<string, boolean>;

const DAILY_TASKS: Task[] = [
  {
    id: "open-kitchen-room-oven-storage",
    time: "08:00",
    title: "Ouvrir la cuisine, la chambre four et la réserve",
    detail: "Première tâche à l'arrivée.",
  },
  {
    id: "open-reception",
    title: "Ouvrir la réception",
    detail: "À faire juste après l'ouverture des premiers locaux.",
  },
  {
    id: "check-kitchen-premises-hobs",
    title: "Vérifier la cuisine, ouvrir le local des plaques",
    detail: "Faire un contrôle rapide de l'état des lieux.",
  },
  {
    id: "check-outdoor-tank-temperature",
    title: "Vérifier la température du ballon à l'extérieur",
    detail:
      "Envoyer la photo et enregistrer dans la feuille de contrôle. Attention : le ballon 3 correspond au ballon 1.",
  },
  {
    id: "check-bins",
    title: "Vérifier les 5 poubelles",
    detail:
      "Contrôler les bacs et suivre la consigne spéciale du jour ci-dessous.",
  },
  {
    id: "check-resident-software",
    title: "Vérifier le logiciel des résidents",
    detail:
      "Contrôler les informations et les éventuelles mises à jour.",
  },
];

const BIN_TASKS_BY_WEEKDAY: Partial<Record<number, Task[]>> = {
  // Lundi
  1: [
    {
      id: "monday-black-bin-out",
      time: "21:00",
      bin: "Bac noir",
      title: "Sortir le bac noir",
      detail:
        "Le placer devant la porte 3, sur le côté, sans bloquer la porte.",
    },
  ],

  // Mardi
  2: [
    {
      id: "tuesday-black-bin-in-clean",
      time: "08:00",
      bin: "Bac noir",
      title: "Rentrer le bac et le nettoyer",
      detail: "Après la sortie du bac noir du lundi soir.",
    },
  ],

  // Mercredi
  3: [
    {
      id: "wednesday-yellow-bin-out",
      time: "21:00",
      bin: "Bac jaune",
      title: "Sortir le bac jaune",
      detail:
        "Le placer à côte de la porte (3 poubelles) , au même endroit, sans bloquer la porte.",
    },
  ],
};

function capitalize(value: string): string {
  if (!value) return value;

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year =
    parts.find((part) => part.type === "year")?.value ?? "";

  const month =
    parts.find((part) => part.type === "month")?.value ?? "";

  const day =
    parts.find((part) => part.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function formatDate(date: Date): string {
  return capitalize(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date)
  );
}

function formatWeekday(date: Date): string {
  return capitalize(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
    }).format(date)
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getWeekday(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(date);

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[weekday] ?? 0;
}

function storageKey(dateKey: string): string {
  return `hotel-checklist:${dateKey}`;
}

function loadChecks(dateKey: string): Checks {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const saved = window.localStorage.getItem(
      storageKey(dateKey)
    );

    if (!saved) {
      return {};
    }

    return JSON.parse(saved) as Checks;
  } catch {
    return {};
  }
}

function saveChecks(
  dateKey: string,
  checks: Checks
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      storageKey(dateKey),
      JSON.stringify(checks)
    );
  } catch {
    // L'application continue à fonctionner même
    // si localStorage n'est pas disponible.
  }
}

type TaskRowProps = {
  task: Task;
  done: boolean;
  last?: boolean;
  onToggle: () => void;
};

function TaskRow({
  task,
  done,
  last = false,
  onToggle,
}: TaskRowProps) {
  return (
    <ListItemButton
      onClick={onToggle}
      role="checkbox"
      aria-checked={done}
      sx={{
        minHeight: 84,
        px: { xs: 2, sm: 2.5 },
        py: 2,
        gap: 1.5,
        alignItems: "flex-start",

        borderBottom: last
          ? "none"
          : "1px solid",

        borderColor: "divider",

        bgcolor: done
          ? "action.hover"
          : "background.paper",

        "&:hover": {
          bgcolor: done
            ? "action.selected"
            : "action.hover",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          pt: 0.25,
          flexShrink: 0,
        }}
      >
        {done ? (
          <CheckCircleRounded
            color="primary"
            sx={{ fontSize: 26 }}
          />
        ) : (
          <RadioButtonUncheckedRounded
            color="disabled"
            sx={{ fontSize: 26 }}
          />
        )}
      </Box>

      <Box
        sx={{
          minWidth: 0,
          flex: 1,
        }}
      >
       <Stack
  direction="row"
  spacing={1}
  useFlexGap
  sx={{
    alignItems: "center",
    mb: 0.75,
    flexWrap: "wrap",
  }}
>
  {task.time ? (
    <Chip
      size="small"
      label={task.time}
      color={done ? "default" : "primary"}
      sx={{
        height: 24,
        fontWeight: 800,
      }}
    />
  ) : null}

  {task.bin ? (
    <Chip
      size="small"
      variant="outlined"
      label={task.bin}
      sx={{
        height: 24,
        fontWeight: 700,
      }}
    />
  ) : null}

  <Typography
    variant="subtitle1"
    sx={{
      fontWeight: 800,
      lineHeight: 1.35,
      textDecoration: done ? "line-through" : "none",
      color: done ? "text.disabled" : "text.primary",
    }}
  >
    {task.title}
  </Typography>
</Stack>
        

        <Typography
          variant="body2"
          color={
            done
              ? "text.disabled"
              : "text.secondary"
          }
          sx={{
            lineHeight: 1.5,
          }}
        >
          {task.detail}
        </Typography>
      </Box>
    </ListItemButton>
  );
}

export default function DailyChecklistPage() {
  const [now, setNow] =
    useState<Date | null>(null);

  const [dateKey, setDateKey] =
    useState("");

  const [checks, setChecks] =
    useState<Checks>({});

  const [toastOpen, setToastOpen] =
    useState(false);

  const previouslyComplete =
    useRef(false);

  useEffect(() => {
    function refresh() {
      const fresh = new Date();

      setNow(fresh);
      setDateKey(localDateKey(fresh));
    }

    refresh();

    const interval = window.setInterval(
      refresh,
      30_000
    );

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!dateKey) {
      return;
    }

    const stored = loadChecks(dateKey);

    setChecks(stored);
    previouslyComplete.current = false;
  }, [dateKey]);

  const binTasks = useMemo(() => {
    if (!now) {
      return [];
    }

    return (
      BIN_TASKS_BY_WEEKDAY[
        getWeekday(now)
      ] ?? []
    );
  }, [now]);

  const allTasks = useMemo(
    () => [...DAILY_TASKS, ...binTasks],
    [binTasks]
  );

  const completed = allTasks.filter(
    (task) => Boolean(checks[task.id])
  ).length;

  const total = allTasks.length;

  const percentage =
    total > 0
      ? Math.round(
          (completed / total) * 100
        )
      : 0;

  const complete =
    total > 0 && completed === total;

  useEffect(() => {
    if (
      complete &&
      !previouslyComplete.current
    ) {
      setToastOpen(true);
    }

    previouslyComplete.current = complete;
  }, [complete]);

  function toggleTask(id: string) {
    if (!dateKey) {
      return;
    }

    setChecks((current) => {
      const next = {
        ...current,
        [id]: !current[id],
      };

      saveChecks(dateKey, next);

      return next;
    });
  }

  function resetToday() {
    if (!dateKey) {
      return;
    }

    const confirmed = window.confirm(
      "Réinitialiser toutes les tâches cochées d'aujourd'hui ?"
    );

    if (!confirmed) {
      return;
    }

    setChecks({});
    saveChecks(dateKey, {});

    previouslyComplete.current = false;
    setToastOpen(false);
  }

  return (
    <>
      <ConnectionBar />

      <PageTitle
        eyebrow="TRAVAIL · HÔTEL"
        title="Checklist du jour"
        description={
          now
            ? formatDate(now)
            : "Chargement de la date…"
        }
        action={
          <Chip
            icon={<AccessTimeRounded />}
            label={
              now
                ? formatTime(now)
                : "--:--"
            }
            color="primary"
            variant="outlined"
            sx={{
              fontWeight: 800,
            }}
          />
        }
      />

      <Stack spacing={3}>
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2, sm: 2.5 },
            borderRadius: 3,
          }}
        >
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              sx={{
                justifyContent:
                  "space-between",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Progression
                </Typography>

                <Typography
                  variant="h6"
                  sx={{ fontWeight: 800 }}
                >
                  {completed} / {total} tâches
                </Typography>
              </Box>

              <Chip
                label={
                  complete
                    ? "Terminé"
                    : `${percentage} %`
                }
                color={
                  complete
                    ? "success"
                    : "primary"
                }
                variant="outlined"
                sx={{ fontWeight: 800 }}
              />
            </Stack>

            <LinearProgress
              variant="determinate"
              value={percentage}
              color={
                complete
                  ? "success"
                  : "primary"
              }
              sx={{
                height: 9,
                borderRadius: 999,
              }}
            />
          </Stack>
        </Paper>

        <Box>
          <Stack
            direction="row"
            sx={{
              justifyContent:
                "space-between",
              alignItems: "center",
              mb: 1.5,
            }}
          >
            <Typography
              variant="h6"
              sx={{ fontWeight: 800 }}
            >
              À faire chaque jour
            </Typography>

            <Chip
              label="Arrivée"
              size="small"
              variant="outlined"
            />
          </Stack>

          <Paper
            variant="outlined"
            sx={{
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <List disablePadding>
              {DAILY_TASKS.map(
                (task, index) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    done={Boolean(
                      checks[task.id]
                    )}
                    last={
                      index ===
                      DAILY_TASKS.length - 1
                    }
                    onToggle={() =>
                      toggleTask(task.id)
                    }
                  />
                )
              )}
            </List>
          </Paper>
        </Box>

        <Box>
          <Stack
            direction="row"
            sx={{
              justifyContent:
                "space-between",
              alignItems: "center",
              mb: 1.5,
            }}
          >
            <Typography
              variant="h6"
              sx={{ fontWeight: 800 }}
            >
              Poubelles
            </Typography>

            <Chip
              label={
                now
                  ? formatWeekday(now)
                  : "Aujourd'hui"
              }
              size="small"
              variant="outlined"
            />
          </Stack>

          {binTasks.length > 0 ? (
            <Paper
              variant="outlined"
              sx={{
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <List disablePadding>
                {binTasks.map(
                  (task, index) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      done={Boolean(
                        checks[task.id]
                      )}
                      last={
                        index ===
                        binTasks.length - 1
                      }
                      onToggle={() =>
                        toggleTask(task.id)
                      }
                    />
                  )
                )}
              </List>
            </Paper>
          ) : (
            <Alert
              severity="warning"
              sx={{
                borderRadius: 3,
              }}
            >
              <Typography
                variant="body2"
                sx={{ fontWeight: 700 }}
              >
                Aucune sortie spéciale
                aujourd&apos;hui.
              </Typography>

              <Typography
                variant="body2"
                sx={{ mt: 0.5 }}
              >
                Lundi : bac noir à 21h ·
                Mardi : rentrer/nettoyer à
                8h · Mercredi : bac jaune à
                21h.
              </Typography>
            </Alert>
          )}
        </Box>

        <Box>
          <Button
            variant="outlined"
            startIcon={
              <RestartAltRounded />
            }
            onClick={resetToday}
            fullWidth
            sx={{
              minHeight: 48,
              borderRadius: 3,
            }}
          >
            Réinitialiser aujourd&apos;hui
          </Button>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          align="center"
          sx={{
            display: "block",
            pb: 2,
          }}
        >
          Les coches sont enregistrées sur
          cet appareil pour la journée en
          cours. La liste s&apos;adapte
          automatiquement au jour de la
          semaine.
        </Typography>
      </Stack>

      <Snackbar
        open={toastOpen}
        autoHideDuration={2300}
        onClose={() =>
          setToastOpen(false)
        }
        message="Toutes les tâches sont terminées ✓"
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "center",
        }}
      />
    </>
  );
}