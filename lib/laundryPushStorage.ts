import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DomainError, type State } from "./domain";
import { laundryMachineStates } from "./laundry";
import { laundryPushSubscriptionSchema } from "./laundryPush";
import { google, storageMode } from "./storage";

export type LaundryPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};
export type StoredLaundryPushSubscription = {
  id: string;
  subscription: LaundryPushSubscription;
  createdAt: string;
  updatedAt: string;
};
type DeliveryRequest = { id: string; cycleId: string; stage: "soon" | "finished"; expiresAt: string };
type DeliveryClaim = { id: string; leaseToken: string };
type DeliveryResult = DeliveryClaim & { outcome: "sent" | "retry" };
type Delivery = DeliveryRequest & { leaseToken: string; leaseUntil: string; sentAt?: string };
type PrivateState = { version: 1; subscriptions: StoredLaundryPushSubscription[]; deliveries: Delivery[] };

const directory = () => process.env.LOCAL_DATA_DIR || path.join(process.cwd(), "data");
const privateFile = () => path.join(directory(), "laundry-notifications.json");
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MINUTE = 60_000;

function timestamp(value: string) {
  const time = Date.parse(value);
  if (!isoPattern.test(value) || !Number.isFinite(time))
    throw new DomainError("Date de notification invalide.");
  return time;
}

function privateState(): PrivateState {
  try {
    const state: PrivateState = JSON.parse(readFileSync(privateFile(), "utf8"));
    if (state.version !== 1 || !Array.isArray(state.subscriptions) || !Array.isArray(state.deliveries))
      throw new DomainError("Le stockage des notifications est invalide.", 503);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, subscriptions: [], deliveries: [] };
    throw error;
  }
}

function writePrivateState(state: PrivateState) {
  mkdirSync(directory(), { recursive: true });
  const temporary = path.join(directory(), `laundry-notifications-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, privateFile());
}

function prune(state: PrivateState, now: number) {
  state.subscriptions = state.subscriptions.filter(item =>
    item.subscription.expirationTime == null || item.subscription.expirationTime > now);
  // Expired requests cannot be claimed again, so an hour is ample retention
  // for acknowledgements delayed by a transient provider/network failure.
  state.deliveries = state.deliveries.filter(item => timestamp(item.expiresAt) + 60 * MINUTE > now);
}

export async function saveLaundryPushSubscription(subscription: LaundryPushSubscription): Promise<{ id: string }> {
  const parsed = laundryPushSubscriptionSchema.parse(subscription);
  const id = createHash("sha256").update(parsed.endpoint).digest("hex");
  if (parsed.expirationTime != null && parsed.expirationTime <= Date.now())
    throw new DomainError("Cet abonnement a expiré. Réactivez les notifications.");
  if (storageMode() === "sheets") return google({ action: "laundryPushSave", subscription: parsed, id }, 8_000);
  const now = new Date().toISOString(), state = privateState();
  prune(state, Date.parse(now));
  const previous = state.subscriptions.find(item => item.id === id);
  if (!previous && state.subscriptions.length >= 50)
    throw new DomainError("La limite de 50 appareils est atteinte. Désactivez les notifications sur un ancien appareil.", 409);
  const stored = { id, subscription: parsed, createdAt: previous?.createdAt || now, updatedAt: now };
  state.subscriptions = state.subscriptions.filter(item => item.id !== id);
  state.subscriptions.push(stored);
  writePrivateState(state);
  return { id };
}

export async function removeLaundryPushSubscription(endpoint: string): Promise<void> {
  if (storageMode() === "sheets") {
    await google({ action: "laundryPushDelete", endpoint }, 8_000);
    return;
  }
  const state = privateState();
  prune(state, Date.now());
  state.subscriptions = state.subscriptions.filter(item => item.subscription.endpoint !== endpoint);
  writePrivateState(state);
}

export async function listLaundryPushSubscriptions(): Promise<StoredLaundryPushSubscription[]> {
  if (storageMode() === "sheets") return google({ action: "laundryPushList" }, 8_000);
  const state = privateState();
  prune(state, Date.now());
  return state.subscriptions;
}

function localWorkEvents() {
  try {
    const state: State = JSON.parse(readFileSync(path.join(directory(), "hotel.json"), "utf8"));
    return state.workEvents || [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function validRequests(requests: DeliveryRequest[]) {
  if (!Array.isArray(requests) || requests.length > 300)
    throw new DomainError("Lot de notifications invalide.");
  for (const request of requests) {
    if (!hashPattern.test(request.id) || !uuidPattern.test(request.cycleId) ||
      !["soon", "finished"].includes(request.stage))
      throw new DomainError("Notification invalide.");
    timestamp(request.expiresAt);
  }
}

export async function claimLaundryPushDeliveries(requests: DeliveryRequest[], nowISO: string): Promise<DeliveryClaim[]> {
  validRequests(requests);
  const now = timestamp(nowISO);
  if (storageMode() === "sheets") return google({ action: "laundryPushClaim", requests, now: nowISO }, 8_000);
  // All local reads/mutations remain synchronous until the atomic rename. This
  // serializes competing requests in the local, single-process development mode.
  const state = privateState();
  prune(state, now);
  const active = new Map(laundryMachineStates(localWorkEvents(), now)
    .flatMap(item => item.cycle ? [[item.cycle.cycleId, item.cycle] as const] : []));
  const deliveries = new Map(state.deliveries.map(item => [item.id, item]));
  const claims: DeliveryClaim[] = [];
  for (const request of requests) {
    if (claims.length === 50) break;
    const cycle = active.get(request.cycleId);
    if (!cycle) continue;
    const end = Date.parse(cycle.endsAt), expires = timestamp(request.expiresAt);
    const windowStart = request.stage === "soon" ? end - 10 * MINUTE : end;
    const windowEnd = request.stage === "soon" ? end : end + 15 * MINUTE;
    if (now < windowStart || now >= windowEnd || expires <= now || expires > windowEnd) continue;
    const previous = deliveries.get(request.id);
    if (previous?.sentAt || (previous && timestamp(previous.leaseUntil) > now)) continue;
    const leaseToken = randomUUID();
    deliveries.set(request.id, { ...request, leaseToken, leaseUntil: new Date(now + 2 * MINUTE).toISOString() });
    claims.push({ id: request.id, leaseToken });
  }
  state.deliveries = [...deliveries.values()];
  writePrivateState(state);
  return claims;
}

export async function completeLaundryPushDeliveries(results: DeliveryResult[], nowISO: string): Promise<void> {
  const now = timestamp(nowISO);
  if (!Array.isArray(results) || results.length > 50 || results.some(item =>
    !hashPattern.test(item.id) || !uuidPattern.test(item.leaseToken) || !["sent", "retry"].includes(item.outcome)))
    throw new DomainError("Résultat de notification invalide.");
  if (storageMode() === "sheets") {
    await google({ action: "laundryPushComplete", results, now: nowISO }, 8_000);
    return;
  }
  const state = privateState();
  prune(state, now);
  for (const result of results) {
    const delivery = state.deliveries.find(item => item.id === result.id && item.leaseToken === result.leaseToken);
    if (!delivery || delivery.sentAt) continue;
    if (result.outcome === "sent") delivery.sentAt = nowISO;
    else state.deliveries = state.deliveries.filter(item => item !== delivery);
  }
  writePrivateState(state);
}

export async function getLaundryPushScheduleStatus(): Promise<{ configured: boolean; lastRunAt?: string }> {
  if (storageMode() === "sheets") return google({ action: "laundryPushStatus" }, 8_000);
  // There is no scheduler in local file mode. The browser retains in-app alerts.
  return { configured: false };
}
