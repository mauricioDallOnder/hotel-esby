import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applyCommand,
  DomainError,
  issuePhotoIds,
  type Command,
  type State,
  type Change,
} from "./domain";

const directory = () =>
  process.env.LOCAL_DATA_DIR || path.join(process.cwd(), "data");
export const storageMode = () =>
  process.env.STORAGE_DRIVER === "sheets" ? "sheets" : "local";
function localState(): State {
  try {
    return JSON.parse(
      readFileSync(path.join(directory(), "hotel.json"), "utf8")
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { issues: [], inspections: [] };
    throw error;
  }
}
async function google<T>(payload: Record<string, unknown>): Promise<T> {
  const url = process.env.GOOGLE_SCRIPT_URL;
  const token = process.env.GOOGLE_API_TOKEN;
  if (!url || !token)
    throw new DomainError(
      "La connexion Google Sheets n’est pas configurée.",
      503
    );
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))
    throw new DomainError("URL Google Apps Script invalide.", 503);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, token }),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new DomainError(
      "Google Sheets est indisponible. Vérifiez la connexion puis actualisez avant de réessayer.",
      503
    );
  }
  let result: { ok: boolean; data: T; error?: string; code?: number };
  try {
    result = await response.json();
  } catch {
    throw new DomainError(
      "Réponse Google invalide. Vérifiez le déploiement Apps Script.",
      502
    );
  }
  if (!response.ok || !result.ok)
    throw new DomainError(
      result.error || "Erreur Google Sheets.",
      result.code || 502
    );
  return result.data;
}
export async function readState(): Promise<State> {
  return storageMode() === "sheets"
    ? google<State>({ action: "list" })
    : localState();
}
export async function execute(command: Command): Promise<State> {
  if (storageMode() === "sheets") {
    const state = await google<State & { maxIssuePhotos?: number }>({ action: "list" });
    const change = applyCommand(state, command);
    if (change.collection === "issues") {
      const { photosData, ...recordChange } = change;
      if ((photosData?.length || 0) > 1 && state.maxIssuePhotos !== 3)
        throw new DomainError("La connexion Google doit être mise à jour par la direction pour enregistrer plusieurs photos.", 503);
      await google({
        action: "commit",
        ...recordChange,
        ...(photosData?.length === 1 ? { photoData: photosData[0] } : { photosData }),
      });
    } else {
      await google({ action: "commit", ...change });
    }
    return readState();
  }
  // Synchronous read + replace keeps local writes serialized in one Node process.
  // Google uses optimistic versions plus a script lock for multiple instances.
  const state = localState();
  const change = applyCommand(state, command);
  mkdirSync(directory(), { recursive: true });
  if (change.collection === "issues" && change.photosData?.length) {
    mkdirSync(path.join(directory(), "photos"), { recursive: true });
    change.record.photoIds = change.photosData.map((photo, index) => {
      const photoId = `${change.record.id}-${index}`;
      writeFileSync(
        path.join(directory(), "photos", photoId + ".jpg"),
        Buffer.from(photo.split(",")[1], "base64"),
        { mode: 0o600 }
      );
      return photoId;
    });
    change.record.photoId = change.record.photoIds[0];
  }
  replace(state, change);
  const temp = path.join(directory(), "hotel." + crypto.randomUUID() + ".tmp");
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, path.join(directory(), "hotel.json"));
  return state;
}
function replace(state: State, change: Change) {
  if (change.collection === "issues")
    state.issues = [
      ...state.issues.filter((i) => i.id !== change.record.id),
      change.record,
    ];
  else
    state.inspections = [
      ...state.inspections.filter((i) => i.id !== change.record.id),
      change.record,
    ];
}
export async function readPhoto(issueId: string, index = 0): Promise<Buffer> {
  const issue = (await readState()).issues.find((i) => i.id === issueId);
  const photoId = issue && issuePhotoIds(issue)[index];
  if (!Number.isInteger(index) || index < 0 || !photoId)
    throw new DomainError("Photo introuvable.", 404);
  if (storageMode() === "sheets") {
    const result = await google<{ base64: string }>({
      action: "photo",
      issueId,
      index,
    });
    return Buffer.from(result.base64, "base64");
  }
  if (!/^[\da-f-]{36}(?:-[0-2])?$/i.test(photoId))
    throw new DomainError("Photo invalide.");
  return readFileSync(path.join(directory(), "photos", photoId + ".jpg"));
}
