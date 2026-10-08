import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { absenceDeleteSchema, parseEntry, roomIssue, type Entry, type EntryChange } from "./rooms";
import { today } from "./domain";
import { ReadCache } from "./readCache";
import {
  applyCommand,
  DomainError,
  issuePhotoIds,
  MAX_ISSUE_PHOTOS,
  type Command,
  type State,
  type Change,
} from "./domain";

const directory = () =>
  process.env.LOCAL_DATA_DIR || path.join(process.cwd(), "data");

export const storageMode = () =>
  process.env.STORAGE_DRIVER === "sheets" ? "sheets" : "local";

const stateCache = new ReadCache<State>(15_000, 1);
const photoCache = new ReadCache<Buffer>(15 * 60_000, 32 * 1024 * 1024, (photo) => photo.length);

function googleScope() {
  return createHash("sha256")
    .update(JSON.stringify([process.env.GOOGLE_SCRIPT_URL, process.env.GOOGLE_API_TOKEN]))
    .digest("hex");
}

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
    
  const readOnly = payload.action === "list" || payload.action === "photo";
  const started = Date.now();
  
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    let result: { ok: boolean; data: T; error?: string; code?: number };
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, token }),
        cache: "no-store",
        redirect: "follow",
        // No modo leitura (fotos), aborta em 8s para evitar o timeout 503 da Vercel
        signal: AbortSignal.timeout(Math.max(1, Math.min(readOnly ? 8_000 : 55_000, 55_000 - (Date.now() - started)))),
      });
      
      if (!response.ok) {
        await response.body?.cancel();
        // OTIMIZAÇÃO: Exponential backoff até 4 tentativas (attempt < 3) em caso de Rate Limit / Erros temporários
        if (readOnly && attempt < 3 && [429, 500, 502, 503, 504].includes(response.status) && Date.now() - started < 54_000) {
          await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
          continue;
        }
        
        throw new DomainError(
          [401, 403, 404].includes(response.status)
            ? "Le déploiement Google est inaccessible. Vérifiez son URL et ses autorisations."
            : "Google est temporairement indisponible. Réessayez dans quelques instants.",
          503
        );
      }
      
      result = await response.json();
      if (!result || typeof result.ok !== "boolean") throw new SyntaxError("Invalid Google response");
      
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const failure = error as Error & { cause?: { code?: string } };
      const elapsed = Date.now() - started;
      
      // OTIMIZAÇÃO: Exponential backoff também para falhas de rede do fetch
      if (readOnly && attempt < 3 && elapsed < 54_000) {
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
        continue;
      }
      
      console.error("[hotel:google]", { action: payload.action, elapsed, name: failure.name, code: failure.cause?.code });
      throw new DomainError(
        error instanceof SyntaxError
          ? "Réponse Google invalide. Vérifiez le déploiement Apps Script."
          : "La connexion Google a échoué ou a mis trop de temps à répondre. Réessayez dans quelques instants.",
        error instanceof SyntaxError ? 502 : 503
      );
    }
    
    if (!result.ok)
      // A Google token failure is a server configuration error, not an expired hotel session.
      throw new DomainError(result.code === 401
        ? "L’accès du serveur à Google est refusé. Vérifiez la configuration de la connexion."
        : result.error || "Erreur Google Sheets.", result.code === 401 ? 503 : result.code || 502);
        
    return result.data;
  }
}

export async function readState({ fresh = false } = {}): Promise<State> {
  if (fresh) stateCache.clear();
  return storageMode() === "sheets"
    ? stateCache.get(googleScope(), () => google<State>({ action: "list" }))
    : localState();
}

export async function execute(command: Command): Promise<State> {
  if (storageMode() === "sheets") {
    const state = await google<State & { maxIssuePhotos?: number }>({ action: "list" });
    const change = applyCommand(state, command);
    stateCache.clear();
    try {
      if (change.collection === "issues") {
        const { photosData, ...recordChange } = change;
        if ((photosData?.length || 0) > 1 && state.maxIssuePhotos !== MAX_ISSUE_PHOTOS)
          throw new DomainError("La connexion Google doit être mise à jour par la direction pour enregistrer plusieurs photos.", 503);
        await google({
          action: "commit",
          ...recordChange,
          ...(photosData?.length === 1 ? { photoData: photosData[0] } : { photosData }),
        });
      } else {
        await google({ action: "commit", ...change });
      }
    } finally {
      stateCache.clear();
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

// OTIMIZAÇÃO: Fila (Semáforo) para evitar congestionamento no Google Drive ao ler múltiplas fotos
const photoQueue: (() => void)[] = [];
let activePhotos = 0;
const MAX_CONCURRENT_PHOTOS = 3; // O Google tolera bem 2 pedidos simultâneos sem rate limiting agressivo

async function acquirePhotoToken() {
  if (activePhotos < MAX_CONCURRENT_PHOTOS) {
    activePhotos++;
    return;
  }
  return new Promise<void>(resolve => photoQueue.push(resolve));
}

function releasePhotoToken() {
  activePhotos--;
  if (photoQueue.length > 0) {
    activePhotos++;
    const next = photoQueue.shift();
    if (next) next();
  }
}

export async function readPhoto(issueId: string, index = 0, collection: "issues" | "roomInspections" = "issues"): Promise<Buffer> {
  if (!/^[\da-f-]{36}$/i.test(issueId) || !Number.isInteger(index) || index < 0 || index >= MAX_ISSUE_PHOTOS)
    throw new DomainError("Photo introuvable.", 404);
    
  if (storageMode() === "sheets") {
    // Apps Script checks that this index belongs to the issue. No extra list call.
    return photoCache.get(`${googleScope()}:${collection}:${issueId}:${index}`, async () => {
      // Controla a concorrência antes de fazer fetch ao Google
      await acquirePhotoToken(); 
      try {
        const result = await google<{ base64: string }>({ action: "photo", issueId, index, collection });
        return Buffer.from(result.base64, "base64");
      } finally {
        releasePhotoToken(); // Liberta espaço para o pedido de outra foto
      }
    });
  }
  
  const issue = ((await readState())[collection] || []).find((i) => i.id === issueId);
  const photoId = issue && issuePhotoIds(issue)[index];
  
  if (!Number.isInteger(index) || index < 0 || !photoId)
    throw new DomainError("Photo introuvable.", 404);
  if (!/^[\da-f-]{36}(?:-[0-2])?$/i.test(photoId))
    throw new DomainError("Photo invalide.");
    
  return readFileSync(path.join(directory(), "photos", photoId + ".jpg"));
}

// New entries are immutable and idempotent: a retry returns the original receipt.
// One Google request per save, with no full hotel download before or after it.
export async function executeEntry(input: Entry, legacy = false): Promise<EntryChange> {
  const entry = parseEntry(input, legacy);
  if (entry.type === "createRoomInspection" && entry.date > today())
    throw new DomainError("La date du contrôle ne peut pas être dans le futur.");
    
  const submissionHash = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  const { photosData, ...fields } = entry.type === "createRoomInspection" ? entry : { ...entry, photosData: [] };
  
  const record = { ...fields, version: 1, updatedAt: new Date().toISOString(), submissionHash,
    ...(entry.type === "createRoomInspection" ? { photoIds: [], photoId: null } : {}) };
    
  const collection = entry.type === "createRoomInspection" ? "roomInspections" : "familyEvents";
  const change = { collection, record } as EntryChange;
  
  if (change.collection === "roomInspections") change.issue = roomIssue(change.record, photosData.length > 0);
  
  if (storageMode() === "sheets") {
    try {
      const receipt = await google<EntryChange>({ action: "commitEntry", ...change, expectedVersion: 0, photosData });
      if (receipt?.collection !== collection || receipt.record?.id !== entry.id || receipt.record?.submissionHash !== submissionHash)
        throw new DomainError("Mettez à jour le déploiement Apps Script pour enregistrer ces données.", 503);
      if (change.collection === "roomInspections" && change.issue && (receipt.collection !== "roomInspections" || receipt.issue?.id !== change.issue.id))
        throw new DomainError("Mettez à jour le déploiement Apps Script pour synchroniser les anomalies des chambres.", 503);
      return receipt;
    } finally { stateCache.clear(); }
  }
  
  const state = localState();
  if (collection === "familyEvents" && state.deletedFamilyEventIds?.includes(entry.id))
    throw new DomainError("Cette absence a été supprimée.", 409);
    
  const existing = (state[collection] || []).find(item => item.id === entry.id);
  if (existing) {
    if (existing.submissionHash !== submissionHash) throw new DomainError("Ce numéro d’enregistrement existe avec un contenu différent.", 409);
    return { collection, record: existing, ...(collection === "roomInspections" ? { issue: state.issues.find(i => i.id === existing.id) } : {}) } as EntryChange;
  }
  
  mkdirSync(directory(), { recursive: true });
  
  if (change.collection === "roomInspections" && photosData.length) {
    mkdirSync(path.join(directory(), "photos"), { recursive: true });
    change.record.photoIds = photosData.map((photo, index) => {
      const id = `${record.id}-${index}`;
      writeFileSync(path.join(directory(), "photos", id + ".jpg"), Buffer.from(photo.split(",")[1], "base64"), { mode: 0o600 });
      return id;
    });
    change.record.photoId = change.record.photoIds[0];
  }
  
  if (change.collection === "roomInspections") {
    state.roomInspections = [...(state.roomInspections || []), change.record];
    if (change.issue) {
      change.issue.photoIds = change.record.photoIds;
      change.issue.photoId = change.record.photoId;
      state.issues.push(change.issue);
    }
  }
  else state.familyEvents = [...(state.familyEvents || []), change.record];
  
  const temp = path.join(directory(), "hotel." + crypto.randomUUID() + ".tmp");
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, path.join(directory(), "hotel.json"));
  
  return change;
}

export async function deleteAbsence(input: unknown): Promise<{ deleted: true; id: string }> {
  const { id, collection } = absenceDeleteSchema.parse(input);
  
  if (storageMode() === "sheets") {
    try {
      const receipt = await google<{ deleted: true; id: string }>({ action: "deleteEntry", collection, id });
      if (receipt?.deleted !== true || receipt.id !== id) throw new DomainError("Confirmation de suppression invalide.", 502);
      return receipt;
    } finally { stateCache.clear(); }
  }
  
  const state = localState();
  const record = state.familyEvents?.find(r => r.id === id);
  
  if (!record && state.deletedFamilyEventIds?.includes(id)) return { deleted: true, id };
  if (!record) throw new DomainError("Absence introuvable.", 404);
  if (record.kind !== "absence") throw new DomainError("Seules les absences peuvent être supprimées.", 400);
  
  state.familyEvents = state.familyEvents!.filter(r => r.id !== id);
  state.deletedFamilyEventIds = [...new Set([...(state.deletedFamilyEventIds || []), id])];
  
  mkdirSync(directory(), { recursive: true });
  const temp = path.join(directory(), "hotel." + crypto.randomUUID() + ".tmp");
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, path.join(directory(), "hotel.json"));
  
  return { deleted: true, id };
}