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
  issuePhotoIds,
  MAX_ISSUE_PHOTOS,
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
  const { mutate, busy, role } = useAppContext();
  const readOnly = !!issue && role !== "direction";
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
  const [photos, setPhotos] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  function change<K extends keyof IssueFields>(key: K, value: IssueFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }
  async function loadPhotos(files: File[]) {
    if (!files.length || processing || busy) return;
    if (photos.length + files.length > MAX_ISSUE_PHOTOS) {
      setError(`Ajoutez au maximum ${MAX_ISSUE_PHOTOS} photos.`);
      return;
    }
    setProcessing(true);
    setError("");
    try {
      const added = await Promise.all(files.map(compressPhoto));
      setPhotos((current) => [...current, ...added]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || processing || busy) return;
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
          : { type: "createIssue", id, date, actor, fields, photosData: photos }
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
          {readOnly ? "Consulter l’anomalie" : issue ? "Suivi de l’anomalie" : "Signaler une anomalie"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {issue && <IssueBadges issue={issue} />}
            {readOnly && <Alert severity="info">Seule la direction peut modifier cette anomalie et son état.</Alert>}
            {!issue && (
              <>
                <Stack sx={{ gap: 1 }} direction={{ xs: "column", sm: "row" }}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<PhotoCameraOutlined />}
                    disabled={processing || busy || photos.length >= MAX_ISSUE_PHOTOS}
                  >
                    Prendre une photo
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        void loadPhotos(Array.from(e.target.files || []));
                        e.target.value = "";
                      }}
                    />
                  </Button>
                  <Button component="label" disabled={processing || busy || photos.length >= MAX_ISSUE_PHOTOS}>
                    Choisir des photos
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        void loadPhotos(Array.from(e.target.files || []));
                        e.target.value = "";
                      }}
                    />
                  </Button>
                </Stack>
                <Typography variant="body2" color="text.secondary">{photos.length} / {MAX_ISSUE_PHOTOS} photos · facultatif</Typography>
                {processing && (
                  <Typography>Préparation des photos…</Typography>
                )}
              </>
            )}
            {(issue ? issuePhotoIds(issue).map((_, index) => `/api/photos/${issue.id}?index=${index}`) : photos).map((src, index) => (
              <Box key={index}>
                <Box
                  component="img"
                  className="photo-preview"
                  src={src}
                  alt={`Photo ${index + 1} du problème signalé`}
                />
                {!issue && (
                  <Button disabled={busy || processing} onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}>
                    Retirer la photo {index + 1}
                  </Button>
                )}
              </Box>
            ))}
            <TextField
              disabled={readOnly}
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
              disabled={readOnly}
              placeholder="Ex. : Fuite sous le lavabo"
              value={fields.title}
              onChange={(e) => change("title", e.target.value)}
            />
            <TextField
              required
              label="Lieu précis"
              disabled={readOnly}
              placeholder="Ex. : Chambre 204 · salle de bain"
              value={fields.location}
              onChange={(e) => change("location", e.target.value)}
            />
            <Stack sx={{ gap: 2 }} direction={{ xs: "column", sm: "row" }}>
              <TextField
                fullWidth
                select
                label="Catégorie"
                disabled={readOnly}
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
                disabled={readOnly}
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
              disabled={readOnly}
              value={fields.assignee}
              onChange={(e) => change("assignee", e.target.value)}
            />
            <TextField
              required
              label={issue && !readOnly ? "Votre nom" : "Signalé par"}
              value={readOnly ? issue.reportedBy : actor}
              disabled={readOnly}
              onChange={(e) => setActor(e.target.value)}
            />
            {issue && (
              <>
                {!readOnly && <>
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
                </>}
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
            {readOnly ? "Fermer" : "Annuler"}
          </Button>
          {!readOnly && <Button
            disabled={busy || processing}
            variant="contained"
            type="submit"
          >
            {busy
              ? "Enregistrement…"
              : issue
              ? "Enregistrer le suivi"
              : "Enregistrer l’anomalie"}
          </Button>}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
