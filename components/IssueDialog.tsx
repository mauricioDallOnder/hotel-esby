"use client";
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PhotoCameraOutlined from "@mui/icons-material/PhotoCameraOutlined";
import { useAppContext } from "@/context/AppContext";

import { compressPhoto } from "@/lib/photos";
import { IssueBadges } from "./HotelUI";
import {
  categories,
  createId,
  priorities,
  Status,
  statuses,
  today,
  type Issue,
  type IssueFields,
} from "@/lib/domain";

export function IssueDialog({
  issue,
  defaults,
  onClose,
  onSaved,
}: {
  issue?: Issue;
  defaults?: {
    title?: string;
    location?: string;
    actor?: string;
    priority?: IssueFields["priority"];
    date?: string;
  };
  onClose: () => void;
  onSaved?: (issue: Issue) => void;
}) {
  const { mutate, busy } = useAppContext();
  const [id] = useState(() => issue?.id || createId());
  const [fields, setFields] = useState<IssueFields>(() =>
    issue
      ? {
          title: issue.title,
          location: issue.location,
          category: issue.category,
          priority: issue.priority,
          description: issue.description,
          assignee: issue.assignee,
        }
      : {
          title: defaults?.title || "",
          location: defaults?.location || "",
          category: "Plomberie",
          priority: defaults?.priority || "normale",
          description: "",
          assignee: "",
        }
  );
  const [date, setDate] = useState(defaults?.date || today());
  const [actor, setActor] = useState(defaults?.actor || "");
  const [status, setStatus] = useState<Status>(issue?.status || "ouvert");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string>();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  function change<K extends keyof IssueFields>(key: K, value: IssueFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }
  async function loadPhoto(file?: File) {
    if (!file) return;
    setProcessing(true);
    setError("");
    try {
      setPhoto(await compressPhoto(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await mutate(
        issue
          ? {
              type: "updateIssue",
              id,
              version: issue.version,
              actor,
              note,
              status,
              fields,
            }
          : { type: "createIssue", id, date, actor, fields, photoData: photo }
      );
      const saved = result.issues.find((i) => i.id === id)!;
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog
      open
      onClose={busy || processing ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <Box component="form" onSubmit={submit}>
        <DialogTitle>
          {issue ? "Suivi de l’anomalie" : "Signaler une anomalie"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {issue && <IssueBadges issue={issue} />}
            {!issue && (
              <>
                <Stack sx={{ gap: 1 }} direction={{ xs: "column", sm: "row" }}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<PhotoCameraOutlined />}
                    disabled={processing || busy}
                  >
                    Prendre une photo
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        void loadPhoto(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </Button>
                  <Button component="label" disabled={processing || busy}>
                    Choisir une photo
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        void loadPhoto(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </Button>
                </Stack>
                {processing && (
                  <Typography>Préparation de la photo…</Typography>
                )}
              </>
            )}
            {(photo || issue?.photoId) && (
              <Box>
                <Box
                  component="img"
                  className="photo-preview"
                  src={photo || `/api/photos/${issue!.id}`}
                  alt="Photo du problème signalé"
                />
                {photo && (
                  <Button onClick={() => setPhoto(undefined)}>
                    Retirer la photo
                  </Button>
                )}
              </Box>
            )}
            <TextField
              required
              label="Description du problème"
              placeholder="Ex. : fuite sous le lavabo, eau au sol…"
              multiline
              minRows={3}
              value={fields.description}
              onChange={(e) => change("description", e.target.value)}
            />
            <TextField
              required
              label="Titre"
              placeholder="Ex. : Fuite sous le lavabo"
              value={fields.title}
              onChange={(e) => change("title", e.target.value)}
            />
            <TextField
              required
              label="Lieu précis"
              placeholder="Ex. : Chambre 204 · salle de bain"
              value={fields.location}
              onChange={(e) => change("location", e.target.value)}
            />
            <Stack sx={{ gap: 2 }} direction={{ xs: "column", sm: "row" }}>
              <TextField
                fullWidth
                select
                label="Catégorie"
                value={fields.category}
                onChange={(e) =>
                  change("category", e.target.value as IssueFields["category"])
                }
              >
                {categories.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                select
                label="Priorité"
                value={fields.priority}
                onChange={(e) =>
                  change("priority", e.target.value as IssueFields["priority"])
                }
              >
                {Object.entries(priorities).map(([key, label]) => (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            {!issue && (
              <TextField
                required
                type="date"
                label="Date du constat"
                value={date}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { max: today() },
                }}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
            <TextField
              label="Responsable de l’intervention"
              value={fields.assignee}
              onChange={(e) => change("assignee", e.target.value)}
            />
            <TextField
              required
              label={issue ? "Votre nom" : "Signalé par"}
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
            {issue && (
              <>
                <TextField
                  select
                  label="État de résolution"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Status)}
                >
                  {Object.entries(statuses).map(([key, label]) => (
                    <MenuItem key={key} value={key}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  required
                  label={
                    status === "resolu"
                      ? "Travaux effectués / résolution"
                      : "Intervention ou modification effectuée"
                  }
                  multiline
                  minRows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  helperText="Cette note sera conservée dans le bilan mensuel."
                />
                <Typography variant="h6">Historique</Typography>
                {issue.history.toReversed().map((event, index) => (
                  <Box
                    key={index}
                    sx={{ borderLeft: "3px solid #d6e3d9", pl: 2 }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {new Date(event.at).toLocaleString("fr-FR", {
                        timeZone: "Europe/Paris",
                      })}{" "}
                      · {event.actor} · {statuses[event.status]}
                    </Typography>
                    <Typography
                      sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {event.note}
                    </Typography>
                  </Box>
                ))}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button disabled={busy || processing} onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={busy || processing}
            variant="contained"
            type="submit"
          >
            {busy
              ? "Enregistrement…"
              : issue
              ? "Enregistrer le suivi"
              : "Enregistrer l’anomalie"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
